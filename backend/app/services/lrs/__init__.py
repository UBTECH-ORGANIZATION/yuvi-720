"""Outbound MoE-LRS (720) xAPI reporting — Yuvi is the single reporter.

Two LRS directions exist in this codebase; do not confuse them:
- INBOUND  (`app/services/events.py`): our lightweight LRS at `/api/xapi` that
  receives content xAPI (relayed by Kata) and feeds the Learner Brain.
- OUTBOUND (this package): conformant 720 statements sent to the Ministry of
  Education LRS, Near-Real-Time, with Retry/Resend + de-dup on `statement.id`.

The outbound vocabulary comes from the 720 PDF (`docs/LRS/`), which OVERRIDES
the general content-standards wire list — never route these through the
inbound `MOE_VERBS` filter. Public entrypoint: `app.services.lrs.reporter`.

PII boundary: the learner's exidentifier (scrambled national ID) exists ONLY
inside this package for government reporting. It must never reach the brain,
an LLM prompt, or application logs.
"""
