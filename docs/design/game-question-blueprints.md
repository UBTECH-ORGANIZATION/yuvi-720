# Game questions with full context — blueprints, figures, randomness

Status: **SUPERSEDED 2026-09-10** — blueprints, figures, instances and server-side grading were removed; games carry the learning in their mechanics and the model writes any question it wants itself (see [learning-game-lab.md](learning-game-lab.md) §1.2, §2.5, §2.6). Kept for the record. Companion to
[learning-game-lab.md](learning-game-lab.md) §2.6 (harness) and §2.5 (pipeline).
Scope: every subject in the catalog (math, science, language, English,
history, geography…), every game theme, every device. The coordinate example
below is only the case that surfaced the problem.

## 0. The problem, from the data

The catalog dump for the component behind "רוגטקה טריגו"
(`CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.WRITE-00001`) shows why a kid cannot answer:

| Kata question text | Kata answer | What the CET screen has that we don't |
|---|---|---|
| כתבו את שיעורי הנקודה שבה ממוקמת המזרקה | (4,3) | a park map on a grid with a fountain icon |
| אילו שיעורים זהים בנקודות A, B, C? | שיעורי ה־x זהים | a grid with points A–E drawn |
| גררו כל ערך לנקודה המתאימה (matching) | A→(5,2), E→(8,8) … | the drawing |

The same shape recurs across subjects: a science item asks "what is the net
mass?" over a picture of a scale; a language item asks "which word is the
subject?" over a highlighted sentence; a geography item asks "which region is
marked?" over a map. Kata ships the caption and the key, never the context.
So a game today shows a caption with nothing to look at.

Two facts shape the design:

- The **key plus the teaching notes** (`informationToBot`, "common mistakes")
  usually contain everything needed to rebuild the context: values to draw,
  the sentence to highlight, the distractors the author cared about.
- The user wants questions **random per run and themed to the game**, not
  fixed strings. That calls for question *generators*, not cached pictures.

## 1. What we build

**Blueprints are written from the learning, not from the questions.** The
Kata texts are captions for screens we do not have ("now that you saw the
chess board, can you…"), so they are never reused, quoted or referenced. What
they tell us, together with the objective, unit and component titles, the
grade and the teacher's notes, is the **learning profile**: the subject, the
skill the component teaches, what its questions are about, and their level.
From that profile the model writes 6–8 original **question blueprints**: small,
declarative, code-validated generators that a game instantiates at run time
with fresh parameters, themed wording, a figure when the skill is visual, and
a server-side answer. Answers are attributed to the blueprint's skill for
telemetry. Nothing subject-specific lives in the pipeline; subject knowledge
enters only as data (blueprints) and as optional renderer kits registered
behind one interface.

```
Learning profile: subject, objective/unit/component, grade, teacher notes,
                  Kata question texts as evidence of scope and level ONLY
        │  (once per component, LLM, cached by profile fingerprint)
        ▼
Blueprints  6–8 × {skill, topic, level, interaction, wording, params | variants, answer, distractor rules, figure}
        │  (per game, mini LLM once)      ┌── theme vocab {slot role → themed noun/icon}
        │◄────────────────────────────────┘
        │  (per YuviLearn.next(), pure code, seeded)
        ▼
Instance  {id, text, interaction, options[], figure_svg, alt}  ──►  game overlay
          answer kept server-side, graded by /check as today
```

### 1.1 Blueprint DSL

JSON only, never code. Everything the model writes is data our code
evaluates in a sandbox. Two randomisation modes cover every subject:

- **Parametric** — params drawn from domains; the answer is computed. For
  anything with numbers, positions, quantities, units, word banks.
- **Variant set** — N hand-authored equivalent variants, each grounded in the
  Kata data and teaching notes (facts cannot be computed: a history date, a
  grammar rule, a definition). Randomness = pick a variant + shuffle options
  + themed wording. A blueprint may have exactly one variant (the Kata
  question itself) when the notes support nothing more; it still gets figure,
  theme and shuffle.

```json
{
  "id": "bp-…", "kata_question": "item#q",
  "skill": "write the coordinates of a marked point",
  "interaction": "text",
  "params": {
    "x": {"int": [1, 9]}, "y": {"int": [1, 9]},
    "w": {"pick": ["רץ", "קפץ", "שר"]},          // word bank (language subjects)
    "obj": {"theme": "object"}                     // filled from the game's theme vocab
  },
  "derived": {"x2": "x + 3"},                      // safe arithmetic on params only
  "constraints": ["x != y"],                       // rejected seeds are re-drawn
  "stem": "כתבו את שיעורי הנקודה שבה נמצא {obj}:",
  "answer": "({x},{y})",
  "accept": ["({x}, {y})"],
  "distractors": ["({y},{x})", "({x},{y2})"],      // from the teaching notes' mistakes
  "figure": { … see 1.2 … }
}
```

Param domains: `int`, `float` (with step), `pick` (from a list), `pick_n`
(distinct sample), `theme` (slot role), `date`/`year` ranges are plain ints.
Expressions run through an AST-whitelisted evaluator (numbers, + − × ÷,
min/max/abs/round/len; only param names). Same allow-list discipline as
`agents/visuals/maths.py`.

**Interactions** (what the kid does), all rendered by the harness and graded
server-side, so a game supports every subject without knowing it:

| interaction | options | answer | typical use |
|---|---|---|---|
| `choice` | ≥ 3 distractors + key | one option | most subjects |
| `multi` | options, ≥ 1 correct | set of options | "mark all the nouns" |
| `text` | none | string / number / pair, normalised | coordinates, results, a word |
| `order` | items | the sequence | timelines, steps of a process, sentence order |
| `hotspot` | targets in the figure | a target id | "click the subject", "click the region", "click point B" |
| `pair` | left/right lists | mapping | Kata `matching` items, translations, term→definition |

`matching` questions therefore stop being dropped: they become `pair`, or
`choice`/`hotspot` when a figure carries the pairs.

### 1.2 Figures: generic primitives, optional kits

A figure is a **composition of primitives** on a canvas, never a
subject-specific "type". The renderer is ours (SVG, instant, themeable,
`dir="ltr"` internally); the model only composes:

- `frame` — canvas size, optional axes (`x`/`y` ranges, ticks, labels), or a
  single axis for number lines and timelines.
- `point`, `icon`, `label`, `segment`, `arrow`, `polygon`, `path`, `arc`,
  `rect`, `ellipse` — with `at`/`from`/`to` bound to params; `icon` and
  `label` text may reference theme slots; each element may carry a `target`
  id for `hotspot`.
- `text` — a paragraph or sentence with `spans` (highlight, underline,
  blank), for language, reading and English items.
- `table` — rows/cols of cells bound to params (data tables, conjugations,
  comparisons).
- `bars` — categories with values (statistics, science measurements).
- `none` — pure word problems that carry everything in the stem.

Composition covers grids, number lines, timelines, sentences, tables and
diagrams with no per-subject code. Where a subject needs a recognisable
object (a balance scale, a beaker, a circuit, a map silhouette), a **kit**
registers a named primitive with its own draw function behind the same
interface (`register_primitive(name, draw, validate)`), the way
`agents/visuals/registry` registers repair passes. Kits are additive; a
blueprint that uses an unregistered primitive fails validation and is repaired
with primitives that exist. Real photographs and real maps cannot be rebuilt;
the judge (1.3) marks those `needs_review` and they are not played.

### 1.3 Generation and validation (once per component)

`backend/app/services/games/blueprints.py`:

1. Input: the learning profile (subject, grade, objective/unit/component
   titles, purpose, teacher notes, and the Kata question texts marked
   *evidence of scope and level only*). One strong-tier call per component,
   JSON mode, ~$0.05–0.10, cached in `game_question_blueprints` keyed by
   `component|profile fingerprint|DSL_VERSION.PROMPT_VERSION|index`. The
   prompt is subject-neutral: it describes the DSL, the interactions, the
   primitives, the two randomisation modes, the coverage rule (core several
   ways, one easier, one per common mistake, one stretch, same level), the
   no-reference rule (never "as you saw", never a screen the game lacks,
   never a yes/no self-check) and the grounding rule (variants and word banks
   come only from the profile; never invented facts).
2. **Code validation, no LLM**: instantiate 50 seeds per blueprint and require
   a unique non-empty answer; distinct distractors ≠ answer; the option counts
   per interaction; every param in its domain after constraints; figure
   renders and every bound position lands inside the frame; no unfilled slot;
   stem ≤ 200 chars; `hotspot` targets exist and are ≥ 44 px. One repair
   round with the validator's messages; still failing → `unusable`, and the
   Kata question is **excluded** from games (an unanswerable question is
   worse than none).
3. **Answerability judge** (mini, one call per blueprint, cached): given one
   rendered instance (text + a textual description of the figure + options)
   and *not* the key, the judge answers; then it is shown the key and asked
   whether the instance was answerable and unambiguous from what was shown.
   `ok` blueprints play; `needs_review` do not. This is the check that catches
   "which coordinates are equal" with no points drawn, and "which word is the
   subject" with no sentence shown.

The studio picker shows the count of `ok` blueprints; a create on a component
with zero is refused with today's "no questions yet" message.

### 1.4 Theme vocab (once per game)

After the create request and before enqueue, one mini call turns the kid's
brief + genre + the union of slot roles used by the component's blueprints
into `theme_vocab` in the game's language. Slot roles are generic
(`object`, `place`, `actor`, `container`, `unit_label`, `collectible`,
`obstacle`) and each carries a noun and an icon from a curated emoji map; a
blueprint with no slot keeps the Kata noun. Wording adapts to the theme, the
skill never does: a grammar question in a space game highlights the same
sentence structure, it just talks about astronauts.

### 1.5 Instances (per `next()`)

`backend/app/services/games/instances.py`, pure code:

- `learn.next` from the harness → the server picks the next blueprint in a
  shuffled cycle (`run_id`, index), draws a seed, instantiates, renders the
  SVG, stores `{instance_id, run_id, game_id, blueprint_id, kata_question,
  answer, accept[]}` in `game_question_instances` (TTL 48h) and returns
  `{id, text, interaction, options (shuffled), figure, alt, index, total}`.
- `total` = `min(12, max(6, ok_blueprints × 2))`: each skill twice with
  different values; every replay differs.
- `/check` grades against the instance row with per-interaction
  normalisers (text: whitespace/case, numbers `4.0`=`4`, pairs `(4, 3)`=`(4,3)`,
  Hebrew/Arabic final-form and niqqud stripping; `order`/`pair`/`multi`:
  set or sequence equality). `learner_game_answers` keeps `blueprint_id` and
  `kata_question`, so teacher analytics and learner signals attribute to the
  Kata skill exactly as now.
- Wrong-answer feedback carries the correct answer and, when the Kata
  question has an explainer, a `learn_more` id the player opens with the
  existing manim deck in the chat panel. Manim is not used for in-game
  figures: renders take seconds to minutes and produce video; the overlay
  needs an instant, crisp, themeable SVG.

### 1.6 Harness and contract changes

`workers/game_gen/harness/yuvi_learn.js`:

- `next()` posts `learn.next` to the host instead of walking a baked list;
  `__YUVI_LEARN_DATA` shrinks to `{total, language}`. Headless validation
  gets a fixture of pre-instantiated questions with keys, so the validator
  runs offline.
- New injected helper `YuviLearn.mount(q, container)` renders the standard
  overlay body for **every** interaction: figure (SVG, max 46vh), stem,
  options / input / orderable list / pair columns / hotspot handlers. Games
  may still build their own overlay for `choice` and `text`, but the
  contract says: if `q.figure` is present it must be visible above the text
  at ≥ 220 px tall, and `order`/`pair`/`hotspot`/`multi` must go through
  `mount()`. The validator checks the overlay contains
  `<svg data-yuvi-figure>` at that size and that `answer()` is called with
  the shape `mount()` produces.

`workers/game_gen/prompts.py`: rule 3 changes timing — the kid sees and
touches the field for a few seconds before the first question, and the field
stays visible (dimmed) behind the overlay; LEARNING_CONTRACT rule 5 becomes
interaction-driven (`mount()` first, custom overlay only for `choice`/`text`);
LEARNING_CONTEXT shows, per blueprint, the skill line and two sample
instances, so the model themes mechanics on the **skills** (rule 7) rather
than on three fixed strings; rule 6 sizes the game by `total` as before.

### 1.7 Serve path and cost

- Instances come from the backend at play time (~1 ms + one Cosmos write);
  the worker is not involved. Cloud workers keep building games.
- Per component: one blueprint call + one judge call per blueprint, cached
  (bust with `DSL_VERSION`). Per game: one mini theme call. Per run: none.

## 2. Flow, end to end

1. Kid picks a component → studio shows the `ok` blueprint count (generated
   lazily on first pick behind the existing spinner; the nightly
   content-intelligence cron pre-warms visited components).
2. Create → theme vocab → job enqueued with the blueprint summaries.
3. Worker builds the game around the skills; the validator plays it headless
   with fixture instances and checks the figure/interaction rules.
4. Play → each `next()` yields a fresh themed instance; `answer()` grades
   server-side; wrong answers can open the explainer.
5. Replay → different values or variants, same skills, same theme.

## 3. Phases

- **Phase 1 — the engine, subject-neutral**: DSL + evaluator, primitives
  renderer (frame/axes, point/icon/label/segment/arrow/polygon, text spans,
  table), interactions `choice`/`text`/`hotspot`, blueprint
  generation/validation/judge, instance service, `/check` on instances,
  harness `learn.next` + `mount()`, contract/validator rules, fixtures.
  Regenerate the existing games. Tests: evaluator, renderer geometry,
  50-seed validation, normalisers, harness headless, one blueprint fixture
  per subject in the catalog (math, science, language, English) to prove
  neutrality.
- **Phase 2 — coverage**: `order`/`pair`/`multi`, `bars`, the first kits
  (balance scale, container) via the registry, theme vocab per game,
  explainer link on wrong answers.
- **Phase 3 — operations**: admin tab listing blueprints per component with
  status and the judge's reason, regenerate button, nightly pre-warm,
  per-blueprint correctness rate in teacher analytics (a blueprint everyone
  gets wrong is flagged for review).

## 4. Risks and answers

- *A wrong but consistent answer formula or an invented "fact" variant.* The
  50-seed validator catches inconsistency, the judge catches unanswerable,
  grounding forbids facts outside the notes, and Phase 3's correctness rate
  flags what slips through. Blueprints are data, reviewable in the admin tab.
- *Figures leak the answer.* They must; the figure is the context the kid
  reads. The key string stays on the server.
- *Games that ignore `q.figure` or the richer interactions.* `mount()` is the
  easy path; the validator rule fails the build and the fix loop gets the text.
- *Context that cannot be rebuilt* (a photo, a real map, an audio clip). The
  blueprint never depends on it: it draws its own. What the judge still finds
  unanswerable is marked `needs_review` and not played.
- *A subject nobody anticipated.* Nothing in the pipeline names a subject.
  A new subject needs at most a kit, and works without one through the
  generic primitives, `text` spans and tables.
