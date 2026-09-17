# 720 Statement Envelope — mandatory on EVERY outbound statement

Builders: `lrs/context.py` (+ `lrs/statements.py:_base`). IRI namespace: `https://lxp.education.gov.il/xapi/moe/…`

## Actor — exidentifier only
```json
{"objectType":"Agent","account":{
  "homePage":"https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
  "name":"<scrambled national id>"}}
```
Resolved by `lrs/identity.py`: the user's own `exidentifier` (MoE SSO, or the seeded overrides on the users doc) first, the staging stub `LRS_TEST_EXIDENTIFIER` second. An empty stub is a one-line notice, never a reason to switch reporting off — users with no identity anywhere are skipped per statement. PII boundary: never leaves the `lrs/` package.

## context.contextActivities.grouping — always lms + session + program
1. **LMS**: `{LRS_SUPPLIER_DOMAIN}` · type `activities/lms`
2. **Session**: `{domain}/session/{sessionId}` · type `activities/session` — the sessionId minted at login (JWT `sid` claim), same for every statement of the visit
3. **Program**: `https://lxp.education.gov.il/xapi/moe/program/720-platform` · type `activities/program`
4. **Content events only** — content-vendor: `…/moe/ecat/content-vendor/{vendorId}` · type `activities/content-vendor` — the ministry's supplier id (מטח 10 · קמפוס 521 · מתודיקה 310), resolved per content from the catalog's `manufacturer` (`hierarchy.ecat_item_for`); a published ECAT id or `LRS_ECAT_ITEMS`/`LRS_KATA_ECAT_ID` would win if one ever existed
5. Content metadata inheritance rides here too: learning-unit / component activities with `name.he` (unit→component→item; an item event carries all three levels' metadata).

`build_grouping` de-dupes by activity id (content-origin statements may already carry lms/session entries — ours win).

## context.team — NMM group preferred, school fallback
- NMM: homePage `…/moe/identity/nmm/kvutsa`, name = NMM id
- School (until NMM known): homePage `…/moe/school`, name = official school symbol

## Extensions
Short name → `…/moe/extensions/{name}` via `context.extensions(...)`. Per-family extensions in the event catalog.

## Other rules
- `id`: server-generated uuid4, persisted, reused on retry (dedup); `exit` uses `uuid5(session IRI + "#exit")` so a second closer files the same id.
- `timestamp`: ISO-8601 UTC at second resolution, **at least one second after the same actor's previous statement, in build order** (`statements.sequenced_timestamp`; the ministry reads sessions as second-resolution sequences). A relayed content statement's own time is floored and sequenced the same way. Durations: ISO-8601 (`PT45M12S`) via `iso_duration`.
- `context.instructor` (student-goal): present only when a teacher performed the action.
- `selected`: `context.extensions/selectionType` ∈ `learning-type | practice-decision | is-understood | is-repeat | external-learning` (spec v1.1 — the `category` placement was v1.0), chosen value in `result.response`.
- `parent`: the direct container (question→questionnaire screen; item→component; component→unit); the deepest `grouping` entry is the statement's own object, verbatim (integration report 3).
- Media statements (`played`/`paused`) are on a `video`/`audio`/`animation` object; `mediaDuration` no longer exists.
- Every extension key is a `…/moe/extensions/…` IRI (`_iri_safe_extensions`); a bare key is a 400.
