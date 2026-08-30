import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LearnerAppBar } from '../../components/LearnerAppBar'
import { useI18n } from '../../i18n/I18nProvider'
import {
  artifactUrl,
  createProject,
  getProject,
  listProjects,
  restoreVersion,
  streamBuild,
  type PlanStep,
  type WorkshopProject,
  type WorkshopVersion,
} from '../../services/workshop'
import './workshop.css'

/* The workshop (720 F1, learner-authored content).
 *
 * A child describes something and watches it get built. Three things drive the
 * layout:
 *
 * - The result is the point, so the preview owns the large half of the screen
 *   and the conversation sits beside it, not above it.
 * - While the code streams there is nothing to preview yet, so the code itself
 *   is what fills that half. Watching it appear is the only honest progress
 *   indicator, and it is also the part children ask about.
 * - Yuvi may answer with a question instead of a build. The options render as
 *   chips because a child who cannot phrase an answer can still tap one.
 */

const COPY = {
  he: {
    title: 'הסדנה',
    lead: 'ספרו לי מה בא לכם לבנות, ואני בונה את זה איתכם.',
    placeholder: 'מה בא לכם לבנות?',
    send: 'בונים',
    stop: 'עצור',
    newProject: 'יצירה חדשה',
    myProjects: 'היצירות שלי',
    empty: 'עוד לא בניתם כלום. זה הרגע להתחיל.',
    building: 'בונה...',
    plan: 'מה עושים',
    codeTab: 'הקוד',
    previewTab: 'המשחק',
    versions: 'גרסאות',
    restore: 'חזרה לגרסה הזו',
    version: 'גרסה',
    knowTitle: 'הידעת?',
    challengeTitle: 'אתגר',
    failed: 'משהו השתבש. נסו לספר לי את זה קצת אחרת.',
    limit: 'בנינו היום הרבה! נמשיך מחר.',
    unsafeNote: 'היצירה שמורה אצלכם, אבל היא עוד לא מוכנה לשיתוף.',
  },
  ar: {
    title: 'الورشة',
    lead: 'أخبروني ماذا تريدون أن تبنوا، وسأبنيه معكم.',
    placeholder: 'ماذا تريدون أن تبنوا؟',
    send: 'نبني',
    stop: 'توقف',
    newProject: 'إبداع جديد',
    myProjects: 'إبداعاتي',
    empty: 'لم تبنوا شيئًا بعد. هذه هي اللحظة للبدء.',
    building: 'أبني...',
    plan: 'ماذا سنفعل',
    codeTab: 'الرماز',
    previewTab: 'اللعبة',
    versions: 'النسخ',
    restore: 'العودة إلى هذه النسخة',
    version: 'نسخة',
    knowTitle: 'هل تعلم؟',
    challengeTitle: 'تحدٍّ',
    failed: 'حدث خطأ ما. حاولوا أن تصفوا لي الأمر بطريقة أخرى.',
    limit: 'بنينا الكثير اليوم! نكمل غدًا.',
    unsafeNote: 'إبداعكم محفوظ لديكم، لكنه ليس جاهزًا للمشاركة بعد.',
  },
  en: {
    title: 'The Workshop',
    lead: 'Tell me what you want to build, and I will build it with you.',
    placeholder: 'What do you want to build?',
    send: 'Build',
    stop: 'Stop',
    newProject: 'New creation',
    myProjects: 'My creations',
    empty: 'Nothing built yet. This is the moment to start.',
    building: 'Building...',
    plan: 'What we are doing',
    codeTab: 'Code',
    previewTab: 'Play',
    versions: 'Versions',
    restore: 'Go back to this version',
    version: 'Version',
    knowTitle: 'Did you know?',
    challengeTitle: 'Challenge',
    failed: 'Something went wrong. Try telling me a little differently.',
    limit: 'We built a lot today! We will carry on tomorrow.',
    unsafeNote: 'Your creation is saved, but it is not ready to share yet.',
  },
} as const

type Turn = { role: 'learner' | 'yuvi'; text: string; options?: string[] }

export function WorkshopPage() {
  const { language } = useI18n()
  const copy = COPY[(language as keyof typeof COPY)] ?? COPY.he

  const [projects, setProjects] = useState<WorkshopProject[]>([])
  const [project, setProject] = useState<WorkshopProject | null>(null)
  const [versions, setVersions] = useState<WorkshopVersion[]>([])

  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [plan, setPlan] = useState<PlanStep[]>([])
  const [code, setCode] = useState('')
  const [previewVersion, setPreviewVersion] = useState<number | null>(null)
  const [cards, setCards] = useState<{ know?: string; challenge?: string } | null>(null)
  const [pane, setPane] = useState<'code' | 'preview'>('preview')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const abortRef = useRef<(() => void) | null>(null)
  const codeRef = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    void listProjects().then(setProjects).catch(() => setProjects([]))
  }, [])

  // The code pane is a progress indicator, so it has to stay pinned to the end.
  useEffect(() => {
    if (pane === 'code' && codeRef.current) {
      codeRef.current.scrollTop = codeRef.current.scrollHeight
    }
  }, [code, pane])

  useEffect(() => () => abortRef.current?.(), [])

  const openProject = useCallback(async (projectId: string) => {
    const detail = await getProject(projectId)
    setProject(detail.project)
    setVersions(detail.versions)
    setPreviewVersion(detail.project.currentVersion || null)
    setPane('preview')
    setTurns([])
    setPlan([])
    setCode('')
    setCards(null)
    setNotice('')
  }, [])

  const startNew = useCallback(() => {
    abortRef.current?.()
    setProject(null)
    setVersions([])
    setTurns([])
    setPlan([])
    setCode('')
    setCards(null)
    setPreviewVersion(null)
    setNotice('')
  }, [])

  const send = useCallback(async (text: string) => {
    const message = text.trim()
    if (!message || busy) return

    setDraft('')
    setNotice('')
    setCards(null)
    setTurns((current) => [...current, { role: 'learner', text: message }])
    setBusy(true)

    let target = project
    if (!target) {
      try {
        target = await createProject({ language })
        setProject(target)
        setProjects((current) => [target as WorkshopProject, ...current])
      } catch {
        setNotice(copy.failed)
        setBusy(false)
        return
      }
    }

    const history = turns.map((turn) => ({
      role: turn.role === 'learner' ? 'user' : 'assistant',
      content: turn.text,
    }))

    let streamed = ''
    abortRef.current = streamBuild(
      target.id,
      { message, language, history },
      {
        onBlocked: (reply) => setTurns((current) => [...current, { role: 'yuvi', text: reply }]),
        onQuestion: (question, options) =>
          setTurns((current) => [...current, { role: 'yuvi', text: question, options }]),
        onTitle: (title) => setProject((current) => (current ? { ...current, title } : current)),
        onPlan: (steps) => {
          setPlan(steps)
          setPane('code')
        },
        onCode: (chunk) => {
          streamed += chunk
          setCode(streamed)
          setPane('code')
        },
        onReady: (version, _url, publishable) => {
          setPreviewVersion(version)
          setPane('preview')
          if (!publishable) setNotice(copy.unsafeNote)
          void getProject((target as WorkshopProject).id)
            .then((detail) => {
              setProject(detail.project)
              setVersions(detail.versions)
            })
            .catch(() => undefined)
        },
        onCards: setCards,
        onError: (errorCode) =>
          setNotice(errorCode === 'daily_build_limit' ? copy.limit : copy.failed),
        onDone: () => {
          setBusy(false)
          abortRef.current = null
        },
      },
    )
  }, [busy, copy, language, project, turns])

  const stop = useCallback(() => {
    abortRef.current?.()
    abortRef.current = null
    setBusy(false)
  }, [])

  const restore = useCallback(async (version: number) => {
    if (!project) return
    const created = await restoreVersion(project.id, version)
    const detail = await getProject(project.id)
    setProject(detail.project)
    setVersions(detail.versions)
    setPreviewVersion(created)
    setPane('preview')
  }, [project])

  const previewSrc = useMemo(
    () => (project && previewVersion ? artifactUrl(project.id, previewVersion) : ''),
    [project, previewVersion],
  )

  return (
    <>
      <LearnerAppBar />
      <main className="sp-workshop">
        <section className="sp-workshop__rail">
          <header className="sp-workshop__intro">
            <h1>{project?.title || copy.title}</h1>
            <p>{copy.lead}</p>
          </header>

          <div className="sp-workshop__turns">
            {turns.map((turn, index) => (
              <div key={index} className={`sp-workshop__turn sp-workshop__turn--${turn.role}`}>
                <p>{turn.text}</p>
                {turn.options?.length ? (
                  <div className="sp-workshop__chips">
                    {turn.options.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className="sp-workshop__chip"
                        onClick={() => void send(option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}

            {plan.length ? (
              <div className="sp-workshop__plan">
                <h2>{copy.plan}</h2>
                <ol>
                  {plan.map((step) => (
                    <li key={step.title}>
                      <strong>{step.title}</strong>
                      {step.achieved ? <span>{step.achieved}</span> : null}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            {cards?.know || cards?.challenge ? (
              <div className="sp-workshop__cards">
                {cards.know ? (
                  <article>
                    <h3>{copy.knowTitle}</h3>
                    <p>{cards.know}</p>
                  </article>
                ) : null}
                {cards.challenge ? (
                  <article>
                    <h3>{copy.challengeTitle}</h3>
                    <p>{cards.challenge}</p>
                  </article>
                ) : null}
              </div>
            ) : null}

            {notice ? <p className="sp-workshop__notice">{notice}</p> : null}
          </div>

          <form
            className="sp-workshop__composer"
            onSubmit={(event) => {
              event.preventDefault()
              void send(draft)
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={copy.placeholder}
              disabled={busy}
              aria-label={copy.placeholder}
            />
            {busy ? (
              <button type="button" onClick={stop}>{copy.stop}</button>
            ) : (
              <button type="submit" disabled={!draft.trim()}>{copy.send}</button>
            )}
          </form>
        </section>

        <section className="sp-workshop__stage">
          <div className="sp-workshop__tabs">
            <button
              type="button"
              className={pane === 'preview' ? 'is-active' : ''}
              onClick={() => setPane('preview')}
              disabled={!previewSrc}
            >
              {copy.previewTab}
            </button>
            <button
              type="button"
              className={pane === 'code' ? 'is-active' : ''}
              onClick={() => setPane('code')}
              disabled={!code}
            >
              {copy.codeTab}
            </button>
            <span className="sp-workshop__spacer" />
            <button type="button" onClick={startNew}>{copy.newProject}</button>
          </div>

          {pane === 'preview' && previewSrc ? (
            /* `sandbox` without `allow-same-origin` is belt-and-braces: the
               response already carries a CSP that forces an opaque origin. */
            <iframe
              key={previewSrc}
              className="sp-workshop__frame"
              src={previewSrc}
              sandbox="allow-scripts allow-pointer-lock"
              title={project?.title || copy.title}
            />
          ) : (
            <pre ref={codeRef} className="sp-workshop__code">
              {code || (busy ? copy.building : '')}
            </pre>
          )}

          {versions.length > 1 ? (
            <div className="sp-workshop__versions">
              <h2>{copy.versions}</h2>
              <ul>
                {versions.map((entry) => (
                  <li key={entry.version}>
                    <button
                      type="button"
                      className={entry.version === previewVersion ? 'is-active' : ''}
                      onClick={() => {
                        setPreviewVersion(entry.version)
                        setPane('preview')
                      }}
                    >
                      {copy.version} {entry.version}
                    </button>
                    {entry.version !== project?.currentVersion ? (
                      <button type="button" onClick={() => void restore(entry.version)}>
                        {copy.restore}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <aside className="sp-workshop__library">
          <h2>{copy.myProjects}</h2>
          {projects.length ? (
            <ul>
              {projects.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    className={entry.id === project?.id ? 'is-active' : ''}
                    onClick={() => void openProject(entry.id)}
                  >
                    {entry.title || copy.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>{copy.empty}</p>
          )}
        </aside>
      </main>
    </>
  )
}
