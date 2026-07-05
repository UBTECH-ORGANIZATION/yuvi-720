# 720 xAPI and Monitoring

The platform needs learning activity reports from content so it can update learner profiles, route learners, and generate recommendations.

## Core Learning Events
- Content/component started.
- Question answered.
- Hint requested.
- Video/media played or completed.
- Component completed.
- Assessment passed or failed.
- Unit completed.

## Required Event Meaning
Every event must make clear:
- Who acted, using a non-identifying learner reference when sent to AI-adjacent systems.
- What action occurred.
- Which unit, component, item, and question the action concerns.
- Result data where relevant: success, response, attempts, duration, score for internal use, or mastery/status snapshot.

## Launch Context (`slxapi`)
When iframe content needs reporting credentials, the platform should pass a top-level `slxapi` query parameter or launch value. Its value is stringified/escaped JSON with:
- `endpoint`: base reporting/LRS endpoint, without appending `/statements`.
- `auth`: reporting credential or token, for example a `Basic ...` value.
- `actor`: learner identity object with display `name` when needed and an `account` containing a non-identifying learner ID and platform `homePage`.

Do not put real government IDs or unnecessary personal details in AI-adjacent reporting context.

## Verb Semantics
- `Initialized`: learner started a component or item. Use the `object` to distinguish component-level vs item-level initialization.
- `Answered`: learner answered an assessed question/task. Use the question ID from metadata as the `object.id` and include `result.response`, `result.success`, and internal `result.score.scaled` when relevant.
- `Selected`: learner made a non-assessed choice. Include a category for the choice type and `result.response` from the relevant allowed values.
- `Requested`: learner requested help, a hint, or learning support.
- `Played` / `Paused`: learner played or paused media, with timestamp context when available.
- `Completed`: learner completed the item or component. For components, emit only after the full component flow, feedback, and summary are complete because the platform may remove the component after receiving completion.

## Completion Reporting
At the end of a component, return:
- Binary success/failure against the component goal.
- A snapshot of learner performance or mastery for routing.
- Recommended next content when failure or misconception is detected, if known.

## Monitoring and Fault Events
Content should report or log:
- Component or media load errors.
- Load time longer than 5 seconds.
- Failed xAPI requests.
- Incomplete actions or content closed before completion.
- Prolonged inactivity.
- Other provider-defined anomalies that help diagnose learner experience issues.

If xAPI delivery fails, retry according to a defined policy and verify successful persistence when acknowledgements are available. Retries must be transparent to the learner and must not block the learning flow.

## Student-Facing Constraint
Scores may be collected internally for routing and analysis, but do not show numeric grades to learners during learning.