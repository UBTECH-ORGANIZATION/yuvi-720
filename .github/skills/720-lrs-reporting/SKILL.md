---
name: 720-lrs-reporting
description: "Use when implementing, reviewing, or debugging outbound xAPI reporting to the Israeli MoE LRS (720 program): OAuth transport, statement envelope (exidentifier/grouping/team), the 14 event families, the retry/dedup outbox ledger, or the Kata (CET) catalog/launcher/relay integration."
argument-hint: "Describe the LRS event, statement, transport, outbox, or Kata integration task."
---
# 720 MoE-LRS Reporting

Yuvi is the **single reporter** of 720 xAPI statements to the Ministry of Education LRS. Implementation lives in `backend/app/services/lrs/` (routes call only `reporter.report_*` — report-and-forget, gated by `LRS_ENABLED`).

## Procedure
1. Identify the direction first — this skill covers **outbound** (Yuvi → MoE LRS). Inbound content ingest (`/api/xapi`, `events.py`) is a different system with a different verb list; never route outbound through its `MOE_VERBS` filter.
2. Load the relevant reference:
   - Transport, auth, retry/dedup, ledger: [auth and transport](./references/auth-and-transport.md)
   - Mandatory statement envelope: [statement envelope](./references/statement-envelope.md)
   - Every event family + trigger wiring: [event catalog](./references/event-catalog.md)
   - Kata (CET) catalog/launcher/relay + the two LRS directions: [kata and directions](./references/kata-and-directions.md)
3. New event = add a builder in `lrs/statements.py` (golden fixtures: `docs/LRS/postman/720-LRS.postman_collection.json`) + one `reporter.report_*` call at the trigger.
4. Verify with `backend/scripts/lrs_smoke_check.py` (connectivity) and the `lrs_outbox` ledger (per-statement status + LRS response).

## Non-Negotiables
- The **exidentifier** (scrambled ת"ז) exists ONLY inside `lrs/` — never in the brain, an LLM prompt, or logs.
- Reporting never raises into a caller and never blocks a feature; failures persist in the outbox and are resent with the **same statement id** (the spec's dedup).
- The 720 PDF vocabulary **overrides** the general MoE list on conflict (it has `initialized/viewed/interacted/rated/skipped/updated/suspend/resume` etc.).
- `lrs_outbox` rows are never deleted — it is the permanent audit ledger of everything sent.
- Access checks come BEFORE reporting (e.g. a 403 teacher view must not emit `viewed`).
