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
  reflect: <><path d="M12 3a9 9 0 1 0 9 9" /><path d="M12 7v5l3 2" /><path d="M21 3v5h-5" /></>,
  lightbulb: <><path d="M9 18h6" /><path d="M10 21h4" /><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.3 1 2.5h6c0-1.2.3-1.8 1-2.5A6 6 0 0 0 12 3z" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  leaf: <><path d="M20 4C12 4 5 8 5 14c0 3 2 5 5 5 6 0 10-7 10-15Z" /><path d="M5 20c2-5 6-8 11-11" /></>,
  orbit: <><circle cx="12" cy="12" r="2" /><ellipse cx="12" cy="12" rx="9" ry="4" /><ellipse cx="12" cy="12" rx="4" ry="9" transform="rotate(42 12 12)" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>,
  map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z" /><path d="M9 3v15m6-12v15" /></>,
  camera: <><rect x="3" y="7" width="13" height="11" rx="2.4" /><path d="m16 10.5 5-3v10l-5-3" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.4 9.2a2.6 2.6 0 0 1 5.1.7c0 1.7-2.5 2.1-2.5 3.6" /><path d="M12 17h.01" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  play: <path d="m8 5 11 7-11 7z" />,
  inbox: <><path d="M4 13h4l1.5 3h5L16 13h4" /><path d="M4 13 6 5h12l2 8v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></>,
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
