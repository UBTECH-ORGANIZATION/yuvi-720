# מסמך התממשקות LRS - פרויקט 720

> גרסה `1.0` | תאריך: `14/07/2026`

## מטרת המסמך

מסמך זה מפרט את דרישות ה־xAPI הייחודיות לפרויקט 720 עבור דיווח למערכת ה־LRS של משרד החינוך. הוא משלים את [אפיון ההתממשקות הכללי לספקים](https://sapakim.education.gov.il/tech/lrs/).

במקרה של סתירה, דרישות מסמך זה גוברות עבור פרויקט 720.

> המקור המחייב הוא [720 התממשקות לLRS 1.0 (2).pdf](720%20התממשקות%20לLRS%201.0%20(2).pdf). מסמך Markdown זה הוא עיבוד קריא של המפרט ואינו מקור נפרד של דרישות.

## תוכן עניינים

1. [עקרונות דיווח](#עקרונות-דיווח)
2. [מעטפת משותפת לכל הודעה](#מעטפת-משותפת-לכל-הודעה)
3. [אירועי פלטפורמה](#אירועי-פלטפורמה)
4. [אירועי תוכן ומטא-דאטה](#אירועי-תוכן-ומטא-דאטה)
5. [רשימת האירועים המלאה](#רשימת-האירועים-המלאה)
6. [רשימת בדיקות לפני שליחה](#רשימת-בדיקות-לפני-שליחה)

---

## עקרונות דיווח

- יש לשלוח אירועי xAPI ב־**Near Real-Time**, סמוך ככל האפשר להתרחשותם.
- יש ליישם `Retry/Resend`: במקרה של כשל זמני יש לשמור את האירוע ולשלוח אותו שוב עד לקליטה מוצלחת.
- יש למנוע כפילויות: יש לשמור על אותו `statement.id` בעת retry; הודעה שכבר נקלטה נדחית על ידי ה־LRS.
- רשימות ה־`ENUM` במסמך מבוססות על תקן התוכן של 720.
- מטא־דאטה באירועי xAPI אינו מחליף את מנגנון המטא־דאטה הסטטי של ספקי התוכן; שני המנגנונים נדרשים.

### כתובות בדוגמאות

הכתובת `https://720.example.co.il` המופיעה בדוגמאות היא placeholder בלבד. במימוש יש להחליף את `{supplier-domain}` בדומיין של הסביבה; אין לקבע דומיין דמו בקוד.

---

## מעטפת משותפת לכל הודעה

| שדה | דרישה |
| --- | --- |
| `id` | UUID ייחודי לכל statement. יש לשמר אותו גם בעת retry. |
| `actor` | מזהה `exidentifier` בלבד: תעודת זהות מעורבלת. |
| `verb` | IRI מתוך `https://lxp.education.gov.il/xapi/moe/verbs/`. |
| `object` | Activity המתאר את האירוע. |
| `timestamp` | זמן האירוע בפורמט ISO-8601. |
| `context.contextActivities.grouping` | LMS, Session ותוכנית; באירועי תוכן גם ספק תוכן. |
| `context.team` | קבוצת NMM, או סמל מוסד כאשר NMM עדיין אינו ידוע. |

### תבנית xAPI בסיסית

```json
{
  "id": "<uuid>",
  "actor": {
    "objectType": "Agent",
    "account": {
      "homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
      "name": "<scrambled-id>"
    }
  },
  "verb": {
    "id": "https://lxp.education.gov.il/xapi/moe/verbs/<verb>"
  },
  "object": {
    "objectType": "Activity",
    "id": "https://{supplier-domain}/<resource>/<id>",
    "definition": {
      "type": "https://lxp.education.gov.il/xapi/moe/activities/<activity-type>"
    }
  },
  "context": {
    "contextActivities": { "grouping": [] },
    "team": {}
  },
  "timestamp": "2026-01-15T08:30:00Z"
}
```

### שיוך ל־LMS

כל הודעה תכלול ב־`context.contextActivities.grouping` את ה־LMS המדווח:

```json
{
  "objectType": "Activity",
  "id": "https://{supplier-domain}",
  "definition": {
    "type": "https://lxp.education.gov.il/xapi/moe/activities/lms"
  }
}
```

### שיוך ל־Session

כל הודעה תכלול את ה־Session הפעיל. אותו Activity משמש באירועי `enter`, `suspend`, `resume` ו־`exit`.

```json
{
  "objectType": "Activity",
  "id": "https://{supplier-domain}/session/{sessionId}",
  "definition": {
    "type": "https://lxp.education.gov.il/xapi/moe/activities/session",
    "name": { "he": "Session" }
  }
}
```

### שיוך לקבוצת לימוד או מוסד

יש להעדיף NMM כאשר הוא ידוע:

```json
{
  "objectType": "Group",
  "account": {
    "homePage": "https://lxp.education.gov.il/xapi/moe/identity/nmm/kvutsa",
    "name": "<nmm-id>"
  }
}
```

כאשר NMM אינו ידוע, משתמשים בסמל המוסד:

```json
{
  "objectType": "Group",
  "account": {
    "homePage": "https://lxp.education.gov.il/xapi/moe/school",
    "name": "<school-symbol>"
  }
}
```

### שיוך לספק תוכן ולתוכנית

באירועי תוכן יש להוסיף גם ספק תוכן לפי מזהה הפריט בקטלוג החינוכי (ECAT):

```json
{
  "objectType": "Activity",
  "id": "https://lxp.education.gov.il/xapi/moe/ecat/item/<ecat-item-id>",
  "definition": {
    "type": "https://lxp.education.gov.il/xapi/moe/activities/content-vendor"
  }
}
```

בכל ההודעות יש לשייך את סוג התוכנית:

```json
{
  "objectType": "Activity",
  "id": "https://lxp.education.gov.il/xapi/moe/program/720-platform",
  "definition": {
    "type": "https://lxp.education.gov.il/xapi/moe/activities/program"
  }
}
```

ערכי תוכנית נוספים: `https://lxp.education.gov.il/xapi/moe/program/english-app` ו־`https://lxp.education.gov.il/xapi/moe/program/innovation-authority`.

---

## אירועי פלטפורמה

### Session

**IRI:** `https://{supplier-domain}/session/{sessionId}`  
**Activity type:** `https://lxp.education.gov.il/xapi/moe/activities/session`

| אירוע | Verb | מועד שליחה | שדות נוספים |
| --- | --- | --- | --- |
| תחילת Session | `enter` | תחילת ביקור חדש במערכת. | `deviceType`, `platform`, `operatingSystem`, `osVersion`, `browser`, `browserVersion`, `applicationVersion` תחת `context.extensions`, כאשר זמינים. |
| אובדן פוקוס | `suspend` | המשתמש מפסיק עבודה זמנית, למשל במעבר חלון. | - |
| חזרה לפוקוס | `resume` | המשתמש חוזר לאותו Session. | - |
| סיום Session | `exit` | סיום הביקור. | `result.duration`: משך ברוטו (`exit - enter`) בפורמט ISO-8601. |

```json
{ "result": { "duration": "PT45M12S" } }
```

### Dashboard

**IRI:** `https://{supplier-domain}/dashboard/{dashboardType}`  
**Activity type:** `https://lxp.education.gov.il/xapi/moe/activities/dashboard`  
**Verb:** `viewed`

| `dashboardType` | משמעות | ערך `extensions.dashboardId` |
| --- | --- | --- |
| `student-personal` | תלמיד צופה בנתונים של עצמו. | מזהה התלמיד. |
| `student-view` | מורה צופה בנתוני תלמיד. | מזהה התלמיד. |
| `learning-group` | מורה צופה בנתוני קבוצה. | NMM. |
| `realtime-dashboard` | מורה צופה בפעילות חיה. | NMM. |

כאשר אפשרי, יש לדווח גם את `result.duration` של הצפייה.

### שאלון פעלנות (Agency Questionnaire)

**IRI:** `https://{supplier-domain}/agency/{pre|post}`  
**Activity type:** `questionnaire`

| אירוע | Verb | Object | דרישות |
| --- | --- | --- | --- |
| תחילת שאלון | `initialized` | השאלון | מזהה השאלון כולל `agency/pre` או `agency/post`. |
| מענה לשאלה | `answered` | שאלה | `result.response`; אם רלוונטי גם `result.score.min`, `max`, `raw`; `context.contextActivities.parent` מצביע על השאלון. |
| סיום שאלון | `completed` | השאלון | `result.completion: true` ו־`result.duration`. |

### ניהול שיחה עם בוט או ישות אחרת

**IRI:** `https://{supplier-domain}/conversation/{conversationId}`  
**Activity type:** `https://lxp.education.gov.il/xapi/moe/activities/conversation`

כל הודעות אותה שיחה משתמשות באותו `conversationId`. תוכן השיחה **לא** נשלח ל־LRS.

| אירוע | Verb | דרישות |
| --- | --- | --- |
| אינטראקציה בשיחה | `interacted` | `context.extensions`: `speaker`, `conversationTrigger`, ובמידת הצורך `helpType`, `componentId`, `itemId`. |
| דירוג הודעת בוט | `rated` | `result.response` הוא `like` או `dislike`; יש לציין `conversationType: bot`. |

| Extension | ערכים |
| --- | --- |
| `speaker` | `student`, `bot` |
| `conversationTrigger` | `student-request`, `success-effort`, `misconception`, `idle-time` |
| `helpType` | `hint`, `explanation`, `alternative-content`, `other`, `bot-help-offer`, `motivation` |

### שאלון רפלקציה

**IRI:** `https://{supplier-domain}/reflection/{questionnaireId}`  
**Activity type:** `questionnaire`

אותו Object של השאלון משמש לכל האירועים באותו מופע רפלקציה.

| אירוע | Verb | Object | דרישות |
| --- | --- | --- | --- |
| תחילת שאלון | `initialized` | השאלון | `context.extensions.reflactionTrigger`. |
| תשובה פתוחה | `answered` | שאלה | `result.response`; parent מצביע על השאלון. |
| תשובת דירוג | `answered` | שאלה | `result.score.raw`, `min`, `max`; אין לשלוח `response` יחד עם score עבור אותה תשובה. |
| דילוג | `skipped` | שאלה | parent מצביע על השאלון. |
| סיום | `completed` | השאלון | `result.completion: true`, `result.duration`. |

ערכי `reflactionTrigger`: `end-of-learning-objective`, `end-of-learning-component`, `difficult-task`, `other`.

> שם ההרחבה במפרט המקורי הוא `reflactionTrigger`; יש לשמור על האיות הזה לצורך תאימות.

### מפגש מנטור-תלמיד

**IRI:** `https://{supplier-domain}/mentor-student-meeting/{meetingId}`  
**Activity type:** `https://lxp.education.gov.il/xapi/moe/activities/mentor-student-meeting`  
**Verb:** `completed`

האירוע נשלח לאחר שהמפגש הסתיים ואינו אירוע תוכן.

| Extension | משמעות |
| --- | --- |
| `mentor` | מזהה המנטור שקיים את המפגש. |
| `student` | מזהה התלמיד שהשתתף במפגש. |
| `meetingDate` | תאריך קיום המפגש. |
| `mentoringPhase` | שלב הליווי, לפי הרשימה שתפורסם. |

### יעד למידה אישי (Student Goal)

**IRI:** `https://{supplier-domain}/student-goal/{goalId}`  
**Activity type:** `https://lxp.education.gov.il/xapi/moe/activities/student-goal`

| אירוע | Verb | דרישות |
| --- | --- | --- |
| הגדרת יעד | `initialized` | `definition.extensions.goalType`. |
| עדכון יעד | `updated` | אותו Object של היעד וה־`goalType`. |
| השלמת יעד | `completed` | אותו Object של היעד וה־`goalType`. |

ערכי `goalType`: `academic`, `personal`, `social-emotional`, `motivational`, `behavioral`, `other`.

כאשר הפעולה נעשית על ידי מורה יש לכלול `context.instructor` עם מזהה ה־`exidentifier` של המורה. בפעולה על ידי תלמיד אין לכלול את השדה.

---

## אירועי תוכן ומטא-דאטה

### היררכיית התוכן

התוכן מאורגן בשלוש רמות:

1. **יחידת תוכן** (`learning-unit`) - הישות העליונה, המכילה רכיבי תוכן.
2. **רכיב תוכן** (`component`) - מקטע לימודי של יחידת תוכן, המכיל פריט אחד או יותר.
3. **פריט תוכן** (`item`) - יחידת התוכן הבסיסית בתוך הרכיב.

כל אירוע תוכן כולל מטא־דאטה של הישות שעליה הוא מדווח ושל הישויות המכילות אותה:

| אירוע על | מטא־דאטה נדרש |
| --- | --- |
| רכיב | הרכיב ויחידת התוכן. |
| פריט | הפריט, הרכיב ויחידת התוכן. |
| שאלה | השאלה והמיכל הישיר שלה, לפי היררכיית הספק. |

ה־`parent` הוא המיכל הישיר של האובייקט: רכיב מכיל פריט, ופריט או שאלון יכולים להכיל שאלה.

### מטא־דאטה: יחידת תוכן

יחידת התוכן נשלחת ב־`context.contextActivities.grouping`.

```json
{
  "objectType": "Activity",
  "id": "https://{supplier-domain}/learning-unit/{unitId}",
  "definition": {
    "type": "https://lxp.education.gov.il/xapi/moe/activities/learning-unit",
    "name": { "he": "<title>" }
  }
}
```

הרחבות: `subTopic`, `learningObjective`, `targetSector`, `targetAudience`, `prerequisiteLearningObjective`.

### מטא־דאטה: רכיב תוכן

רכיב התוכן נשלח ב־`context.contextActivities.grouping`.

| Extension | משמעות |
| --- | --- |
| `skills` | מיומנויות. |
| `componentPurpose` | מטרה מתוך רשימה סגורה. |
| `isAssessment` | האם הרכיב הוא רכיב הערכה. |
| `manufacture` | שם ספק התוכן. |
| `recommendedAfterFail` | רכיבים מומלצים לאחר כישלון. |
| `isRequired` | האם הרכיב חובה. |
| `relativeDifficulty` | קושי יחסי ביחידת התוכן. |
| `masteryLevel` | רמת שליטה מתוך רשימה סגורה. |
| `order` | מיקום בסדר היחידה. |
| `depthLevel` | רמת עומק ביחס לתוכנית הלימודים. |
| `cognitiveLevel` | רמת חשיבה לפי מקצוע. |
| `languages` | שפות התוכן. |
| `estimatedTimeInMinutes` | זמן ביצוע מוערך בדקות. |

### מטא־דאטה: פריט תוכן

| Extension | משמעות |
| --- | --- |
| `informationToBot` | מטרת הפריט, אסטרטגיות, טעויות נפוצות ומידע שימושי לבוט. |
| `contentType` | סוג תוכן מתוך רשימה סגורה. |
| `questions` | פרטי השאלות המופיעות בפריט. |
| `componentId` | מזהה הרכיב המכיל את הפריט. |

### רכיב (Component)

**IRI:** `https://{supplier-domain}/component/{componentId}`  
**Activity type:** `https://lxp.education.gov.il/xapi/moe/activities/component`

| אירוע | Verb | דרישות |
| --- | --- | --- |
| תחילת רכיב | `initialized` | כל השדות המשותפים ומטא־הדאטה של הרכיב ויחידת התוכן. |
| סיום רכיב | `completed` | `result.success`, `result.score.scaled` בין `0` ל־`1` כאשר רלוונטי, ו־`result.duration` בפורמט ISO-8601. |

אירועי רכיב מתייחסים לביצוע הרכיב כולו; הם אינם מחליפים את אירועי הפריטים שבתוכו.

### דילוג על פריט

כל סוג פריט צריך לתמוך ב־`skipped` כאשר משתמש בוחר לא לבצע אותו ועובר לפריט הבא.

| שדה | דרישה |
| --- | --- |
| `verb` | `https://lxp.education.gov.il/xapi/moe/verbs/skipped` |
| `object` | הפריט שעליו דולג. |
| `context.contextActivities.parent` | הרכיב או המיכל הישיר. |
| `context.extensions` | כל מטא־הדאטה של התוכן. |

### שאלון כתוכן

**Activity type:** `https://lxp.education.gov.il/xapi/moe/activities/questionnaire`

| אירוע | Verb | דרישות |
| --- | --- | --- |
| תחילת שאלון | `initialized` | parent מצביע על הרכיב; מצרפים מטא־דאטה מלא. |
| סיום שאלון | `completed` | `result.score` לפי הצורך, `result.duration`, parent ומטא־דאטה מלא. |

### שאלה כתוכן

**IRI:** `https://{supplier-domain}/item/question/{questionId}`  
**Activity type:** `https://lxp.education.gov.il/xapi/moe/activities/question`  
**Verb:** `answered`

ה־`parent` מצביע על המיכל הישיר של השאלה: שאלון, פריט הכולל שאלות, רכיב, או ישות אחרת לפי מבנה התוכן של הספק.

| Extension | משמעות |
| --- | --- |
| `questionId` | מזהה פנימי של השאלה בפריט. |
| `questionType` | סוג השאלה, למשל `multiple-choice`, `true-false`, `fill-in`. |
| `attemptNumber` | מספר ניסיון המענה. |

תשובה פתוחה:

```json
{
  "result": { "response": "<student response>" }
}
```

תשובה סגורה / בחירה / דירוג:

```json
{
  "result": {
    "response": "B",
    "success": true,
    "score": { "scaled": 1, "min": 0, "max": 1, "raw": 1 }
  }
}
```

### מדיה

**Object:** פריט המדיה, למשל `https://{supplier-domain}/item/video/{mediaId}`.  
**Activity type:** לפי סוג המדיה, למשל `activities/video`.

| אירוע | Verb | דרישות |
| --- | --- | --- |
| התחלת צפייה | `played` | `mediaFormat`, `mediaPosition`, `mediaDuration`. |
| השהיה | `paused` | אותו מידע מדיה ו־`result.duration` של זמן הצפייה בפועל. |
| סיום צפייה | `completed` | אותו מידע מדיה ו־`result.duration`. |

| Extension | משמעות |
| --- | --- |
| `mediaFormat` | `video`, `audio` או `animation`. |
| `mediaPosition` | מיקום המדיה בשניות: תחילה ב־`played`, עצירה ב־`paused`. |
| `mediaDuration` | אורך המדיה הכולל בשניות. |

### בקשת עזרה

**Verb:** `requested`  
**Object:** הרכיב או הפריט שממנו התלמיד ביקש עזרה.

| Extension | ערכים לדוגמה |
| --- | --- |
| `helpSource` | `content`, `platform` |
| `helpType` | `hint`, `explanation` |

כאשר בקשת העזרה נעשית מתוך שאלה, יש לשייך אותה גם למיכל הישיר באמצעות `context.contextActivities.parent`.

### בחירה שאינה לימודית

**Verb:** `selected`  
**Object:** הרכיב או הפריט שעליו בוצעה הבחירה.

האירוע אינו מייצג מענה לשאלה. הוא כולל את כל מטא־הדאטה והתיוגים הפדגוגיים של האובייקט, ובנוסף:

| `selectionType` | משמעות | ערך ב־`result.response` |
| --- | --- | --- |
| `learning-type` | בחירת סוג תוכן מתוך רשימת סוגי התוכן | סוג התוכן שנבחר |
| `practice-decision` | החלטה על תרגול נוסף | `true` / `false` |
| `is-understood` | תשובת התלמיד אם הבין | `true` / `false` |
| `is-repeat` | החלטה לחזור לצפייה בתוכן | `true` / `false` |
| `external-learning` | החלטה לצאת ללמידה עצמאית מחוץ למערכת | `true` / `false` |

`selectionType` מתאר את הבחירה שהוצגה לתלמיד; `result.response` מתאר את הבחירה שביצע בפועל.

---

## רשימת האירועים המלאה

| # | תחום | אירוע | Verb | Object type |
| ---: | --- | --- | --- | --- |
| 1 | Session | התחלה | `enter` | `session` |
| 2 | Session | אובדן פוקוס | `suspend` | `session` |
| 3 | Session | חזרה לפוקוס | `resume` | `session` |
| 4 | Session | סיום | `exit` | `session` |
| 5 | Dashboard | צפייה | `viewed` | `dashboard` |
| 6 | שאלון פעלנות | התחלה | `initialized` | `questionnaire` |
| 7 | שאלון פעלנות | מענה לשאלה | `answered` | `question` |
| 8 | שאלון פעלנות | סיום | `completed` | `questionnaire` |
| 9 | שיחה | אינטראקציה | `interacted` | `conversation` |
| 10 | שיחה | דירוג הודעת בוט | `rated` | `conversation` |
| 11 | רפלקציה | התחלה | `initialized` | `questionnaire` |
| 12 | רפלקציה | תשובה פתוחה | `answered` | `question` |
| 13 | רפלקציה | תשובת דירוג | `answered` | `question` |
| 14 | רפלקציה | דילוג על שאלה | `skipped` | `question` |
| 15 | רפלקציה | סיום | `completed` | `questionnaire` |
| 16 | מפגש מנטור-תלמיד | סיום | `completed` | `mentor-student-meeting` |
| 17 | יעד למידה אישי | יצירה | `initialized` | `student-goal` |
| 18 | יעד למידה אישי | עדכון | `updated` | `student-goal` |
| 19 | יעד למידה אישי | השלמה | `completed` | `student-goal` |
| 20 | רכיב | התחלה | `initialized` | `component` |
| 21 | רכיב | סיום | `completed` | `component` |
| 22 | שאלון כתוכן | התחלה | `initialized` | `questionnaire` |
| 23 | שאלון כתוכן | סיום | `completed` | `questionnaire` |
| 24 | שאלה כתוכן | מענה | `answered` | `question` / `item` |
| 25 | פריט | דילוג | `skipped` | סוג הפריט |
| 26 | מדיה | התחלת צפייה | `played` | `video` / `audio` / `animation` |
| 27 | מדיה | השהיה | `paused` | media |
| 28 | מדיה | סיום צפייה | `completed` | media |
| 29 | עזרה | בקשה | `requested` | `component` / `item` |
| 30 | בחירה לא לימודית | בחירה | `selected` | `component` / `item` |

---

## רשימת בדיקות לפני שליחה

- [ ] `actor.account` מכיל `exidentifier` מעורבל בלבד.
- [ ] לכל הודעה יש `id` ייחודי והוא נשמר בעת retry.
- [ ] לכל הודעה יש שיוך LMS, Session ותוכנית.
- [ ] בכל אירוע תוכן יש שיוך ספק תוכן לפי ECAT.
- [ ] `context.team` מכיל NMM או סמל מוסד.
- [ ] ה־Object וה־Activity type תואמים לאירוע.
- [ ] כל extension משתמש ב־IRI המלא שלו תחת `https://lxp.education.gov.il/xapi/moe/extensions/`.
- [ ] `parent` מצביע על המיכל הישיר של אובייקט התוכן.
- [ ] `result.duration` נשלח בפורמט ISO-8601 כאשר הוא נדרש.
- [ ] `selected` כולל גם `selectionType` וגם `result.response`.
- [ ] `rated` כולל `result.response` של `like` או `dislike`.
- [ ] אין שימוש ב־`https://720.example.co.il` בערכי runtime; הוא דוגמה במסמך בלבד.

## מקורות וקבצים נלווים

- [מסמך מקור PDF](720%20התממשקות%20לLRS%201.0%20(2).pdf)
- [ריכוז אירועי xAPI ל־Postman](720-lrs-xapi-events.md)
- [אוסף Postman](postman/720-LRS.postman_collection.json)
- [סביבת Postman](postman/720-LRS.postman_environment.json)
- [אפיון LRS כללי לספקים](https://sapakim.education.gov.il/tech/lrs/)