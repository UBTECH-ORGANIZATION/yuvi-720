# 720 → LRS · ריכוז אירועי xAPI לבדיקה ב-Postman

מסמך זה מרכז את **כל הקריאות** ש-720 צריכה לשלוח ל-LRS של משרד החינוך, על בסיס
`docs/LRS/720 התממשקות לLRS 1.0 (2).pdf` (גרסה 1.0, 14/7/26).

לצד המסמך יש שני קבצים מוכנים לייבוא ל-Postman:

- `docs/LRS/postman/720-LRS.postman_collection.json` — כל האירועים כבקשות מוכנות.
- `docs/LRS/postman/720-LRS.postman_environment.json` — endpoint + פרטי OAuth + משתני דמו.

> ⚠️ **סוד:** קובץ ה-environment מכיל `client_secret` של סביבת ה-staging. הוא מסומן ב-`.gitignore`
> ואין להעלות אותו ל-repo ציבורי. בסביבת production השתמשו ב-Postman Vault / secret variables.

---

## 1. אימות (OAuth2 · client_credentials)

לפני כל שליחת statement יש לקבל `access_token`:

```
POST https://lrs-stg.education.gov.il/auth/oauth/v2/token
     ?grant_type=client_credentials
     &client_id={{client_id}}
     &client_secret={{client_secret}}
     &scope=lrs
```

בקשת **`00 · Get OAuth Token`** באוסף עושה זאת אוטומטית ושומרת את
`access_token` למשתנה הסביבה. הריצו אותה פעם אחת ואז את שאר הבקשות.

כל בקשת statement נשלחת עם:

| Header | Value |
|---|---|
| `Authorization` | `Bearer {{access_token}}` |
| `Content-Type` | `application/json` |
| `X-Experience-API-Version` | `1.0.3` |

> ה-endpoint לשליחת statements נשמר במשתנה `{{lrs_statements_url}}`.
> ברירת המחדל היא `https://lrs-stg.education.gov.il/data/xAPI/statements` — עדכנו אם הכתובת הרשמית שונה.

### הערות מימוש כלליות (מהמסמך)

- שליחה **Near-Real-Time** — סמוך ככל האפשר להתרחשות.
- מנגנון **Retry/Resend** עם מניעת כפילויות: `statement.id` שכבר נקלט → נדחה. באוסף Postman
  שדה ה-`id` משתמש ב-`{{$guid}}` כדי ליצור מזהה חדש בכל שליחה (מאפשר בדיקות חוזרות).
- כל ה-`ENUM` מבוססים על תקן התוכן של 720.

---

## 2. שדות משותפים לכל הודעה

| חלק | דרישה |
|---|---|
| **actor** | `exidentifier` בלבד (ת"ז מעורבלת) — `homePage: .../identity/exidentifier`, `name: {{learner_id}}` |
| **grouping → LMS** | ה-Activity של מערכת ה-LMS המדווחת (`activities/lms`) |
| **grouping → session** | הפניה ל-Session הפעיל (`activities/session`) |
| **grouping → program** | סוג התוכנית — `program/720-platform` (`activities/program`) |
| **grouping → content-vendor** | באירועי תוכן בלבד — מזהה פריט ECAT (`activities/content-vendor`) |
| **team** | קבוצת NMM (עדיפות) או סמל מוסד |

מזהי בסיס (IRI):

- Session: `https://{supplier-domain}/session/{sessionId}`
- Dashboard: `https://{supplier-domain}/dashboard/{dashboardType}`
- Agency: `https://{supplier-domain}/agency/{pre|post}`
- Reflection: `https://{supplier-domain}/reflection/{questionnaireId}`
- Conversation: `https://{supplier-domain}/conversation/{conversationId}`
- Mentor meeting: `https://{supplier-domain}/mentor-student-meeting/{id}`
- Student goal: `https://{supplier-domain}/student-goal/{goalId}`
- Learning-unit / component / item: `https://{supplier-domain}/learning-unit|component|item/{id}`

כל ה-verbs וה-activity-types תחת המרחב `https://lxp.education.gov.il/xapi/moe/...`.

---

## 3. מפת כל הקריאות

### 3.1 Session (מחזור חיים)
| # | אירוע | Verb | Object type | הערות |
|---|---|---|---|---|
| 1 | תחילת Session | `enter` | `session` | `context.extensions`: deviceType, platform, operatingSystem, osVersion, browser, browserVersion, applicationVersion |
| 2 | איבוד פוקוס | `suspend` | `session` | |
| 3 | חזרה לפוקוס | `resume` | `session` | |
| 4 | סיום Session | `exit` | `session` | `result.duration` (exit − enter) |

### 3.2 Dashboard
| # | אירוע | Verb | Object type | הערות |
|---|---|---|---|---|
| 5 | צפייה בדשבורד | `viewed` | `dashboard` | `result.duration` (מומלץ) · `extensions.dashboardId` · סוגים: student-personal / student-view / learning-group / realtime-dashboard |

### 3.3 שאלון פעלנות (Agency)
| # | אירוע | Verb | Object type | הערות |
|---|---|---|---|---|
| 6 | תחילת שאלון | `initialized` | `questionnaire` | id כולל `agency/pre` או `agency/post` |
| 7 | מענה על שאלה | `answered` | `question` | `result.response` + `result.score` · `parent` → השאלון |
| 8 | סיום שאלון | `completed` | `questionnaire` | `result.completion`, `result.duration` |

### 3.4 ניהול שיחה (בוט)
| # | אירוע | Verb | Object type | הערות |
|---|---|---|---|---|
| 9 | אינטראקציה בשיחה | `interacted` | `conversation` | `extensions`: speaker, conversationTrigger, helpType, componentId, itemId · **תוכן השיחה לא נשלח** |
| 10 | דירוג הודעת בוט | `rated` | `conversation` | `result.response`: like / dislike |

### 3.5 שאלון רפלקציה
| # | אירוע | Verb | Object type | הערות |
|---|---|---|---|---|
| 11 | תחילת שאלון | `initialized` | `questionnaire` | id כולל `reflection` · `extensions.reflactionTrigger` |
| 12 | מענה (פתוח) | `answered` | `question` | `result.response` |
| 13 | מענה (דירוג) | `answered` | `question` | `result.score` |
| 14 | דילוג על שאלה | `skipped` | `question` | `parent` → השאלון |
| 15 | סיום שאלון | `completed` | `questionnaire` | `result.completion`, `result.duration` |

### 3.6 מפגש מנטור–תלמיד
| # | אירוע | Verb | Object type | הערות |
|---|---|---|---|---|
| 16 | סיום מפגש | `completed` | `mentor-student-meeting` | `extensions`: mentor, student, meetingDate, mentoringPhase |

### 3.7 יעד למידה אישי (Student Goal)
| # | אירוע | Verb | Object type | הערות |
|---|---|---|---|---|
| 17 | הגדרת יעד | `initialized` | `student-goal` | `definition.extensions.goalType` · `context.instructor` אם ע"י מורה |
| 18 | עדכון יעד | `updated` | `student-goal` | |
| 19 | השלמת יעד | `completed` | `student-goal` | |

### 3.8 אינטראקציה עם תוכן — רכיב (Component)
| # | אירוע | Verb | Object type | הערות |
|---|---|---|---|---|
| 20 | תחילת רכיב | `initialized` | `component` | כל מטא-הנתונים של הרכיב + יחידת התוכן |
| 21 | סיום רכיב | `completed` | `component` | `result.success`, `result.score.scaled`, `result.duration` |

### 3.9 אינטראקציה עם תוכן — פריט (Item)
| # | אירוע | Verb | Object type | הערות |
|---|---|---|---|---|
| 22 | תחילת שאלון | `initialized` | `questionnaire` | `parent` → רכיב · כל המטא-דאטה |
| 23 | סיום שאלון | `completed` | `questionnaire` | `result.score`, `result.duration` |
| 24 | מענה על שאלה | `answered` | `item`/`question` | `result.response/success/score` · `extensions`: questionId, questionType, attemptNumber |
| 25 | דילוג על פריט | `skipped` | (סוג הפריט) | `parent` → רכיב |

### 3.10 מדיה
| # | אירוע | Verb | Object type | הערות |
|---|---|---|---|---|
| 26 | התחלת צפייה | `played` | `video`/audio/animation | `extensions`: mediaFormat, mediaPosition, mediaDuration |
| 27 | השהיה | `paused` | media | `extensions.mediaPosition` + `result.duration` |
| 28 | סיום צפייה | `completed` | media | `result.duration` |

### 3.11 בקשת עזרה / בחירה לא-לימודית
| # | אירוע | Verb | Object type | הערות |
|---|---|---|---|---|
| 29 | בקשת עזרה | `requested` | component/item | `extensions`: helpSource, helpType |
| 30 | בחירה לא-לימודית | `selected` | component/item | `extensions.selectionType` + `result.response` |

---

## 4. סדר הרצה מומלץ ב-Postman

1. בחרו את ה-Environment **`720 LRS – staging`**.
2. הריצו **`00 · Get OAuth Token`** (שומר `access_token`).
3. הריצו **`Session / 01 enter`** — שומר `sessionId` חדש לסביבה.
4. הריצו כל אירוע אחר לבדיקה. שדה ה-`id` מתחדש בכל שליחה כדי למנוע דחיית כפילות.
5. תשובת LRS תקינה: `200 OK` (POST) עם מערך מזהי statement, או `204`.

## 5. מקורות

- מסמך אפיון 720: `docs/LRS/720 התממשקות לLRS 1.0 (2).pdf`
- אפיון LRS כללי לספקים: https://sapakim.education.gov.il/tech/lrs/
