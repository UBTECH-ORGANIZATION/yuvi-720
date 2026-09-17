# Kata (CET) + the Two LRS Directions

## Never confuse the two LRS directions
| | INBOUND (ours) | OUTBOUND (this skill) |
|---|---|---|
| What | Yuvi's lightweight LRS at `/api/xapi` | The Ministry's LRS (`lrs-stg.education.gov.il`) |
| Role | Receives content xAPI (Kata relay) → feeds the Learner Brain | Yuvi deposits conformant 720 statements (send-only, never read) |
| Code | `routes/xapi.py`, `services/events.py` | `services/lrs/*` |
| Verbs | Content-standards wire list (`MOE_VERBS`, no initialized/selected/requested) | 720 PDF vocabulary (overrides on conflict) |

The MoE LRS is a **store you deposit records into** — not a proxy, not a read source. Pipeline: content → our LRS (receive) → enrich → MoE LRS (deposit).

## Kata = CET's content platform (`kata.cet.ac.il`)
API (all `X-API-Key` header; key in `KATA_API_KEY`, staging key verified live 2026-07-20):
- **Catalog**: `GET /api/v1/catalog/content-units` · `/content-units/{id}` · `/components` · `/search` — paged `{items,page,limit,total}`, full 720-shaped metadata incl. **real MoE-coded objectives** (`MOE.SCI.G7.CHEM…`), componentPurpose/isAssessment/relativeDifficulty/order/depthLevel/cognitiveLevel/recommendedAfterFail.
- **xAPI Launcher**: `POST /api/v1/launcher/context` body `{componentId, studentId (pseudonymous, NEVER a real ת"ז → xAPI actor.account.name), platformUrl (→ actor homePage), lrsEndpoint?, lrsAuth?, studentName?, resetState?}` → returns a `launchUrl` to embed in the player iframe. `resetState: true` (Kata, 18/09/2026) makes Kata forget the student's saved progress in that component so the launch starts over; Yuvi sends it only for the §6 re-entry dialog's "start again" (`POST /api/learning/sessions` `restart: true` → `create_launch_context(reset_state=True)`), never on an ordinary relaunch. The `registrationId` stays the same per student+component either way.

## The relay model (from the launcher docs — the key architectural fact)
**"Kata is itself the ingest endpoint"**: launched content reports its xAPI **to Kata**, and Kata **forwards** each statement to the configured `lrsEndpoint`+`lrsAuth` (server-side group default or per-launch override; stored server-side, never in the launch URL). **We point that at our own `/api/xapi/{launch}/` + `Basic {token}`** — statements land in the existing ingest, just relayed by Kata instead of posted directly by the iframe. Yuvi then enriches + forwards to the MoE LRS as the single reporter, tagging Kata as `content-vendor`/ecat.

```
Kata catalog  ──GET──►  Yuvi   (discover/retrieve content)
Kata launcher ──POST─►  Yuvi   → launchUrl embedded in iframe
content ──xAPI──► Kata ──relay──► Yuvi /api/xapi ──enrich──► MoE LRS
Yuvi platform events ─────────────────────────────────────► MoE LRS
```

## Forward-path gotcha (live 400, fixed 2026-07-20)
The MoE LRS **rejects bare (non-IRI) extension keys** (`NoAdditionalPropertiesAllowed: #/context.extensions.question_id`). Content relayed through our inbound convention carries bare keys (`question_id`, `misconception`…) — `enriched_content_statement` now maps them onto the MoE extension namespace via `_iri_safe_extensions` (context + result extensions; `None` values dropped). Never forward raw content extensions untouched.

## Open items (tracked in the plan)
- Launcher 404s on catalog-listed component ids (verified live: catalog sees them, launcher says "component not found") — likely unpublished-for-launch on Kata's side; ask Kata.
- Confirm the relay's exact forward path (`{lrsEndpoint}/statements`?) + auth header format + the launcher 200-response field names.
- Ask Kata/MoE whether Kata ALSO reports learner events to the MoE LRS itself (spec structure implies the platform is the sole event reporter; Kata's separate MoE channel is *static metadata*) — avoid double-counting.
- `LRS_KATA_ECAT_ID` (Kata's MoE educational-catalog item id) unassigned — content-vendor grouping omitted until it lands.

## Kata ids are URLs (since 09/2026)
Kata's catalog now identifies components and items by the content's own URL (`https://lomdot.education.gov.il/metodica/720active/science/mass-measure/01/methodica-science-mass-measure-01-01`, sometimes with a trailing `/`; CET: `https://learning.cet.ac.il/player/learning-activity/{oid}/CET.…-00001`, items `https://learning.cet.ac.il/metadata/{oid}/{key}`). **Yuvi's id stays the slug** — the URL's last path segment, `kata_client.content_slug` — everywhere: the brain pointer, `learning_events.launch`, coach threads, content-intelligence shards, the LRS IRIs (`{d}/component/{slug}`, `componentId` extension). Kata's own id is kept beside it as `launch_id` and used for exactly one call, `create_launch_context`. `resolve_component` accepts both shapes (a bookmarked `?component=https://…` still launches; `LessonPage` rewrites the address bar to the slug). The read side reduces any URL it still meets (`events._object_tail`, `agents/sessions.normalize_activity_id`). Component slugs are unique across the live catalog; item slugs repeat only across components, and items are always scoped by their component.
