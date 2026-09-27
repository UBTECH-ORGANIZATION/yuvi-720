# Design — English Lomda 01 · "What I Do Every Day"

Source of inspiration: *Up We Go Student's Book*, Section 1 "Smartphone Teens", Unit 1 "Send a Message!" (pp. 10–24).
Knowledge base: [`docs/720/en-books/up-we-go-sb/`](../../../docs/720/en-books/up-we-go-sb/).

> **Original content.** Every English text, name and illustration in this lomda was written for it.
> Nothing is reproduced from the printed pages. The book supplies the *level, vocabulary set,
> grammar target, rubric pattern and tone* — not the wording.

---

## 1. Learning objective

One objective, fully realized by this unit:

> **The learner describes daily habits — their own and other people's — in the Present Simple, using the unit's smartphone verb phrases.**

This is the pedagogical core of the book unit: §2 supplies the verb phrases, §8 supplies
Present Simple (1) including the 3rd-person `-s/-es`, and §1/§4 supply the personal "what I do"
frame that makes the grammar worth using.

Level: middle school, grades 7–9. CEFR **A1 with an A1+ stretch lane** (our estimate — the book
does not state a CEFR level; see `BOOK-PROFILE.md` §2).

### Can-Do goals (learner-facing, non-numeric)

| # | Can-Do | Where it is taught | Where it is proven |
|---|--------|--------------------|--------------------|
| G1 | I can understand and say **8 phrases** about what people do on a phone. | C1 | C1 matching, C4, C5 |
| G2 | I can **scan** a short text and find who does what — quickly. | C2 | C2 questions |
| G3 | I can build a sentence in the **Present Simple** about myself (`I take photos`). | C3 | C4 |
| G4 | I can add **`-s` / `-es`** when I talk about *he / she / it*. | C3 | C4, C5 |
| G5 | I can put a **time word** (`always / sometimes / never`) in the right place. | C3 | C4 |
| G6 | I can ask and answer a **`Who …?`** question. | C2, C5 | C5 |

Goals are shown to the learner as a checklist in the opening planning card and re-visited,
unchanged, in the closing reflection card. No mastery label and no score is ever displayed.

---

## 2. Route shape — **hybrid**

Seven components. Six sit on the main route; one is a support lane the platform may inject.
The learner may open any unlocked component in any order from the map screen — nothing is
sequence-locked (720: learner autonomy).

| order | id suffix | title | purpose | assessment | mastery | required |
|-------|-----------|-------|---------|------------|---------|----------|
| 1 | `-C1` | Word Power | instruction | no | basic | yes |
| 2 | `-C2` | The 8B Forum | both | no | intermediate | yes |
| 3 | `-C3` | Language Point | instruction | no | intermediate | yes |
| 4 | `-C4` | Practice | practice | no | intermediate | yes |
| 4 | `-C7` | Step by Step | practice | no | **basic** | **no** |
| 5 | `-C5` | The Moment of Truth | practice | **yes** | advanced | yes |
| 6 | `-C6` | Looking Back | instruction | no | — | yes |

`-C4` and `-C7` share `order: 4` — they are **alternative components at the same route position**,
as the standard requires. `-C7` is the `recommendedAfterFail` target of both `-C4` and `-C5`.

### Why `-C7` is a genuinely different representation

`-C4` is text-led: read the sentence, choose/type/order the words.
`-C7` is **audio-and-picture-led**: the learner hears the sentence first, then chooses,
one idea per screen, with the rule visible on-screen the whole time. Same objective,
different road — not "the same exercises again, easier".

---

## 3. Component-by-component

### C1 · Word Power — *instruction*
1. **Planning card** (meta-cognitive · planning) — the six Can-Do goals + a real choice:
   "start from the words" / "start from the text". Emitted as xAPI `Selected` with
   `result.response = "learningType"`. Both roads lead to the same place.
2. **Word bank** — 8 verb phrases, each with an English audio button and a He/Ar gloss,
   modelled on the book's *Mini-Dictionary* rubric.
3. **Matching** — phrase → meaning (not assessed; a warm-up).
4. **Read it right!** — the `all → /ɔːl/` family (`call / small / all`), audio + one choice item.
   The book teaches pronunciation explicitly; keeping that is what makes the audio component
   pedagogically required rather than decorative.

### C2 · The 8B Forum — *instruction + practice*
1. **Strategy card** (meta-cognitive · monitoring) — *Scanning*: don't read every word, hunt for
   the one word you need. Includes the "check yourself" prompt used during the questions.
2. **Reading** — an original forum thread: Maya asks her classmates one question, eight answer.
   Line-numbered, LTR, with a full-text audio button. 8 short replies = one screen, no scroll trap.
3. **Scan questions** — four `Who …?` choice items, each with a "where to look" hint on request
   (xAPI `Requested`).
4. **True / False** — two items that only a learner who actually scanned can pass.

### C3 · Language Point — *instruction*
1. **Rule card** — `I / You / We / They` + verb, with a live **sentence builder**: tap a subject,
   tap a verb phrase, the sentence assembles itself. Colour-coded exactly like the book
   (subject / verb / rest).
2. **The `-s` rule** — `He / She / It` + verb`-s`. Same builder, now showing the ending appear.
3. **`-es` spelling** — `watch → watches`, `go → goes`.
4. **Time words** — `always / sometimes / never` and their position, plus `every day / in the evening`.
5. **Solved exercise** (`contentType: Solved Exercise`) — one sentence walked through step by step,
   the way the book's worked examples do it.

### C4 · Practice — *practice* (**10 items**, hard cap 15)
`fill-in` ×3 · `choice` ×3 · `sequencing` ×2 (word order) · `matching` ×1 · `true-false` ×1.
Every item: immediate verbal feedback that **names the error**, and a forward-feed sentence
("next time, look at the subject first"). Unlimited retry, no penalty, no counter.

### C5 · The Moment of Truth — *assessment*
An original short interview (a reporter asks five teens one question each), then six items
mixing `choice`, `fill-in` and `Who …?`. Pass threshold `0.7` — **internal only**, used for
routing and reported in `result.score.scaled`; the learner sees words, never a number.
On fail → `recommendedAfterFail: [-C7]`.

### C6 · Looking Back — *summary + reflection*
1. Visual recap of the rule and the eight phrases (no new practice — matches the standard's
   summary rules).
2. Can-Do self-check — the same six goals, self-rated with three verbal levels.
3. One open reflection line: "one thing I will try next time".

---

## 4. Meta-cognitive scaffolds — all three phases

| Phase | Where | What |
|-------|-------|------|
| Planning | C1 item 1, and a one-line "what is this screen asking?" on every question screen | goals, route choice, task reading |
| Monitoring | C2 strategy card; the "check yourself" prompt; on-demand hints | pause-and-check during work |
| Reflection | C6 | self-check against the goals + forward transfer |

---

## 5. Four communication domains

| Domain | Covered by |
|--------|------------|
| Listening | C1 word-bank audio, C1 *Read it right!*, C2 reading audio, C7 audio-led items |
| Reading | C2 forum, C5 interview, every written stem |
| Writing | C4 `fill-in` items, C6 open reflection line |
| Speaking | *Say it* prompts on the word bank and after the reading — the learner is asked to say the sentence aloud before answering. Not recorded, not assessed (no microphone: privacy). |

The book's performance tasks (film a video in groups of four, a whole-class chain drill, acting
out a dialogue) are **physical and social** and cannot be graded on screen. Screen-doable
equivalent adopted here: the *Say it* prompt plus the C6 reflection, with the group video
left as a teacher-facing suggestion in the component metadata rather than a learner task.

---

## 6. Differentiation — modelled on the book's `⇧UP` marker

Three lanes, never labelled to the learner:

- **Support** → `-C7`, audio-led, one idea per screen, rule permanently visible.
- **Core** → `-C1 → C2 → C3 → C4 → C5`.
- **Stretch** → optional `⇧` items inside C2/C4/C5, marked in the UI with a small chevron only
  (no "advanced" wording), exactly the way the book marks enrichment.

---

## 7. Feedback wording rules

- Never "wrong", never "failed", never a number, never a comparison to other learners.
- Always three beats: **what happened → why → what to do next**.
  *"`He` needs a verb with `-s`. `watch` ends in `ch`, so it takes `-es`: `watches`. Try the next one and check the ending first."*
- Delayed feedback is not used anywhere, so no "feedback will come later" notice is needed.

---

## 8. Localization

- Learner-facing instructions, feedback, goals and UI chrome: **Hebrew (source) + Arabic**, every
  string keyed in `content.json`. `?lang=he|ar`, `dir` switched on `<html>`.
- The English material always stays English and always renders inside an LTR island
  (`dir="ltr"`), the way the book prints English blocks inside a Hebrew/Arabic page.
- No hardcoded learner-facing text in `player.js`.

---

## 9. Technical contract

- Standalone HTML/CSS/JS. No CDN, no framework, no build step, no emoji (icons are inline SVG).
- `width: 100%`, 16:9 target, works at desktop and tablet widths, mouse **and** touch **and** keyboard.
  Ordering/matching use tap-to-select rather than HTML5 drag — drag is hostile to touch and to keyboards.
- English audio: **pre-generated Azure Speech MP3s** under `audio/`. Browser `SpeechSynthesis` is
  never used. Missing file → the speaker button hides itself, the lomda keeps working.
- Two modes behind one seam: `standalone` (demo — checks answers locally) and `hosted`
  (reads `slxapi` from the query string and reports xAPI). The item-checking call site is identical.
- No global unit progress inside the lomda. Component-internal progress dots only.
- On component completion → xAPI `Completed` **after** all feedback is shown, then
  `postMessage({source:'yuvilab-lomda', type:'component-completed', ...})` to the parent.

---

## 10. Open placeholders

Tracked in [`PLACEHOLDERS.md`](./PLACEHOLDERS.md). The MoE-owned closed indexes
(sub-topic, learning-objective, depth-level, cognitive-level, skill, sector and audience codes)
are **not invented** — they carry explicit `PLACEHOLDER:` values until the official lists are imported.
