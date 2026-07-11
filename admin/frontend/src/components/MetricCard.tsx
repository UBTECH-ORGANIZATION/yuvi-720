interface MetricCardProps {
  icon: string
  value: string
  label: string
  detail?: string
  tone: 'indigo' | 'cyan' | 'emerald' | 'amber' | 'violet' | 'rose'
  sparkline: number[]
}

export function MetricCard({ icon, value, label, detail, tone, sparkline }: MetricCardProps) {
  const maximum = Math.max(...sparkline, 1)
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__header">
        <div>
          <span className="metric-card__label">{label}</span>
          <strong className="metric-card__value">{value}</strong>
          {detail ? <span className="metric-card__detail">{detail}</span> : null}
        </div>
        <span className="metric-card__icon" aria-hidden="true">{icon}</span>
      </div>
      <div className="metric-card__sparkline" aria-hidden="true">
        {sparkline.map((point, index) => (
          <span key={`${index}-${point}`} style={{ blockSize: `${Math.max(8, (point / maximum) * 100)}%` }} />
        ))}
      </div>
    </article>
  )
}