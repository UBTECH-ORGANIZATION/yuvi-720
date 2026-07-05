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

## Student-Facing Constraint
Scores may be collected internally for routing and analysis, but do not show numeric grades to learners during learning.