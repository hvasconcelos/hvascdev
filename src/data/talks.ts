export interface Talk {
  title: string
  /** Where it was given — conference, meetup or host company. */
  event: string
  date: string
  /** Slides or a recording, when there is one to link to. */
  url?: string
}

/** Most recent first, matching the Writing section. */
export const talks: Talk[] = [
  {
    title: 'Model Selection is Capacity Planning',
    event: 'API Community',
    date: 'October 2026',
  },
  {
    title: 'AI Inference Stack',
    event: 'Agents Day, Ceeia',
    date: 'July 2026',
  },
  {
    title: 'Building agents, live',
    event: 'Agents Day, Ceeia',
    date: 'July 2026',
  },
  {
    title: 'Agentic Shift, How AI Transformed Engineering at LayerX',
    event: 'Sword Health Office',
    date: 'February 2026',
  },
  {
    title: 'Tracing Web3 Tech Stack Evolutionary Steps',
    event: 'DeHouse',
    date: 'December 2024',
  },
]
