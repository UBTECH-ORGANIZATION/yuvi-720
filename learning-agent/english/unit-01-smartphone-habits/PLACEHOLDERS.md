# Placeholders — English Lomda 01

Fields in [`content.json`](./content.json) whose value is owned by a **closed Ministry of Education
index that has not been imported into this repo yet**. They carry an explicit `PLACEHOLDER:` prefix
and **must not** be guessed, invented, or filled with a plausible-looking code.

| Placeholder token | Field(s) | Level | What is needed |
|---|---|---|---|
| `PLACEHOLDER:MOE-EN-SUBTOPIC-INDEX` | `subTopic` | unit | Official English sub-topic index for middle school |
| `PLACEHOLDER:MOE-EN-OBJECTIVE-INDEX` | `learningObjective` | unit | Official learning-objective code matching "describing daily habits in the Present Simple" |
| `PLACEHOLDER:MOE-SECTOR-INDEX` | `targetSector` | unit | Official sector list |
| `PLACEHOLDER:MOE-AUDIENCE-INDEX` | `targetAudience` | unit | Official audience list |
| `PLACEHOLDER:MOE-DEPTH-INDEX` | `depthLevel` | component ×7 | Official depth-level list |
| `PLACEHOLDER:MOE-EN-COGNITIVE-INDEX` | `cognitiveLevel` | component ×7 | Cognitive-level list **for the English subject** (the math list is not transferable) |
| `PLACEHOLDER:MOE-SKILL-INDEX` | `skills` | component ×7 | Official skills index |

The human-readable intent of each field is recorded next to it (`learningObjectiveText`,
the per-component `goals` array) so the swap is mechanical once the official lists arrive.

## Non-placeholder values that are still our own judgement

These are **not** MoE-owned and are deliberately concrete, but they are editorial decisions
that a reviewer may want to challenge:

- `relativeDifficulty` (1–5) per component.
- `masteryLevel` per component.
- `estimatedTimeInMinutes` per component.
- `passScoreInternal: 0.7` on the assessment component `-C5`. Internal only — never displayed.
- CEFR framing (A1 with an A1+ lane). The source book does not state a CEFR level.

## Follow-up

Importing the official indexes is tracked separately from this lomda. Until then the
validation script treats any value starting with `PLACEHOLDER:` as *known-missing* rather
than *invalid*, and reports the count so it cannot be quietly forgotten.
