/**
 * The two mechanical steps either side of designing an article's cover.
 * Run both with `npm run cover`.
 *
 *   1. plate  — artwork from `articles/assets/<slug>-source.png`, fitted to
 *               1200x630 and re-grounded onto the site's page colour. This is
 *               what you place in Figma and set type against.
 *   2. card   — the Figma export at `articles/assets/<slug>-card.png`,
 *               re-grounded the same way, written to `public/articles/<slug>.png`.
 *
 * The Figma export is an *input*, never an output. Nothing here writes to a
 * file a person made, so re-running it can't destroy the design.
 *
 * Step 2 exists because Figma exports on whatever near-black the artboard was
 * given, which is a few points off `--color-page` — cool where the site is
 * warm. On its own that is invisible; against the article page, where the card
 * is the first thing under the title, it is a seam. Setting the Figma artboard
 * to #14120b makes this step a no-op, which is the better fix if you remember.
 */
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

// --color-page from the dark theme in global.css. A card is only ever seen
// dark: there is no toggle on somebody else's timeline.
const PAGE = [0x14, 0x12, 0x0b]

const jobs = [
  {
    // The plate. Cropped to 1200x630, the ratio social platforms expect.
    in: '../articles/assets/agi-two-scoreboards-source.png',
    out: '../articles/assets/agi-two-scoreboards-plate.png',
    fit: [1200, 630],
    // Measured off this source, where 85% of pixels sit between 16 and 31.
    ground: [16, 16, 16],
  },
  {
    // The card. Left at the size Figma exported: the type is set relative to
    // that frame, and a crop here would clip it.
    in: '../articles/assets/agi-two-scoreboards-card.png',
    out: '../public/articles/agi-two-scoreboards.png',
    ground: [20, 20, 23],
  },
  {
    // Drawn on the page colour already, so this one is only the palette pass.
    in: '../articles/assets/trellis-more-than-a-terminal-card.png',
    out: '../public/articles/trellis-more-than-a-terminal.png',
    ground: PAGE,
  },
]

/**
 * Maps the artwork's own ground onto the site's, per channel, and stretches
 * everything above it to fit — so `ground` lands exactly on `PAGE` and 255
 * stays 255.
 *
 * A subtract-then-screen does the first half of that but drags the highlights
 * down with it: white type comes out around 237 rather than 255, which on a
 * card whose whole job is legibility is the wrong thing to give away.
 */
function reground(data, ground) {
  const scale = PAGE.map((page, c) => (255 - page) / (255 - ground[c]))

  for (let i = 0; i < data.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const lifted = PAGE[c] + (data[i + c] - ground[c]) * scale[c]
      data[i + c] = Math.max(0, Math.min(255, Math.round(lifted)))
    }
  }

  return data
}

for (const job of jobs) {
  let pipeline = sharp(fileURLToPath(new URL(job.in, import.meta.url)))
  if (job.fit) {
    pipeline = pipeline.resize(job.fit[0], job.fit[1], {
      fit: 'cover',
      position: 'centre',
    })
  }

  const { data, info } = await pipeline
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const target = fileURLToPath(new URL(job.out, import.meta.url))

  await sharp(reground(data, job.ground), {
    raw: { width: info.width, height: info.height, channels: 3 },
  })
    /*
     * Palette PNG. This is flat line art on a near-uniform ground, which is
     * exactly what an indexed palette is for: 1.3 MB of truecolour becomes
     * about 400 KB with nothing visible given up. The card is above the fold
     * on the article, so that weight is on the critical path.
     *
     * quality 90 rather than lower: the only real colour here is the glow
     * around the green linework, and by 70 the palette is too small to hold
     * its halo, which then dithers into speckle.
     */
    .png({ palette: true, quality: 90, effort: 10 })
    .toFile(target)

  console.log(`wrote ${job.out.replace('../', '')}  ${info.width}x${info.height}`)
}
