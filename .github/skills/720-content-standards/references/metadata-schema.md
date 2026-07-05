# 720 Metadata Schema

## Hierarchy
- Topic: annual curriculum topic.
- Sub-topic: ordered set of learning objectives.
- Learning objective: focused content unit target.
- Content unit: realizes one learning objective fully.
- Component: platform-navigable learning part, such as instruction, practice, assessment, game, or simulation.
- Item: one interaction or event inside a component.

## Content Unit Fields
- `id`: unique ID, usually provider + subject + topic + serial, for example `YuviDori-math-angles-0000X`.
- `title`: learner-facing title, up to 30 characters.
- `subTopic`: one value from the closed sub-topic list.
- `learningObjective`: one value from the closed learning-objective list. Omit only when the unit is a whole-sub-topic summary.
- `targetSector`: one or more values from the closed sector list.
- `targetAudience`: one or more values from the closed audience list.
- `prerequisiteLearningObjective`: array of learning-objective indexes required by this unit.

## Component Fields
- `id`: parent unit ID + unique serial.
- `title`: display description, up to 70 characters.
- `learningUnitId`: parent content unit ID.
- `componentPurpose`: `instruction`, `practice`, or `both`.
- `isAssessment`: boolean.
- `manufacture`: content provider name.
- `recommendedAfterFail`: component IDs recommended after failure.
- `isRequired`: whether the component is required. Applies to equivalent components with the same `order`.
- `relativeDifficulty`: number from 1 to 5.
- `masteryLevel`: `basic`, `intermediate`, or `advanced`; not mandatory for 2026-27.
- `order`: route position; lower numbers come earlier.
- `depthLevel`: value from the closed depth-level list.
- `cognitiveLevel`: value from the subject cognitive-level list.
- `languages`: `Hebrew`, `Arabic`, and/or `English`.
- `skills`: array of skill indexes.
- `estimatedTimeInMinutes`: number.
- `createdAt`, `updatedAt`: ISO date-time strings.
- `subContent`: array of item metadata.

## Item Fields
- `id`: parent component ID + unique serial.
- `title`: item title.
- `informationToBot`: structured free text for AI assistance, including item goal, what the learner should understand or practice, thinking strategies, common misconceptions, extra context, and optional screenshot note.
- `contentType`: one value from the content type list.
- `questions`: array of question objects, or empty when the item has no questions.
- `mediaFormat`: one value from the media format list.

## Question Object Fields
- `questionId`: unique internal ID for linking xAPI `answered` events to the question.
- `questionType`: one xAPI-aligned question type.
- `questionText`: learner-facing question or task.
- `answers`: answer options, when relevant. Matching uses `source` and `target` groups.
- `correctAnswers`: answer(s) in the format appropriate for the question type.