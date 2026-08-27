<mark>מבוא</mark> 

.של משרד החינוך LRS מסמך זה מהווה הרחבה והשלמה למסמך האפיון הכללי של התממשקות ספקי תוכן למערכת ה (Extensions) מבני הנתונים וההרחבות , xAPI ומפרט את אירועי ה המסמך מתמקד בדרישות הייחודיות לפרויקט720 הנדרשים עבור פרויקט זה. כל הדרישות, ההגדרות והכללים שאינם מפורטים במסמך זה כפופים למסמך האפיון הכללי של <u>https://sapakim.education.gov.il/tech/lrs/</u> הזמין בכתובת: , LRS התממשקות ספקים ל 

.בלבד מקרה של סתירה בין המסמכים, ההנחיות המפורטות במסמך זה יגברו עבור התממשקות פרויקט720 

כך שהאירועים יועברו בסמוך ככל האפשר למועד **, Near Real-Time** LRS המתוארים במסמך זה יישלחו ל xAPI דיווחי ה כך שבמקרה של כשל זמני **, Retry/Resend** התרחשותם. בנוסף, על המערכת התומכת בהתממשקות ליישם מנגנון האירוע יישמר ויישלח מחדש עד לקליטתו המוצלחת, תוך הבטחת מנגנון למניעת שליחת דיווחים , LRS בשליחת אירוע ל שכבר נקלט במערכת תגרום לדחיית ההודעה) . statement.id כפולים (שליחת הודעה בעלת 

, ומטרתן להבטיח אחידות המופיעות במסמך זה מבוססות על תקן התוכן שהופץ לספקי פרויקט720 **ENUM** רשימות ערכי ה אינה xAPI בין נתוני התוכן המדווחים לבין המטא-דאטה המוגדר בתקן. כמו כן, שליחת המטא-דאטה במסגרת הודעות ה דאטה הסטטי של ספקי התוכן. שני המנגנונים יפעלו במקבילמחליפה, אינה סותרת ואינה מייתרת את מנגנון שליחת המטא. ויש להשלים את הדרישות של שניהם 

|גרסאות|
|---|



|**השינוי **|**תיאור**|**תאריך שינוי**|**גרסה**||
|---|---|---|---|---|
|אשונה|גרסה ר|14/7/26|1.0||
|שינוי בשיוך לספק התוכן<br>עדכוניextensions<br>של מטא נתונים של יחידת התוכן<br>עדכוניextensions<br>של מטא נתונים של רכיב תוכן<br>עדכוניextensions<br>של מטא נתונים של פריט תוכן<br>עדכון לערכים אפשריים עבורconversation trigger<br>Skipped<br>–<br>כא י רוע של רכיב ולא של פריט<br>מדיה–<br>א י רועcompleted<br>–<br>הוספת דיוק<br>מדיה–<br>הסרתextension<br>:<br>mediaduration<br>שאלון רפלקציה–<br>תיקון<br>extension|•<br>•<br>•<br>•<br>•<br>•<br>•<br>•<br>•|16/8/26|1.1||
|||||כללי|
|||ACTOR<br>)|(  משתמש|מזהה|



.בלבד - מזהה משרד החינוך exidentifier יש להעדי ף דיווח מבצע הפעולה ע"י עבור כל דיווח תחת תוכנית720 

```
{
```

```
"objectType": "Agent",
```

```
"account": {
"homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
"name": "1000000000"
  }
}
```

את :מזהה משרד החינוך ניתן לדווח ע"י זהות רגיל כך IDM במידה והספק לא מקבל מ 

```
{
```

```
"objectType": "Agent",
"account": {
```

```
"homePage": "https://lxp.education.gov.il/xapi/moe/identity/idnumber ",
"name": "0222222222"
  }
}
```

## <mark>LMS שיוך ל ספק</mark> 

-LMS את מערכת ה context.contextActivities.grouping חייבת לכלול תחת -LRS הנשלחת למערכת ה xAPI כל הודעת . אשר מדווחת את האירוע 

. השולחת את ההודעה, בהתאם למבנה המוגדר במפרט -LMS יתאר את מערכת ה -Activity ה 

: דוגמה 

```
"context": {
"contextActivities": {
"grouping": [
        {
"objectType": "Activity",
"id": "https://720.example.co.il",
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/lms"
          }
        }
      ]
    }
  }
```

## <mark>SESSION שיוך ל</mark> 

. הפעיל אליו שייך האירוע -Session הפניה ל context.contextActivities.grouping תכלול תחת xAPI כל הודעת 

-exit. ו enter, suspend, resume שנשלח באירועי Activity ייוצג באמצעות אותו -Session ה 

**: דוגמה** 

```
"context": {
```

```
"contextActivities": {
"grouping": [
        {
"objectType": "Activity",
"id": "https://720.example.co.il/session/8b91cb91-a17b-45b0-963d-
fd2c537d9494",
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/session",
"name": {
"he": "Session"
            }
          }
        }
      ]
    }
  }
```

<mark>שיוך לקבוצת לימוד</mark> 

context.team או המוסד החינוכי אליו משויך המשתמש באמצעות השדה NMM קבוצת ה יכללו את xAPI כל הודעות ה **קבוצת הלימוד, יש לשייך לסמל מוסד ה ), במידה ועדיין לא ידוע NMM ( עדיפות לשיוך לקבוצת הלימוד** 

שיוך לס מל מוס ד . השדה יזהה את המוסד באמצעות סמל המוסד הרשמי של משרד החינוך 

**: דוגמה** 

```
{
"context": {
"team": {
"objectType": "Group",
"account": {
"homePage": "https://lxp.education.gov.il/xapi/moe/school",
"name": "123456"
    }
  }
}
```

. מכיל את סמל המוסד הרשמי name כאשר הערך 

NMM שיוך ל כפי שמופיעה ברשומות משרד החינוך NMM קבוצת ה השדה יזהה את 

**: דוגמה** 

```
{
```

```
"context": {
```

```
"team": {
```

```
"objectType": "Group",
"account": {
```

```
"homePage": "https://lxp.education.gov.il/xapi/moe/identity/nmm/kvutsa",
"name": "90635956"
```

```
    }
  }
}
```

כפי שמופיע במשרד NMM של ה ID ת ה מכיל א name כאשר הערך 

<mark>שיוך לספק תוכן – דיווח על פעילויות תוכן</mark> 

בהודעות המתייחסות לאינטראקציה עם תוכן לימודי (כגון משימות, שאלונים, משחקים, סימולציות, סרטונים, יחידות לימוד . גם את ספק התוכן ממנו הגיע פריט התוכן context.contextActivities.grouping וכדומה), יש לצרף בנוסף תחת 

:בצורה הבאה ) VendorId ( הספק בקטלוג החינוכי ספק התוכן יזוהה באמצעות מזהה 

https://lxp.education.gov.il/xapi/moe/ecat/content-vendor/<vendorId> 

:נוכחית רשימת ספקי תוכן  ל720 10 מטח - • 521 - קמפוס • 310 מתודיקה - • 

: דוגמה 

<mark>`"context": { "contextActivities": { "grouping": [ { "objectType": "Activity", "id": "https://720.example.co.il", "definition": { "type": "https://lxp.education.gov.il/xapi/moe/activities/lms" } }, { "objectType": "Activity", "id": " https://lxp.education.gov.il/xapi/moe/ecat/content-vendor/` 10</mark> <mark>`", "definition": { "type": "https://lxp.education.gov.il/xapi/moe/activities/contentvendor" } } ]`</mark> 

```
    }
  }
```

המדווחת את האירוע לבין ספק התוכן אליו מתייחס -LMS הוספת מזהה ספק התוכן מאפשרת להבחין בין מערכת ה **: הערה** . האירוע, במקרים בהם מערכת הלמידה והתוכן מסופקים על-ידי גורמים שונים 

<mark>שיוך ל סוג מערכת</mark> 

context.contexActivities.grouping כל הודעה יש לשייך לסוג התוכנית תחת 

:הערכים האפשריים הם 

זה הערך הרלוונטי לספקי פלטפורמה - https://lxp.education.gov.il/xapi/moe/program/720-platform • תוכנית720 זה הערך הרלוונטי לספקי קול קורא אנגלית - https://lxp.education.gov.il/xapi/moe/program/english-app • זה הערך הרלוונטי לספקי קול - https://lxp.education.gov.il/xapi/moe/program/innovation-authority • קורא הרשות לחדשנות ומשרד החינוך 

:הוא Activity type כאשר ה 

https://lxp.education.gov.il/xapi/moe/activities/program 

**:לדוגמא** 

```
"context": {
"contextActivities": {
"grouping": [
      {
"objectType": "Activity",
"id": "https://720.example.co.il",
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/lms"
        }
      },
      {
"objectType": "Activity",
"id": "https://lxp.education.gov.il/xapi/moe/ecat/item/123456",
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/content-
vendor"
        }
      },
      {
"objectType": "Activity",
"id": "https://lxp.education.gov.il/xapi/moe/program/720-platform",
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/program"
        }
```

```
      }
    ]
  }
}
```

# <mark>) SESSION התחברות למערכת  (</mark> 

כללי 

. במערכת Session תומכת בדיווח על מחזור החיים של -LRS מערכת ה . מייצג ביקור אחד של משתמש במערכת, החל מרגע הכניסה ועד לסיום העבודה Session . אשר ישמש בכל ההודעות השייכות לאותו ביקור (sessionId) יוקצה מזהה ייחודי Session לכל . חדש למילון הפעילויות ActivityType לצורך כך נוסף **ActivityType** 

https://lxp.education.gov.il/xapi/moe/activities/session 

: יהיה -Session של ה -IRI מבנה ה 

https://{supplier-domain}/session/{sessionId} 

: לדוגמה 

https://720.example.co.il/session/8b91cb91-a17b-45b0-963d-fd2c537d9494 

אירועים נתמכים 

**אירוע Verb** Session תחיל ת enter 

איבוד פוקוס suspend חזרה לפוקוס resume Session סיו ם exit 

<mark>ENTER הודעת</mark> 

. חדש במערכת Session אירוע זה מדווח כאשר המשתמש מתחיל . ניתן לצרף מידע טכני המתאר את סביבת העבודה של המשתמש Session בנוסף ליצירת ה : המידע מועבר באמצעות context.extensions 

## **Extension דוגמה לערכים** 

deviceType Desktop / Mobile / Tablet platform Web / Android / iOS 

operatingSystem Windows / Android / iOS 

osVersion Windows 11 browser Chrome 

## **דוגמת הודע ה** 

```
{
"id": "3d2ab89b-75b8-4c43-bb17-1cf8f25c0001",
"actor": {
"objectType": "Agent",
"account": {
"homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
"name": "1012345678"
    }
  },
"verb": {
"id": "https://lxp.education.gov.il/xapi/moe/verbs/enter"
  },
"object": {
"objectType": "Activity",
"id": "https://720.example.co.il/session/8b91cb91-a17b-45b0-963d-
fd2c537d9494",
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/session",
"name": {
"he": "Session"
      }
    }
  },
```

```
"context": {
```

```
"extensions": {
```

```
"https://lxp.education.gov.il/xapi/moe/extensions/deviceType": "Desktop",
"https://lxp.education.gov.il/xapi/moe/extensions/platform": "Web",
"https://lxp.education.gov.il/xapi/moe/extensions/operatingSystem":
"Windows",
```

```
"https://lxp.education.gov.il/xapi/moe/extensions/osVersion": "11",
"https://lxp.education.gov.il/xapi/moe/extensions/browser": "Chrome",
"https://lxp.education.gov.il/xapi/moe/extensions/browserVersion": "138.0",
"https://lxp.education.gov.il/xapi/moe/extensions/applicationVersion":
"2.5.17"
```

```
    }
```

```
  },
```

```
"timestamp": "2026-01-15T08:30:00Z"
```

```
}
```

<mark>SUSPEND הודעת</mark> 

אירוע זה מדווח כאשר המשתמש מפסיק את העבודה במערכת באופן זמני, לדוגמה בעקבות מעבר לחלון אחר או איבוד . פוקוס של הדפדפן 

**דוגמת הודעה** 

```
{
```

```
"id": "9e56dcb8-cf90-4ef7-8b64-a11111111111",
```

```
"actor": {
```

```
"objectType": "Agent",
```

```
"account": {
```

```
"homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
```

```
"name": "1012345678"
```

```
"verb": {
```

```
"id": "https://lxp.education.gov.il/xapi/moe/verbs/suspend"
```

```
"object": {
```

```
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/session/8b91cb91-a17b-45b0-963d-
fd2c537d9494",
```

```
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/session"
    }
  },
```

```
"timestamp": "2026-01-15T09:02:15Z"
}
```

<mark>RESUME הודעת</mark> 

. לאחר איבוד פוקוס Session אירוע זה מדווח כאשר המשתמש חוזר להמשיך את העבודה באותו 

## **דוגמת הודעה** 

```
{
```

```
"id": "c5e6c7c9-0d1f-44af-b222-222222222222",
"actor": {
```

```
"objectType": "Agent",
"account": {
```

```
"homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
"name": "1012345678"
    }
  },
"verb": {
"id": "https://lxp.education.gov.il/xapi/moe/verbs/resume"
```

```
  },
"object": {
"objectType": "Activity",
"id": "https://720.example.co.il/session/8b91cb91-a17b-45b0-963d-
fd2c537d9494",
```

```
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/session"
    }
  },
"timestamp": "2026-01-15T09:05:10Z"
}
```

<mark>EXIT ה ודעת</mark> 

Session אירוע זה מדווח כאשר המשתמש מסיים את ה result.duration באמצעות ) enter מינוס exit ברוטו( Session יש לדווח את משך ה 

## **דוגמת הודעה** 

```
{
```

```
"id": "4c92b8d8-2a3d-41e5-9333-333333333333",
```

```
"actor": {
```

```
"objectType": "Agent",
"account": {
```

```
"homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
"name": "1012345678"
    }
  },
"verb": {
"id": "https://lxp.education.gov.il/xapi/moe/verbs/exit"
  },
"object": {
```

```
"objectType": "Activity",
"id": "https://720.example.co.il/session/8b91cb91-a17b-45b0-963d-
fd2c537d9494",
```

```
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/session"
    }
  },
"result": {
"duration": "PT45M12S"
  },
"timestamp": "2026-01-15T09:15:12Z"
}
```

<mark>DASHBOARD צפייה ב כללי</mark> 

|כלDashboardיוגדר כ-Activityעצמאי, כך שניתן יהיה לנתח אילו דשבורדים נצפו, באיזו תדירות ועל ידי אילו משתמשים.<br>לצורך כך נוסףActivityTypeחדש למילון הפעילויות.|
|---|
|**ActivityType**|
|https://lxp.education.gov.il/xapi/moe/activities/dashboard|
|בנוסף, נוסףVerbחדש למילון הפעלים.|
|**Verb**|
|https://lxp.education.gov.il/xapi/moe/verbs/viewed|
|מבנה ה-IRIשל ה-Dashboardיהיה:|
|https://{supplier-domain}/dashboard/{dashboardType}|
|לדוגמה:|
|https://720.example.co.il/dashboard/ learning-group|
|או|
|https://720.example.co.il/dashboard/student-personal|
|:מתוך הרשימה הבאה שהוגדרה|
|•<br>student-personal<br>-<br>תלמיד צופה<br>בנתוני<br>עצמו<br>•<br>student-view<br>- מורה צופה בנתוני<br>תלמיד|
|•<br>learning-group<br>- מורה<br>צופה<br>בנתוני<br>קבוצה<br>•<br>realtime-dashboard<br>-מורה צופה<br>בפעילות חיה של<br>תלמידים|
|אירועים<br>נתמכים<br>בשלב זה מוגדר אירוע אחד בלבד.|
|**אירוע**<br>**Verb**|
|צפיה<br>ב דשבורדviewed|
|משך הצפייה<br>במידת האפשר מומלץ לדווח את משך הזמן שבו המשתמש צפה בדשבורד באמצעות השדה:|
|result.duration|
|משך הזמן ידווח בפורמטISO-8601 Duration.<br>לדוגמה:|



"result": { "duration": "PT2M35S" } 

. כאשר הדיווח נשלח עם סיום הצפייה בדשבורד 

מבנה ההודעה . יתאר את הדשבורד אליו נכנס המשתמש -object ה 

<mark>`"object": {`</mark> `"objectType": "Activity", "id": "https://720.example.co.il/dashboard/student-personal", "definition": { "type": "https://lxp.education.gov.il/xapi/moe/activities/dashboard", "name": { "he": "` פר תלמיד דשבורד `" } } }` 

הדשבורד מסנן dashboard עבורו הציגו את ה id את ה context.extensions באמצעותיש לצרף 

: לדוגמה 

"context": { 

"extensions": { "https://lxp.education.gov.il/xapi/moe/extensions/dashboardId": "<nmmId/tzId>" } } 

:לפי החלוקה הבאה - ת " ז student-personal תלמיד צופה בנתוני עצמו – - ת "ז student-view מורה צופה בנתוני תלמיד– learning-group - nmm מורה צופה בנתוני קבוצה– realtime-dashboard - nmm מורה צופה בפעילות חיה של תלמידים– 

דוגמת הודע ה 

```
{
"id": "82fd1f7b-f18f-46ef-bfc7-1fef0d220001",
"actor": {
```

<mark>`"objectType": "Agent", "account": { "homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier", "name": "1012345678" } }, "verb": { "id": "https://lxp.education.gov.il/xapi/moe/verbs/viewed" }, "object": { "objectType": "Activity", "id": "https://720.example.co.il/dashboard/student-personal", "definition": { "type": "https://lxp.education.gov.il/xapi/moe/activities/dashboard", "name": { "he": "` דשבורד מורה</mark> <mark>`" } } }, "result": { "duration": "PT2M35S" }, "context": { "extensions": { "https://lxp.education.gov.il/xapi/moe/extensions/dashboardId": "123456789" } }, "timestamp": "2026-01-15T09:10:00Z" }`</mark> 

<mark>(AGENCY QUESTIONNAIRE) שאלון פעלנות</mark> 

כללי questionnaire מסוג Activity שאלון הפעלנות מיוצג כ ובנוסף יציין האם מדובר בשאלון המתבצע לפני agency יכלול את המילה object.id לצורך זיהוי שמדובר בשאלון פעלנות, ה . או לאחר תהליך הלמידה 

: יהיה -IRI מבנה ה 

https://{supplier-domain}/agency/{pre|post} 

: לדוגמא 

https://720.example.co.il/agency/pre 

או 

https://720.example.co.il/agency/post 

אירועים נתמכים 

**אירוע Verb** 

תחילת מענה על שאלון initialized 

מענה על שאלה answered 

סיום שאלון completed 

<mark>INITIALIZED תחילת מענה על שאלון  -</mark> 

. אירוע זה נשלח כאשר המשתמש מתחיל לענות על שאלון הפעלנות 

**דוגמת הודעה** 

<mark>`{ "id": "4f0c49d8-2b90-4e78-8fd0-000000000001", "actor": { "objectType": "Agent", "account": { "homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier", "name": "1012345678" } }, "verb": { "id": "https://lxp.education.gov.il/xapi/moe/verbs/initialized" }, "object": { "objectType": "Activity", "id": "https://720.example.co.il/agency/PRE", "definition": { "type": "https://lxp.education.gov.il/xapi/moe/activities/questionnaire", "name": { "he": "` לפני הלמידה שאלון פעלנות-</mark> <mark>`" } } }, "timestamp": "2026-01-15T08:30:00Z" }`</mark> 

<mark>ANSWERED מענה על שאלה  -</mark> 

. אירוע זה נשלח עבור כל שאלה עליה ענה המשתמש 

. מייצג את השאלה עצמה object ה 

. מצביע על שאלון הפעלנות parent ה 

:, כך result.respons המלל של תוכן התשובה ישלח ב  וכן result.score תשובת המשתמש תישלח באמצעות 

|`"result": {`|
|---|
|`"response": "`מסכים מאוד`", `|
|`"score": {`|
|`"min": 0, `|
|`"max": 5, `|
|`"raw": `5<br>`}`<br>`}`|



**דוגמת הודעה** 

<mark>`{ "id": "4f0c49d8-2b90-4e78-8fd0-000000000002", "actor": { "objectType": "Agent", "account": { "homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier", "name": "1012345678" } }, "verb": { "id": "https://lxp.education.gov.il/xapi/moe/verbs/answered" }, "object": { "objectType": "Activity", "id": "https://720.example.co.il/agency/question/5", "definition": { "type": "https://lxp.education.gov.il/xapi/moe/activities/question", "name": { "he": "` שאלה5</mark> <mark>`" } } }, "result": { "response": "` מסכים מאוד</mark> <mark>`", "score": { "min": 0, "max": 5, "raw":` 5</mark> <mark>`} }, "context": { "contextActivities": {`</mark> 

```
"parent": [
        {
"objectType": "Activity",
"id": "https://720.example.co.il/agency/PRE"
        }
      ]
    }
  },
"timestamp": "2026-01-15T08:31:15Z"
}
```

<mark>COMPLETED סיום שאלון  -</mark> 

. אירוע זה נשלח לאחר שהמשתמש השלים את המענה על שאלון הפעלנות 

result.duration משך מילוי השאלון ידווח באמצעות 

## **דוגמת הודעה** 

<mark>`{ "id": "4f0c49d8-2b90-4e78-8fd0-000000000003", "actor": { "objectType": "Agent", "account": { "homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier", "name": "1012345678" } }, "verb": { "id": "https://lxp.education.gov.il/xapi/moe/verbs/completed" }, "object": { "objectType": "Activity", "id": "https://720.example.co.il/agency/PRE", "definition": { "type": "https://lxp.education.gov.il/xapi/moe/activities/questionnaire", "name": { "he": "` לפני הלמידה שאלון פעלנות-</mark> <mark>`" } } }, "result": { "completion": true, "duration": "PT3M42S" }, "timestamp": "2026-01-15T08:34:12Z" }`</mark> 

<mark>)ניהול שיחה (עם בוט או ישות אחרת</mark> 

כללי . מייצג רצף הודעות בין המשתמש לבין גורם אחר במערכת, כגון בוט, מורה או גורם אחר Conversation . חדש למילון הפעילויות ActivityType לצורך כך נוסף **ActivityType** https://lxp.education.gov.il/xapi/moe/activities/conversation : יהיה -IRI מבנה ה https://{supplier-domain}/conversation/{conversationId} 

: יהיה -IRI מבנה ה : לדוגמה 

https://720.example.co.il/conversation/7b42b7ef 

. הוא מזהה ייחודי של השיחה במערכת הספק conversationId כאשר . ישמש בכל ההודעות המתייחסות לאותה שיחה object.id אותו **: הערה** מידע ייעודי לאינטראקציה context.extensions יש לצרף את המאפיינים הבאים באמצעות **Extension תיאור** speaker מי שלח את ההודעה conversationTrigger מה גרם לפתיחת/שליחת ההודעה helpType סוג העזרה שהתבקשה/הוצעה componentId )מזהה הרכיב ממנו בוצעה הפנייה (כאשר קיים itemId )מזהה הפריט ממנו בוצעה הפנייה (כאשר קיים SPEAKER . מזהה את הגורם ששלח את ההודעה : ערכים אפשריים student • 

bot • 

|CONVERSATION TRIGGER<br>מתאר מה גרם לאינטראקציה.|
|---|
|ערכים<br>אפשריים:|
|•<br>student-request|
|•<br>success-effort|
|•<br>student-error|
|•<br>idle-time|
|•<br>other|
|HELP TYPE|
|מתאר מה סוג העזרה שהתבקשה ע"י התלמיד הוא הוצעה ע"י הבוט|
|:ערכים אפשריים|
|•<br>hint|
|•<br>explanation|
|•<br>alternative-content|
|•<br>other|
|•<br>bot-help-offer|
|•<br>motivation|
|COMPONENT ID|
|כאשר האינטראקציה בוצעה מתוך רכיב תוכן, יצוין מזהה הרכיב.|
|ITEM ID|
|כאשר האינטראקציה בוצעה מתוך פריט תוכן, יצוין מזהה הפריט.|
|אירועים נתמכים|
|**אירוע**<br>**Verb**|
|אינטראקציה במסגרת שיחה<br>interacted|
|התלמיד דירג הודעת בוט -<br>אופציונליrated|



כללי הדיווח . **התלמיד** יהיה -actor בכל האירועים ה • 

Conversation יהיה ה object ה • conversationId כל ההודעות באותה שיחה יתייחסו לאותו • LRS נשלח ל **אינו** תוכן השיחה • שונה חדש עבור שיחה חדשה או פריט conversationId יש ליצור • 

<mark>INTERACTED דוגמת הודעת</mark> 

```
{
"id": "1c52f635-8c63-47b0-b41b-1b5d9d1b1001",
"actor": {
```

```
"objectType": "Agent",
"account": {
```

```
"homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
"name": "1012345678"
```

```
    }
  },
"verb": {
```

```
"id": "https://lxp.education.gov.il/xapi/moe/verbs/interacted"
  },
```

```
"object": {
```

```
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/conversation/8d22fe91",
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/conversation"
    }
```

```
  },
```

```
"context": {
```

```
"extensions": {
```

```
"https://lxp.education.gov.il/xapi/moe/extensions/speaker": "student",
"https://lxp.education.gov.il/xapi/moe/extensions/conversationTrigger"
"helpRequest",
```

```
"https://lxp.education.gov.il/xapi/moe/extensions/componentId":
"https://720.example.co.il/component/200",
```

```
"https://lxp.education.gov.il/xapi/moe/extensions/itemId"
"https://720.example.co.il/item/questionnaire/315"
```

```
  },
"timestamp": "2026-01-15T10:25:00Z"
}
```

<mark>RATED דוגמת הודעת</mark> 

reated פורמה מאפשרת דירוג של השיחה יש לשלוח את ה ארועבמידה והפל ט 

enum הוא rate בהודעת response ה 

:ערכים אפשריים 

like • dislike • 

```
{
```

```
"id": "3c8f9d58-6f34-4b76-bb4d-000000000003",
```

```
"actor": {
```

```
"objectType": "Agent",
```

```
"account": {
```

```
"homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
"name": "1012345678"
```

```
    }
```

```
  },
"verb": {
```

```
"id": "https://lxp.education.gov.il/xapi/moe/verbs/rated"
  },
"object": {
```

```
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/conversation/7b42b7ef",
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/conversation"
    }
  },
```

```
"result": {
"response": "like"
  },
"context": {
```

```
"extensions": {
```

```
"https://lxp.education.gov.il/xapi/moe/extensions/conversationType": "bot"
    }
  },
"timestamp": "2026-01-15T10:15:10Z"
}
```

<mark>שאלון רפלקציה</mark> 

כללי 

במידה ו ניתנו שאלות רפלקציה על הלמידה על ידי ספק הפלטפורמה, כגון: היה קל/קשה/משעמם? או האם את/ה בטוחה .יש לשלוח את הארועים הבאים 'בתושבה שלך? וכו . questionnaire מסוג Activity שאלון הרפלקציה מיוצג כ- 

. reflection יכלול את המילה object.id לצורך זיהוי שמדובר בשאלון רפלקציה, ה- :יהיה IRI מבנה ה- 

https://{supplier-domain}/reflection/{questionnaireId} 

:לדוגמה 

https://720.example.co.il/reflection/end-of-lesson 

או 

https://720.example.co.il/reflection/12345 

וכן) initialized, answered, skipped, completed ( ישמש בכל ההודעות המתייחסות לאותו שאלון object.id הערה: אותו לכל המופעים של אותו שאלון עבור תלמידים שונים או בזמנים שונים 

אירועים נתמכים 

## **אירוע Verb** 

תחילת מענה על שאלון initialized 

מענה על שאלה answered 

דילוג על שאלה skipped 

סיום שאלון completed 

:חדש למילון הפעלים Verb לצורך כך יתווסף 

https://lxp.education.gov.il/xapi/moe/verbs/skipped 

<mark>INITIALIZED תחילת מענה על שאלון  -</mark> 

.אירוע זה נשלח כאשר המשתמש מתחיל לענות על שאלון הרפלקציה reflectionTrigger תחת הערך context.extensions הצגת השאלון בטריגר ליש לציין את ה 

ערכים אפשריים : 

end-of-learning-objective • end-of-learning-component • difficult-task • other • **דוגמת הודעה** 

```
{
```

```
"id": "5c1a2d17-6b4f-4a6c-98f7-71d15c770001",
```

```
"actor": {
```

```
"objectType": "Agent",
"account": {
```

```
"homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
"name": "1012345678"
```

```
    }
  },
"verb": {
```

```
"id": "https://lxp.education.gov.il/xapi/moe/verbs/initialized"
  },
```

```
"object": {
```

```
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/reflection/end-of-lesson",
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/questionnaire"
"name": {
```

<mark>`"he": "` שאלון רפלקציה</mark> <mark>`"`</mark> 

```
      }
    }
  },
"context": {
```

```
"extensions": {
```

```
"https://lxp.education.gov.il/xapi/moe/extensions/reflectionTrigger":
"difficult-task"
```

```
    }
  },
"timestamp": "2026-01-15T08:30:00Z"
}
```

<mark>ANSWERED מענה על שאלה  -</mark> 

.אירוע זה נשלח עבור כל שאלה עליה ענה המשתמש :את תיאור השאלה כך object , יש לכלול ב מייצג את השאלה object ה- 

```
"object": {
```

```
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/reflection/question/3",
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/question"
"name": {
```

<mark>`"he": "` מה תרם לך ההסבר</mark> <mark>`?" } } }`</mark> 

.מצביע על שאלון הרפלקציה parent ה- :תומכת בשני סוגי תשובות LRS מערכת ה- תשובה פתוחה • 

:כאשר המשתמש מזין תשובה חופשית, תוכן התשובה יישלח באמצעות 

"result": { 

"response": " התשובה שהזין המשתמש " 

} 

תשובת דירוג • . result.score ), ערך הדירוג יישלח באמצעות10– או1 5– כאשר השאלה היא מסוג דירוג (לדוגמה1 

:לדוגמה 

"result": { 

"score": { 

"raw": 4, 

"min": 1, 

"max": 5 

} 

} 

:יישלח אחד מסוגי התשובות בלבד, בהתאם לסוג השאלה answered הערה: בהודעת 

.עבור שאלות פתוחות – result.response .עבור שאלות דירוג – result.score **תשובה פתוחה דוגמת הודעה–** 

```
{
"id": "5c1a2d17-6b4f-4a6c-98f7-71d15c770002",
"actor": {
"objectType": "Agent",
"account": {
"homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
```

```
"name": "1012345678"
```

```
"verb": {
"id": "https://lxp.education.gov.il/xapi/moe/verbs/answered"
"object": {
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/reflection/question/3",
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/question"",
"name": {
```

<mark>`"he": "` מה תרם לך ההסבר</mark> <mark>`?" "result": {`</mark> 

<mark>`"response": "` הבנתי טוב יותר את הנושא</mark> <mark>`." "context": {`</mark> 

```
"contextActivities": {
```

```
"parent": [
```

```
        {
```

```
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/reflection/end-of-lesson"
```

```
        }
      ]
    }
  },
"timestamp": "2026-01-15T08:31:15Z"
}
```

## **תשובת דירוג דוגמת הודעה–** 

```
{
```

```
"id": "5c1a2d17-6b4f-4a6c-98f7-71d15c770003",
"actor": {
"objectType": "Agent",
"account": {
"homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
"name": "1012345678"
"verb": {
```

```
"id": "https://lxp.education.gov.il/xapi/moe/verbs/answered"
```

```
"object": {
```

```
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/reflection/question/4",
"definition": {
```

<mark>`"type": "https://lxp.education.gov.il/xapi/moe/activities/question"", "name": { "he": "` את קושי העבודה עד10דרג מ1</mark> <mark>`?" "result": { "score": { "raw": 4, "min": 1, "max": 5 "context": { "contextActivities": { "parent": [ {`</mark> 

```
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/reflection/end-of-lesson"
        }
      ]
    }
  },
"timestamp": "2026-01-15T08:32:10Z"
}
```

<mark>SKIPPED דילוג על שאלה  -</mark> 

.אירוע זה נשלח כאשר המשתמש בחר שלא לענות על שאלה ועבר לשאלה הבאה :את תיאור השאלה כך object , יש לכלול ב מייצג את השאלה שעליה דולג object ה- 

```
"object": {
```

```
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/reflection/question/3",
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/question",
"name": {
```

<mark>`"he": "` מה תרם לך ההסבר</mark> <mark>`?" }`</mark> 

```
  }
```

.מצביע על שאלון הרפלקציה parent ה- 

## **דוגמת הודעה** 

```
{
```

```
"id": "5c1a2d17-6b4f-4a6c-98f7-71d15c770004",
"actor": {
"objectType": "Agent",
"account": {
"homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
"name": "1012345678"
"verb": {
"id": "https://lxp.education.gov.il/xapi/moe/verbs/skipped"
"object": {
"objectType": "Activity",
"id": "https://720.example.co.il/reflection/question/5",
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/question",
"name": {
```

<mark>`"he": "` מה תרם לך ההסבר</mark> <mark>`?" "context": { "contextActivities": { "parent": [ {`</mark> 

```
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/reflection/end-of-lesson"
        }
      ]
    }
  },
"timestamp": "2026-01-15T08:32:45Z"
}
```

<mark>COMPLETED סיום שאלון  -</mark> 

.אירוע זה נשלח לאחר שהמשתמש השלים את המענה על שאלון הרפלקציה 

. result.duration משך מילוי השאלון ידווח באמצעות 

**דוגמת הודעה** 

<mark>`{ "id": "5c1a2d17-6b4f-4a6c-98f7-71d15c770005", "actor": { "objectType": "Agent", "account": { "homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier", "name": "1012345678" } }, "verb": { "id": "https://lxp.education.gov.il/xapi/moe/verbs/completed" }, "object": { "objectType": "Activity", "id": "https://720.example.co.il/reflection/end-of-lesson", "definition": { "type": "https://lxp.education.gov.il/xapi/moe/activities/questionnaire" } }, "result": { "completion": true, "duration": "PT4M18S" }, "timestamp": "2026-01-15T08:34:12Z" }` תלמיד מפגש מנטור –</mark> 

כללי 

. אירוע זה מתעד מפגש מנטור –תלמיד שהתקיים במסגרת התוכנית 

. האירוע נשלח לאחר שהמפגש הסתיים, ומתעד את עצם קיום המפגש ואת המידע הנלווה אליו . אירוע זה אינו מהווה אינטראקציה עם תוכן לימודי, ולכן אינו כולל תיוגים פדגוגיים או מטא־נתוני תוכן :במקרה הזה יהיה verb ה 

https://lxp.education.gov.il/xapi/moe/verbs/completed 

. של ההודעה ייצג את מפגש המנטור –תלמיד object ה־ Activity Type: 

https://lxp.education.gov.il/xapi/moe/activities/mentor-student-meeting 

. יהיה מזהה ייחודי של המפגש במערכת הספק object.id ה־ 

: לדוגמה 

https://720.example.co.il/mentor-student-meeting/987654 

מידע ייעודי לאירוע context.extensions ההודעה תכלול את השדות הבאים באמצעות 

## **Extension תיאור** 

mentor . מזהה המנטור שקיים את המפגש student . מזהה התלמיד שהשתתף במפגש meetingDate . תאריך קיום המפגש 

הערכים יהיו כפי המופיע mentoringPhase<sup>שלב הליווי של התלמיד בעת קיום המפג ש –</sup> <u>קובץ הזהב</u> 

**: דוגמה** 

```
{
"id": "4e79b8dd-bc3f-43d5-98cf-4d47252f2b47",
"actor": {
"objectType": "Agent",
"account": {
"homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
"name": "123456789"
    }
  },
"verb": {
"id": "https://lxp.education.gov.il/xapi/moe/verbs/completed",
"display": {
"en": "completed"
    }
  },
"object": {
"objectType": "Activity",
"id": "https://720.example.co.il/mentor-student-meeting/987654",
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/mentor-student-
meeting"
    }
```

```
  },
"context": {
"team": {
"objectType": "Group",
"account": {
"homePage": "https://lxp.education.gov.il/xapi/moe/school",
"name": "441122"
      }
    },
```

```
"contextActivities": {
"grouping": [
        {
"objectType": "Activity",
"id": "https://720.example.co.il/lms",
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/lms",
"name": {
"he": "720"
```

```
            }
```

```
          }
        },
        {
"objectType": "Activity",
"id": "https://720.example.co.il/session/8b91cb91-a17b-45b0-963d-
fd2c537d9494",
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/session"
          }
        },
        {
"objectType": "Activity",
"id": "https://lxp.education.gov.il/xapi/moe/program/720-platform",
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/program"
          }
        }
      ]
    },
"extensions": {
"https://lxp.education.gov.il/xapi/moe/extensions/mentor": "987654321",
"https://lxp.education.gov.il/xapi/moe/extensions/student": "123456789",
"https://lxp.education.gov.il/xapi/moe/extensions/meetingDate": "2026-09-
15",
"https://lxp.education.gov.il/xapi/moe/extensions/mentoringPhase": "phase1"
    }
```

<mark>`}, "timestamp": "2026-09-15T10:45:00Z" }` (STUDENT GOAL) יעד אישי</mark> 

כללי . יעד אישי מייצג יעד שהוגדר עבור תלמיד במסגרת התוכנית ידי מורה, ולעבור מספר שלבים לאורך מחזור חייו, החל מהגדרתו ועדהיעד יכול להיות מוגדר על-ידי התלמיד או על. להשלמתו 

אירועים נתמכים **אירוע Verb** 

תלמיד הגדיר יעד initialized תלמיד עדכן יעד updated תלמיד השלים יעד completed 

OBJECT . מייצג את יעד הלמידה Object ה־ Activity Type https://lxp.education.gov.il/xapi/moe/activities/student-goal Object ID https://720.example.co.il/student-goal/{goalId} GOAL TYPE Object סוג היעד ידווח כחלק ממאפייני ה־ : ערכים אפשריים academic • personal • social-emotional • motivational • 

behavioral • 

other • 

INSTRUCTOR 

: כאשר הפעולה מבוצעת על -ידי מורה, יש לכלול את פרטי המורה באמצעות 

context.instructor 

. כאשר הפעולה מבוצעת על -ידי התלמיד, אין צורך לשלוח את השדה 

<mark>INITIALIZED יצירת יעד אישי  -</mark> 

**:דוגמת הודעה** 

```
{
```

```
"id": "9c31f5b8-57d3-4c78-8c74-9a6fbb5b4123",
```

```
"actor": {
```

```
"objectType": "Agent",
```

```
"account": {
```

```
"homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
```

```
"name": "123456789"
```

```
"verb": {
```

```
"id": "https://lxp.education.gov.il/xapi/moe/verbs/initialized"
```

```
"object": {
```

```
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/student-goal/548965",
```

```
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/student-goal",
"extensions": {
```

```
"https://lxp.education.gov.il/xapi/moe/extensions/goalType": "academic"
```

```
"context": {
```

```
"team": {
```

```
"objectType": "Group",
```

```
"account": {
```

```
"homePage": "https://lxp.education.gov.il/xapi/moe/school",
```

```
"name": "441122"
```

```
"contextActivities": {
```

```
"grouping": [
```

```
        {
```

```
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/lms",
```

```
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/lms",
"name": {
"he": "720"
            }
          }
        },
        {
"objectType": "Activity",
"id": "https://720.example.co.il/session/8b91cb91-a17b-45b0-963d-
fd2c537d9494",
```

```
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/session"
          }
```

```
        },
        {
"objectType": "Activity",
```

```
"id": "https://lxp.education.gov.il/xapi/moe/program/720-platform",
"definition": {
```

<mark>`"type": "https://lxp.education.gov.il/xapi/moe/activities/program" } } ] }, "instructor": { "objectType": "Agent", "account": { "homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier", "name": "987654321" } } }, "timestamp": "2026-09-15T08:30:00Z" }` UPDATED עדכון יעד אישי  -</mark> 

**:דוגמת הודעה** 

```
{
"id": "9c31f5b8-57d3-4c78-8c74-9a6fbb5b4123",
```

```
"actor": {
```

```
"objectType": "Agent",
```

```
"account": {
```

```
"homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
"name": "123456789"
```

```
    }
```

```
  },
"verb": {
```

```
"id": "https://lxp.education.gov.il/xapi/moe/verbs/updated"
```

```
  },
```

```
"object": {
```

```
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/student-goal/548965",
```

```
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/student-goal",
"extensions": {
```

```
"https://lxp.education.gov.il/xapi/moe/extensions/goalType": "academic"
      }
```

```
    }
```

```
  },
```

```
"context": {
```

```
"team": {
```

```
"objectType": "Group",
```

```
"account": {
```

```
"homePage": "https://lxp.education.gov.il/xapi/moe/school",
```

```
"name": "441122"
```

```
      }
```

```
    },
```

```
"contextActivities": {
"grouping": [
```

```
        {
```

```
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/lms",
```

```
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/lms",
"name": {
"he": "720"
            }
```

```
          }
        },
        {
"objectType": "Activity",
"id": "https://720.example.co.il/session/8b91cb91-a17b-45b0-963d-
fd2c537d9494",
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/session"
          }
        },
        {
"objectType": "Activity",
```

```
"id": "https://lxp.education.gov.il/xapi/moe/program/720-platform",
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/program"
          }
        }
      ]
    },
"instructor": {
"objectType": "Agent",
"account": {
"homePage":
```

```
"https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
"name": "987654321"
```

```
      }
    }
  },
"timestamp": "2026-09-15T08:30:00Z"
}
```

<mark>COMPLETED השלמת יעד אישי  -</mark> 

**:)דוגמת הודעה (במקרה הזה ע"י התלמיד** 

```
{
"id": "9c31f5b8-57d3-4c78-8c74-9a6fbb5b4123",
"actor": {
"objectType": "Agent",
"account": {
"homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
"name": "123456789"
    }
  },
"verb": {
"id": "https://lxp.education.gov.il/xapi/moe/verbs/completed"
  },
"object": {
"objectType": "Activity",
"id": "https://720.example.co.il/student-goal/548965",
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/student-goal",
"extensions": {
```

```
"https://lxp.education.gov.il/xapi/moe/extensions/goalType": "academic"
      }
    }
  },
"context": {
"team": {
"objectType": "Group",
"account": {
"homePage": "https://lxp.education.gov.il/xapi/moe/school",
"name": "441122"
      }
    },
"contextActivities": {
"grouping": [
        {
"objectType": "Activity",
"id": "https://720.example.co.il/lms",
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/lms",
"name": {
"he": "720"
            }
          }
        },
        {
"objectType": "Activity",
"id": "https://720.example.co.il/session/8b91cb91-a17b-45b0-963d-
fd2c537d9494",
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/session"
          }
        },
        {
"objectType": "Activity",
"id": "https://lxp.education.gov.il/xapi/moe/program/720-platform",
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/program"
          }
        }
      ]
    }
  },
"timestamp": "2026-09-15T08:30:00Z"
}
```

<mark>כללי אינטראקציה עם תוכן  -</mark> 

<mark>מטא־נתוני תוכן</mark> 

מבנה היררכי של התוכן : התוכן במערכת מאורגן במבנה היררכי בן שלוש רמות 

. הישות העליונה, המכילה מספר רכיבי תוכן **(Learning Unit)** – **יחידת תוכן** • . מקטע לימודי השייך ליחידת תוכן אחת ומכיל פריט תוכן אחד או יותר **(Component)** – **רכיב תוכן** • . יחידת התוכן הבסיסית, השייכת לרכיב תוכן אחד **(Item)** – **פריט תוכן** • 

**ירושת מטא־נתונים** 

המתייחסת לתוכן תכלול את מטא־הנתונים של הישות עליה מתייחס האירוע, וכן את מטא־הנתונים של כל xAPI כל הודעת . הישויות המכילות אותה בהיררכיית התוכן 

: כלומר 

. יכלול את מטא־הנתונים של הרכיב וכן את מטא־הנתונים של יחידת התוכן **רכיב תוכן** אירוע על • . יכלול את מטא־הנתונים של הפריט, של רכיב התוכן ושל יחידת התוכן **פריט תוכן** אירוע על • 

(LEARNING UNIT) מטא־נתונים של יחידת תוכן 

GROUPING 

context.contextActivities.grouping של יחידת התוכן ידווחו באמצעות name ו id השדות 

**דוגמה** 

<mark>`{ "objectType": "Activity", "id": "https://720.example.co.il/learning-unit/4587", "definition": { "type": "https://lxp.education.gov.il/xapi/moe/activities/learning-unit", "name": { "he": "` שברים פשוטים</mark> <mark>`" } } }`</mark> 

EXTENSIONS 

: context.extensions השדות הבאים ידווחו באמצעות 

## **תיאור extension** 

תת נושא subTopic 

רשימה סגורה של יעדי למידה learningObjective 

רשימה סגורה של המגזרים שאליהם מיועדת יחידת התוכן , יתקבל מערך targetSectors 

רשימה סגורה של האוכלוסיות שאליהן מיועדת יחידת התוכן targetAudience 

ים לפני יחידת התוכן . הרלוונטי ים הנדרשי הלמידה  יעד prerequisiteLearningObjective 

## **דוגמה** 

# <mark>`{`</mark> 

```
"https://lxp.education.gov.il/xapi/moe/extensions/subTopic": "fractions",
"https://lxp.education.gov.il/xapi/moe/extensions/learningObjective": "add-
fractions",
```

```
"https://lxp.education.gov.il/xapi/moe/extensions/targetSector": ["general"],
"https://lxp.education.gov.il/xapi/moe/extensions/targetAudience": "grade-6"",
"https://lxp.education.gov.il/xapi/moe/extensions/prerequisiteLearningObjective
": ["MOE.SCI.G7.CHEM.MAT-IMPACT.LIQUID.VISCOSITY", ["MOE.MATH.G7.ALG.VAR-
EXPR.VAR-BASICS.NOTATION"],
```

```
}
```

(COMPONENT) מטא־נתונים של רכיב תוכן 

GROUPING 

. context.contextActivities.grouping של רכיב התוכן ידווחו באמצעות name ו id השדות 

**דוגמה** 

```
{
```

```
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/component/1254",
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/component",
"name": {
```

<mark>`"he": "` תרגול שברים</mark> <mark>`" } } }`</mark> 

EXTENSIONS : context.extensions השדות הבאים ידווחו באמצעות 

**תיאור extension** מיומנויות skills ערך מתוך רשימה סגורה של מטרת הרכיב componentPurpose האם רכיב הוא רכיב הערכה isAssessment ספק התוכןקוד manufacturer מזהים של רכיבי תוכן מומלצים לאחר כישלון ברכיב תוכן זה recommendedAfterFail האם יש חובת ביצוע על רכיב התוכן isRequired מספר המייצג את רמת הקושי של רכיב התוכן ביחס לשאר רכיבי התוכן ביחידת relativeDifficulty התוכן ערך יחיד מתוך רשימה סגורה של רמות שליטה masteryLevel מיקום הרכיב בסדר יחידת התוכן. מספר נמוך אומר רכיב שיעבור קודם order 

רשימה סגורה של רמת רכיב התוכן ביחס לתכנית הלימודים depthLevel רשימה סגורה של רמת חשיבה לכל מקצוע cognitiveLevels רשימה סגורה של שפות התוכן languages זמן מוערך בדקות לביצוע רכיב התוכן estimatedTimeInMinutes 

## **דוגמה** 

```
{
```

<mark>`"https://lxp.education.gov.il/xapi/moe/extensions/skills":` ]</mark> <mark>`"problem-solving"` [</mark> <mark>`, "https://lxp.education.gov.il/xapi/moe/extensions/componentPurpose": "practice", "https://lxp.education.gov.il/xapi/moe/extensions/isAssessment": false, "https://lxp.education.gov.il/xapi/moe/extensions/manufacturer": 33,`</mark> 

<mark>`"https://lxp.education.gov.il/xapi/moe/extensions/recommendedAfterFail":` ]</mark> <mark>`"component_a"` [</mark> <mark>`, "https://lxp.education.gov.il/xapi/moe/extensions/isRequired": true, "https://lxp.education.gov.il/xapi/moe/extensions/relativeDifficulty": 3, "https://lxp.education.gov.il/xapi/moe/extensions/masteryLevel": "intermediate",`</mark> 

```
"https://lxp.education.gov.il/xapi/moe/extensions/order": 5,
"https://lxp.education.gov.il/xapi/moe/extensions/depthLevel": "medium",
"https://lxp.education.gov.il/xapi/moe/extensions/cognitiveLevels": ["apply"],
"https://lxp.education.gov.il/xapi/moe/extensions/languages": ["he"],
"https://lxp.education.gov.il/xapi/moe/extensions/estimatedTimeInMinutes": 15
}
```

(ITEM) מטא־נתונים של פריט תוכן 

GROUPING . context.contextActivities.grouping של פריט התוכן ידווחו באמצעות name ו id השדות 

**דוגמה** 

```
{
```

```
"objectType": "Activity",
"id": "https://720.example.co.il/item/9876",
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/video"
"name": {
```

<mark>`"he": "` סרטון פתיחה</mark> <mark>`" } } }`</mark> 

EXTENSIONS : context.extensions השדות הבאים ידווחו באמצעות 

**תיאור extension** 

תיאור מטרת הפריט: מה התלמיד אמור להבין / לתרגל, כיווני חשיבה או אסטרטגיות informationToBot שחשוב שהתלמיד יפעיל, טעויות נפוצות של תלמידים ומידע נוסף 

ערך יחיד מתוך רשימה סגורה של סוגי תוכן contentType מערך המציג פרטים על שאלות המופיעות בפריט התוכן questions 

## **תיאור extension** 

מזהה הרכיב המכיל את הפריט componentId 

## **דוגמה** 

# <mark>`{`</mark> 

```
"https://lxp.education.gov.il/xapi/moe/extensions/informationToBot": "…",
"https://lxp.education.gov.il/xapi/moe/extensions/contentType": "video",
"https://lxp.education.gov.il/xapi/moe/extensions/questions": ["…"],
"https://lxp.education.gov.il/xapi/moe/extensions/componentId": "…"
}
```

<mark>שיוך בהיררכיית התוכן</mark> 

: כל אירוע תוכן ישויך לישות המכילה אותו באמצעות 

context.contextActivities.parent 

. יהיה הישות הישירה המכילה את האובייקט עליו מדווח האירוע, בהתאם להיררכיית התוכן של ספק התוכן parent ערך ה־ 

: לדוגמה 

אותויחידת הלימוד המכיל ה  יהיה parent רכיב → ה־ • יהיה הרכיב המכיל אותו parent פריט → ה־ • . יהיה הישות הישירה המכילה אותה (לדוגמה שאלון או פריט אחר), בהתאם למבנה התוכן parent שאלה → ה־ • 

<mark>(COMPONENT) רכיב</mark> 

כללי 

. מייצג מקטע לימודי אחד בתהליך הלמידה (Component) רכיב . רכיב יכול להכיל פריט אחד או יותר, כגון סרטונים, שאלונים, משחקים, אנימציות או כל סוג תוכן אחר . אירועי רכיב מתעדים את תחילת ביצוע הרכיב ואת סיומו על-ידי התלמיד 

אירועים נתמכים 

**אירוע Verb** 

תלמיד התחיל רכיב initialized 

תלמיד סיים רכיב completed 

## **אירוע Verb** 

תלמיד דילג רכיב skipped 

OBJECT . ייצג את הרכיב object ה־ : דוגמה 

https://720.example.co.il/component/12345 https://720.example.co.il/component/my-first-component https://lxp.education.gov.il/xapi/moe/activities/component 

Activity: סוג ה־ INITIALIZED הודעת . אירוע זה נשלח כאשר התלמיד מתחיל לבצע את הרכיב : יישלחו **כל "לי אינטראקציה עם תוכן– "** בנוסף לשדות הכלליים המוגדרים בפרק Verb = initialized • component מסוג Object • 

## **דוגמה** 

<mark>`{ "verb": { "id": "https://lxp.education.gov.il/xapi/moe/verbs/initialized" }, "object": { "objectType": "Activity", "id": "https://720.example.co.il/component/12345", "definition": { "type": "https://lxp.education.gov.il/xapi/moe/activities/component", "name": { "he": "` תרגול שברים</mark> <mark>`" } } } }`</mark> 

COMPLETED הודעת 

. אירוע זה נשלח כאשר התלמיד סיים את ביצוע הרכיב : יישלחו **כללי " אינטראקציה עם תוכן– "** בנוסף לשדות הכלליים המוגדרים בפרק Verb = completed • component מסוג Object • 

: result ובשדה **שדה תיאור** 

success האם התלמיד השלים את הרכיב בהצלחה 

score.scaled )(כאשר רלוונטי ל־1 ציון מנורמל בין0 

duration ISO-8601 משך ביצוע הרכיב בפורמט 

## **דוגמה** 

<mark>`{ "verb": { "id": "https://lxp.education.gov.il/xapi/moe/verbs/completed" }, "object": { "objectType": "Activity", "id": "https://720.example.co.il/component/12345", "definition": { "type": "https://lxp.education.gov.il/xapi/moe/activities/component", "name": { "he": "` תרגול שברים</mark> <mark>`" } } }, "result": { "success": true, "score": { "scaled": 0.92 }, "duration": "PT12M34S" } }`</mark> 

**הערה** 

אירועי רכיב מתייחסים לביצוע הרכיב כולו. אירועים המתייחסים לפריטים (כגון שאלון, סרטון או משחק) ידווחו בנפרד בהתאם . לסוג הפריט, ואינם מחליפים את אירועי הרכיב 

SKIPPED הודעת 

אירוע זה נשלח כאשר המשתמש בחר שלא לבצע רכיב מסוים ודילג לרכיב הבא אם קיימת אפשרות כזו בפלטפורמה . 

: יישלחו **כללי " אינטראקציה עם תוכן– "** בנוסף לשדות הכלליים המוגדרים בפרק Verb = skipped • component מסוג Object • 

**רכיב : לדילוגדוגמת הודעה** 

<mark>`{ "id": "5c1a2d17-6b4f-4a6c-98f7-71d15c770001", "actor": { "objectType": "Agent", "account": { "homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier", "name": "1012345678" } }, "verb": { "id": "https://lxp.education.gov.il/xapi/moe/verbs/skipped" }, "object": { "objectType": "Activity", "id": "https://720.example.co.il/component/12345", "definition": { "type": "https://lxp.education.gov.il/xapi/moe/activities/component", "name": { "he": "` תרגול שברים</mark> <mark>`" } } }, "context": { "contextActivities": { "parent": { "objectType": "Activity", "id": "https://720.example.co.il/learning-unit/4587", "definition": { "type": "https://lxp.education.gov.il/xapi/moe/activities/learningunit", "name": { "he": "` שברים פשוטים</mark> <mark>`"`</mark> 

```
             }
           }
       }
    },
"extensions": {
//all metadata
    }
  },
"timestamp": "2026-01-15T08:30:00Z"
}
```

<mark>פריט</mark> 

הוא יחידת תוכן בודדת המרכיבה רכיב לימודי. רכיב עשוי להכיל פריט אחד או יותר, כאשר כל פריט מייצג סוג (Item) פריט ייעודיים המתארים את האינטראקציה של xAPI תוכן מסוים, כגון שאלון, שאלה או מדיה. לכל סוג פריט מוגדרים אירועי . התלמיד עם אותו פריט 

:סוגי פריטים לדוגמא 

שאלון • שאלה • מדיה • בקשת עזרה • בחירה שאינה לימודית • 

|שאלון|
|---|



כללי 

רק אם מתקבל תוכן בפורמט שאלון מספק התוכן . יש להתייחס לכל הפרק . questionnaire מסוג Activity שאלון מיוצג כ- 

אירועים נתמכים 

## **אירוע Verb** 

תחילת מענה על שאלון initialized 

סיום שאלון completed 

<mark>INITIALIZED תחילת מענה על שאלון  -</mark> 

אירוע זה נשלח כאשר המשתמש מתחיל לענות על שאלו ן **דוגמת הודעה** 

```
{
```

```
"id": "5c1a2d17-6b4f-4a6c-98f7-71d15c770001",
```

```
"actor": {
```

```
"objectType": "Agent",
"account": {
```

```
"homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
"name": "1012345678"
"verb": {
"id": "https://lxp.education.gov.il/xapi/moe/verbs/initialized"
"object": {
"objectType": "Activity",
"id": "https://720.example.co.il/questionnaire/first-questionnaire",
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/questionnaire",
"name": {
```

<mark>`"he": "` שאלון ראשון</mark> <mark>`" "context": { "contextActivities": { "parent": {`</mark> 

```
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/component/987",
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/component"
        }
      }
    },
"extensions": {
//all metadata
    }
  },
"timestamp": "2026-01-15T08:30:00Z"
}
```

<mark>COMPLETED סיום שאלון  -</mark> 

.אירוע זה נשלח לאחר שהמשתמש השלים את המענה על שאלון 

. result.duration משך מילוי השאלון ידווח באמצעות 

**דוגמת הודעה** 

```
{
```

```
"id": "5c1a2d17-6b4f-4a6c-98f7-71d15c770001",
```

```
"actor": {
```

```
"objectType": "Agent",
```

```
"account": {
```

```
"homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
"name": "1012345678"
```

```
"verb": {
"id": "https://lxp.education.gov.il/xapi/moe/verbs/completed"
```

```
"object": {
```

```
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/questionnaire/first-questionnaire",
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/questionnaire",
"name": {
```

<mark>`"he": "` שאלון ראשון</mark> <mark>`"`</mark> 

```
"result": {
"score": {
```

```
"min": 0,
```

```
"max": 100,
```

```
"raw": 95,
```

```
"scale": 0.95
```

```
"duration": "PT4M18S"
"context": {
```

```
"contextActivities": {
```

```
"parent": {
```

```
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/component/987",
```

```
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/component"
        }
```

```
"extensions": {
```

```
      //all metadata
```

```
  },
"timestamp": "2026-01-15T08:30:00Z"
}
```

<mark>שאלה</mark> 

כללי 

. אירוע זה נשלח כאשר תלמיד עונה על שאלה המהווה חלק מפריט תוכן . שאלה עליה ענה התלמיד של ההודעה יהיה ה object ה 

context.contextActivities.parent הרכיב המכיל את השאלה (לדוגמה שאלון, תרגול או משחק) ידווח באמצעות 

אירועים נתמכים 

## **אירוע Verb** 

תלמיד ענה על שאלה answered 

OBJECT 

. )יזהה את הפריט (השאלה -object ה 

: לדוגמה 

https://720.example.co.il/item/question/12345 

: יהיה -Activity סוג ה 

https://lxp.education.gov.il/xapi/moe/activities/question 

PARENT 

. כל שאלה תשויך לרכיב המכיל אותה 

: לדוגמה 

```
"context": {
```

```
"contextActivities": {
"parent": [
        {
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/component/987",
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/component"
          }
        }
```

```
      ]
    }
  }
```

. לישות המכילה אותה באופן ישיר context.contextActivities.parent כל שאלה תשויך באמצעות . יהיה הישות הקרובה ביותר בהיררכיה, בהתאם למבנה התוכן של ספק התוכן Parent ה־ : לדוגמא שאלון • פריט המכיל מספר שאלות • רכיב • כל ישות אחרת המהווה את המיכל הישיר של השאלה • : לדוגמה 

```
"context": {
"contextActivities": {
"parent": [
      {
"objectType": "Activity",
"id": "https://720.example.co.il/item/questionnaire/987",
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/item
        }
      }
    ]
  }
}
```

או 

```
"context": {
```

```
"contextActivities": {
"parent": [
```

```
      {
```

```
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/component/123",
```

```
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/component
        }
```

```
      }
    ]
  }
}
```

יכול Parent המכיל את השאלה. עם זאת, במבני תוכן אחרים ה־ , **פריט מסוג שאלון** יהיה Parent ברוב המקרים ה־ **: הערה** יהיה תמיד רכיב או תמיד פריט. המבנה נקבע בהתאם Parent המכילה את השאלה. אין חובה שה־ להיות כל ישות אחרת . להיררכיית התוכן של ספק התוכן 

מידע נוסף 

. יש לכלול את המאפיינים הייחודיים לשאלה בנוסף למידע הכללי הנשלח בכל הודעה 

## **Extension תיאור** 

questionId מזהה פנימי של השאלה בפריט 

questionType (multiple-choice, true-false, fill-in) סוג השאלה 

attemptNumber מספר הניסיון למענה על השאלה 

תוצאת המענה : תומך בשני סוגי תשובות answered אירוע **תשובה פתוחה** 

"result": { 

"response": " התשובה שהזין התלמיד " 

} 

## **תשובה סגורה / בחירה / דירוג** 

כאשר -result.response, כאשר התשובה היא ערך מובנה (לדוגמה בחירה, נכון/לא נכון או דירוג), ניתן גם להשתמש ב . הערך יהיה הקוד או הערך שנבחר : בנוסף ניתן לדווח על תוצאת הבדיקה 

"result": { 

"response": "B", "success": true, "score": { "scaled": 1 } } 

: כאשר 

. - התשובה שסיפק התלמיד response • . האם התשובה נכונה - success • . 1 ל- ציון מנורמל בין0 - score.scaled • 

<mark>ANSWERED מענה על שאלה -</mark> 

```
{
"verb": {
"id": "https://lxp.education.gov.il/xapi/moe/verbs/answered"
  },
```

<mark>`"object": { "objectType": "Activity", "id": "https://720.example.co.il/item/question/12345", "definition": { "type": "https://lxp.education.gov.il/xapi/moe/activities/item", "name": { "he": "` שאלה3</mark> <mark>`" }`</mark> 

```
    }
  },
```

```
"result": {
"response": "B"
"success": true
"score": {
"scaled": 1,
```

```
"min": 0,
"max": 1,
"raw": 1,
    }
  },
```

```
"context": {
"contextActivities": {
```

```
"parent": [
```

```
        {
```

```
"objectType": "Activity",
```

```
"id": "https://720.example.co.il/component/987",
"definition": {
"type": "
```

```
https://lxp.education.gov.il/xapi/moe/activities/component",
          }
```

```
        }
```

```
      ]
```

```
    },
"extensions": {
```

```
"https://lxp.education.gov.il/xapi/moe/extensions/questionId": "3",
```

```
"https://lxp.education.gov.il/xapi/moe/extensions/questionType": "multiple-
choice",
"https://lxp.education.gov.il/xapi/moe/extensions/attemptNumber": 1
    }
```

```
  }
```

|`}`|
|---|



<mark>מדיה</mark> כללי . יש לדווח על אינטראקציות של תלמיד עם פריטי מדיה, כגון סרטונים, קטעי שמע ואנימציות אירועים נתמכים **אירוע Verb** התחלת צפייה במדיה played השהיית צפייה paused סיום צפייה completed 

OBJECT . מייצג את פריט המדיה object ה : לדוגמה https://720.example.co.il/item/video/12345 . יהיה בהתאם לסוג המדיה Activity סוג ה : לדוגמה https://lxp.education.gov.il/xapi/moe/activities/video PARENT : פריט המדיה ישויך לישות המכילה אותו באמצעות context.contextActivities.parent . יהיה הישות הישירה המכילה את המדיה, בהתאם להיררכיית התוכן של ספק התוכן Parent ה מידע ייעודי למדיה . יש לצרף את המאפיינים הבאים 

**שדה xAPI מיקום ב** 

media-format context.extensions.mediaFormat 

media-position context.extensions.mediaPosition 

|MEDIA FORMAT<br>סוג המדיה.<br>ערכים לדוגמה:<br>•<br>video<br>•<br>audio|
|---|
|•<br>animation|
|MEDIA POSITION|
|המיקום במדיה, בשניות.|
|באירועplayed<br>הוא מציין את נקודת ההתחלה.|
|באירועpaused<br>הוא מציין את נקודת העצירה.|
|WATCH DURATION|
|משך זמן הצפייה בפועל.|
|יישלח באמצעות:|
|"result": {<br>"duration": "PT2M35S"<br>}|
|התחלת צפייה  -<br>PLAYED|
|**דוגמת הודעה**<br>|
|`{`<br> `"verb": {`<br> `"id": "https://lxp.education.gov.il/xapi/moe/verbs/played"`<br>`},`<br> `"object": {`<br> `"id": "https://720.example.co.il/item/video/12345", `|
|`"definition": {`<br> `"type": "https://lxp.education.gov.il/xapi/moe/activities/video"`<br>`}`|



```
"context": {
"extensions": {
```

```
"https://lxp.education.gov.il/xapi/moe/extensions/mediaFormat": "video",
"https://lxp.education.gov.il/xapi/moe/extensions/mediaPosition": 0
    }
  }
}
```

## <mark>PAUSED השהיית צפייה  -</mark> 

## **דוגמת הודעה** 

```
{
"verb": {
```

```
"id": "https://lxp.education.gov.il/xapi/moe/verbs/paused"
```

```
"object": {
"id": "https://720.example.co.il/item/video/12345",
"definition": {
```

```
"type": "https://lxp.education.gov.il/xapi/moe/activities/video"
```

```
"context": {
"extensions": {
```

```
"https://lxp.education.gov.il/xapi/moe/extensions/mediaFormat": "video",
```

<mark>`"https://lxp.education.gov.il/xapi/moe/extensions/mediaPosition": 105 } }, "result": { "duration": "PT` 0</mark> <mark>`M25S" } }`</mark> 

<mark>COMPLETED סיום צפייה  -</mark> 

עובר אוטומטית לרכיב הבא או מסמן שסיים המשתמש  ארוע סיום צפיה ישלח ע"י הפלטפורמה כאשר 

**דוגמת הודעה** 

```
{
```

```
"verb": {
```

```
"id": "https://lxp.education.gov.il/xapi/moe/verbs/completed"
"object": {
"id": "https://720.example.co.il/item/video/12345",
```

```
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/video"
    }
  },
"result": {
"duration": "PT2M0S"
  },
"context": {
"extensions": {
"https://lxp.education.gov.il/xapi/moe/extensions/mediaFormat": "video",
"https://lxp.education.gov.il/xapi/moe/extensions/mediaPosition": 120
    }
  }
}
```

<mark>בקשת עזרה</mark> 

כללי 

. אירוע זה נשלח כאשר תלמיד מבקש עזרה במהלך ביצוע פעילות לימודית 

. בקשת העזרה יכולה להתייחס לרכיב או לפריט, בהתאם לישות ממנה ביקש התלמיד את העזרה 

.לדוגמא לחיצה על לחצן "רמז" בתוך פריט 

אירועים נתמכים 

**אירוע Verb** 

תלמיד ביקש עזרה requested 

OBJECT . יהיה הישות ממנה התלמיד ביקש את העזרה object ה 

: הישות יכולה להיות 

Component • )(שאלון שאלה וכו Item • 

: לדוגמה 

https://720.example.co.il/component/12345 

או 

https://720.example.co.il/item/98765 

: סוג הישות יזוהה באמצעות 

object.definition.type 

PARENT 

לשייך את ההודעה לישות המכילה את השאלה באמצעותיש  ,כאשר בקשת העזרה מתבצעת מתוך שאלה ". בהתאם לעקרונות שהוגדרו בפרק "תלמיד ענה על שאלה context.contextActivities.parent 

מידע ייעודי לבקשת עזרה context.extensions יש לצרף את המאפיינים הבאים באמצעות 

## **Extension תיאור** 

helpSource מקור העזרה 

helpType סוג העזרה שהתבקשה 

HELP SOURCE 

. מזהה את מקור העזרה : ערכים לדוגמה content • platform • HELP TYPE . מזהה את סוג העזרה שהתלמיד ביקש : ערכים לדוגמה hint • explanation • 

REQUESTED דוגמת הודעה  - 

```
{
```

```
"id": "c4d10d81-7a59-43e8-a0d0-000000000001",
"actor": {
"objectType": "Agent",
"account": {
"homePage": "https://lxp.education.gov.il/xapi/moe/identity/exidentifier",
```

```
"name": "1012345678"
    }
  },
"verb": {
"id": "https://lxp.education.gov.il/xapi/moe/verbs/requested"
  },
"object": {
"objectType": "Activity",
"id": "https://720.example.co.il/component/987",
"definition": {
"type": "https://lxp.education.gov.il/xapi/moe/activities/component"
    }
  },
"context": {
"extensions": {
"https://lxp.education.gov.il/xapi/moe/extensions/helpSource": "content",
"https://lxp.education.gov.il/xapi/moe/extensions/helpType": "hint"
    }
  },
"timestamp": "2026-01-15T09:18:25Z"
}
```

<mark>SELECTED בחירה שאינה לימודית  -</mark> 

אירוע זה מתעד בחירה שביצע התלמיד במהלך השימוש במערכת, כאשר הבחירה אינה מהווה חלק מהפעילות הלימודית . ואינה מייצגת מענה על שאלה ארוע זה אופציונלי במידה והפלטפורמה מאפשרת למשתמש בחירה שאיננה לימודית למשל: בחירת תחומי עניין 

:במקרה הזה יהיה verb ה 

https://lxp.education.gov.il/xapi/moe/verbs/selected 

. של ההודעה יהיה הישות עליה בוצעה הבחירה (רכיב או פריט), בהתאם להיררכיית התוכן object ה־ **אינטראקציה עם "** בנוסף, ההודעה תכלול את כלל התיוגים הפדגוגיים ומטא־נתוני התוכן של אותו אובייקט, בהתאם לפרק **"** . **כללי תוכן–** : בנוסף לשדות הכלליים, ההודעה תכלול 

CONTEXT.EXTENSIONS 

**Extension תיאור** 

selectionType . סוג הבחירה שביצע התלמיד 

: הערכים הנתמכים 

## **result.response הערך ב־ משמעות selectionType** 

אחד מהערכים ברשימת סוגי התוכן בחירת סוג תוכן מתוך רשימת סוגי התוכן learning-type 

true / false החלטה האם לבצע תרגול נוסף practice-decision true / false תשובת התלמיד האם הבין את החומר is-understood 

true / false החלטת התלמיד האם לחזור לצפייה בתוכן is-repeat 

true / false החלטת התלמיד לצאת ללמידה עצמאית מחוץ למערכת external-learning 

RESULT.RESPONSE . יכיל את הערך שנבחר על-ידי התלמיד result.response השדה 

: דוגמאות 

"true" • "false" • "practice" • "instruction" • 

**הערך שנבחר** המתאר מה נשאל או הוצג לתלמיד, לבין (selection-type), **סוג הבחירה** כך נשמרת ההבחנה בין . המתאר את הבחירה שביצע בפועל (result.response) 

<mark>קודי תגובה ומנגנון שליחה חוזרת  נספ ח -</mark> 

**קודי תגובה ומנגנון שליחה חוזרת נספח–** 

וכן את אופן הטיפול הנדרש במקרה , xAPI בעת שליחת הודעות LRS נספח זה מפרט את קודי התגובה הצפויים משירות ה־ . של שגיאה או כשל זמני 

**קודי תגובה** 

**קוד התנהגות תרחיש תגובה** . ההודעה התקבלה ונקלטה בהצלחה **204** שליחת הודעה בודדת תקינה . כלל ההודעות באצווה התקבלו ונקלטו בהצלחה **200** תקינה (Batch) שליחת אצווה 

הודעה לא תקינה, או אצווה הכוללת לפחות הודעה אחת שאינה תקינה : . מוחזר פירוט השגיאה לצורך איתור התקלה ותיקונה **400 סביבת טסט** . פרטי השגיאה ממוסכים מטעמי אבטחת מידע **500 סביבת פרודקשן** כפול : ID אצווה עם ) request with duplicate  ids… תתקבל סיבת השגיאה ( **400 סביבת טסט** . פרטי השגיאה ממוסכים מטעמי אבטחת מידע **500 פרודקשן  סביבת** שכבר התקבל בעבר עם Statement הבקשה מתקבלת, אך **200 /** אצווה ) (לא באותוהודעה כפולה . לא יעובד בשנית (id) אותו מזהה **204** בפרט כאשר , **הודעות עד100** מומלץ לשלוח אצוות הכוללות **500** אצווה גדולה מהמותר . מדובר בהודעות בעלות תוכן רב (Authentication / שגיאת אימות או הרשאה . הבקשה נדחית עקב כשל בתהליך האימות או ההרשאה **403** Authorization) במבנה לא JSON בקשה שאינה תקינה, לדוגמה . הבקשה אינה ניתנת לעיבוד **500** תקין . אירעה תקלה זמנית, או שהשירות אינו זמין **500** תחזוקה או תקלה בצד השרת , Timeout, עומס 

**האצווה כולה** , במקרה של שליחת אצווה הכוללת לפחות הודעה אחת שאינה תקינה **עקרון האטומיות של האצוו:ה** • . אף אחת מההודעות הכלולות באצווה לא תיקלט במערכת, לרבות הודעות תקינות **נדחי .ת** 

, message בסביבת הטסט, במקרים המתאימים, תשובת השגיאה כוללת גם שדה **: פירוט שגיאות בסביבת הטסט** • מידע זה נועד לסייע לספק באיתור . Timeout או JSON המפרט את סוג השגיאה, לדוגמה שגיאה במבנה ה־ . תקלות ובתיקונן במהלך תהליך האינטגרציה 

(RETRY) מנגנון שליחה חוזרת 

. לצורך התמודדות עם תקלות זמניות בשירות (Retry) יש לממש מנגנון שליחה חוזרת 

,הכולל מספר מוגבל של ניסיונות חוזרים והשהיה בין ניסיון לניסיון. כך, במקרה של תקלה זמנית Retry מומלץ לממש מנגנון . ניתן יהיה להשלים את השליחה לאחר שהשירות יחזור לפעילות תקינה 

במקביל יש לתעד את ההודעות כך שיהיה אפשר לשלוח כאשר התקלה תתוקן . 

