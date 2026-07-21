# 720 xAPI and Monitoring

The platform needs learning activity reports from content so it can update learner profiles, route learners, and generate recommendations.

> **Scope note — two LRS directions.** This reference covers the **inbound** wire vocabulary (content → Yuvi's own `/api/xapi`). For **outbound** reporting (Yuvi → the Ministry's LRS), the 720-project PDF defines a different, overriding vocabulary (`session enter/suspend/resume/exit`, `initialized`, `viewed`, `interacted/rated`, `skipped`, `updated`, …) — see the `720-lrs-reporting` skill. On conflict, the 720 PDF wins for outbound; the inbound list below is unchanged.

## Authoritative closed vocabularies (MoE LXP) — source of truth
Use these exact IRIs; never invent verbs, activity types, extensions, or domains. Canonical registry:
- Verbs: `https://lxp.education.gov.il/vocabulery/Verb.html`
- Activity types: `https://lxp.education.gov.il/vocabulery/ActivityType.html`
- Result extensions: `https://lxp.education.gov.il/vocabulery/ResultExtension.html`
- Domains (subjects): `https://lxp.education.gov.il/vocabulery/Domain.html`

IRI bases: verbs `https://lxp.education.gov.il/xapi/moe/verbs/{verb}`; activities
`https://lxp.education.gov.il/xapi/moe/activities/{type}`; result extensions
`https://lxp.education.gov.il/xapi/moe/extensions/{name}`; curriculum tag object
`https://lxp.education.gov.il/xapi/curriculum`; catalog grouping id
`https://lxp.education.gov.il/xapi/moe/ecat/item/{catalogId}`.

## Core Learning Events
- Content/component started.
- Question answered.
- Hint requested.
- Video/media played or completed.
- Component completed.
- Assessment passed or failed.
- Unit completed.

## Required Event Meaning
Every event must make clear:
- Who acted, using a non-identifying learner reference when sent to AI-adjacent systems.
- What action occurred.
- Which unit, component, item, and question the action concerns.
- Result data where relevant: success, response, attempts, duration, score for internal use, or mastery/status snapshot.

## Launch Context (`slxapi`)
When iframe content needs reporting credentials, the platform should pass a top-level `slxapi` query parameter or launch value. Its value is stringified/escaped JSON with:
- `endpoint`: base reporting/LRS endpoint, without appending `/statements`.
- `auth`: reporting credential or token, for example a `Basic ...` value.
- `actor`: learner identity object with display `name` when needed and an `account` containing a non-identifying learner ID and platform `homePage`.

Do not put real government IDs or unnecessary personal details in AI-adjacent reporting context.

## Verbs (closed list — `.../xapi/moe/verbs/{verb}`)
The MoE LXP defines the closed verb set below. Choose the verb by activity type + scoring timing. These
are the **wire** verbs — there is **no** generic `Initialized` / `Selected` / `Requested`.

| Verb (slug) | Hebrew | When to use |
|---|---|---|
| `enter` / `exit` | כניסה / יציאה | learner enters/leaves the system, course, or activity |
| `attempted` | ניסה | an answer **attempt** when multiple tries are allowed and a wrong attempt exists (question, gameon, simulation) |
| `answered` | ענה | learner **submitted** an answer where scoring is **not** immediate (open questions, tasks) |
| `scored` | נוקד | a score was later given for a non-immediately-scored activity |
| `completed` | סיים | activity that is itself scored — emit **only after** the final score/feedback is shown to the learner |
| `submitted` | הגשה | learner submitted a submittable task/assignment |
| `read` | קרא | learner read reading content (page/article/book) |
| `watched` | צפה | learner watched video |
| `listened` | הקשיב | learner listened to audio |
| `played` / `paused` | שיחק / השהה | learner played/paused a game or pausable media |
| `play` | ניגן | learner played back media (video/audio) |
| `downloaded` | הוריד | learner downloaded a downloadable activity |
| `install` | התקין | learner installed an installable activity (e.g., app) |
| `assigned` | הקצאה | a submittable activity was linked/assigned to a learner |
| `created` | יצירה | creation of a learning group, course, or task |
| `joined` / `leave` | הצטרפות / עזיבה | learner joined/left a learning group |
| `voided` | ביטול | void a previously sent (erroneous) statement |

Every statement carries the three mandatory fields — **`actor`** (non-identifying), **`verb`** (an IRI
from the list above), and **`object`** (the activity id from metadata / the education catalog).

**Mapping our internal events → MoE verbs:** start → `enter` / `attempted`; formative retry → `attempted`;
submitted answer with delayed score → `answered` then `scored`; inline-scored activity finished →
`completed`; media → `watched` / `listened` / `played` / `paused`; reading → `read`; assignment →
`submitted`. **Hint requests and prolonged inactivity are NOT MoE verbs** — capture them as
monitoring/telemetry (internal), not as conformant xAPI statements.

## Activity types (closed list — `.../xapi/moe/activities/{type}`)
`question` · `page` · `onlinelesson` · `assignment` · `onlinesession` · `lms` · `e-book` · `video` ·
`audio` · `simulation` · `application` · `serious-game` · `article` · `questionnaire` · `course` · `tag`.
Set `object.definition.type` to the matching IRI. `course` is the top grouping (carries a catalog id
`.../ecat/item/{catalogId}`); `tag` tags content to the curriculum (`.../xapi/curriculum`).

## Result extensions (`.../xapi/moe/extensions/{name}`)
- `weight` (משקל) — the activity's weight within the overall score (e.g., a question inside a
  `questionnaire` when questions carry different weights).

Standard xAPI `result` fields (`success`, `response`, `score.scaled`, `duration`, `completion`) are used
as-is; `score.*` stays **internal** (never shown to the learner).

## Domains / subjects (closed list)
The curriculum **domain** (subject) comes from the LXP Domain registry. Scope for תשפ"ז is **מתמטיקה**
and **מדע וטכנולוגיה**. The list also includes מבוא למדעים, ביולוגיה, אנגלית, עברית – הבנה הבעה
ולשון, היסטוריה, גאוגרפיה, אזרחות, חשיבה מחשובית ורובוטיקה, אוריינות דיגיטלית ועוד. Use only domains from the
registry; do not invent subjects.

## Completion Reporting
At the end of a component, return:
- Binary success/failure against the component goal.
- A snapshot of learner performance or mastery for routing.
- Recommended next content when failure or misconception is detected, if known.

## Monitoring and Fault Events
Content should report or log:
- Component or media load errors.
- Load time longer than 5 seconds.
- Failed xAPI requests.
- Incomplete actions or content closed before completion.
- Prolonged inactivity.
- Other provider-defined anomalies that help diagnose learner experience issues.

If xAPI delivery fails, retry according to a defined policy and verify successful persistence when acknowledgements are available. Retries must be transparent to the learner and must not block the learning flow.

## Student-Facing Constraint
Scores may be collected internally for routing and analysis, but do not show numeric grades to learners during learning.