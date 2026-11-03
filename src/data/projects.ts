export interface Project {
  name: string
  description: string
  url: string
  language?: string
}

// Names and descriptions are taken verbatim from GitHub, or from the
// project's own site when it has no public repository.
export const projects: Project[] = [
  {
    name: 'Keel',
    description:
      'One calm Mac app for Redis, Valkey and Dragonfly. Browse millions of keys with SCAN, edit every core type, run commands in a redis-cli-style console and keep production read-only.',
    url: 'https://bearstouch.com/keel',
    language: 'Swift',
  },
  {
    name: 'Trellis',
    description:
      'Every project gets a window, every window its tabs, every tab its panes. Launch whole projects on your Mac or a saved host, see which coding agent needs you, and keep sessions running after you quit. Free and open source.',
    url: 'https://bearstouch.com/trellis/',
    language: 'Swift',
  },
  {
    name: 'SONORA',
    description:
      'An analog-style polyphonic synth for Mac, standalone and as a VST3 and AU plugin, with everything on one screen.',
    url: 'https://oryonaudio.com/sonora/',
    language: 'C++',
  },
  {
    name: 'Luzia',
    description: 'Price and Market Data Crypto API for Developers: Real-time pricing for centralized exchanges (Binance, Coinbase, Kraken, Bybit, OKX), on-chain DEX markets (Solana, Ethereum), and tokenized stocks & real-world assets — all through a single unified API.',
    url: 'https://github.com/luziadev',
    language: 'TypeScript',
  },
  {
    name: 'uberSKILLS',
    description:
      'Design, test, and deploy Claude Code Agent Skills through a visual, AI-assisted workflow.',
    url: 'https://github.com/uberskillsdev/uberSKILLS',
    language: 'TypeScript',
  },
  {
    name: 'picogpt-mlx',
    description:
      'A minimal, from-scratch decoder-only GPT in MLX trained on Tiny Shakespeare on Apple Silicon. Inspired by nanoGPT.',
    url: 'https://github.com/hvasconcelos/picogpt-mlx',
    language: 'Python',
  },
  {
    name: 'postwoman',
    description:
      'PostWoman 💅 is a lightweight Postman alternative designed specifically for macOS',
    url: 'https://github.com/bearstouch/postwoman',
    language: 'Swift',
  },
  {
    name: 'libmlxforge',
    description:
      'Embeddable, batched MLX LLM engine for Apple Silicon, one C ABI, bound from Node, Swift & Rust. Continuous batching, streaming, JSON-constrained structured output, and embeddings.',
    url: 'https://github.com/hvasconcelos/libmlxforge',
    language: 'C++',
  },
  {
    name: 'pictor',
    description:
      'On-device image generation for Apple Silicon: a C++17 inference engine for FLUX.2 klein 4B on MLX (Metal). Text-to-image, instruction editing, multi-reference — 4-step distilled, stable C ABI, CLI + OpenAI Images API server.',
    url: 'https://github.com/hvasconcelos/pictor',
    language: 'C++',
  },
  {
    name: 'banannate',
    description:
      'The easiest way to generate images with Google Gemini from your Terminal. Fast, efficient, and 4K ready. 🙊🙈🙉',
    url: 'https://github.com/hvasconcelos/banannate',
    language: 'TypeScript',
  },
]
