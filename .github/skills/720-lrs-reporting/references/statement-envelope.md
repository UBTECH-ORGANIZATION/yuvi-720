# 720 Statement Envelope — mandatory on EVERY outbound statement

Builders: `lrs/context.py` (+ `lrs/statements.py:_base`). IRI namespace: `https://lxp.education.gov.il/xapi/moe/…`

## Actor — exidentifier only
```json
{"objectType":"Agent","account":{
  "homePage":"https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
  "name":"<scrambled national id>"}}
```
Resolved by `lrs/identity.py` — currently env stubs (staging), later real MoE SSO. PII boundary: never leaves the `lrs/` package.

## context.contextActivities.grouping — always lms + session + program
1. **LMS**: `{LRS_SUPPLIER_DOMAIN}` · type `activities/lms`
2. **Session**: `{domain}/session/{sessionId}` · type `activities/session` — the sessionId minted at login (JWT `sid` claim), same for every statement of the visit
3. **Program**: `https://lxp.education.gov.il/xapi/moe/program/720-platform` · type `activities/program`
4. **Content events only** — content-vendor: `…/moe/ecat/item/{ecatId}` · type `activities/content-vendor` (Kata's educational-catalog id, `LRS_KATA_ECAT_ID`)
5. Content metadata inheritance rides here too: learning-unit / component activities with `name.he` (unit→component→item; an item event carries all three levels' metadata).

`build_grouping` de-dupes by activity id (content-origin statements may already carry lms/session entries — ours win).

## context.team — NMM group preferred, school fallback
- NMM: homePage `…/moe/identity/nmm/kvutsa`, name = NMM id
- School (until NMM known): homePage `…/moe/school`, name = official school symbol

## Extensions
Short name → `…/moe/extensions/{name}` via `context.extensions(...)`. Per-family extensions in the event catalog.

## Other rules
- `id`: server-generated uuid4, persisted, reused on retry (dedup).
- `timestamp`: ISO-8601 UTC. Durations: ISO-8601 (`PT45M12S`) via `iso_duration`.
- `context.instructor` (student-goal): present only when a teacher performed the action.
- `selected`: choice-type goes in `context.contextActivities.category` (per the content-dev guidelines), chosen value in `result.response`.
- `parent`: the direct container (question→questionnaire/component; item→component) — flexible per content hierarchy, passed as a param, never hardcoded.
