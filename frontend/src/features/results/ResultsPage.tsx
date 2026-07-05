import { useEffect, useMemo, useState } from 'react'
import { apiPost, getLearnerState, updateLearnerState } from '../../services/api'
import type { MappingResults, Profile, ProfileImprove, ProfileStrength } from './types'

type SceneStep =
  | { type: 'welcome'; name: string }
  | { type: 'strength'; data: ProfileStrength; index: number; total: number }
  | { type: 'improve'; data: ProfileImprove }
  | { type: 'plan'; tips: string[] }
  | { type: 'done' }

type Status = 'loading' | 'analyzing' | 'noData' | 'journey'

const loadingSteps = [
  { icon: '🎯', text: 'מזהה את הסגנון שלך...' },
  { icon: '💡', text: 'מחפש חוזקות מיוחדות...' },
  { icon: '🗺️', text: 'בונה מסלול אישי בדיוק בשבילך...' },
  { icon: '✨', text: 'מכין הפתעות!' }
]

export function ResultsPage() {
  const [status, setStatus] = useState<Status>('loading')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [studentName, setStudentName] = useState('תלמיד/ה')
  const [journeyIndex, setJourneyIndex] = useState(0)
  const [loadingStep, setLoadingStep] = useState(0)
  const [reaction, setReaction] = useState<number | null>(null)
  const [whyOpen, setWhyOpen] = useState(false)

  useEffect(() => {
    void loadResults()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setReaction(null)
    setWhyOpen(false)
  }, [journeyIndex])

  useEffect(() => {
    if (status !== 'analyzing') return
    if (loadingStep >= loadingSteps.length) return
    const timer = window.setTimeout(() => setLoadingStep((step) => step + 1), loadingStep === 0 ? 500 : 1200)
    return () => window.clearTimeout(timer)
  }, [status, loadingStep])

  async function loadResults() {
    const state = await getLearnerState()
    const data = state.mapping_results as MappingResults | null | undefined
    if (!data) {
      setStatus('noData')
      return
    }

    const name = data.student_name || 'תלמיד/ה'
    const sourceHash = JSON.stringify(data)
    setStudentName(name)

    const cached = state.profile_cache as { sourceHash?: string; data?: Profile } | null | undefined
    if (cached) {
      if (cached.sourceHash === sourceHash && cached.data) {
        setProfile(cached.data)
        setStatus('journey')
        return
      }
    }

    setStatus('analyzing')
    setLoadingStep(0)

    try {
      const analyzed = await apiPost<Profile>('/api/analyze-profile', { student_name: name, scores: data.scores })
      void updateLearnerState({ profile_cache: { sourceHash, data: analyzed } })
      setProfile(analyzed)
      setStatus('journey')
    } catch {
      setProfile(fallbackProfile())
      setStatus('journey')
    }
  }

  const journeySteps = useMemo<SceneStep[]>(() => {
    if (!profile) return []
    const strengths = (profile.strengths || []).slice(0, 3)
    const improve = (profile.improve || []).slice(0, 2)
    const tips = (profile.tips || []).slice(0, 3)
    const steps: SceneStep[] = [{ type: 'welcome', name: studentName }]
    strengths.forEach((data, index) => steps.push({ type: 'strength', data, index, total: strengths.length }))
    improve.forEach((data) => steps.push({ type: 'improve', data }))
    if (tips.length) steps.push({ type: 'plan', tips })
    steps.push({ type: 'done' })
    return steps
  }, [profile, studentName])

  if (status === 'noData') {
    return (
      <>
        <TopBar title="פרופיל הלמידה שלי" />
        <div className="no-data-state">
          <div className="emoji">📋</div>
          <div className="msg">עדיין אין לנו נתונים</div>
          <div className="sub">כדי לקבל פרופיל למידה אישי, צריך קודם למלא את השאלון</div>
          <a className="btn" href="/">למילוי השאלון →</a>
        </div>
      </>
    )
  }

  if (status === 'loading' || status === 'analyzing') {
    return (
      <>
        <TopBar title="פרופיל הלמידה שלי" />
        <div className="loading-state">
          <div className="loading-mascot">
            <div className="orbit-dot" />
            <div className="orbit-dot" />
            <div className="orbit-dot" />
            <div className="mascot-body" />
          </div>
          <div className="text">יובי מנתח את הפרופיל שלך... 🔍</div>
          <div className="sub">זה הולך להיות מעניין!</div>
          <div className="loading-steps">
            {loadingSteps.map((step, index) => (
              <div
                className={`loading-step ${index < loadingStep ? 'visible' : ''} ${index < loadingStep - 1 ? 'done' : ''}`}
                key={step.text}
              >
                <span className="step-icon">{step.icon}</span>
                <span>{step.text}</span>
              </div>
            ))}
          </div>
          <div className="loading-progress">
            <div className="bar" style={{ width: `${Math.min(loadingStep, loadingSteps.length) / loadingSteps.length * 100}%` }} />
          </div>
        </div>
      </>
    )
  }

  const step = journeySteps[journeyIndex]
  const isFirst = journeyIndex === 0
  const isLast = journeyIndex === journeySteps.length - 1

  function goNext() {
    if (journeyIndex < journeySteps.length - 1) {
      setJourneyIndex((index) => index + 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  function goBack() {
    if (journeyIndex > 0) {
      setJourneyIndex((index) => index - 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  return (
    <>
      <TopBar title={`הפרופיל של ${studentName}`} />
      <div className="journey">
        <div className="journey-progress">
          {journeySteps.map((_, index) => (
            <span
              className={`dot ${index === journeyIndex ? 'active' : index < journeyIndex ? 'done' : ''}`}
              key={index}
            />
          ))}
        </div>

        <div className="journey-stage">
          {step?.type === 'welcome' && (
            <div className="scene active welcome-card">
              <div className="welcome-mascot"><span style={{ fontSize: 54 }}>🎉</span></div>
              <div className="title">{step.name}, סיימנו את המיפוי!</div>
              <div className="sub">גיליתי כמה דברים שיעזרו לי להתאים לך למידה בדיוק בדרך שלך.</div>
            </div>
          )}

          {step?.type === 'strength' && (
            <div className="scene active">
              <div className="big-card">
                <span className="kicker">החוזקה {['הראשונה', 'השנייה', 'השלישית'][step.index] || ''} שלך 💪</span>
                <div className="big-ico">{step.data.icon}</div>
                <div className="big-name">{step.data.label}</div>
                <div className="big-desc">{shorten(step.data.desc)}</div>
                <div className="reactions">
                  <button className={`reaction-btn ${reaction === 0 ? 'selected' : ''}`} onClick={() => setReaction(0)}>נשמע כמוני 😊</button>
                  <button className={`reaction-btn ${reaction === 1 ? 'selected' : ''}`} onClick={() => setReaction(1)}>לא בטוח 🤔</button>
                </div>
              </div>
            </div>
          )}

          {step?.type === 'improve' && (
            <div className="scene active">
              <div className="big-card">
                <span className="kicker">מה יעזור לי להתקדם 🌱</span>
                <div className="big-ico">{step.data.icon}</div>
                <div className="big-name">{softLabel(step.data.label)}</div>
                <div className="big-desc">{shorten(step.data.tip || step.data.desc || '')}</div>
                {(step.data.tip || step.data.desc) && (
                  <>
                    <button className={`why-toggle ${whyOpen ? 'open' : ''}`} onClick={() => setWhyOpen((open) => !open)}>
                      <span>למה זה חשוב?</span><span className="chev">▾</span>
                    </button>
                    <div className={`why-body ${whyOpen ? 'open' : ''}`}>{stripScores(step.data.desc || step.data.tip || '')}</div>
                  </>
                )}
              </div>
            </div>
          )}

          {step?.type === 'plan' && (
            <div className="scene active">
              <div className="plan-head">
                <span className="e">💪</span>
                <div className="title">הצעדים הקטנים שלי</div>
              </div>
              <div className="plan-steps">
                {step.tips.map((tip, index) => (
                  <div className="plan-step" style={{ animationDelay: `${0.15 + index * 0.12}s` }} key={tip}>
                    <div className="num">{index + 1}</div>
                    <div className="t">{tip}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step?.type === 'done' && (
            <div className="scene active welcome-card">
              <div className="welcome-mascot"><span style={{ fontSize: 50 }}>🚀</span></div>
              <div className="title">מוכנים להתחיל?</div>
              <div className="sub">מעכשיו נלמד יחד בדרך שמתאימה בדיוק לך.</div>
            </div>
          )}
        </div>

        <div className="journey-nav">
          {!isFirst && !isLast && <button className="nav-btn ghost" onClick={goBack}>→ הקודם</button>}
          {step?.type === 'welcome' && <button className="nav-btn" onClick={goNext}>בוא נראה מה גיליתי ✨</button>}
          {isLast && <a className="nav-btn" href="/student-dashboard/">מתחילים ללמוד בדרך שלי ←</a>}
          {!isLast && step?.type !== 'welcome' && <button className="nav-btn" onClick={goNext}>הבא ←</button>}
        </div>
      </div>
    </>
  )
}

function TopBar({ title }: { title: string }) {
  return (
    <div className="top-bar">
      <span className="top-bar-title">{title}</span>
      <span className="top-bar-logo">Yuvilab Spark</span>
    </div>
  )
}

function fallbackProfile(): Profile {
  return {
    strengths: [
      { icon: '🎯', label: 'ריכוז', desc: 'אתה מצליח להישאר ממוקד כשיש לך מטרה ברורה.' },
      { icon: '💡', label: 'סקרנות', desc: 'אתה אוהב לגלות איך דברים עובדים.' }
    ],
    improve: [],
    tips: [
      'ללמוד ביחידות קצרות של 15 דקות',
      'לבחור מטרה קטנה לפני כל משימה',
      'לעצור בסוף ולכתוב: מה עבד לי טוב?'
    ]
  }
}

function stripScores(text: string): string {
  return text
    .replace(/\b\d{1,3}\s*%/g, '')
    .replace(/(?:קיבלת|עם|ציון|ציונך|של)\s*\d{1,3}\b/g, (match) => match.replace(/\d{1,3}/, '').trim())
    .replace(/\b\d{1,3}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?…])/g, '$1')
    .trim()
}

function shorten(text: string): string {
  if (!text) return ''
  const clean = stripScores(text.trim())
  if (clean.length > 90) {
    const dot = clean.indexOf('. ')
    if (dot > 20 && dot < 90) return clean.slice(0, dot + 1)
    return clean.slice(0, 88).trim() + '…'
  }
  return clean
}

function softLabel(label: string): string {
  const map: Record<string, string> = {
    'שליטה בטכנולוגיה': 'להרגיש בטוח עם כלים דיגיטליים',
    'הכרה עצמית': 'להכיר מה עוזר לי ללמוד',
    'מודעות עצמית': 'להכיר מה עוזר לי ללמוד',
    'התמדה': 'להמשיך גם כשמאתגר',
    'ארגון': 'לסדר את הדרך שלי'
  }
  return map[label] || label
}
