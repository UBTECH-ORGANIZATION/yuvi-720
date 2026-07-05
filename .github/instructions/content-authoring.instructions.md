---
description: "Use when creating, generating, reviewing, or instrumenting 720 learning content, lomdot, iframe content, practice items, assessments, xAPI events, or adaptive content routes."
applyTo: "learning-agent/**,backend/server.py"
---
# 720 Content Authoring Guidelines

- A content unit realizes one learning objective. It may include prerequisite or contextual knowledge only when needed for understanding.
- Model content as unit -> component -> item. The component is the smallest platform-navigable unit; an item is a single interaction/event such as a question, video, hint, or game step.
- Content may be closed, fully modular, or hybrid. Prefer modular components when the platform needs reuse, adaptation, and routing.
- Provide multiple paths for basic, intermediate, and advanced mastery levels, but do not reveal mastery labels to learners.
- Assessment components must be explicitly identified. Passing an assessment component can establish mastery for the learning objective.
- On component completion, return both binary pass/fail for the component goal and a mastery/status snapshot useful for routing.
- Student feedback must be effort-based, action-specific, explain errors, and include forward feed: what to try next.
- Do not show numeric grades or global content-unit progress inside content. The platform owns global progress. Component-internal progress is allowed.
- Middle-school videos must be no longer than 2 minutes. Practice components must not exceed 15 exercises.
- Avoid cognitive overload on a single screen. Balance text load between question stems and answer options.
- Include meta-cognitive scaffolds across planning, monitoring, and reflection where appropriate.
- Iframe content must be responsive, use width `100%`, target a 16:9 aspect ratio, and work on computers and tablets.
- Drag interactions must support mouse and touch.
- Do not use YouTube players for 720 learning content.
- Send or prepare xAPI/analytics events for starts, answers, completions, hints, media use, load failures, slow loads over 5 seconds, failed xAPI requests, incomplete actions, and prolonged inactivity.