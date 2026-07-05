// @ts-nocheck
/* eslint-disable */

export function initTeacherView() {
    // ============================================================
    //  MOCK DATA  (demo only)
    // ============================================================
    const TEACHER = { name: 'מיכל דוד', first: 'מיכל', role: 'מורה למתמטיקה', avatar: 'מ' };

    const SUBJECT_OPTIONS = ['מתמטיקה'];

    // soft status meta
    const REASON_META = {
        inactivity:    { label: 'אי-ביצוע פעילות',              cls: 'attn', pill: 'דחיפות גבוהה' },
        low_success:   { label: 'ירידה בהצלחה במשימות עוקבות',  cls: 'warm', pill: 'דחיפות בינונית' },
        knowledge_gap: { label: 'קושי חוזר בפריט ידע',          cls: 'warm', pill: 'דחיפות בינונית' },
        manual:        { label: 'סומן ידנית ע״י המורה',          cls: 'info', pill: 'סימון מורה' },
    };
    const STATUS_META = {
        requires_attention: { label: 'דורש תשומת לב', ico: '⚠️', bg: 'var(--attn-bg)', ink: 'var(--attn-ink)' },
        reinforce:          { label: 'מומלץ לחיזוק',  ico: '🌱', bg: 'var(--warm-bg)', ink: 'var(--warm-ink)' },
        on_track:           { label: 'תקין',           ico: '✅', bg: 'var(--good-bg)', ink: 'var(--good-ink)' },
        progressing:        { label: 'מתקדם/ת היטב',   ico: '🚀', bg: 'var(--info-bg)', ink: 'var(--info-ink)' },
    };
    const GAP_LEVEL = {
        high: { label: 'קושי גבוה',  cls: 'attn', col: 'var(--attn-ink)', bg: 'var(--attn-bg)' },
        mid:  { label: 'קושי בינוני', cls: 'warm', col: 'var(--warm-ink)', bg: 'var(--warm-bg)' },
        low:  { label: 'כמעט נשלט',   cls: 'good', col: 'var(--good-ink)', bg: 'var(--good-bg)' },
    };
    const REC_META = {
        reinforcement: { type: 'חיזוק',     ico: '💪', bg: 'var(--good-bg)', col: 'var(--good-ink)' },
        practice:      { type: 'תרגול נוסף', ico: '✍️', bg: 'var(--info-bg)', col: 'var(--info-ink)' },
        deepening:     { type: 'העמקה',     ico: '🔍', bg: '#efeaff',          col: 'var(--purple)' },
        enrichment:    { type: 'העשרה',     ico: '⭐', bg: 'var(--warm-bg)', col: 'var(--warm-ink)' },
        personal_talk: { type: 'שיחה אישית', ico: '💬', bg: 'var(--info-bg)', col: 'var(--info-ink)' },
        intervention:  { type: 'התערבות חינוכית', ico: '🧭', bg: 'var(--attn-bg)', col: 'var(--attn-ink)' },
    };
    const INSIGHT_META = {
        strength:  { ico: '💚', label: 'חוזקה',         tag: 'var(--good-bg)',  col: 'var(--good-ink)' },
        challenge: { ico: '🌱', label: 'אתגר / לחיזוק', tag: 'var(--warm-bg)',  col: 'var(--warm-ink)' },
        interest:  { ico: '⭐', label: 'תחום עניין',     tag: '#efeaff',          col: 'var(--purple)' },
        note:      { ico: '📝', label: 'הערה פדגוגית',   tag: 'var(--line-soft)', col: 'var(--ink-500)' },
    };
    const AVA_COLORS = ['#e87fb0','#7c5cff','#4cb3d4','#e0a64e','#56b87f','#9f7afe','#d97aa6'];
    function avaColor(seed){ let h=0; for(const c of seed) h=(h*31+c.charCodeAt(0))>>>0; return AVA_COLORS[h%AVA_COLORS.length]; }

    // students keyed by id
    const STUDENTS = {
        ron: {
            name: 'רון לוי', avatar: 'ר', grade: 'כיתה ח׳1', status: 'requires_attention',
            engagement: 20, avgMin: 9, tasksWeek: 1, lastActive: '04.06.2026',
            reasonType: 'inactivity',
            reasonSub: 'לא נכנס/ה למערכת 7 ימים',
            recommendation: 'מומלץ לבדוק חסם רגשי או טכני, או לשלוח תזכורת אישית חמה.',
            aiExplain: ['לא ביצע/ה פעילות במשך 7 ימים רצופים', 'המשימה האחרונה שהושלמה הייתה ב-04.06.2026', 'לפני כן נצפתה ירידה הדרגתית בזמן הפעילות'],
            aiSummary: {
                text: 'רון בעצירה זמנית — <b>7 ימים ללא פעילות</b>, וההתקדמות ירדה ל-48% (יעד 75%). הקושי המרכזי הוא «משוואות מילוליות» (20% הצלחה). זו ככל הנראה עצירה מוטיבציונית/טכנית ולא חוסר יכולת — הוא מגיב מצוין בקבוצות קטנות ובדוגמאות מהחיים. הצעד הראשון שלך: ליצור איתו קשר חם ולהחזיר אותו לפעילות.',
                actions: [
                    { ico: '💌', label: 'שליחת תזכורת אישית חמה', toast: ['נשלחה תזכורת אישית 💌', 'לרון לוי'] },
                    { ico: '✍️', label: 'תרגול ממוקד 10 דק׳ ביום ב«משוואות מילוליות»', toast: ['התרגול נשלח ✓', 'משוואות מילוליות · 10 דק׳ ליום'] },
                    { ico: '💬', label: 'קביעת שיחת בדיקה קצרה השבוע', toast: ['השיחה נקבעה 💬', 'שיחת בדיקה עם רון'] },
                ],
            },
            progress: [{ subject: 'מתמטיקה', value: 48, goal: 75, trend: 'down' }],
            gaps: [
                { title: 'משוואות מילוליות', level: 'high', rate: 20, tasks: 4, pattern: 'קושי בתרגום טקסט למשוואה מתמטית' },
                { title: 'פישוט ביטויים אלגבריים', level: 'mid', rate: 45, tasks: 3, pattern: 'זיהוי משתנה ופעולה חשבונית' },
                { title: 'פתרון משוואות ליניאריות', level: 'low', rate: 80, tasks: 2, pattern: 'שמירה על איזון בין האגפים' },
            ],
            recs: [
                { type: 'reinforcement', text: 'תרגול נוסף בנושא משוואות מילוליות', target: 'רון לוי', why: 'זוהו טעויות חוזרות בפריט ידע זה (20% הצלחה ב-4 משימות עוקבות).', action: 'שליחת סדרת תרגול ממוקדת של 10 דק׳ ליום' },
                { type: 'deepening', text: 'שימוש בדוגמאות מהחיים לתרגום בעיות', target: 'רון לוי', why: 'דפוס הקושי הוא תרגום טקסט למשוואה — הקשר יומיומי מקל על ההבנה.', action: 'הצגת 3 דוגמאות יומיומיות לפני המשימה הבאה' },
                { type: 'personal_talk', text: 'שיחת בדיקה קצרה על אי-הפעילות', target: 'רון לוי', why: 'אי-כניסה למערכת 7 ימים רצופים — כדאי לוודא שהכול תקין.', action: 'יצירת קשר אישי השבוע' },
            ],
            insights: [
                { type: 'note', text: 'רון מתחבר/ת טוב לעבודה בקבוצות קטנות. כדאי לשלב אותו במשימה קבוצתית.', subject: 'מתמטיקה', date: '04.06.2026' },
                { type: 'strength', text: 'מצא/ה מוטיבציה גבוהה בשיעורים פרקטיים. לשלב יותר דוגמאות מהחיים.', subject: 'מתמטיקה', date: '01.06.2026' },
            ],
        },
        noam: {
            name: 'נועם כהן', avatar: 'נ', grade: 'כיתה ח׳1', status: 'requires_attention',
            engagement: 45, avgMin: 14, tasksWeek: 4, lastActive: '04.06.2026',
            reasonType: 'low_success',
            reasonSub: '45% הצלחה ב-4 משימות עוקבות',
            recommendation: 'מומלץ לתת תרגול חיזוק ממוקד בנושא שבו זוהתה הירידה.',
            aiExplain: ['שיעור ההצלחה ירד ל-45% ב-4 המשימות האחרונות', 'הירידה מרוכזת בנושא פישוט ביטויים אלגבריים', 'זמן הפעילות נשמר תקין — מדובר בקושי תוכני, לא במוטיבציה'],
            aiSummary: {
                text: 'נועם מתמיד ולא נוטש משימות, אך שיעור ההצלחה ירד ל-<b>45%</b> ב-4 משימות עוקבות — קושי תוכני (לא מוטיבציוני) בנושא «פישוט ביטויים אלגבריים». זמן הפעילות תקין, כך שאם תשלחי לו תרגול חיזוק ממוקד הוא צפוי לחזור למסלול במהירות.',
                actions: [
                    { ico: '✍️', label: 'שליחת סדרת 5 תרגילים מדורגים', toast: ['התרגול נשלח ✓', 'נועם כהן · 5 תרגילים מדורגים'] },
                    { ico: '🎯', label: 'שילוב דוגמאות יומיומיות לזיהוי משתנה', toast: ['נוסף למשימה הבאה 🎯', 'דוגמאות יומיומיות'] },
                ],
            },
            progress: [{ subject: 'מתמטיקה', value: 58, goal: 75, trend: 'steady' }],
            gaps: [
                { title: 'פישוט ביטויים אלגבריים', level: 'high', rate: 45, tasks: 4, pattern: 'זיהוי משתנה ופעולה חשבונית' },
                { title: 'משוואות מילוליות', level: 'mid', rate: 55, tasks: 3, pattern: 'תרגום טקסט למשוואה' },
            ],
            recs: [
                { type: 'reinforcement', text: 'תרגול חיזוק בפישוט ביטויים אלגבריים', target: 'נועם כהן', why: 'ירידה ל-45% הצלחה ב-4 משימות עוקבות באותו נושא.', action: 'סדרת 5 תרגילים מדורגים מהקל לקשה' },
                { type: 'practice', text: 'תרגול קצר עם דוגמאות יומיומיות', target: 'נועם כהן', why: 'חיזוק זיהוי המשתנה והפעולה דרך הקשר מוכר.', action: 'משחק התאמה קצר של ביטוי לערך' },
            ],
            insights: [
                { type: 'strength', text: 'נועם מתמיד/ה ולא נוטש/ת משימות גם כשהן מאתגרות.', subject: 'מתמטיקה', date: '02.06.2026' },
            ],
        },
        shahar: {
            name: 'שחר ישראלי', avatar: 'ש', grade: 'כיתה ח׳1', status: 'requires_attention',
            engagement: 18, avgMin: 11, tasksWeek: 2, lastActive: '03.06.2026',
            reasonType: 'knowledge_gap',
            reasonSub: '3 טעויות חוזרות בנושא שברים',
            recommendation: 'מומלץ הסבר חוזר על המושג ולאחריו תרגול קצר וממוקד.',
            aiExplain: ['אותה שגיאה חזרה ב-3 משימות שונות בנושא שברים', 'הקושי ממוקד בהמרת שבר לאחוז', 'שאר הנושאים נשלטים היטב — מדובר בקושי נקודתי'],
            aiSummary: {
                text: 'שחר שולט ברוב החומר, אך אותה שגיאה חוזרת ב-<b>3 משימות</b> בנושא «המרת שברים לאחוזים» (בלבול בין מונה למכנה). מדובר בקושי נקודתי — אם תיתני לו הסבר חוזר קצר וממוקד הוא צפוי להיפתר, ובמקביל תוכלי להציע לו אתגר בנושאים שכבר נשלטים.',
                actions: [
                    { ico: '🎬', label: 'שליחת סרטון קצר + 3 תרגילים מודרכים', toast: ['נשלח ✓', 'שחר ישראלי · המרת שברים לאחוזים'] },
                    { ico: '⭐', label: 'הצעת אתגר בנושאים שכבר נשלטים', toast: ['האתגר נשלח ⭐', 'שחר ישראלי'] },
                ],
            },
            progress: [{ subject: 'מתמטיקה', value: 62, goal: 75, trend: 'steady' }],
            gaps: [
                { title: 'המרת שברים לאחוזים', level: 'high', rate: 30, tasks: 3, pattern: 'בלבול בין מונה למכנה בהמרה' },
                { title: 'משוואות מילוליות', level: 'low', rate: 78, tasks: 2, pattern: 'נשלט ברובו' },
            ],
            recs: [
                { type: 'reinforcement', text: 'הסבר חוזר על המרת שבר לאחוז', target: 'שחר ישראלי', why: 'אותה טעות חזרה ב-3 משימות — הסבר ממוקד יפתור את הקושי.', action: 'סרטון קצר + 3 תרגילים מודרכים' },
                { type: 'enrichment', text: 'אתגר מתקדם בנושאים שכבר נשלטים', target: 'שחר ישראלי', why: 'שליטה גבוהה ברוב הנושאים מאפשרת העשרה.', action: 'משימת אתגר אחת לשבוע' },
            ],
            insights: [],
        },
        maya: {
            name: 'מאיה רון', avatar: 'מ', grade: 'כיתה ח׳1', status: 'progressing',
            engagement: 92, avgMin: 28, tasksWeek: 13, lastActive: '12.06.2026',
            reasonType: null, reasonSub: '', recommendation: '',
            aiExplain: ['עומדת ביעדי הלמידה ומעבר להם', 'מעורבות גבוהה ויציבה לאורך זמן'],
            aiSummary: {
                text: 'מאיה עומדת ביעדים ומעבר להם (<b>88%</b> מול יעד 80%), מעורבות מצוינת (92%) ומובילה אחרים בקבוצה. כדאי שתשמרי את המומנטום עם אתגרים מעשירים ותתני לה הזדמנויות הובלה.',
                actions: [
                    { ico: '⭐', label: 'שליחת משימת אתגר / פרויקט חקר קצר', toast: ['האתגר נשלח ⭐', 'מאיה רון · פרויקט חקר'] },
                ],
            },
            progress: [{ subject: 'מתמטיקה', value: 88, goal: 80, trend: 'up' }],
            gaps: [],
            recs: [
                { type: 'enrichment', text: 'משימת אתגר מתמטית מתקדמת', target: 'מאיה רון', why: 'עמידה ביעדים מאפשרת העשרה והרחבה.', action: 'פרויקט חקר קצר בנושא לבחירה' },
            ],
            insights: [
                { type: 'strength', text: 'לומדת עצמאית ומובילה אחרים בקבוצה.', subject: 'מתמטיקה', date: '05.06.2026' },
            ],
        },
        eitan: {
            name: 'איתן ברק', avatar: 'א', grade: 'כיתה ח׳1', status: 'on_track',
            engagement: 71, avgMin: 21, tasksWeek: 8, lastActive: '11.06.2026',
            reasonType: null, reasonSub: '', recommendation: '',
            aiExplain: ['מתקדם בקצב יציב לקראת היעדים'],
            aiSummary: {
                text: 'איתן מתקדם בקצב יציב לקראת היעד (<b>67%</b> מול 75%) ומעורבותו תקינה. חיזוק קל שתשלחי בנושא «פתרון משוואות ליניאריות» יסייע לו לסגור את הפער ולהגיע ליעד.',
                actions: [
                    { ico: '✍️', label: 'שליחת סדרת תרגול קצרה במשוואות ליניאריות', toast: ['התרגול נשלח ✓', 'איתן ברק · משוואות ליניאריות'] },
                ],
            },
            progress: [{ subject: 'מתמטיקה', value: 67, goal: 75, trend: 'up' }],
            gaps: [
                { title: 'פתרון משוואות ליניאריות', level: 'mid', rate: 52, tasks: 3, pattern: 'שמירה על איזון בין האגפים' },
            ],
            recs: [
                { type: 'practice', text: 'תרגול נוסף בפתרון משוואות ליניאריות', target: 'איתן ברק', why: 'חיזוק קל יסייע לעמוד ביעד.', action: 'סדרת תרגול קצרה' },
            ],
            insights: [],
        },
    };

    // groups
    const GROUPS = {
        g_8a: {
            name: 'כיתה ח׳1 – מתמטיקה', subject: 'מתמטיקה',
            summary: { progress: 79, engagement: 67, active: 14, total: 21, avgMin: 21, attention: 3 },
            attention: ['ron', 'noam', 'shahar'],
            students: ['ron', 'noam', 'shahar', 'maya', 'eitan'],
            aiSummary: {
                text: 'הקבוצה במגמת עלייה יפה — ההתקדמות לעבר היעדים קפצה מ-65% ל-<b>79%</b> השבוע, והמעורבות יציבה (67%). המוקד העיקרי שלך כרגע: <b>3 תלמידים</b> הזקוקים לתשומת לב, כשהנושא «משוואות מילוליות» חוזר כקושי משותף. כדאי שתרכזי סביבו פעולה קבוצתית קצרה.',
                actions: [
                    { ico: '💌', label: 'תזכורת אישית לרון לוי', toast: ['נשלחה תזכורת אישית 💌', 'לרון לוי – 7 ימים ללא פעילות'] },
                    { ico: '✍️', label: 'תרגול חיזוק קבוצתי ב«משוואות מילוליות»', toast: ['התרגול הקבוצתי נוצר ✓', 'משוואות מילוליות · 10 דק׳'] },
                    { ico: '👥', label: 'מעבר לתלמידים לתשומת לב', scrollTo: 'attnPanel' },
                ],
            },
            trends: {
                dates: ['30/5','31/5','1/6','2/6','3/6','4/6','5/6'],
                progress:   [40, 43, 48, 50, 61, 65, 79],
                engagement: [55, 58, 60, 62, 63, 65, 67],
                minutes:    [16, 17, 18, 18, 20, 20, 21],
            },
        },
        g_7b: {
            name: 'כיתה ז׳2 – מתמטיקה', subject: 'מתמטיקה',
            summary: { progress: 71, engagement: 74, active: 17, total: 23, avgMin: 19, attention: 1 },
            attention: ['noam'],
            students: ['noam', 'maya', 'eitan'],
            aiSummary: {
                text: 'קבוצה ז׳2 במצב טוב ויציב — מעורבות גבוהה (<b>74%</b>) והתקדמות מתמדת ל-71%. רק תלמיד אחד דורש תשומת לב כרגע, כך שתוכלי להשקיע גם בהעשרה למתקדמים ולשמר את המומנטום החיובי.',
                actions: [
                    { ico: '✍️', label: 'חיזוק לנועם כהן בנושא שזוהתה בו ירידה', toast: ['התרגול נשלח ✓', 'נועם כהן · חיזוק ממוקד'] },
                    { ico: '⭐', label: 'אתגר העשרה למאיה (עומדת ביעדים)', toast: ['אתגר ההעשרה נשלח ⭐', 'מאיה רון · פרויקט חקר קצר'] },
                ],
            },
            trends: {
                dates: ['30/5','31/5','1/6','2/6','3/6','4/6','5/6'],
                progress:   [52, 55, 58, 62, 64, 68, 71],
                engagement: [60, 63, 66, 68, 70, 72, 74],
                minutes:    [14, 15, 16, 17, 18, 18, 19],
            },
        },
    };

    const METRIC_LABEL = {
        progress:   { name: 'התקדמות לעבר יעדי למידה', unit: '%', sub: 'התקדמות לעבר יעדי למידה לאורך זמן' },
        engagement: { name: 'מעורבות',                 unit: '%', sub: 'מעורבות הקבוצה לאורך זמן' },
        minutes:    { name: 'זמן פעילות ממוצע',         unit: " דק'", sub: 'זמן פעילות ממוצע לתלמיד לאורך זמן' },
    };

    // ============================================================
    //  STATE
    // ============================================================
    let currentGroup = 'g_8a';
    let currentRange = '7';
    let currentMetric = 'progress';
    let currentStudent = 'ron';
    let profileTab = 'insights';
    let currentView = 'class';

    // live presence + help detection (demo — updates in real time)
    let liveFilter = 'all';
    let liveTimer = null;
    const LIVE = {
        ron:    { online: false, needsHelp: true,  activity: 'לא מחובר/ת',                       why: 'לא נכנס/ה למערכת 7 ימים — ייתכן חסם רגשי או טכני. כדאי קשר אישי חם.' },
        noam:   { online: true,  needsHelp: true,  activity: 'עובד/ת על «פישוט ביטויים אלגבריים»', why: 'ירידה ל-45% הצלחה ב-4 משימות עוקבות — קושי תוכני, לא מוטיבציוני.' },
        shahar: { online: true,  needsHelp: true,  activity: 'תרגול «המרת שברים לאחוזים»',          why: '3 טעויות חוזרות באותו נושא — קושי נקודתי שהסבר קצר יפתור.' },
        maya:   { online: true,  needsHelp: false, activity: 'פרויקט חקר במתמטיקה',                why: '' },
        eitan:  { online: false, needsHelp: false, activity: 'לא מחובר/ת',                       why: '' },
    };

    // ============================================================
    //  HELPERS
    // ============================================================
    function showToast(title, sub) {
        document.getElementById('toastTitle').textContent = title;
        document.getElementById('toastSub').textContent = sub || '';
        const t = document.getElementById('toast');
        t.classList.add('show');
        clearTimeout(window._tt);
        window._tt = setTimeout(() => t.classList.remove('show'), 2800);
    }
    function ava(el, name) { el.style.background = avaColor(name); el.textContent = name.charAt(0); }

    // ============================================================
    //  RENDER: top + filters
    // ============================================================
    function renderShell() {
        document.getElementById('topName').textContent = TEACHER.name;
        const ta = document.getElementById('topAva'); ta.textContent = TEACHER.avatar;
        document.getElementById('greetTitle').textContent = `שלום ${TEACHER.first} 👋`;

        const fg = document.getElementById('fGroup');
        fg.innerHTML = Object.keys(GROUPS).map(g => `<option value="${g}">${GROUPS[g].name}</option>`).join('');
        fg.value = currentGroup;

        const fs = document.getElementById('fSubject');
        fs.innerHTML = SUBJECT_OPTIONS.map(s => `<option>${s}</option>`).join('');
    }

    const RANGE_LABELS = { '7': '7 ימים אחרונים', '14': '14 ימים אחרונים', '30': '30 ימים אחרונים' };
    function updateContextLine() {
        const g = GROUPS[currentGroup];
        const cls = g.name.split('–')[0].trim();
        const subject = document.getElementById('fSubject').value || g.subject;
        const range = RANGE_LABELS[currentRange] || currentRange;
        document.getElementById('ctxValue').textContent = `${cls} · ${subject} · ${range}`;
    }

    // ============================================================
    //  RENDER: AI summaries (class + student)
    // ============================================================
    function aiActionsHtml(actions, scope) {
        return actions.map((a, i) =>
            `<li class="ai-act" data-scope="${scope}" data-idx="${i}">${a.label}</li>`
        ).join('');
    }
    function handleAiAction(scope, idx) {
        const ai = scope === 'group' ? GROUPS[currentGroup].aiSummary : STUDENTS[currentStudent].aiSummary;
        const a = ai && ai.actions[idx];
        if (!a) return;
        if (a.scrollTo) { document.getElementById(a.scrollTo).scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
        if (a.toast) showToast(a.toast[0], a.toast[1] || '');
    }
    function renderAiSummary() {
        const g = GROUPS[currentGroup];
        const ai = g.aiSummary;
        const el = document.getElementById('aiSummary');
        if (!ai) { el.style.display = 'none'; return; }
        el.style.display = '';
        el.innerHTML = `
            <div class="ai-head">
                <span class="ai-badge">סיכום AI</span>
                <span class="ai-title">${g.name}</span>
                <span class="ai-scope">ברמת הכיתה</span>
            </div>
            <div class="ai-text"><b>${TEACHER.first}</b>, ${ai.text}</div>
            <div class="ai-actions"><span class="ai-act-lab">מה כדאי לעשות:</span><ul class="ai-acts">${aiActionsHtml(ai.actions, 'group')}</ul></div>`;
    }
    function renderStudentAiSummary() {
        const s = STUDENTS[currentStudent];
        const ai = s.aiSummary;
        const el = document.getElementById('studentAiSummary');
        if (!ai) { el.style.display = 'none'; return; }
        el.style.display = '';
        el.innerHTML = `
            <div class="ai-head">
                <span class="ai-badge">סיכום AI</span>
                <span class="ai-title">${s.name}</span>
                <span class="ai-scope">ברמת התלמיד/ה</span>
            </div>
            <div class="ai-text"><b>${TEACHER.first}</b>, ${ai.text}</div>
            <div class="ai-actions"><span class="ai-act-lab">מה כדאי לעשות:</span><ul class="ai-acts">${aiActionsHtml(ai.actions, 'student')}</ul></div>`;
    }

    // ============================================================
    //  RENDER: KPI cards
    // ============================================================
    function renderKpis() {
        const s = GROUPS[currentGroup].summary;
        const grid = document.getElementById('kpiGrid');
        grid.innerHTML = `
            <div class="kpi attn">
                <div class="k-lab">דורשים תשומת לב</div>
                <div class="k-val">${s.attention}</div>
                <button class="k-cta" onclick="document.getElementById('attnPanel').scrollIntoView({behavior:'smooth',block:'center'})">צפייה בתלמידים</button>
            </div>
            <div class="kpi">
                <div class="k-lab">מעורבות</div>
                <div class="k-val">${s.engagement}<small>%</small></div>
                <div class="k-sub">${s.active}/${s.total} תלמידים פעילים</div>
            </div>
            <div class="kpi">
                <div class="k-lab">התקדמות ליעדים</div>
                <div class="k-val">${s.progress}<small>%</small></div>
                <div class="k-sub">ממוצע הקבוצה</div>
            </div>
            <div class="kpi">
                <div class="k-lab">זמן פעילות ממוצע</div>
                <div class="k-val">${s.avgMin}<small> דק׳</small></div>
                <div class="k-sub">לשבוע, לכל תלמיד</div>
            </div>`;
    }

    // ============================================================
    //  RENDER: attention table
    // ============================================================
    function renderAttention() {
        const g = GROUPS[currentGroup];
        const wrap = document.getElementById('attnTableWrap');
        if (!g.attention.length) {
            wrap.innerHTML = `<div class="empty"><span class="big">🎉</span><h3>אין כרגע תלמידים לתשומת לב</h3><p>כל התלמידים בקבוצה זו במעקב תקין. כל הכבוד!</p></div>`;
            return;
        }
        let rows = '';
        g.attention.forEach(sid => {
            const s = STUDENTS[sid];
            const rm = REASON_META[s.reasonType];
            const active = sid === currentStudent;
            rows += `
                <tr class="${active ? 'active' : ''}" onclick="selectStudent('${sid}')">
                    <td>
                        <div class="tstud">
                            <div class="tstud-ava" style="background:${avaColor(s.name)}">${s.avatar}</div>
                            <div><div class="tstud-name">${s.name}</div><div class="r-sub">${s.grade}</div></div>
                        </div>
                    </td>
                    <td>
                        <div class="reason">
                            <span class="r-dot" style="background:var(--${rm.cls === 'attn' ? 'attn' : rm.cls === 'warm' ? 'warm' : 'info'}-dot)"></span>
                            <div><div class="r-main">${rm.label}</div><div class="r-sub">${s.reasonSub}</div></div>
                        </div>
                    </td>
                    <td><div class="date-cell">${s.lastActive}</div></td>
                    <td>
                        <div class="eng-cell">
                            <div class="v">${s.engagement}%</div>
                            <div class="eng-track"><div class="eng-fill" style="width:${s.engagement}%; background:${s.engagement < 40 ? 'var(--attn-dot)' : s.engagement < 70 ? 'var(--warm-dot)' : 'var(--good-dot)'}"></div></div>
                        </div>
                    </td>
                </tr>`;
            if (active) {
                rows += `
                <tr class="xai-row"><td colspan="4">
                    <div class="xai-box fade-in">
                        <div class="why">למה סומן/ה? הסימון מבוסס על הנתונים הבאים:</div>
                        <ul>${s.aiExplain.map(x => `<li>${x}</li>`).join('')}</ul>
                        <div class="xai-rec"><span>💡</span><div><b>המלצה:</b> ${s.recommendation}</div></div>
                        <div class="xai-actions">
                            <button class="mini-btn solid" onclick="event.stopPropagation(); openProfileTab('${sid}')">👤 פתח פרופיל מלא</button>
                            <button class="mini-btn" onclick="event.stopPropagation(); showToast('נשלחה תזכורת אישית 💌','ל${s.name}')">💌 שליחת תזכורת</button>
                            <button class="mini-btn" onclick="event.stopPropagation(); showToast('סומן כטופל ✓','')">✓ סמן כטופל</button>
                        </div>
                    </div>
                </td></tr>`;
            }
        });
        wrap.innerHTML = `
            <table class="attn-table">
                <thead><tr><th>תלמיד/ה</th><th>סיבת הסימון</th><th>פעילות אחרונה</th><th>מעורבות</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
    }

    // ============================================================
    //  RENDER: trend chart (inline SVG)
    // ============================================================
    function renderTrend() {
        const g = GROUPS[currentGroup];
        const days = parseInt(currentRange, 10);
        const allDates = g.trends.dates;
        const allVals = g.trends[currentMetric];
        const n = Math.max(2, Math.min(allDates.length, days <= 7 ? 7 : days <= 14 ? 6 : 5));
        const dates = allDates.slice(-n);
        const vals = allVals.slice(-n);

        document.getElementById('trendSub').textContent = METRIC_LABEL[currentMetric].sub;

        const W = 300, H = 150, padX = 22, padY = 22;
        const maxV = currentMetric === 'minutes' ? Math.max(...vals) + 6 : 100;
        const minV = 0;
        const x = i => padX + (i / (vals.length - 1)) * (W - padX * 2);
        const y = v => H - padY - ((v - minV) / (maxV - minV)) * (H - padY * 2);

        const linePts = vals.map((v, i) => `${x(i)},${y(v)}`).join(' ');
        const areaPts = `${x(0)},${H - padY} ${linePts} ${x(vals.length - 1)},${H - padY}`;
        const lastV = vals[vals.length - 1];
        const unit = METRIC_LABEL[currentMetric].unit;

        const dots = vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${i === vals.length - 1 ? 5 : 3.5}" fill="#fff" stroke="#7c5cff" stroke-width="2.5"/>`).join('');
        const xlabels = dates.map((d, i) => `<text x="${x(i)}" y="${H - 5}" font-size="8" fill="#a8a3bd" text-anchor="middle">${d}</text>`).join('');
        const gridY = [0, 25, 50, 75, 100].filter(() => currentMetric !== 'minutes');
        const grid = (currentMetric === 'minutes' ? [] : gridY).map(gv => `<line x1="${padX}" y1="${y(gv)}" x2="${W - padX}" y2="${y(gv)}" stroke="#f4f1fb" stroke-width="1"/><text x="${padX - 4}" y="${y(gv) + 3}" font-size="7" fill="#c4bfd6" text-anchor="end">${gv}</text>`).join('');

        document.getElementById('chartWrap').innerHTML = `
            <svg viewBox="0 0 ${W} ${H}" width="100%" height="170" preserveAspectRatio="xMidYMid meet">
                <defs>
                    <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#7c5cff" stop-opacity="0.22"/>
                        <stop offset="100%" stop-color="#7c5cff" stop-opacity="0"/>
                    </linearGradient>
                </defs>
                ${grid}
                <polygon points="${areaPts}" fill="url(#areaGrad)"/>
                <polyline points="${linePts}" fill="none" stroke="#7c5cff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
                ${dots}
                <text x="${x(vals.length - 1)}" y="${y(lastV) - 11}" font-size="11" font-weight="700" fill="#7c5cff" text-anchor="middle">${lastV}${unit}</text>
                ${xlabels}
            </svg>`;
    }

    // ============================================================
    //  RENDER: student profile section
    // ============================================================
    function renderProfileBar() {
        const sel = document.getElementById('pStudent');
        const list = GROUPS[currentGroup].students;
        sel.innerHTML = list.map(sid => `<option value="${sid}">${STUDENTS[sid].name}</option>`).join('');
        if (!list.includes(currentStudent)) currentStudent = list[0];
        sel.value = currentStudent;
        ava(document.getElementById('pselAva'), STUDENTS[currentStudent].name);
        document.getElementById('ptabInsights').classList.toggle('active', profileTab === 'insights');
        document.getElementById('ptabProfile').classList.toggle('active', profileTab === 'profile');
        renderStudentAiSummary();
    }

    function renderProfileBody() {
        if (profileTab === 'insights') renderInsightsTab();
        else renderProfileTab();
    }

    function renderInsightsTab() {
        const s = STUDENTS[currentStudent];
        const insights = s.insights || [];
        const insightsHtml = insights.length
            ? insights.map((ins, idx) => {
                const m = INSIGHT_META[ins.type];
                return `<div class="insight-card">
                    <div class="i-text">${ins.text}</div>
                    <div class="i-foot">
                        <span class="insight-type-tag" style="background:${m.tag}; color:${m.col}">${m.label} · ${ins.subject}</span>
                        <span class="i-tools">
                            <span class="i-date">${ins.date}</span>
                            <button title="עריכה" onclick="showToast('עריכת תובנה','אפשרות עריכה תיפתח כאן')">✎</button>
                            <button title="מחיקה" onclick="deleteInsight(${idx})">🗑</button>
                        </span>
                    </div>
                </div>`;
            }).join('')
            : `<div class="empty" style="padding:20px 10px"><span class="big">📝</span><p>עדיין לא הוספת תובנות על ${s.name}. הוסיפו תובנה כדי להעשיר את פרופיל הלומד.</p></div>`;

        const gaps = s.gaps || [];
        const gapsHtml = gaps.length
            ? gaps.map((g, idx) => {
                const lv = GAP_LEVEL[g.level];
                return `<div class="gap-card">
                    <div class="g-top">
                        <span class="g-title">${g.title}</span>
                        <span class="pill" style="background:${lv.bg}; color:${lv.col}">${lv.label}</span>
                    </div>
                    <div class="g-meta">דפוס קושי: ${g.pattern}</div>
                    <div class="g-foot">
                        <span class="g-rate">שיעור הצלחה: <b>${g.rate}%</b> · ב-${g.tasks} משימות עוקבות</span>
                        <button class="gap-show" onclick="toggleGap(${idx})">הצגת נתונים <span id="gapchev${idx}">▾</span></button>
                    </div>
                    <div class="gap-evidence" id="gapev${idx}">
                        🔍 <b>הנתון הגולמי:</b> זוהו ${g.tasks} משימות עוקבות בנושא «${g.title}» עם ${g.rate}% הצלחה בלבד. דפוס הקושי החוזר: ${g.pattern}.
                    </div>
                </div>`;
            }).join('')
            : `<div class="empty" style="padding:20px 10px"><span class="big">✨</span><p>לא זוהו פריטי ידע עם קושי — עבודה יפה!</p></div>`;

        const recs = s.recs || [];
        const recsHtml = recs.length
            ? recs.map((r, idx) => {
                const m = REC_META[r.type];
                return `<div class="rec-card" id="rec${idx}">
                    <div class="rec-head" onclick="toggleRec(${idx})">
                        <div class="rec-ico" style="background:${m.col}"></div>
                        <div class="rec-info"><div class="r-type">${m.type}</div><div class="r-text">${r.text}</div></div>
                        <span class="rec-chev">‹</span>
                    </div>
                    <div class="rec-detail">
                        <div class="rd-row"><b>למי:</b> ${r.target}</div>
                        <div class="rd-row"><b>למה נוצר:</b> ${r.why}</div>
                        <div class="rd-row rd-act"><button class="mini-btn solid" onclick="event.stopPropagation(); showToast('הפעולה נשמרה ✓','${r.action}')">✓ ${r.action}</button></div>
                    </div>
                </div>`;
            }).join('')
            : `<div class="empty" style="padding:20px 10px"><span class="big">💡</span><p>אין כרגע המלצות להצגה.</p></div>`;

        document.getElementById('profileBody').innerHTML = `
            <div class="cols-3 fade-in">
                <div>
                    <div class="col-head">התובנות האחרונות שלי</div>
                    <button class="add-insight-btn" onclick="openInsightModal()">הוספת תובנה</button>
                    ${insightsHtml}
                </div>
                <div>
                    <div class="col-head">פריטי ידע בהם ${s.name} מתקשה</div>
                    ${gapsHtml}
                </div>
                <div>
                    <div class="col-head">המלצות מותאמות</div>
                    ${recsHtml}
                    <button class="link-btn" style="margin-top:6px" onclick="showToast('כל ההמלצות','כאן תיפתח רשימת ההמלצות המלאה')">צפייה בכל ההמלצות ↓</button>
                </div>
            </div>`;
    }

    function renderProfileTab() {
        const s = STUDENTS[currentStudent];
        const st = STATUS_META[s.status];
        const reasonLine = s.reasonType ? `<div class="ai-explain" style="margin-bottom:20px"><div class="ae-h">למה ${s.name} סומן/ה? הסבר המערכת</div><ul>${s.aiExplain.map(x => `<li>${x}</li>`).join('')}</ul></div>` : '';
        const progHtml = s.progress.map(p => {
            const ti = p.trend === 'up' ? '↗️ עלייה' : p.trend === 'down' ? '↘️ ירידה' : '➡️ יציב';
            return `<div class="prog-item">
                <div class="prog-top"><span class="s-name">${p.subject} <span style="font-size:0.7rem; color:var(--ink-400)">${ti}</span></span><span class="s-val">${p.value}% מתוך יעד ${p.goal}%</span></div>
                <div class="prog-track"><div class="prog-fill" style="width:${Math.min(100,p.value)}%"></div><div class="prog-goal" style="right:${Math.min(100,p.goal)}%"></div></div>
            </div>`;
        }).join('');
        const recHint = s.recommendation ? `<div class="xai-rec" style="margin-top:16px"><span>💡</span><div><b>המלצה מותאמת:</b> ${s.recommendation}</div></div>` : '';

        document.getElementById('profileBody').innerHTML = `
            <div class="fade-in">
                <div class="psum-hero">
                    <div class="psum-ava" style="background:${avaColor(s.name)}">${s.avatar}</div>
                    <div>
                        <h2>${s.name}</h2>
                        <div class="meta">${s.grade} · ${GROUPS[currentGroup].subject} · פעילות אחרונה: ${s.lastActive}</div>
                        <div style="margin-top:7px"><span class="status-tag" style="background:${st.bg}; color:${st.ink}">${st.ico} ${st.label}</span></div>
                    </div>
                    <div class="psum-stats">
                        <div class="psum-stat"><div class="v">${s.engagement}%</div><div class="l">מעורבות</div></div>
                        <div class="psum-stat"><div class="v">${s.avgMin}׳</div><div class="l">זמן ממוצע</div></div>
                        <div class="psum-stat"><div class="v">${s.tasksWeek}</div><div class="l">משימות השבוע</div></div>
                    </div>
                </div>
                <div class="psum-grid">
                    <div>
                        <div class="col-head">📈 התקדמות מול יעדי הלמידה האישיים</div>
                        ${progHtml}
                        ${recHint}
                    </div>
                    <div>
                        ${reasonLine || `<div class="ai-explain"><div class="ae-h">🔍 תובנות המערכת</div><ul>${s.aiExplain.map(x => `<li>${x}</li>`).join('')}</ul></div>`}
                    </div>
                </div>
            </div>`;
    }

    // ============================================================
    //  RENDER: live view (presence + real-time help detection)
    // ============================================================
    function liveTimeNow() {
        return new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    function liveCardHtml(sid) {
        const s = STUDENTS[sid];
        const L = LIVE[sid];
        const statusTag = L.online
            ? `<span class="live-status on">● מחובר/ת</span>`
            : `<span class="live-status off">● לא מחובר/ת</span>`;
        const helpBadge = L.needsHelp ? `<span class="live-help">🔔 צריך/ה עזרה</span>` : '';
        const actLine = L.online
            ? `<div class="live-act">🟢 ${L.activity}</div>`
            : `<div class="live-act">⚪ ${L.activity}</div>`;
        const whyBlock = (L.needsHelp && L.why)
            ? `<div class="live-why"><span class="lw-badge">סיכום AI · למה</span><div>${L.why}</div></div>`
            : '';
        return `
            <div class="live-card ${L.online ? 'on' : 'off'} ${L.needsHelp ? 'help' : ''}" id="livecard-${sid}">
                <div class="live-top">
                    <div class="live-ava" style="background:${avaColor(s.name)}">${s.avatar}<span class="live-dot ${L.online ? 'on' : 'off'}"></span></div>
                    <div class="live-id">
                        <div class="live-name">${s.name}</div>
                        <div class="live-class">${s.grade}</div>
                    </div>
                    ${helpBadge}
                </div>
                <div style="margin-top:10px">${statusTag}</div>
                ${actLine}
                ${whyBlock}
                <button class="live-open" onclick="openProfileTab('${sid}')">👤 פתיחת פרופיל מלא</button>
            </div>`;
    }
    function renderLive() {
        const list = GROUPS[currentGroup].students;
        const onlineN = list.filter(sid => LIVE[sid].online).length;
        const helpN = list.filter(sid => LIVE[sid].needsHelp).length;
        document.getElementById('lcAll').textContent = list.length;
        document.getElementById('lcOnline').textContent = onlineN;
        document.getElementById('lcHelp').textContent = helpN;
        document.getElementById('liveTime').textContent = liveTimeNow();

        const filtered = list.filter(sid => {
            const L = LIVE[sid];
            if (liveFilter === 'online') return L.online;
            if (liveFilter === 'help') return L.needsHelp;
            return true;
        });
        const grid = document.getElementById('liveGrid');
        grid.innerHTML = filtered.length
            ? filtered.map(liveCardHtml).join('')
            : `<div class="empty" style="grid-column:1/-1"><span class="big">✨</span><p>אין תלמידים שתואמים לסינון הזה כרגע.</p></div>`;
    }
    // simulate live changes every few seconds (demo)
    function liveTick() {
        const list = GROUPS[currentGroup].students;
        // randomly flip presence for one student
        const flipSid = list[Math.floor(Math.random() * list.length)];
        const L = LIVE[flipSid];
        if (Math.random() < 0.5) {
            const wasOnline = L.online;
            L.online = !L.online;
            if (L.online && !wasOnline) L.activity = ['פותר/ת משימת מתמטיקה', 'צופה בהסבר קצר', 'מתרגל/ת בנושא חדש', 'עובד/ת על אתגר'][Math.floor(Math.random() * 4)];
            else if (!L.online) { L.activity = 'לא מחובר/ת'; }
        }
        // occasionally a connected student starts struggling → needs help
        const online = list.filter(sid => LIVE[sid].online && !LIVE[sid].needsHelp);
        if (online.length && Math.random() < 0.25) {
            const sid = online[Math.floor(Math.random() * online.length)];
            const reasons = [
                'נתקע/ה על אותה שאלה כבר כמה דקות.',
                '3 ניסיונות שגויים ברצף באותה משימה — קושי נקודתי.',
                'ירידה פתאומית בקצב — ייתכן שאיבד/ה ריכוז.',
                'ביקש/ה רמז פעמיים ועדיין מתקשה להתקדם.',
            ];
            LIVE[sid].needsHelp = true;
            LIVE[sid].why = reasons[Math.floor(Math.random() * reasons.length)];
            if (currentView === 'live') {
                showToast(`🔔 ${STUDENTS[sid].name} זקוק/ה לעזרה`, LIVE[sid].why);
                setTimeout(() => {
                    const card = document.getElementById('livecard-' + sid);
                    if (card) { card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1500); }
                }, 60);
            }
        }
        // a flagged student may recover on their own (keeps the board dynamic)
        const flagged = list.filter(sid => LIVE[sid].needsHelp && LIVE[sid].online && sid !== 'ron');
        if (flagged.length && Math.random() < 0.3) {
            const sid = flagged[Math.floor(Math.random() * flagged.length)];
            LIVE[sid].needsHelp = false;
            LIVE[sid].why = '';
        }
        if (currentView === 'live') renderLive();
    }
    function startLive() {
        if (liveTimer) clearInterval(liveTimer);
        liveTimer = setInterval(liveTick, 5000);
    }

    // ============================================================
    //  ACTIONS
    // ============================================================
    function selectStudent(sid) {
        currentStudent = sid;
        renderAttention();
        renderProfileBar();
        renderProfileBody();
    }
    function setView(view) {
        currentView = view;
        document.getElementById('classView').style.display = view === 'class' ? '' : 'none';
        document.getElementById('liveView').style.display = view === 'live' ? '' : 'none';
        document.getElementById('studentView').style.display = view === 'student' ? '' : 'none';
        document.querySelectorAll('#viewToggle .vt-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
        const sub = document.querySelector('.greet p');
        if (sub) sub.textContent = view === 'class'
            ? 'תמונת מצב קבוצתית — מעורבות, התקדמות ותלמידים הדורשים תשומת לב.'
            : view === 'live'
            ? 'מבט לייב — מי מחובר/ת עכשיו ומי מהתלמידים זקוק/ה לעזרה בזמן אמת.'
            : 'מבט מעמיק על תלמיד/ה בודד/ת — תובנות, פערי ידע והמלצות מותאמות.';
        if (view === 'live') renderLive();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function openProfileTab(sid) {
        currentStudent = sid; profileTab = 'profile';
        renderProfileBar(); renderProfileBody();
        setView('student');
    }
    function toggleGap(idx) {
        document.getElementById('gapev' + idx).classList.toggle('show');
        const c = document.getElementById('gapchev' + idx); c.textContent = c.textContent === '▾' ? '▴' : '▾';
    }
    function toggleRec(idx) { document.getElementById('rec' + idx).classList.toggle('open'); }
    function deleteInsight(idx) {
        STUDENTS[currentStudent].insights.splice(idx, 1);
        renderInsightsTab();
        showToast('התובנה הוסרה', '');
    }

    // insight modal
    function openInsightModal() {
        document.getElementById('insightModalSub').textContent = 'תיעוד ידע איכותני על ' + STUDENTS[currentStudent].name;
        const ms = document.getElementById('miSubject');
        ms.innerHTML = SUBJECT_OPTIONS.map(x => `<option>${x}</option>`).join('');
        document.getElementById('miText').value = '';
        document.getElementById('insightOverlay').classList.add('open');
        setTimeout(() => document.getElementById('miText').focus(), 80);
    }
    function closeInsightModal() { document.getElementById('insightOverlay').classList.remove('open'); }
    function saveInsight() {
        const text = document.getElementById('miText').value.trim();
        if (!text) { showToast('כתבו תיאור לתובנה 📝', 'התיאור לא יכול להיות ריק'); document.getElementById('miText').focus(); return; }
        const type = document.getElementById('miType').value;
        const subject = document.getElementById('miSubject').value;
        const today = new Date().toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.');
        if (!STUDENTS[currentStudent].insights) STUDENTS[currentStudent].insights = [];
        STUDENTS[currentStudent].insights.unshift({ type, text, subject, date: today });
        closeInsightModal();
        if (profileTab !== 'insights') { profileTab = 'insights'; renderProfileBar(); }
        renderProfileBody();
        showToast('התובנה נשמרה! 💜', 'נוספה לפרופיל הלומד של ' + STUDENTS[currentStudent].name);
    }

    // ============================================================
    //  WIRING
    // ============================================================
    function renderAll() {
        renderAiSummary();
        renderKpis();
        renderAttention();
        renderTrend();
        renderProfileBar();
        renderProfileBody();
        renderLive();
    }

    document.getElementById('fGroup').addEventListener('change', e => {
        currentGroup = e.target.value;
        const list = GROUPS[currentGroup].students;
        if (!list.includes(currentStudent)) currentStudent = GROUPS[currentGroup].attention[0] || list[0];
        renderAll();
        updateContextLine();
        showToast('הקבוצה הוחלפה', GROUPS[currentGroup].name);
    });
    document.getElementById('fSubject').addEventListener('change', () => { renderAll(); updateContextLine(); });
    document.getElementById('fRange').addEventListener('change', e => { currentRange = e.target.value; renderTrend(); updateContextLine(); });

    // filter popover open/close
    const filterBtn = document.getElementById('filterBtn');
    const filterPopover = document.getElementById('filterPopover');
    filterBtn.addEventListener('click', e => { e.stopPropagation(); filterPopover.classList.toggle('open'); });
    document.addEventListener('click', e => {
        if (filterPopover.classList.contains('open') && !filterPopover.contains(e.target) && !filterBtn.contains(e.target)) {
            filterPopover.classList.remove('open');
        }
    });

    document.getElementById('liveFilters').addEventListener('click', e => {
        const b = e.target.closest('.live-chip'); if (!b) return;
        liveFilter = b.dataset.lf;
        document.querySelectorAll('#liveFilters .live-chip').forEach(c => c.classList.toggle('active', c === b));
        renderLive();
    });

    document.getElementById('trendToggle').addEventListener('click', e => {
        const b = e.target.closest('.trend-chip'); if (!b) return;
        currentMetric = b.dataset.metric;
        document.querySelectorAll('#trendToggle .trend-chip').forEach(c => c.classList.toggle('active', c === b));
        renderTrend();
    });

    document.getElementById('pStudent').addEventListener('change', e => { currentStudent = e.target.value; renderAttention(); renderProfileBar(); renderProfileBody(); });
    document.getElementById('ptabInsights').addEventListener('click', () => { profileTab = 'insights'; renderProfileBar(); renderProfileBody(); });
    document.getElementById('ptabProfile').addEventListener('click', () => { profileTab = 'profile'; renderProfileBar(); renderProfileBody(); });

    document.getElementById('viewToggle').addEventListener('click', e => {
        const b = e.target.closest('.vt-btn'); if (!b) return;
        setView(b.dataset.view);
    });

    document.getElementById('miSave').addEventListener('click', saveInsight);
    document.getElementById('miCancel').addEventListener('click', closeInsightModal);
    document.getElementById('insightOverlay').addEventListener('click', e => { if (e.target.id === 'insightOverlay') closeInsightModal(); });

    // AI summary action buttons (event delegation)
    document.getElementById('aiSummary').addEventListener('click', e => {
        const b = e.target.closest('.ai-act'); if (!b) return;
        handleAiAction(b.dataset.scope, parseInt(b.dataset.idx, 10));
    });
    document.getElementById('studentAiSummary').addEventListener('click', e => {
        const b = e.target.closest('.ai-act'); if (!b) return;
        handleAiAction(b.dataset.scope, parseInt(b.dataset.idx, 10));
    });

    // expose for inline handlers
    window.showToast = showToast;
    window.selectStudent = selectStudent;
    window.openProfileTab = openProfileTab;
    window.toggleGap = toggleGap;
    window.toggleRec = toggleRec;
    window.deleteInsight = deleteInsight;
    window.openInsightModal = openInsightModal;
    window.setView = setView;

    /* ===================== CHAT ASSISTANT ===================== */
    function escapeHtml(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function chatAppend(role, html) {
        const body = document.getElementById('chatBody');
        const div = document.createElement('div');
        div.className = 'chat-msg ' + role;
        div.innerHTML = html;
        body.appendChild(div);
        body.scrollTop = body.scrollHeight;
        return div;
    }
    function chatShowTyping() {
        const body = document.getElementById('chatBody');
        const div = document.createElement('div');
        div.className = 'chat-typing';
        div.innerHTML = '<span></span><span></span><span></span>';
        body.appendChild(div);
        body.scrollTop = body.scrollHeight;
        return div;
    }
    function chatRespond(text) {
        const g = GROUPS[currentGroup];
        const t = text.trim();
        // student mention?
        let matched = null;
        for (const sid of g.students) {
            const name = STUDENTS[sid].name;
            const first = name.split(' ')[0];
            if (t.includes(first) || t.includes(name)) { matched = sid; break; }
        }
        if (!matched && /(תלמיד|הילד|הילדה|שנבחר|עליו|עליה|איתו|איתה)/.test(t)) matched = currentStudent;

        if (matched) {
            const s = STUDENTS[matched];
            const acts = (s.aiSummary.actions || []).map(a => `<br>• ${a.label}`).join('');
            return `לגבי <b>${s.name}</b>: ${s.aiSummary.text}${acts ? `<br><br><b>מה כדאי לעשות:</b>${acts}` : ''}`;
        }
        if (/(מי|להתמקד|דחוף|דורש|תשומת)/.test(t)) {
            const names = g.attention.map(id => STUDENTS[id].name).join(', ');
            return `כרגע מומלץ להתמקד ב-<b>${g.attention.length} תלמידים</b> ב${g.name}: ${names}. רוצה שאפרט על אחד מהם? כתבי לי את שמו.`;
        }
        // class-level default
        const sm = g.summary;
        return `תמונת מצב של <b>${g.name}</b>: התקדמות ${sm.progress}%, מעורבות ${sm.engagement}%, ${sm.active}/${sm.total} תלמידים פעילים, ${sm.attention} דורשים תשומת לב.<br><br>${g.aiSummary.text}`;
    }
    function chatSend(forcedText) {
        const input = document.getElementById('chatInput');
        const t = (forcedText != null ? forcedText : input.value).trim();
        if (!t) return;
        chatAppend('me', escapeHtml(t));
        input.value = '';
        input.style.height = 'auto';
        const typing = chatShowTyping();
        setTimeout(() => {
            typing.remove();
            chatAppend('ai', chatRespond(t));
        }, 650);
    }
    function initChat() {
        chatAppend('ai', `שלום <b>${TEACHER.first}</b>! אפשר לשאול אותי כל דבר על הכיתה או על תלמיד ספציפי — תמונת מצב, המלצות, או מה כדאי לעשות הלאה.`);
        const input = document.getElementById('chatInput');
        document.getElementById('chatSend').addEventListener('click', () => chatSend());
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatSend(); }
        });
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 96) + 'px';
        });
        document.getElementById('chatChips').addEventListener('click', e => {
            const c = e.target.closest('.chat-chip'); if (!c) return;
            chatSend(c.dataset.q);
        });
    }

    /* ===================== TOP TABS + MESSAGES + CALENDAR ===================== */
    let currentTab = 'dashboard';
    let activeMsgStudent = null;

    const MSG_THREADS = {
        ron:    { unread: 2, messages: [
            { from:'me',   text:'היי רון, שמתי לב שלא נכנסת כמה ימים — הכל בסדר? 😊', day:'אתמול', time:'09:10' },
            { from:'them', text:'היי המורה, היה לי קצת עומס... אני אחזור היום', day:'אתמול', time:'18:24' },
            { from:'them', text:'אפשר עזרה במשוואות מילוליות? זה קשה לי', day:'היום', time:'08:05' },
        ]},
        noam:   { unread: 1, messages: [
            { from:'me',   text:'נועם, ראיתי שהתאמצת במשימות האחרונות — כל הכבוד! 👏', day:'אתמול', time:'12:40' },
            { from:'them', text:'תודה! אני אנסה את התרגול ששלחת', day:'היום', time:'07:50' },
        ]},
        shahar: { unread: 0, messages: [
            { from:'me',   text:'שחר, שלחתי לך סרטון קצר על המרת שברים לאחוזים 🎬', day:'אתמול', time:'15:20' },
            { from:'them', text:'מעולה, אני אצפה בערב 🙂', day:'אתמול', time:'17:02' },
        ]},
        maya:   { unread: 0, messages: [
            { from:'me',   text:'מאיה, הכנתי לך אתגר חקר מתקדם — בא לך? ⭐', day:'אתמול', time:'11:00' },
            { from:'them', text:'כן בטח! אני אוהבת אתגרים 🚀', day:'אתמול', time:'11:15' },
        ]},
    };
    const MSG_ORDER = ['ron','noam','shahar','maya'];
    const STU_REPLIES = ['תודה המורה! 😊','הבנתי, אני אנסה 💪','אוקיי, אני על זה','מתי המפגש הבא שלנו?','אפשר עוד דוגמה אחת?'];

    function updateMsgBadge(){
        const total = MSG_ORDER.reduce((n,id)=> n + (MSG_THREADS[id].unread||0), 0);
        const b = document.getElementById('msgBadge');
        if(total>0){ b.textContent = total; b.style.display=''; } else { b.style.display='none'; }
    }

    function renderMsgStudents(){
        const wrap = document.getElementById('msgStudents');
        wrap.innerHTML = '<div class="msg-students-title">התלמידים שלי</div>' + MSG_ORDER.map(id=>{
            const s = STUDENTS[id]; const t = MSG_THREADS[id];
            const last = t.messages[t.messages.length-1];
            const prev = (last.from==='me'?'אני: ':'') + last.text;
            const col = avaColor(s.name);
            return `<div class="stu-item ${id===activeMsgStudent?'active':''}" data-stu="${id}">
                <div class="stu-ava" style="background:${col}">${s.avatar}</div>
                <div class="stu-info">
                    <div class="stu-name">${s.name}</div>
                    <div class="stu-preview">${prev}</div>
                </div>
                ${t.unread?`<span class="stu-unread">${t.unread}</span>`:''}
            </div>`;
        }).join('');
        wrap.querySelectorAll('.stu-item').forEach(el=> el.addEventListener('click', ()=> selectMsgStudent(el.dataset.stu)));
    }

    function selectMsgStudent(id){
        activeMsgStudent = id;
        MSG_THREADS[id].unread = 0;
        updateMsgBadge();
        renderMsgStudents();
        renderMsgThread();
    }

    function nowHM(){ const d=new Date(); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }

    function renderMsgThread(){
        const wrap = document.getElementById('msgThread');
        if(!activeMsgStudent){
            wrap.innerHTML = `<div class="thread-empty"><div class="te-ico">💬</div><div>בחר/י תלמיד מהרשימה כדי להתחיל שיחה</div></div>`;
            return;
        }
        const s = STUDENTS[activeMsgStudent]; const t = MSG_THREADS[activeMsgStudent];
        const online = (typeof LIVE!=='undefined' && LIVE[activeMsgStudent] && LIVE[activeMsgStudent].online);
        const col = avaColor(s.name);
        let lastDay = '';
        const body = t.messages.map(m=>{
            let sep = '';
            if(m.day && m.day!==lastDay){ sep = `<div class="m-day">${m.day}</div>`; lastDay = m.day; }
            return `${sep}<div class="m-bubble ${m.from}">${escapeHtml(m.text)}<div class="m-time">${m.time}</div></div>`;
        }).join('');
        wrap.innerHTML = `
            <div class="thread-head">
                <div class="th-ava" style="background:${col}">${s.avatar}</div>
                <div><div class="th-name">${s.name}</div>
                <div class="th-sub">${online?'<span class="live-dot2"></span> מחובר/ת עכשיו':s.grade}</div></div>
            </div>
            <div class="thread-body" id="threadBody">${body}</div>
            <form class="thread-input" id="threadForm">
                <input id="threadInput" placeholder="כתוב/כתבי ל${s.name.split(' ')[0]}..." autocomplete="off">
                <button type="submit" title="שליחה">➤</button>
            </form>`;
        const tb = document.getElementById('threadBody'); tb.scrollTop = tb.scrollHeight;
        document.getElementById('threadForm').addEventListener('submit', e=>{
            e.preventDefault();
            const inp = document.getElementById('threadInput');
            const v = inp.value.trim(); if(!v) return;
            sendStudentMsg(v); inp.value='';
        });
    }

    function sendStudentMsg(text){
        const id = activeMsgStudent; if(!id) return;
        MSG_THREADS[id].messages.push({ from:'me', text, day:'היום', time: nowHM() });
        renderMsgThread();
        setTimeout(()=>{
            const r = STU_REPLIES[Math.floor(Math.random()*STU_REPLIES.length)];
            MSG_THREADS[id].messages.push({ from:'them', text:r, day:'היום', time: nowHM() });
            if(activeMsgStudent===id) renderMsgThread();
        }, 1400);
    }

    // ----- Calendar -----
    const CAL_YEAR = 2026, CAL_MONTH = 5; // June (0-indexed)
    const CAL_MONTH_NAMES = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
    const CAL_WEEKDAYS = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];
    const CAL_DAY_NAMES = ['יום ראשון','יום שני','יום שלישי','יום רביעי','יום חמישי','יום שישי','שבת'];
    const EV_TYPES = {
        meeting:  { color:'#7c5cff', soft:'#f3effe', ico:'👩‍🏫', tag:'מפגש כיתה' },
        talk:     { color:'#4071b8', soft:'#eef4fd', ico:'💬', tag:'שיחה אישית' },
        task:     { color:'#3d9466', soft:'#eefaf1', ico:'✍️', tag:'מטלה' },
        deadline: { color:'#c25b66', soft:'#fdf3f4', ico:'⏰', tag:'דדליין' },
        parents:  { color:'#b9842f', soft:'#fdf6ec', ico:'👨‍👩‍👧', tag:'מפגש הורים' },
    };
    const CAL_EVENTS = {
        '2026-06-19': [ {time:'14:00', type:'talk', title:'שיחה אישית עם רון לוי'} ],
        '2026-06-21': [ {time:'10:00', type:'meeting', title:'מפגש כיתה ח׳1 — מתמטיקה'}, {time:'13:00', type:'task', title:'בדיקת מטלות שבועיות'} ],
        '2026-06-23': [ {time:'12:00', type:'parents', title:'מפגש הורים — נועם כהן'} ],
        '2026-06-25': [ {time:'כל היום', type:'deadline', title:'דדליין דוחות התקדמות'} ],
        '2026-06-28': [ {time:'09:00', type:'meeting', title:'מפגש כיתה ז׳2 — מתמטיקה'} ],
    };
    const CAL_TODAY = '2026-06-19';
    function dstr(y,m,d){ return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }

    function renderCalMonth(){
        const startDay = new Date(CAL_YEAR, CAL_MONTH, 1).getDay();
        const daysInMonth = new Date(CAL_YEAR, CAL_MONTH+1, 0).getDate();
        let cells = '';
        for(let i=0;i<startDay;i++) cells += `<div class="cal-cell blank"></div>`;
        for(let d=1; d<=daysInMonth; d++){
            const ds = dstr(CAL_YEAR, CAL_MONTH, d);
            const evs = CAL_EVENTS[ds] || [];
            const chips = evs.map(e=>{
                const m = EV_TYPES[e.type];
                return `<div class="cal-chip" style="--ev-color:${m.color};--ev-soft:${m.soft}" title="${e.time} · ${e.title}">${m.ico} ${e.title}</div>`;
            }).join('');
            cells += `<div class="cal-cell ${ds===CAL_TODAY?'today':''}"><div class="cal-cell-num">${d}</div>${chips}</div>`;
        }
        document.getElementById('calMonthWrap').innerHTML = `
            <div class="cal-grid">
                <div class="cal-weekdays">${CAL_WEEKDAYS.map(w=>`<div>${w}</div>`).join('')}</div>
                <div class="cal-days">${cells}</div>
            </div>`;
        document.getElementById('calMonthTitle').textContent = `${CAL_MONTH_NAMES[CAL_MONTH]} ${CAL_YEAR}`;
    }

    function renderCalList(){
        const keys = Object.keys(CAL_EVENTS).sort();
        const html = keys.map(ds=>{
            const [y,m,d] = ds.split('-').map(Number);
            const dt = new Date(y, m-1, d);
            const events = CAL_EVENTS[ds].map(e=>{
                const meta = EV_TYPES[e.type];
                return `<div class="cal-event" style="--ev-color:${meta.color};--ev-soft:${meta.soft}">
                    <div class="cal-ev-time">${e.time}</div>
                    <div class="cal-ev-ico">${meta.ico}</div>
                    <div class="cal-ev-body"><div class="cal-ev-title">${e.title}</div><div class="cal-ev-tag">${meta.tag}</div></div>
                </div>`;
            }).join('');
            return `<div class="cal-day">
                <div class="cal-day-head">
                    <div class="cal-day-num"><b>${d}</b><span>${CAL_MONTH_NAMES[m-1]}</span></div>
                    <div><div class="cal-day-label">${CAL_DAY_NAMES[dt.getDay()]}${ds===CAL_TODAY?' · היום':''}</div>
                    <div class="cal-day-sub">${d} ב${CAL_MONTH_NAMES[m-1]} ${y}</div></div>
                </div>
                <div class="cal-events">${events}</div>
            </div>`;
        }).join('');
        document.getElementById('calListWrap').innerHTML = `<div class="cal-agenda">${html}</div>`;
    }

    function setTab(tab){
        currentTab = tab;
        const isDash = tab==='dashboard';
        document.querySelector('.main').style.display = isDash ? '' : 'none';
        document.querySelector('.chat-panel').style.display = isDash ? '' : 'none';
        document.getElementById('messagesPane').style.display = tab==='messages' ? '' : 'none';
        document.getElementById('calendarPane').style.display = tab==='calendar' ? '' : 'none';
        document.querySelectorAll('#topTabs .tt-btn').forEach(b=> b.classList.toggle('active', b.dataset.tab===tab));
        if(tab==='messages'){
            if(!activeMsgStudent) activeMsgStudent = MSG_ORDER[0];
            MSG_THREADS[activeMsgStudent].unread = 0;
            updateMsgBadge();
            renderMsgStudents(); renderMsgThread();
        }
        if(tab==='calendar'){ renderCalMonth(); renderCalList(); }
        window.scrollTo({ top:0, behavior:'smooth' });
    }

    document.getElementById('topTabs').addEventListener('click', e=>{
        const b = e.target.closest('.tt-btn'); if(!b) return;
        setTab(b.dataset.tab);
    });
    document.getElementById('calViewToggle').addEventListener('click', e=>{
        const b = e.target.closest('.cvt-btn'); if(!b) return;
        document.querySelectorAll('#calViewToggle .cvt-btn').forEach(c=> c.classList.toggle('active', c===b));
        const month = b.dataset.cv==='month';
        document.getElementById('calMonthWrap').style.display = month ? '' : 'none';
        document.getElementById('calListWrap').style.display = month ? 'none' : '';
    });

    // boot
    renderShell();
    renderAll();
    initChat();
    setView('class');
    updateContextLine();
    startLive();
    updateMsgBadge();

}
