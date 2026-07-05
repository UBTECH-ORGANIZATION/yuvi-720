import { useEffect } from 'react'
import { initDashboard } from './dashboardApp'
import { useI18n } from '../../i18n/I18nProvider'
import skeleton from './skeleton.html?raw'
import dashboardCss from './dashboard.css?inline'

/**
 * Student dashboard (720 Feature 4).
 *
 * This is a 1:1 migration of the original student-dashboard page. The exact
 * markup, CSS, imperative logic, and the real Three.js Yubi robot are reused;
 * React owns routing and mounting. The page CSS is injected only while this
 * route is mounted so its global class names (.top-bar, .journey, .chat-body,
 * ...) never collide with the mapping/results routes.
 */
export function StudentDashboardPage() {
  const { t, language, isLoading } = useI18n()

  useEffect(() => {
    if (isLoading) return

    document.querySelectorAll<HTMLElement>('.tt-label[data-tab]').forEach((element) => {
      element.textContent = t(`dashboard.tabs.${element.dataset.tab}`)
    })
    document.getElementById('tbRole')?.replaceChildren(t('dashboard.profile.role'))
    document.getElementById('dashboardLoadingTitle')?.replaceChildren(t('dashboard.loading.title'))
    document.getElementById('dashboardLoadingSubtitle')?.replaceChildren(t('dashboard.loading.subtitle'))
    document.getElementById('chatPaneTitle')?.replaceChildren(t('dashboard.chatPane.title'))
    document.getElementById('chatPaneSubtitle')?.replaceChildren(t('dashboard.chatPane.subtitle'))
    document.getElementById('calendarPaneTitle')?.replaceChildren(t('dashboard.calendarPane.title'))
    document.getElementById('calendarPaneSubtitle')?.replaceChildren(t('dashboard.calendarPane.subtitle'))
    document.getElementById('yubiBubbleTitle')?.replaceChildren(t('dashboard.yubi.bubbleTitle'))
    document.getElementById('yubiBubbleSubtitle')?.replaceChildren(t('dashboard.yubi.bubbleSubtitle'))
    document.getElementById('yubiBubbleBtn')?.replaceChildren(t('dashboard.yubi.bubbleBtn'))
  }, [isLoading, t])

  useEffect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-scope', 'student-dashboard')
    style.textContent = dashboardCss
    document.head.appendChild(style)

    return () => {
      if (style.parentNode) style.parentNode.removeChild(style)
    }
  }, [])

  useEffect(() => {
    if (isLoading) return

    const startDashboard = () => {
      const main = document.getElementById('mainContent')
      if (!main || main.dataset.dashboardInitialized === language) return
      main.dataset.dashboardInitialized = language
      try {
        initDashboard(t, language)
      } catch (error) {
        console.error('Dashboard initialization failed:', error)
        main.innerHTML = `
          <div style="text-align:center; padding:80px 20px;">
            <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
            <div style="font-size:18px;font-weight:700;color:#3a3360;">${t('dashboard.error.title')}</div>
            <div style="font-size:14px;color:#9a93b5;margin-top:8px;">${t('dashboard.error.subtitle')}</div>
          </div>
        `
      }
    }

    const frame = window.requestAnimationFrame(startDashboard)
    return () => window.cancelAnimationFrame(frame)
  }, [isLoading, language, t])

  return <div dangerouslySetInnerHTML={{ __html: skeleton }} />
}
