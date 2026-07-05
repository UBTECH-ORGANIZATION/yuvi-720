---
description: "Use when changing learner mapping, the initial questionnaire, learner profile scoring, activeness mapping, questionnaire localization, or dashboard data derived from mapping in yuvi-720."
applyTo: "frontend/src/features/learner-mapping/**,frontend/src/features/results/**,frontend/src/features/student-dashboard/**,frontend/src/features/teacher-view/**,learner-mapping/**,backend/mock_data.py,backend/server.py,backend/app/routes/learner_mapping.py,student-dashboard/**,teacher-view/**"
---
# 720 Learner Mapping Guidelines

The Ministry of Education sample is `שאלון פעלנות לומדים`: a friendly learner-activeness questionnaire of about 10 minutes, split into 6 short parts and 38 items. The source text is masculine Hebrew but the product must make it accessible in feminine Hebrew phrasing where relevant and in Arabic; this repo also targets English localization.

## Required Areas
- Academic: existing knowledge and skills, subject interest, learning preferences, talents, and perceived difficulty.
- Psycho-pedagogical: motivation, self-efficacy, growth mindset, autonomy, cognitive skills, personal development, and social-emotional skills.
- Environmental: school climate, support network, daily habits, technology comfort, and focus.

## Questionnaire Structure
- Part A, questions 1-12: subject interest and difficulty, relevance to daily life, satisfaction with classroom learning, preference for certain success, recent topic interest, importance of success, and study investment.
- Part B, questions 13-16: growth mindset, attitude to challenge, learning from mistakes, and persistence under difficulty.
- Part C, questions 17-21: setting goals, trying independently before asking for help, responsibility for learning, meeting self-planned schedules, and initiating academic/social actions.
- Part D, questions 22-25: monitoring understanding, planning before tasks, calming when frustrated, and studying additional material independently.
- Part E, questions 26-28: knowing what helps learning, identifying difficult topics, and reflecting on success/failure to improve.
- Part F, questions 29-38: boredom, teacher help, teacher understanding, help sources, computer-learning experience, past computer-class experience, preference for computer over books, need for computer help, school concentration, and computer-related concentration difficulty.

## Activeness Components
Map outputs into the 720 activeness components:
- Motivation and relevance.
- Growth mindset.
- Initiative and responsibility.
- Self-regulation.
- Self-awareness.
- Support and emotional experiences.

## UX and Data Rules
- Keep the questionnaire friendly, short-feeling, and easy to complete with full concentration.
- There are no right or wrong answers. Ask for honest self-report.
- Do not show numeric scores to students. Use verbal, encouraging summaries.
- Results must feed both the student dashboard and teacher/mentor view.
- Persist mapping results and derived profile/dashboard data in MongoDB-backed backend state. Do not cache learner mapping results in `localStorage` or `sessionStorage`.
- Student-facing results should be positive, actionable, and age-appropriate.
- Teacher-facing results may include richer diagnostic detail, but should be explainable and should not compare students to each other.