"""Ministry of Education OpenID Connect sign-in (720 unified identity).

Authorization-code flow with PKCE against `is.remote.education.gov.il`. The
Ministry proves who the person is; everything after that — the session cookie,
roles, the brain document — stays exactly as it was for password login, so the
rest of the app never learns there is a second way in.

PII boundary: the Ministry's `exidentifier` (scrambled national ID) is written
to the `users` document and used ONLY to address outbound LRS statements. The
`learner_id` every other collection is keyed by is a salted hash of the OIDC
subject, so the brain, prompts and logs stay non-identifying.
"""
