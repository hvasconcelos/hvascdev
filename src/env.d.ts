/// <reference types="astro/client" />

interface ImportMetaEnv {
  /**
   * The site's domain as registered in Plausible (its `data-domain`).
   * Analytics are omitted entirely when this is unset, so a build without it —
   * local dev, or somebody's fork — ships no tracker.
   */
  readonly PLAUSIBLE_DOMAIN?: string
  /**
   * The Plausible origin the script loads from. Defaults to Plausible Cloud;
   * point it at your own instance when self-hosting.
   */
  readonly PLAUSIBLE_HOST?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
