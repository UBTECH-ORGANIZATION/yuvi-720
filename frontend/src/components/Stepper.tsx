import { useI18n } from '../i18n/I18nProvider'

const steps = ['step.intro', 'step.questions', 'step.insights', 'step.summary']

export function Stepper({ activeStep }: { activeStep: number }) {
  const { t } = useI18n()

  return (
    <nav className="stepper" aria-label={t('stepper.aria')}>
      {steps.map((stepKey, index) => (
        <span className="step-pair" key={stepKey}>
          {index > 0 && <span className="step-line" />}
          <span className={`step ${index === activeStep ? 'active' : ''} ${index < activeStep ? 'done' : ''}`}>
            <span className="step-dot">{index === 0 ? <YubiMiniIcon /> : index + 1}</span>
            <span className="step-label">{t(stepKey)}</span>
          </span>
        </span>
      ))}
    </nav>
  )
}

function YubiMiniIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <rect x="5" y="8" width="14" height="11" rx="3.5" fill="currentColor" />
      <circle cx="9.5" cy="13" r="1.6" fill="#fff" />
      <circle cx="14.5" cy="13" r="1.6" fill="#fff" />
      <rect x="11" y="3" width="2" height="3.5" rx="1" fill="currentColor" />
      <circle cx="12" cy="2.5" r="1.6" fill="currentColor" />
    </svg>
  )
}