interface BrandLogoProps {
  className?: string
}

export function BrandLogo({ className = '' }: BrandLogoProps) {
  return (
    <span className={`yuvi-brand-logo ${className}`.trim()}>
      <img
        className="yuvi-brand-logo__image yuvi-brand-logo__image--dark"
        src="/shared/brand/yuvilab-spark-dark.png"
        alt="Yuvilab Spark"
      />
      <img
        className="yuvi-brand-logo__image yuvi-brand-logo__image--light"
        src="/shared/brand/yuvilab-spark-light.png"
        alt=""
        aria-hidden="true"
      />
    </span>
  )
}
