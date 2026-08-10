import type { ReactNode, HTMLAttributes } from 'react'

// Line-SVG icon set (stroke = currentColor). No emoji, per the 720-UIUX bar.
const ICON_PATHS: Record<string, ReactNode> = {
  spark: <path d="M12 3v4m0 10v4m9-9h-4M7 12H3m14.5-5.5-2.8 2.8M9.3 14.7l-2.8 2.8m11 0-2.8-2.8M9.3 9.3 6.5 6.5" />,
  chart: <><path d="M4 20V4" /><path d="M4 20h16" /><path d="M8 16v-4m4 4V8m4 8v-6" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" /></>,
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
  message: <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4V6a1 1 0 0 1 1-1z" />,
  teacher: <><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>,
  alert: <><path d="M12 4 2.5 20h19z" /><path d="M12 10v4m0 3h.01" /></>,
  check: <path d="M4 12.5 9 17.5 20 6.5" />,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M8 3v4m8-4v4M3.5 9.5h17M8 13h.01m4 0h.01m4 0h.01M8 16.5h.01m4 0h.01" /></>,
  reflect: <><path d="M12 3a9 9 0 1 0 9 9" /><path d="M12 7v5l3 2" /><path d="M21 3v5h-5" /></>,
  lightbulb: <><path d="M9 18h6" /><path d="M10 21h4" /><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.3 1 2.5h6c0-1.2.3-1.8 1-2.5A6 6 0 0 0 12 3z" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  leaf: <><path d="M20 4C12 4 5 8 5 14c0 3 2 5 5 5 6 0 10-7 10-15Z" /><path d="M5 20c2-5 6-8 11-11" /></>,
  orbit: <><circle cx="12" cy="12" r="2" /><ellipse cx="12" cy="12" rx="9" ry="4" /><ellipse cx="12" cy="12" rx="4" ry="9" transform="rotate(42 12 12)" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>,
  map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15m6-12v15" /></>,
  camera: <><rect x="3" y="7" width="13" height="11" rx="2.4" /><path d="m16 10.5 5-3v10l-5-3" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.4 9.2a2.6 2.6 0 0 1 5.1.7c0 1.7-2.5 2.1-2.5 3.6" /><path d="M12 17h.01" /></>,
  click: <><path d="M9 3v2.8M4.8 4.8l2 2M3 9h2.8M4.8 13.2l2-2" /><path d="m10.2 10.2 9.3 3.5-4.1 1.7-1.7 4.1z" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" /><path d="M12 18v3m-3 0h6" /></>,
  play: <path d="m8 5 11 7-11 7z" />,
  image: <><rect x="3" y="4.5" width="18" height="15" rx="2.6" /><circle cx="8.6" cy="10" r="1.7" /><path d="m4 17.5 5-4.5 3.5 3 3-2.6 5.5 4.6" /></>,
  inbox: <><path d="M4 13h4l1.5 3h5L16 13h4" /><path d="M4 13 6 5h12l2 8v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></>,
  calculator: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8" /><path d="M8 11h.01M12 11h.01M16 11h.01M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h4" /></>,
  document: <><path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v4h4" /><path d="M9 12h6M9 16h6" /></>,
  chevronLeft: <path d="m14 6-6 6 6 6" />,
  chevronUp: <path d="m6 14 6-6 6 6" />,
  expand: <><path d="M8 3H4a1 1 0 0 0-1 1v4" /><path d="M16 3h4a1 1 0 0 1 1 1v4" /><path d="M16 21h4a1 1 0 0 0 1-1v-4" /><path d="M8 21H4a1 1 0 0 1-1-1v-4" /></>,
  /* Teacher app additions (F6). Line-only, matching the set above — no emoji. */
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0" /><path d="M16.5 5.4a3.2 3.2 0 0 1 0 5.6" /><path d="M17.5 14.4A6.2 6.2 0 0 1 21.2 20" /></>,
  pulse: <path d="M2.5 12h4l2.5-6 4 12 2.5-6h6" />,
  filter: <path d="M3.5 5.5h17l-6.5 7.5V20l-4-2.2v-4.8z" />,
  bell: <><path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" /><path d="M13.7 20a2 2 0 0 1-3.4 0" /></>,
  note: <><path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M15 3v4h4" /><path d="M8.5 12h7M8.5 16h4" /></>,
  wand: <><path d="m4 20 10-10" /><path d="M14.5 4.5 16 3m2.5 4.5L21 6m-4 4.5 2.5 1.5M13 5.5 11.5 3" /><path d="m13 11 3-3" /></>,
  handoff: <><path d="M3 12h11" /><path d="m10 8 4 4-4 4" /><path d="M17 4.5a3.5 3.5 0 0 1 0 15" /></>,
  send: <><path d="M20.5 3.5 3.5 10l6.5 2.5L12.5 19z" /><path d="M20.5 3.5 10 12.5" /></>,
  trendUp: <><path d="M3.5 17.5 9 12l3.5 3.5 7-7.5" /><path d="M14.5 8h5v5" /></>,
  /* Learnings: a shelf of lessons. The speech bubble this used to be said
     "conversation", which is what the messages lane means — two nav items
     cannot share a metaphor. */
  library: <>
    <rect x="3.5" y="4.5" width="4.5" height="15" rx="1.2" />
    <rect x="9.5" y="4.5" width="4.5" height="15" rx="1.2" />
    <path d="m16.4 6.2 3.6 1 -3.1 12 -3.6-1z" />
  </>,
  collapse: <><path d="M3 9h4a1 1 0 0 0 1-1V4" /><path d="M21 9h-4a1 1 0 0 1-1-1V4" /><path d="M21 15h-4a1 1 0 0 0-1 1v4" /><path d="M3 15h4a1 1 0 0 1 1 1v4" /></>,
  home: <><path d="m3 10.5 9-7 9 7" /><path d="M5.5 9v10.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9" /><path d="M10 20.5V14h4v6.5" /></>,
  // Yuvi Studio category glyphs — avatar slots, then room prop groups.
  hat: <><path d="M7 15.5a5 5 0 0 1 10 0" /><path d="M3.5 15.5h14a3.5 3.5 0 0 0 3.5-3.5" /></>,
  face: <><circle cx="12" cy="12" r="8.5" /><path d="M9 10.5h.01M15 10.5h.01" /><path d="M8.8 14.5a4.2 4.2 0 0 0 6.4 0" /></>,
  shirt: <path d="M9 3.5 12 6l3-2.5 4 2v5h-3v10H8V10.5H5v-5z" />,
  hand: <><path d="M9 11.5V5.5a1.5 1.5 0 0 1 3 0V11" /><path d="M12 10.5V4.8a1.5 1.5 0 0 1 3 0V11" /><path d="M15 11V7.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a5 5 0 0 1-4.3-2.5L5 15c-.6-1 .5-2.1 1.6-1.6L9 14.6" /></>,
  backpack: <><rect x="5" y="7" width="14" height="14" rx="4" /><path d="M9 7V6a3 3 0 0 1 6 0v1" /><path d="M9.5 13h5v3.5h-5z" /></>,
  palette: <><path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2-.9 2-1.8 0-1.2-1.1-1.6-1.1-2.7 0-.8.7-1.5 1.6-1.5H16a4.5 4.5 0 0 0 4.5-4.5c0-3.7-3.8-6.5-8.5-6.5z" /><path d="M7.5 12h.01M9.5 8.5h.01M14 7.5h.01" /></>,
  sofa: <><path d="M5 11.5V9a2.5 2.5 0 0 1 5 0v2.5" /><path d="M14 11.5V9a2.5 2.5 0 0 1 5 0v2.5" /><rect x="3.5" y="11.5" width="17" height="6" rx="2" /><path d="M6.5 17.5V19m11-1.5V19" /></>,
  gamepad: <><rect x="2.5" y="7.5" width="19" height="9" rx="4.5" /><path d="M7 10.5v3M5.5 12h3" /><path d="M15.5 11h.01M18 13h.01" /></>,
  chip: <><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M10 3v4m4-4v4M10 17v4m4-4v4M3 10h4m-4 4h4m10-4h4m-4 4h4" /></>,
  sound: <><path d="M4 9.5h3L11.5 6v12L7 14.5H4z" /><path d="M15 9.5a4 4 0 0 1 0 5" /><path d="M17.8 7a7.5 7.5 0 0 1 0 10" /></>,
  mute: <><path d="M4 9.5h3L11.5 6v12L7 14.5H4z" /><path d="m15.5 10 4 4m0-4-4 4" /></>,
}

export interface IconProps extends Omit<HTMLAttributes<SVGElement>, 'children'> {
  name: keyof typeof ICON_PATHS | string
  size?: number
  strokeWidth?: number
  title?: string
}

export function Icon({ name, size = 20, strokeWidth = 1.8, title, ...rest }: IconProps) {
  const path = ICON_PATHS[name] ?? ICON_PATHS.spark
  return (
    <svg
      className="sp-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {path}
    </svg>
  )
}
