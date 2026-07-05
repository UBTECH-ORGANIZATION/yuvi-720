---
name: 720-delivery-requirements
description: "Use when planning, prioritizing, reviewing, creating Azure DevOps tasks, preparing proof videos, or checking coverage for the Israeli MoE 720 system feature appendix and 30/07/2026 minimum requirements. Covers personalized delivery, learner mapping, AI learning agent, dashboards, mentoring goals, teacher view, feedback, permissions, localization, privacy, and explainability."
argument-hint: "Describe the feature, deadline, backlog, proof, or compliance check."
---
# 720 Delivery Requirements

Use this skill to translate the 720 system feature appendix into roadmap, backlog, implementation, demo, or compliance work.

## Priority Weights
- Feature 3, learning agent / personal companion: 25%.
- Feature 1, personalized learning item delivery: 20%.
- Feature 6, teacher view: 20%.
- Feature 4, student dashboard: 15%.
- Feature 5, mentoring goals: 10%.
- Feature 2, initial learner mapping: 5%.
- Feature 7, user feedback collection: 3%.
- Feature 8, organizational management and permissions: 2%.

## Minimum Requirements
### 1. Personalized Learning Item Delivery
- Support 720-compliant learning content in multiple subjects. Do not supply math/science content without MoE approval.
- Deliver content according to learner preferences, appropriate difficulty, current needs, and approved alternatives when the learner struggles.
- Show progress, opening/closing messages between content items, current place in the process, expectations, pace/direction, and help options.
- Let the learner control pace and go back to previous content.
- Offer breaks at relevant times.
- Resume from the same point after closing mid-task without save/submit.

### 2. Initial Learner Mapping
- Create initial mapping during first uses of the system.
- Cover academic, psycho-pedagogical, and environmental areas.
- Keep the questionnaire friendly and not too long.
- Mapping must be MoE-approved.
- Results must feed student and teacher dashboards.

### 3. Learning Agent and Personal Companion
- Accessible from every screen.
- Deepen or simplify explanations, use relevant examples, and preserve independent learner understanding.
- Detect frustration or persistent confusion and offer pedagogical alternatives.
- Remember non-identifying learner usage/profile context and maintain continuity across sessions.
- Support Hebrew and Arabic text communication.
- Update the learner profile based on interaction.
- Act proactively for idle time, repeated misconception patterns, and success/effort encouragement.
- Follow privacy, information security, and student welfare requirements.

### 4. Student Dashboard
- Show learner full name.
- Show subjects and progress against curriculum.
- Show knowledge items where the learner struggled.
- Show and update goals from mentoring conversations.
- Show initial mapping data such as interests and preferences.
- Show activeness competency metrics.
- Update in real time, avoid numeric grades, and use verbal feedback.

### 5. Mentoring Goals
- Let teachers document in-person mentoring conversations.
- Let both teacher and participating learner view documentation.
- Let teachers add teacher-only notes and choose visibility.
- Let learners document mentoring conversations.
- Include date, teacher, learner, meeting stage, conversation notes, next steps, and deadline.

### 6. Teacher View
- Show student-level struggle items, tailored recommendations, teacher-entered insights, filters by subject/interest, and progress against learning objectives.
- Show group-level achievement, engagement, and progress trends.
- Flag students requiring immediate attention for inactivity or low success on consecutive tasks.
- Enforce group-based access. Admin can view all students and groups.
- Insights must be explainable and show the raw data behind flags.
- Do not show comparisons between students.
- Update insights in real time.

### 7. User Feedback Collection
- Provide a mechanism to report technical issues from inside and outside the system.
- Prepare access for MoE staff according to a future procedure.

### 8. Organizational Management and Permissions
- Model school, teacher, administrator, student, and learning group entities.

## Additional Requirements
- Support self-learning, group learning, and project-based learning.
- Provide growth-mindset feedback at the end of learning items or long questions.
- Let learner and teacher view available learning objectives.
- Add voice chat and read-aloud for agent text.
- Show actionable student insights with 2-5 possible actions.
- Show strengths prominently and recommend how to build on them.
- Add reflection questions at relevant points, after hard tasks, and at scheduled intervals; store answers in the learner profile.
- Teacher view should show strengths/weaknesses, self-assessment vs system assessment, group gaps, and subgroup teaching recommendations.
- Collect UX feedback, improvement suggestions, and feedback about content fit and recommendation quality.

## Backlog Procedure
When creating or reviewing work items:
1. Attach the exact feature number and requirement clause.
2. Add acceptance criteria that are demoable by video or mockup.
3. Note privacy, localization, explainability, and real-time update requirements when relevant.
4. Tag with the feature number, for example `720-feature-3-agent`.