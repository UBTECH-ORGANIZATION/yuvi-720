interface WeeklyHeroArtProps {
  className?: string
}

/**
 * Symbolic "summit" illustration for the weekly focus — a flag planted on a
 * peak, in Spark's soft pastel language. No emoji, no stock imagery.
 */
export function WeeklyHeroArt({ className }: WeeklyHeroArtProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 220 180"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="sk-hero-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f3efff" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="sk-hero-peak" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b7a6ff" />
          <stop offset="1" stopColor="#8a74f0" />
        </linearGradient>
        <linearGradient id="sk-hero-peak-2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d7ccff" />
          <stop offset="1" stopColor="#a892f7" />
        </linearGradient>
        <linearGradient id="sk-hero-flag" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c6cff" />
          <stop offset="1" stopColor="#4cc9f0" />
        </linearGradient>
      </defs>

      <circle cx="110" cy="86" r="74" fill="url(#sk-hero-sky)" />

      {/* soft clouds */}
      <g fill="#ffffff" opacity="0.9">
        <ellipse cx="46" cy="58" rx="20" ry="9" />
        <ellipse cx="60" cy="52" rx="14" ry="8" />
        <ellipse cx="176" cy="44" rx="18" ry="8" />
        <ellipse cx="188" cy="50" rx="12" ry="7" />
      </g>

      {/* back peak */}
      <path d="M18 150 L86 66 L138 150 Z" fill="url(#sk-hero-peak-2)" opacity="0.75" />
      {/* main peak */}
      <path d="M70 152 L128 58 L196 152 Z" fill="url(#sk-hero-peak)" />
      {/* snow cap */}
      <path d="M128 58 L112 84 L120 90 L128 82 L136 92 L146 82 Z" fill="#ffffff" opacity="0.92" />

      {/* flag pole + flag on the summit */}
      <rect x="126" y="30" width="3.4" height="34" rx="1.7" fill="#5a45f0" />
      <path d="M129 32 L156 39 L129 48 Z" fill="url(#sk-hero-flag)" />

      {/* ground line */}
      <rect x="18" y="150" width="184" height="6" rx="3" fill="#efeaff" />
    </svg>
  )
}
