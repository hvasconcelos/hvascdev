/**
 * SigV4 for nginx, so /files/<key> can be streamed straight out of a private
 * Railway bucket.
 *
 * Railway buckets are private and public buckets are not supported, so an
 * object only reaches a browser through a presigned URL or through something
 * of ours holding the credentials. This container runs no application — nginx
 * serving dist/ off disk is the whole runtime — so the signing happens here,
 * in njs, which the official nginx:alpine image already ships and merely does
 * not load.
 *
 * Wired up in nginx.conf.template as four js_set variables. js_set caches a
 * value for the life of the request, which is the property the whole thing
 * rests on: authorization() reads $s3_date, $s3_key and $bucket_host back out
 * of r.variables rather than recomputing them, so the signature and the
 * headers describe the same request no matter what order nginx happens to
 * evaluate the proxy_set_header directives in.
 *
 * Credentials come from process.env — which nginx wipes from its workers
 * unless each name is declared with the main-context `env` directive. The
 * Dockerfile seds those in. Keeping them here rather than in the template
 * means no secret is ever written into the rendered config file.
 */
import crypto from 'crypto'

/** sha256 of the empty string: every request through here has no body. */
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/** The URL prefix the bucket is mounted at, stripped to form the object key. */
const PREFIX = '/files'

/**
 * The derived signing key, memoised on its scope date. It is four HMACs deep
 * and changes once a day, and nginx workers are long-lived.
 */
let signingKeyCache = { date: null, key: null }

/** Railway's own names for the credentials, as the bucket hands them over. */
function env(name) {
  return process.env[name] || ''
}

/**
 * Buckets created before Railway moved to virtual-hosted URLs address the
 * bucket as a path segment instead of a subdomain. The bucket's Credentials
 * tab says which style it wants; set S3_PATH_STYLE=1 for the older one.
 */
function pathStyle() {
  return env('S3_PATH_STYLE') === '1'
}

/** The endpoint as a bare hostname: https://t3.storageapi.dev -> t3.storageapi.dev */
function endpointHost() {
  return env('ENDPOINT').replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

/**
 * $bucket_host — the Host header, the SNI name and the authority in
 * proxy_pass, all from one place.
 *
 * Empty when the bucket variables are missing, which makes proxy_pass invalid
 * and costs a 502 on /files/ alone. The rest of the site is files on disk and
 * does not care.
 */
function host() {
  const endpoint = endpointHost()
  const bucket = env('BUCKET')
  if (!endpoint || !bucket) return ''
  return pathStyle() ? endpoint : `${bucket}.${endpoint}`
}

/** $s3_date — YYYYMMDDTHHMMSSZ, from a single clock reading per request. */
function date() {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
}

/**
 * $s3_key — the path sent upstream, which is also the canonical URI that gets
 * signed. The two have to agree byte for byte, and they do because nginx
 * passes a proxy_pass URI built from variables through unchanged rather than
 * re-escaping it.
 *
 * r.uri arrives percent-decoded, so each segment is encoded back. AWS
 * canonicalisation escapes everything outside A-Za-z0-9-_.~ while
 * encodeURIComponent leaves !'()* alone — a key containing one of those would
 * be signed differently at the two ends, so scripts/bucket.mjs refuses to
 * upload one.
 */
function key(r) {
  const rest = r.uri.substring(PREFIX.length)
  const encoded = rest.split('/').map(encodeURIComponent).join('/')
  return pathStyle() ? `/${encodeURIComponent(env('BUCKET'))}${encoded}` : encoded
}

/** HMAC-SHA256, taking and returning bytes so the derivation chain composes. */
function hmac(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest()
}

/** AWS4 -> date -> region -> service -> aws4_request. */
function signingKey(scopeDate, region) {
  if (signingKeyCache.date !== scopeDate) {
    const kDate = hmac(`AWS4${env('SECRET_ACCESS_KEY')}`, scopeDate)
    const kRegion = hmac(kDate, region)
    const kService = hmac(kRegion, 's3')
    signingKeyCache = { date: scopeDate, key: hmac(kService, 'aws4_request') }
  }
  return signingKeyCache.key
}

/**
 * $s3_auth — the Authorization header.
 *
 * The method is r.method rather than a literal GET: nginx forwards a HEAD as a
 * HEAD, and a signature over the wrong verb is no signature at all.
 */
function authorization(r) {
  const accessKey = env('ACCESS_KEY_ID')
  const region = env('REGION') || 'auto'
  if (!accessKey || !env('SECRET_ACCESS_KEY')) return ''

  const amzDate = r.variables.s3_date
  const scopeDate = amzDate.substring(0, 8)
  const scope = `${scopeDate}/${region}/s3/aws4_request`

  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = [
    r.method,
    r.variables.s3_key,
    '',
    `host:${r.variables.bucket_host}`,
    `x-amz-content-sha256:${EMPTY_SHA256}`,
    `x-amz-date:${amzDate}`,
    '',
    signedHeaders,
    EMPTY_SHA256,
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n')

  const signature = crypto
    .createHmac('sha256', signingKey(scopeDate, region))
    .update(stringToSign)
    .digest('hex')

  return `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

export default { host, date, key, authorization }
