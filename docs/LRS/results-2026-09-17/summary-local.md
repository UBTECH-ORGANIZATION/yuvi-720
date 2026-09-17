# דוח תסריט הבדיקות xAPI — 2026-09-17 · local

- הצהרות בחלון הריצה: **125**, נשלחו בהצלחה: **125**
- שורות: עבר **24**, לא עבר **17**, לא נבדק **13**, לא רלוונטי **8**
- חשבונות: תלמיד `1020000001`, מורה `1020000002`, NMM `90635956`
- חלון: 2026-09-17T13:55:00.136Z → 2026-09-17T15:52:15.818Z

## שורות שלא עברו / לא נבדקו
- TC-CMP-01 (initialized): לא עבר — initialized לרכיב חסר מטא-נתונים או parent.
- TC-ITM-01 (initialized): לא עבר — שאלון פנימי אותחל אך חסרים מטא-נתוני פריט.
- TC-ITM-02 (answered): לא עבר — לא נמצאה תשובה תקינה לשאלה בתוכן.
- TC-CMP-02 (completed): לא עבר — לא נמצא completed לרכיב.
- TC-ITM-05 (played): לא עבר — לא נמצא played על פריט מדיה.
- TC-ITM-06 (paused): לא עבר — לא נמצא paused על פריט מדיה.
- TC-ITM-07 (completed): לא עבר — לא נמצא completed על פריט מדיה.
- TC-ITM-08 (requested): לא נבדק — בריצה זו לא נלחץ כפתור העזרה שבתוך הלומדה.
- TC-ITM-09 (requested): לא עבר — לא נמצאה בקשת עזרה תקינה מהפלטפורמה.
- TC-ITM-09 (selected): לא עבר — לא נמצא selected עם selectionType מהרשימה.
- TC-ITM-10 (completed): לא נבדק — בריצה זו לא הושלם רכיב הערכה עם success=true.
- TC-ITM-11 (completed): לא נבדק — בריצה זו לא הושלם רכיב הערכה עם success=false.
- TC-CNV-01 (interacted): לא עבר — פניית תלמיד חסרה שדות חובה.
- TC-CNV-02 (interacted): לא נבדק — בריצה זו לא התרחשה פנייה יזומה מסוג ['student-error'].
- TC-CNV-02 (interacted): לא נבדק — בריצה זו לא התרחשה פנייה יזומה מסוג ['idle-time'].
- TC-CNV-02 (interacted): לא נבדק — בריצה זו לא התרחשה פנייה יזומה מסוג ['other', 'success-effort'].
- TC-CNV-02 (rated): לא עבר — דירוג ללא response/conversationType.
- TC-CNV-03 (interacted): לא נבדק — בריצה זו התלמיד לא הגיב לפנייה יזומה.
- TC-CNV-04 (interacted): לא עבר — לא נמצאה תשובת בוט לפניית תלמיד.
- TC-REF-01 (initialized): לא עבר — רפלקציה: initialized חסר שדות.
- TC-REF-02 (answered): לא עבר — רפלקציה: answered חסר שדות.
- TC-REF-03 (skipped): לא עבר — רפלקציה: skipped חסר שדות.
- TC-REF-04 (completed): לא עבר — רפלקציה: completed חסר שדות.
- TC-ITM-03 (completed): לא עבר — שאלון פנימי הושלם ללא score/duration.
- row-55 (Initiated + no Complete): לא נבדק — לא נמצא אובייקט תוכן שאותחל ולא הושלם.
- row-56 (Initialized+ יציאה מהמשימה + second Initialized): לא נבדק — לא נמצא אתחול חוזר של אותו אובייקט.
- row-57 (Initialized + Answered + Completed + Success = False + initialized + Answered + Completed + Success = True): לא נבדק — לא נמצא רצף ניסיונות מתאים על אותה שאלה.
- row-58 (Initialized + Answered + Completed + Success = False + initialized + Answered + Completed + Success = False): לא נבדק — לא נמצא רצף ניסיונות מתאים על אותה שאלה.
- row-59 (Sesssion 1 + Initialize+ no Complete + Logout + Login + Initialize): לא נבדק — לא נמצא רצף חזרה בין סשנים לאותו אובייקט.
- row-61 (Initialized + requested + answered + completed): לא נבדק — לא נמצאה בקשת עזרה במהלך משימה.

## אינדקס החוזה ללא ראיה
- component:initialized
- component:completed
- conversation:interacted
- conversation:rated
- questionnaire (reflection):initialized
- question (reflection):answered
- question (reflection):skipped
- questionnaire (reflection):completed
- questionnaire:initialized
- questionnaire:completed
- question:answered
- video / audio / animation (media):played
- video / audio / animation (media):paused
- video / audio / animation (media):completed
- component / item:requested
