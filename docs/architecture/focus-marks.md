# Focus marks — showing the learner what a reply is about

Every on-task lesson reply from Yuvi carries one **mark**: the object on the
lesson screen the sentence is about (the question, a picture, the table, the
answers). It replaced a model-chosen `point_at_screen` tool that ~97% of the
time chose nothing and, when it did, mostly lit up the whole frame.

## Pipeline → runtime

```
nightly walker (content-extract.mjs, capture v8)
  → objects with stable ids + Hebrew labels + per-size rects   content_objects.build_objects
  → shards content/context/** (public: no answers, no authored notes)
runtime
  → coach_focus.resolve(turn)        deterministic, zero tokens, before the first word
  → pointer frame v2 over SSE        {object_id, kind, label, precision, region, breakpoints}
  → LessonPointLayer                 rect with a name badge · "scroll to: <name>" · labeled callout
  → chat chip "👀 <name>"            re-shows the mark
```

Object sources, best first: the v8 catalog → legacy v7 regions (whole regions
only) → the catalog alone (a *semantic* mark: named, not drawn).

## The rules that keep it honest

- **Leak policy** (`coach_focus.finalize`, the only place it runs): a single
  answer option is marked only when the learner chose it or the question is
  solved — never merely because they named it (that would make the mark an
  oracle). Evidence is scoped to the current screen (question ids repeat).
- **No mark** on the welcome, praise, social or off-task turns.
- **Assumed position** (the player has not said where the learner is): named
  only, never drawn. **Look-alike variants**: whole regions only.
- A mark never outlives its screen: cleared on `screen_change`, and at once
  on `position_lost` (an unmapped vendor page).
- Why a mark was lifted or refused never leaves the server.

## Flags

| Flag | Default | What |
|---|---|---|
| `COACH_FOCUS_MARKS_ENABLED` | `on` | off · shadow (log only) · on |
| `COACH_LESSON_PLANNING` | `gated` | the planning call only on a teacher-help cue |
| `COACH_FOCUS_TAG_ENABLED` | off | the model re-aims the mark with a hidden `⟦o3⟧` |
| `COACH_LEAN_NUDGES` | off | compact nudge prompt, same cached instructions |
| `COACH_SHARED_TEXTS` | off | arrival texts generated once per screen + language |
| `COACH_MISCONCEPTION_CATALOG` | off | vendor mistakes catalog parsed, not cut at 900 chars |
| `LESSON_TALL_FRAME_ENABLED` + `…_HOSTS` | off | iframe as tall as its content, page scrolls |

`COACH_POINTING_ENABLED=0` turns all pointing off.

## Proving it

- `backend/scripts/coach_eval.py` — the real coach on real screens with
  natural questions (he/ar/en), sandboxed; compares flag variants on hard
  gates (answer leak, mark leak, visible tag, language), mark accuracy,
  tokens, cost, latency, and a two-order pairwise judge.
- `backend/scripts/content_audit.py` — a local screenshot gallery of every
  captured object and the mark each turn type gets.
- `backend/scripts/tall_frame_report.py` — which players qualify for the
  tall frame, from the walker's tall probes.
- `backend/scripts/content_guard.py` — the nightly's merge gate.
