# 720 Pedagogy and UX

## Content Unit Routes
- Closed unit: one component internally routes the learner among items. Provider has full control; low platform granularity and reuse.
- Fully modular unit: multiple detachable components form paths. The platform routes among components using provider definitions and learner data.
- Hybrid unit: modular components plus some closed/internal-routing components.

## Adaptive Paths
- Build paths for basic, intermediate, and advanced mastery levels.
- Paths may differ in support level, explanation depth, practice difficulty, task type, and activity type.
- Alternative components should be pedagogically equivalent when they occupy the same route position.
- Recommended-after-failure content should help the platform recover from struggle or misconception.

## Feedback
- Give focused feedback after learner actions, or clearly tell the learner when feedback will be delayed until task completion.
- Feedback must be effort-based, specific to the action, explain the error or misconception, and offer a concrete next step.
- Avoid integrative cumulative feedback inside content; platform-level systems provide that.

## Meta-Cognitive Scaffolds
Include supports across:
- Planning: what is the task asking, which information matters, what strategy will help.
- Execution and monitoring: pause and check whether the chosen route is working.
- Evaluation and reflection: what worked, what to change next time, which idea transfers to a similar task.

## Design and Accessibility
- Avoid cognitive overload on one screen.
- Use consistent marking, color coding, highlights, and visual aids to guide attention.
- If a concept may be unfamiliar, explain it at the learner's knowledge level.
- The product must be responsive for computers and tablets.
- Use mouse and touch support for drag interactions.

## Specific Limits
- Middle-school videos: maximum 2 minutes.
- Practice component: maximum 15 exercises.
- Iframe content: width `100%`, recommended 16:9 ratio.
- No YouTube player.
- No learner-facing numeric grades.
- No global content-unit progress bar inside content.

## Sub-Topic Summary Unit
At the end of each sub-topic, create a dedicated summary content unit that is not linked to a specific learning objective. It should include visual and textual summary and may include examples from prior questions, but no practice or assessment components.