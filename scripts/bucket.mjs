/**
 * Puts things in the Railway bucket that nginx serves at /files/.
 *
 *   npm run files -- ls [prefix]
 *   npm run files -- put <local-path> [key] [--cache=...] [--type=...]
 *   npm run files -- rm <key>
 *   npm run files -- sync <dir> <prefix>
 *
 * The bucket is additive: everything already under public/ stays committed and
 * stays authoritative, and this is for the things a git repository should not
 * hold — video, hi-res artwork, a PDF — plus a copy of anything that wants a
 * hotlinkable URL. An upload is live immediately; nothing is rebuilt.
 *
 * No dependency. SigV4 is four HMACs and a canonical string, node:crypto has
 * both, and fetch is in the runtime — the same trade as the hand-rolled ICO in
 * generate-icons.mjs and the hand-rolled sitemap.
 *
 * Credentials are the five variables Railway's bucket hands out, read from
 * .env or .env.local (the latter wins) or straight from the environment:
 *
 *   BUCKET  ACCESS_KEY_ID  SECRET_ACCESS_KEY  REGION  ENDPOINT
 *
 * and S3_PATH_STYLE=1 for a bucket old enough to want path-style URLs. They
 * are the same names s3-signer.js reads inside the container, on purpose.
 */
import { createHash, createHmac } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, extname, join, relative, sep } from 'node:path'

// Read the env files here rather than through an npm flag, so the script runs
// the same way the others do — plain `node scripts/bucket.mjs`. .env.local
// wins, as it does for Astro itself. A missing file is the normal case.
for (const file of ['.env', '.env.local']) {
  try {
    process.loadEnvFile(new URL(`../${file}`, import.meta.url))
  } catch {}
}

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/**
 * A key nginx and the bucket are guaranteed to agree on. AWS canonicalisation
 * escapes everything outside A-Za-z0-9-_.~, and neither nginx nor
 * encodeURIComponent escapes !'()* — a key containing one would be signed one
 * way here and another way at the edge, and fail with a signature error that
 * says nothing about why. Refuse it at the point of upload instead.
 */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

/** Enough of a table to cover what actually gets uploaded here. */
const TYPES = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.m4a': 'audio/mp4',
  '.md': 'text/markdown; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.zip': 'application/zip',
}

/**
 * An hour. Long enough that Cloudflare absorbs the repeats — the bytes are
 * service egress and are billed — and short enough that replacing a file under
 * the same key is visible the same morning. Override per upload with --cache=.
 */
const DEFAULT_CACHE = 'public, max-age=3600'

const config = {
  bucket: process.env.BUCKET ?? '',
  accessKey: process.env.ACCESS_KEY_ID ?? '',
  secretKey: process.env.SECRET_ACCESS_KEY ?? '',
  region: process.env.REGION || 'auto',
  endpoint: (process.env.ENDPOINT ?? '').replace(/\/+$/, ''),
  pathStyle: process.env.S3_PATH_STYLE === '1',
}

/** The site's own origin, which is written in astro.config.mjs and nowhere else. */
async function siteOrigin() {
  const source = await readFile(new URL('../astro.config.mjs', import.meta.url), 'utf8')
  return source.match(/site:\s*'([^']+)'/)?.[1] ?? ''
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

function requireConfig() {
  const missing = ['bucket', 'accessKey', 'secretKey', 'endpoint'].filter((k) => !config[k])
  if (missing.length) {
    fail(
      'Missing bucket credentials. Copy BUCKET, ACCESS_KEY_ID, SECRET_ACCESS_KEY,\n' +
        'REGION and ENDPOINT out of the bucket\'s Credentials tab on Railway into .env.',
    )
  }
}

/** AWS's percent-encoding, which is stricter than encodeURIComponent's. */
function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function hmac(secret, data) {
  return createHmac('sha256', secret).update(data).digest()
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Signs one request and returns what fetch needs. Virtual-hosted by default —
 * the bucket is the subdomain — which is the style Railway issues today.
 */
function sign({ method, key = '/', query = {}, body }) {
  const endpointHost = config.endpoint.replace(/^https?:\/\//, '')
  const host = config.pathStyle ? endpointHost : `${config.bucket}.${endpointHost}`
  const path = config.pathStyle ? `/${config.bucket}${key}` : key

  const canonicalUri = path.split('/').map(encodeRfc3986).join('/')
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k])}`)
    .join('&')

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const scopeDate = amzDate.slice(0, 8)
  const scope = `${scopeDate}/${config.region}/s3/aws4_request`
  const payloadHash = body ? sha256(body) : EMPTY_SHA256

  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    '',
    signedHeaders,
    payloadHash,
  ].join('\n')

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')

  const kDate = hmac(`AWS4${config.secretKey}`, scopeDate)
  const kRegion = hmac(kDate, config.region)
  const kService = hmac(kRegion, 's3')
  const signature = createHmac('sha256', hmac(kService, 'aws4_request'))
    .update(stringToSign)
    .digest('hex')

  return {
    url: `https://${host}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`,
    headers: {
      host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  }
}

/** Sends a signed request, and turns an S3 error document into one line. */
async function send({ method, key, query, body, headers = {} }) {
  const signed = sign({ method, key, query, body })
  const response = await fetch(signed.url, {
    method,
    headers: { ...signed.headers, ...headers },
    body,
  })

  if (!response.ok && response.status !== 404) {
    const text = await response.text()
    const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? response.status
    const message = text.match(/<Message>([^<]+)<\/Message>/)?.[1] ?? response.statusText
    fail(`${method} ${key ?? '/'} — ${code}: ${message}`)
  }

  return response
}

function checkKey(key) {
  if (!SAFE_KEY.test(key) || key.includes('//') || key.includes('..')) {
    fail(
      `Refusing the key "${key}".\n` +
        'Keys are [A-Za-z0-9._/-], start with a letter or digit, and contain no // or ..\n' +
        'Anything else signs differently at the two ends and 403s at the edge.',
    )
  }
  return key
}

/** ListObjectsV2, following the continuation token. */
async function list(prefix = '') {
  const keys = []
  let token

  do {
    const query = { 'list-type': '2', 'max-keys': '1000' }
    if (prefix) query.prefix = prefix
    if (token) query['continuation-token'] = token

    const xml = await (await send({ method: 'GET', key: '/', query })).text()

    for (const entry of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []) {
      keys.push({
        key: entry.match(/<Key>([^<]*)<\/Key>/)?.[1] ?? '',
        size: Number(entry.match(/<Size>(\d+)<\/Size>/)?.[1] ?? 0),
        modified: entry.match(/<LastModified>([^<]*)<\/LastModified>/)?.[1] ?? '',
      })
    }

    token = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1]
  } while (token)

  return keys
}

async function put(localPath, key, { cache, type }) {
  const body = await readFile(localPath)
  const contentType = type ?? TYPES[extname(localPath).toLowerCase()] ?? 'application/octet-stream'

  await send({
    method: 'PUT',
    key: `/${key}`,
    body,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': cache ?? DEFAULT_CACHE,
    },
  })

  return { bytes: body.length, contentType }
}

/** Every file under a directory, depth first, with POSIX separators. */
async function walk(dir, base = dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full, base)))
    else out.push({ path: full, rel: relative(base, full).split(sep).join('/') })
  }
  return out
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const [command, ...rest] = process.argv.slice(2)
// Split on the first = only: a Cache-Control is full of them.
const flags = Object.fromEntries(
  rest
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const arg = a.replace(/^--/, '')
      const eq = arg.indexOf('=')
      return eq === -1 ? [arg, true] : [arg.slice(0, eq), arg.slice(eq + 1)]
    }),
)
const args = rest.filter((a) => !a.startsWith('--'))

requireConfig()
const origin = await siteOrigin()

switch (command) {
  case 'ls': {
    const keys = await list(args[0] ?? '')
    if (!keys.length) {
      console.log(args[0] ? `Nothing under ${args[0]}` : 'The bucket is empty.')
      break
    }
    for (const { key, size, modified } of keys) {
      console.log(`${human(size).padStart(9)}  ${modified.slice(0, 10)}  ${key}`)
    }
    console.log(`\n${keys.length} object${keys.length === 1 ? '' : 's'}`)
    break
  }

  case 'put': {
    const [localPath, given] = args
    if (!localPath) fail('Usage: npm run files -- put <local-path> [key]')
    const key = checkKey(given ?? basename(localPath))
    const { bytes, contentType } = await put(localPath, key, flags)
    console.log(`${localPath} -> ${key}  (${human(bytes)}, ${contentType})`)
    console.log(`${origin}/files/${key}`)
    break
  }

  case 'rm': {
    const [key] = args
    if (!key) fail('Usage: npm run files -- rm <key>')
    await send({ method: 'DELETE', key: `/${checkKey(key)}` })
    console.log(`Deleted ${key}`)
    break
  }

  case 'sync': {
    const [dir, prefix = ''] = args
    if (!dir) fail('Usage: npm run files -- sync <dir> <prefix>')
    if (prefix) checkKey(prefix.replace(/\/$/, ''))
    if (!(await stat(dir)).isDirectory()) fail(`${dir} is not a directory`)

    const files = await walk(dir)
    for (const file of files) {
      const key = checkKey(`${prefix.replace(/\/$/, '')}${prefix ? '/' : ''}${file.rel}`)
      const { bytes } = await put(file.path, key, flags)
      console.log(`${key.padEnd(48)} ${human(bytes)}`)
    }
    console.log(`\n${files.length} file${files.length === 1 ? '' : 's'} -> ${origin}/files/${prefix}`)
    break
  }

  default:
    console.log(
      [
        'Usage:',
        '  npm run files -- ls [prefix]',
        '  npm run files -- put <local-path> [key] [--cache=...] [--type=...]',
        '  npm run files -- rm <key>',
        '  npm run files -- sync <dir> <prefix>',
        '',
        `Served at ${origin || 'https://…'}/files/<key>`,
      ].join('\n'),
    )
}
