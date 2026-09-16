/* The few design primitives the organisation console composes from, styled
 * with this app's tokens (see console.css). Line-SVG icons, stroke =
 * currentColor — the same glyphs the Spark console used, so the tabs read the
 * same to an admin who knew the old screen. */

import type { HTMLAttributes, ReactNode } from 'react'

const ICON_PATHS: Record<string, ReactNode> = {
  pulse: <path d="M2.5 12h4l2.5-6 4 12 2.5-6h6" />,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0" /><path d="M16.5 5.4a3.2 3.2 0 0 1 0 5.6" /><path d="M17.5 14.4A6.2 6.2 0 0 1 21.2 20" /></>,
  teacher: <><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>,
  gamepad: <><rect x="2.5" y="7.5" width="19" height="9" rx="4.5" /><path d="M7 10.5v3M5.5 12h3" /><path d="M15.5 11h.01M18 13h.01" /></>,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M4 12.5 9 17.5 20 6.5" />,
  alert: <><path d="M12 4 2.5 20h19z" /><path d="M12 10v4m0 3h.01" /></>,
  inbox: <><path d="M4 13h4l1.5 3h5L16 13h4" /><path d="M4 13 6 5h12l2 8v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /></>,
  chevronUp: <path d="m6 14 6-6 6 6" />,
  chevronLeft: <path d="m14 6-6 6 6 6" />,
}

export type IconName = keyof typeof ICON_PATHS

export interface IconProps extends Omit<HTMLAttributes<SVGElement>, 'children'> {
  name: IconName | string
  size?: number
  strokeWidth?: number
}

export function Icon({ name, size = 18, strokeWidth = 1.8, className = '', ...rest }: IconProps) {
  return (
    <svg
      className={`adm-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {ICON_PATHS[name] ?? ICON_PATHS.inbox}
    </svg>
  )
}

export function Panel({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`adm-surface ${className}`.trim()} {...rest}>{children}</div>
}

export function Card({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`adm-surface adm-surface--card ${className}`.trim()} {...rest}>{children}</div>
}

/* Verbal only — never a number. */
export type StatusTone = 'strong' | 'steady' | 'support' | 'neutral'

export function StatusPill({ tone = 'neutral', children }: { tone?: StatusTone; children: ReactNode }) {
  return (
    <span className={`adm-pill adm-pill--${tone}`}>
      <span className="adm-pill__dot" aria-hidden="true" />
      <span dir="auto">{children}</span>
    </span>
  )
}

export interface StateProps {
  icon?: IconName | string
  title: string
  body?: string
  action?: ReactNode
}

export function EmptyState({ icon = 'inbox', title, body, action }: StateProps) {
  return (
    <div className="adm-state">
      <Icon className="adm-state__icon" name={icon} size={32} />
      <p className="adm-state__title" dir="auto">{title}</p>
      {body ? <p className="adm-state__body" dir="auto">{body}</p> : null}
      {action}
    </div>
  )
}

export function LoadingState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="adm-state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <p className="adm-state__title" dir="auto">{title}</p>
      {body ? <p className="adm-state__body" dir="auto">{body}</p> : null}
    </div>
  )
}

export function ErrorState({ title, body, action }: StateProps) {
  return (
    <div className="adm-state adm-state--error" role="alert">
      <Icon className="adm-state__icon" name="alert" size={32} />
      <p className="adm-state__title" dir="auto">{title}</p>
      {body ? <p className="adm-state__body" dir="auto">{body}</p> : null}
      {action}
    </div>
  )
}
