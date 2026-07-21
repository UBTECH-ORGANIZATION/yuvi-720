import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { I18nProvider } from './i18n/I18nProvider'
import { AuthProvider } from './providers/AuthProvider'
import { BrainProvider } from './providers/BrainProvider'
import { CompanionProvider } from './providers/CompanionProvider'
import { OnboardingProvider } from './providers/OnboardingProvider'
import { LessonRoadmapProvider } from './providers/LessonRoadmapProvider'
import { ThemeProvider } from './providers/ThemeProvider'
import { StudioTransitionProvider } from './features/yubi-studio/StudioTransitionProvider'
import { YubiDesignProvider } from './features/yubi-studio/YubiDesignProvider'
import './styles/tokens.css'
import './styles/theme.css'
import './styles/global.css'
import './components/primitives/primitives.css'
import './styles/landing-login.css'
import './styles/learner-mapping.css'
import './styles/results.css'
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
            <OnboardingProvider>
            <CompanionProvider>
              <YubiDesignProvider>
                <LessonRoadmapProvider>
                  <StudioTransitionProvider>
                    <App />
                  </StudioTransitionProvider>
                </LessonRoadmapProvider>
              </YubiDesignProvider>
            </CompanionProvider>
            </OnboardingProvider>
          </BrainProvider>
        </I18nProvider>
      </ThemeProvider>
    </AuthProvider>
  </React.StrictMode>
)