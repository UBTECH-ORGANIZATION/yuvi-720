---
description: "Use when creating, generating, reviewing, or instrumenting 720 learning content, lomdot, iframe content, practice items, assessments, xAPI events, metadata, content recommendations, or adaptive content routes."
applyTo: "learning-agent/**,frontend/src/features/learning-portal/**,frontend/src/features/learning-lesson/**,frontend/src/features/learning-create/**,backend/server.py,backend/app/**"
---
# 720 Content Authoring Guidelines

- Treat the official MoE 720 content-development guidance as binding for all platform content work. Content must be identifiable, manageable, measurable, resumable, monitorable, and useful for personalized recommendations.
- A content unit realizes one learning objective. It may include prerequisite or contextual knowledge only when needed for understanding.
- Model content as unit -> component -> item. The component is the smallest platform-navigable unit; an item is a single interaction/event such as a question, video, hint, or game step.
- Content may be closed, fully modular, or hybrid. Prefer modular components when the platform needs reuse, adaptation, and routing.
- Closed units route internally inside one component. Fully modular units expose detachable components for platform routing. Hybrid units combine platform-routed components with internally routed components.
- Provide multiple paths for basic, intermediate, and advanced mastery levels, but do not reveal mastery labels to learners.
- Paths may differ by guidance/support level, explanation depth, practice difficulty, task type, and activity type. Alternative components at the same route position must be pedagogically equivalent.
- Assessment components must be explicitly identified. Passing an assessment component can establish mastery for the learning objective.
- Assess only the central learning objective. If one of several assessment components is passed and the provider defines that as sufficient, the unit can be considered competent for routing.
- On component completion, return both binary pass/fail for the component goal and a mastery/status snapshot useful for routing.
- Content must support saving progress and returning to the same point. Re-entry after completion must support either viewing prior performance or repeating the component.
- Student feedback must be effort-based, action-specific, explain errors, and include forward feed: what to try next.
- Feedback may be delayed for complex tasks only if the learner is told that feedback will arrive after completion. Do not provide cumulative/integrative profile feedback inside content; the platform owns that level.
- Do not show numeric grades or global content-unit progress inside content. The platform owns global progress. Component-internal progress is allowed.
- Middle-school videos must be no longer than 2 minutes. Practice components must not exceed 15 exercises.
- Avoid cognitive overload on a single screen. Balance text load between question stems and answer options.
- Explain any unfamiliar concept at the learner's knowledge level. Use consistent highlighting, color coding, and visual aids to guide attention.
- Include meta-cognitive scaffolds across planning, monitoring, and reflection where appropriate.
- Meta-cognitive scaffolds should support planning before solving, monitoring during work, and evaluation/reflection after work; they are not only end-of-task reflection questions.
- Iframe content must be responsive, use width `100%`, target a 16:9 aspect ratio, and work on computers and tablets.
- Drag interactions must support mouse and touch.
- Do not use YouTube players for 720 learning content.
- Send or prepare xAPI/analytics events in real time for starts, answers, selections, completions, hints/help requests, media played/paused, media completion, assessment pass/fail, load failures, slow loads over 5 seconds, failed xAPI requests, incomplete actions, content closed before completion, and prolonged inactivity.
- If xAPI delivery fails, retry according to a defined policy and verify successful persistence where the target supports acknowledgements. This must be transparent to the learner and must not interrupt the learning flow.
- Platform iframe launches must be compatible with the `slxapi` initialization parameter when reporting is implemented. `slxapi` is stringified JSON containing `endpoint` (base LRS/reporting URL without `/statements`), `auth` credentials/token, and `actor` with a non-identifying learner account and platform `homePage`.
- xAPI verbs and meaning: `Initialized` for starting a component or item, `Completed` only after the full component/item and feedback are complete, `Answered` for assessed questions/tasks, `Selected` for non-assessed choices, `Requested` for help/hints, `Played` and `Paused` for media with timestamp context.
- For `Answered`, identify the question by `object.id` matching metadata `questionId`, and include `result.response`, `result.success`, and internal-use `result.score.scaled` where relevant. Scores are collected for routing/analysis, not displayed to learners.
- For `Selected`, include `context.contextActivities.category` and a `result.response` from the allowed choice-type semantics: `learningType`, `practiceDecision`, `isUnderstood`, `isRepeat`, or `externalLearning`.
- For `Completed`, include success and score/status data for components/items that contain assessed interactions. Component completion may cause the platform to remove the component from screen, so emit it only after all learner-facing feedback and summary content have been shown.
- Metadata must exist at unit, component, and item levels. Unit metadata includes `id`, `title`, `subTopic`, optional `learningObjective` for sub-topic summary units, `targetSector`, `targetAudience`, and prerequisites. Component metadata includes `componentPurpose`, `isAssessment`, `recommendedAfterFail`, `isRequired`, `relativeDifficulty`, `masteryLevel` when available, `order`, `depthLevel`, `cognitiveLevel`, `languages`, `skills`, timings, and `subContent`. Item metadata includes `informationToBot`, `contentType`, `mediaFormat`, and question metadata.
- `informationToBot` must explain the item goal, what the learner should understand/practice, useful strategies, common misconceptions, additional context, and optional screenshot notes so the companion can help accurately.
- Use official closed lists for content types, question types, media formats, sectors, audiences, depth levels, cognitive levels, learning-objective indexes, and skill indexes. If an official list/index is missing, do not invent final values; use explicit placeholders and create a follow-up task to import the official list.
- At the end of every sub-topic, create a dedicated summary content unit that is not tied to a specific learning objective. It should contain visual/textual summary and examples from previous questions, with no practice or assessment.
- Future face-to-face or group/inquiry learning ideas may be proposed, but current platform units are digital computer/tablet learning unless the project explicitly adds non-digital routing support.