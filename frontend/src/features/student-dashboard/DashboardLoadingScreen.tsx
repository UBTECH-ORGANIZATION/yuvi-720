import { BrandLogo } from '../../components/BrandLogo'
import { Icon } from '../../components/primitives'
import { useI18n } from '../../i18n/I18nProvider'

/** Full-viewport initial state while the learner dashboard projection loads. */
export function DashboardLoadingScreen() {
  const { t } = useI18n()

  return (
    <main
      className="sd-loading-screen"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-labelledby="sd-loading-title"
      aria-describedby="sd-loading-description"
    >
      <div className="sd-loading-screen__ambient sd-loading-screen__ambient--primary" aria-hidden="true" />
      <div className="sd-loading-screen__ambient sd-loading-screen__ambient--teal" aria-hidden="true" />

      <section className="sd-loading-screen__content">
        <BrandLogo className="sd-loading-screen__logo" />

        <div className="sd-loading-orbit" aria-hidden="true">
          <span className="sd-loading-orbit__ring sd-loading-orbit__ring--outer" />
          <span className="sd-loading-orbit__ring sd-loading-orbit__ring--inner" />
          <span className="sd-loading-orbit__node sd-loading-orbit__node--book">
            <Icon name="book" size={18} />
          </span>
          <span className="sd-loading-orbit__node sd-loading-orbit__node--spark">
            <Icon name="spark" size={17} />
          </span>
          <span className="sd-loading-orbit__center">
            <Icon name="target" size={30} />
          </span>
        </div>

        <div className="sd-loading-screen__copy">
          <h1 id="sd-loading-title">{t('sdash.loading')}</h1>
          <p id="sd-loading-description">{t('sdash.loading.body')}</p>
        </div>

        <span className="sd-loading-screen__track" aria-hidden="true">
          <span />
        </span>
      </section>
    </main>
  )
}
