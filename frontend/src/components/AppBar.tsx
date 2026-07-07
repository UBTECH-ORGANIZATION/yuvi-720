import { LanguageSwitcher } from './LanguageSwitcher'
import { Stepper } from './Stepper'
import { useI18n } from '../i18n/I18nProvider'

interface AppBarProps {
  studentName: string
  studentSubtitle: string
  activeStep?: number
}

export function AppBar({ studentName, studentSubtitle, activeStep }: AppBarProps) {
  const { t } = useI18n()
  const initials = studentName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)

  return (
    <header className="app-bar">
      <div className="app-bar-left">
        <div className="app-bar-brand" aria-label={t('app.brand')}>
          <img src="/shared/brand/yuvispark.png" alt="" />
          <span dir="ltr">Yuvilab <b>Spark</b></span>
        </div>
        <LanguageSwitcher />
      </div>
      {typeof activeStep === 'number' && (
        <div className="app-bar-steps">
          <Stepper activeStep={activeStep} />
        </div>
      )}
      <div className="app-bar-user">
        <div className="user-meta">
          <span className="user-name">{studentName}</span>
          <span className="user-sub">{studentSubtitle}</span>
        </div>
        <div className="user-avatar">{initials}</div>
      </div>
    </header>
  )
}