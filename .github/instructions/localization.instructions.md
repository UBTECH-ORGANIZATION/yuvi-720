---
description: "Use when adding or changing localization, translations, UI strings, backend prompts, language switching, RTL, LTR, Arabic, English, or Hebrew support in yuvi-720."
applyTo: "shared/**,locales/**,learner-mapping/**,learning-agent/**,student-dashboard/**,teacher-view/**,mentoring/**,backend/server.py,backend/mock_data.py"
---
# Localization Guidelines

- Supported locales are `he`, `ar`, and `en`.
- Direction rules: Hebrew and Arabic use `dir="rtl"`; English uses `dir="ltr"`.
- Put direction on `document.documentElement`; avoid per-component hardcoded `dir` unless an embedded iframe or user-generated content needs isolation.
- Store the selected language in `localStorage` and pass it to backend endpoints that produce text or prompt an AI model.
- All new UI strings must be represented in all three locale files. Hebrew is the source language.
- Prefer `data-i18n` / `data-i18n-*` attributes for static HTML and `t("key")` for JavaScript-rendered strings.
- Use logical CSS properties (`margin-inline-start`, `padding-inline-end`, `inset-inline-start`, `text-align: start`) instead of physical left/right rules.
- Use `dir="auto"` on free-text inputs, chat messages, and content that can mix Hebrew, Arabic, and English.
- Backend prompts, fallback messages, and AI response instructions must come from language-keyed dictionaries such as `PROMPTS[language]`.
- The learning agent must respond in the selected language and must support Hebrew and Arabic to satisfy the 720 system requirements.