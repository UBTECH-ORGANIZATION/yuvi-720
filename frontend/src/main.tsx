import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { I18nProvider } from './i18n/I18nProvider'
import { AuthProvider } from './providers/AuthProvider'
import { BrainProvider } from './providers/BrainProvider'
import { CompanionProvider } from './providers/CompanionProvider'
import { OnboardingProvider } from './providers/OnboardingProvider'
import { RewardsProvider } from './providers/RewardsProvider'
import { ProgressionProvider } from './providers/ProgressionProvider'
import { LessonRoadmapProvider } from './providers/LessonRoadmapProvider'
import { ThemeProvider } from './providers/ThemeProvider'
import { StudioTransitionProvider } from './features/Yuvi-studio/StudioTransitionProvider'
import { YuviDesignProvider } from './features/Yuvi-studio/YuviDesignProvider'
import { NotificationsProvider } from './providers/NotificationsProvider'
import { initTelemetry } from './services/telemetry'
import './styles/tokens.css'
import './styles/theme.css'
import './styles/global.css'
import './components/primitives/primitives.css'
import './styles/landing-login.css'
// App-bar chrome (bar, user chip, switchers, stepper). The mapping and results
// pages import their own CSS: both are lazy routes now.
import './styles/app-chrome.css'
// Responsive foundation loads LAST so its breakpoint overrides win everywhere.
import './styles/responsive.css'
// Theme compatibility loads after legacy feature CSS; new UI should use tokens directly.
import './styles/dark-mode.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  // AuthProvider is outermost: the theme comes from the signed-in user's stored
  // preferences, and BrainProvider's learner id is that user's id.
  <React.StrictMode>
    <AuthProvider>
      <ThemeProvider>
        <I18nProvider>
          <BrainProvider>
            {/* Above the shells: a learner should be told their teacher set them
                a goal wherever they are, not only on the dashboard. */}
            <NotificationsProvider>
            <RewardsProvider>
            <ProgressionProvider>
            <OnboardingProvider>
            <CompanionProvider>
              <YuviDesignProvider>
                <LessonRoadmapProvider>
                  <StudioTransitionProvider>
                    <App />
                  </StudioTransitionProvider>
                </LessonRoadmapProvider>
              </YuviDesignProvider>
            </CompanionProvider>
            </OnboardingProvider>
            </ProgressionProvider>
            </RewardsProvider>
            </NotificationsProvider>
          </BrainProvider>
        </I18nProvider>
      </ThemeProvider>
    </AuthProvider>
  </React.StrictMode>
)

// After the first render is queued, never before: the SDK loads on idle and
// must not compete with painting the app. See services/telemetry.ts.
initTelemetry()