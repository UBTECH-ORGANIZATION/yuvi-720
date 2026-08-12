import type { ReactNode, HTMLAttributes } from 'react'
import { Icon } from './Icon'
import './primitives.css'

/* Design-system primitives — the mature, emoji-free building blocks every
   migrated 720 screen composes from (architecture §17.3). */

// ── Card ──────────────────────────────────────────────────────────────────
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean
  flat?: boolean
}
export function Card({ interactive, flat, className = '', children, ...rest }: CardProps) {
  const cls = ['sp-card', interactive && 'sp-card--interactive', flat && 'sp-card--flat', className]
    .filter(Boolean)
    .join(' ')
  return <div className={cls} {...rest}>{children}</div>
}

// ── Panel ─────────────────────────────────────────────────────────────────
export function Panel({ className = '', children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`sp-panel ${className}`.trim()} {...rest}>{children}</div>
}

// ── SectionHeader ─────────────────────────────────────────────────────────
export interface SectionHeaderProps {
  title: string
  subtitle?: string
  action?: ReactNode
}
export function SectionHeader({ title, subtitle, action }: SectionHeaderProps) {
  return (
    <div className="sp-section-header">
      <div className="sp-section-header__titles">
        <h2 className="sp-section-header__title">{title}</h2>
        {subtitle ? <p className="sp-section-header__subtitle" dir="auto">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  )
}

// ── StatusPill (verbal only — never a number) ─────────────────────────────
export type StatusTone = 'strong' | 'steady' | 'support' | 'neutral'
export interface StatusPillProps {
  tone?: StatusTone
  children: ReactNode
}
export function StatusPill({ tone = 'neutral', children }: StatusPillProps) {
  return (
    <span className={`sp-pill sp-pill--${tone}`}>
      <span className="sp-pill__dot" aria-hidden="true" />
      <span dir="auto">{children}</span>
    </span>
  )
}

// ── EvidenceChip (raw "why" behind any AI claim — F6 explainability) ───────
export interface EvidenceChipProps {
  label?: string
  children: ReactNode
}
export function EvidenceChip({ label, children }: EvidenceChipProps) {
  return (
    <span className="sp-evidence">
      <Icon name="chart" size={13} strokeWidth={2} aria-hidden="true" />
      {label ? <span className="sp-evidence__label">{label}</span> : null}
      <span dir="auto">{children}</span>
    </span>
  )
}

// ── State blocks ──────────────────────────────────────────────────────────
export interface StateProps {
  icon?: string
  title: string
  body?: string
  action?: ReactNode
}
export function EmptyState({ icon = 'inbox', title, body, action }: StateProps) {
  return (
    <div className="sp-state">
      <Icon className="sp-state__icon" name={icon} size={36} />
      <p className="sp-state__title" dir="auto">{title}</p>
      {body ? <p className="sp-state__body" dir="auto">{body}</p> : null}
      {action}
    </div>
  )
}

export function LoadingState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="sp-state" role="status" aria-live="polite">
      <svg className="sp-spinner" width={32} height={32} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
        <path d="M12 3a9 9 0 1 0 9 9" />
      </svg>
      <p className="sp-state__title" dir="auto">{title}</p>
      {body ? <p className="sp-state__body" dir="auto">{body}</p> : null}
    </div>
  )
}

export function ErrorState({ title, body, action }: StateProps) {
  return (
    <div className="sp-state sp-state--error" role="alert">
      <Icon className="sp-state__icon" name="alert" size={36} />
      <p className="sp-state__title" dir="auto">{title}</p>
      {body ? <p className="sp-state__body" dir="auto">{body}</p> : null}
      {action}
    </div>
  )
}

// ── Skeletons ─────────────────────────────────────────────────────────────
/* Layout-shaped loading. A spinner says "wait"; a skeleton says "this is what
   is coming, and it will land exactly here" — so a tab switch does not tear
   the page down and rebuild it around a centred circle. Compose the three
   shapes to sketch the surface being fetched. Decorative by design:
   aria-hidden, with the busy signal carried by the container. */

export function Skeleton({ w, h = 14, r }: { w?: number | string; h?: number | string; r?: number | string }) {
  return (
    <span
      className="sp-skeleton"
      aria-hidden="true"
      style={{ inlineSize: w ?? '100%', blockSize: h, borderRadius: r }}
    />
  )
}

/** N text-ish lines; the last one is shorter, the way real prose ends. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <span className="sp-skeleton__rows" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} w={index === rows - 1 ? '62%' : '100%'} />
      ))}
    </span>
  )
}

/** A card-shaped placeholder: title line + body lines inside a real panel. */
export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="sp-panel sp-skeleton__card" aria-hidden="true">
      <Skeleton w="38%" h={18} />
      <SkeletonRows rows={rows} />
    </div>
  )
}

export { Icon } from './Icon'
export { Hint, Tooltip } from './Tooltip'
