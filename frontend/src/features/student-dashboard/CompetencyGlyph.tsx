import type { CSSProperties, ReactElement } from 'react'

/* A calm, conceptual line-art illustration per activeness competency — shown in
 * the learning-map topic dialog so the panel reads at a glance instead of as a
 * wall of text. Stroke uses the topic accent via currentColor. */

const GLYPHS: Record<string, ReactElement> = {
  // Growth mindset — a sprout rising from the ground.
  growth_mindset: (
    <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M30 68h72" />
      <path d="M66 68V36" />
      <path d="M66 50c-11 1-19-5-21-16 12-2 20 4 21 16z" />
      <path d="M66 44c9-2 16-9 16-18-11-1-17 5-16 18z" />
      <circle cx="66" cy="30" r="4.5" fill="currentColor" stroke="none" />
      <path d="M40 22l3 5M92 22l-3 5" opacity=".55" />
    </g>
  ),
  // Motivation & relevance — a target with a guiding star.
  motivation_relevance: (
    <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="56" cy="48" r="22" />
      <circle cx="56" cy="48" r="12.5" />
      <circle cx="56" cy="48" r="3.6" fill="currentColor" stroke="none" />
      <path d="M98 16l2.6 6.4 6.9.6-5.2 4.5 1.6 6.7-5.9-3.6-5.9 3.6 1.6-6.7-5.2-4.5 6.9-.6z" />
    </g>
  ),
  // Initiative & responsibility — steps leading to a planted flag.
  initiative_responsibility: (
    <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M98 20v46" />
      <path d="M98 22h20l-5.5 7 5.5 7H98" />
      <path d="M26 66h34" />
      <path d="M30 55h26" opacity=".85" />
      <path d="M40 44h22" opacity=".65" />
    </g>
  ),
  // Self-regulation — a steady gauge with its needle balanced.
  self_regulation: (
    <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M32 62a30 30 0 0 1 60 0" />
      <path d="M62 62 80 40" />
      <circle cx="62" cy="62" r="4.6" fill="currentColor" stroke="none" />
      <path d="M32 62h-4M92 62h4M62 30v-4" opacity=".7" />
    </g>
  ),
  // Self-awareness — a figure meeting its own reflection.
  self_awareness: (
    <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M66 18v50" strokeDasharray="4 6" opacity=".8" />
      <circle cx="46" cy="34" r="8" />
      <path d="M32 66c0-11 6-17 14-17s14 6 14 17" />
      <circle cx="86" cy="34" r="8" opacity=".55" />
      <path d="M72 66c0-11 6-17 14-17s14 6 14 17" opacity=".55" />
    </g>
  ),
  // Support & emotional experience — a heart held in a chat bubble.
  support_emotional: (
    <g fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M30 22h72a9 9 0 0 1 9 9v22a9 9 0 0 1-9 9H58L44 74V62H30a9 9 0 0 1-9-9V31a9 9 0 0 1 9-9z" />
      <path d="M66 36c-4-5-14-4-14 4 0 6 8 10 14 14 6-4 14-8 14-14 0-8-10-9-14-4z" />
    </g>
  ),
}

export function CompetencyGlyph({ competencyKey, color }: { competencyKey: string; color: string }) {
  const glyph = GLYPHS[competencyKey] ?? GLYPHS.growth_mindset
  return (
    <svg
      className="sd-lmap-detail__glyph-svg"
      viewBox="0 0 132 84"
      role="img"
      aria-hidden="true"
      style={{ color } as CSSProperties}
    >
      {glyph}
    </svg>
  )
}
