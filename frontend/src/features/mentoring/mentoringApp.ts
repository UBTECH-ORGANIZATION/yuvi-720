// @ts-nocheck
/* eslint-disable */

export function initMentoring() {
        // ================= MOCK DATA =================
        const STUDENT_NAMES = {
            student_001: { name: 'יובל כהן', avatar: 'י' },
            student_002: { name: 'נועה לוי', avatar: 'נ' },
            student_003: { name: 'אדם ברק', avatar: 'א' },
            student_004: { name: 'מיכל דוד', avatar: 'מ' },
            student_005: { name: 'עומר שלום', avatar: 'ע' },
            student_006: { name: 'שירה אבירם', avatar: 'ש' },
        };

        // author: 'teacher' | 'student'
        // visibility: 'all_teachers' | 'student_teacher'
        const MENTORING_DATA = {
            student_001: [
                {
                    id: 'm1', date: '2026-06-08', teacher: 'מירי לוי', stage: 'הצבת יעדים',
                    text: 'דיברנו על ההתקדמות במתמטיקה. יובל הביע רצון להשתפר בשברים. סיכמנו שנפגש שוב בעוד שבועיים לבדוק את ההתקדמות. יובל היה מאוד ממוקד ושיתף פעולה.',
                    nextSteps: 'לתרגל 3 דפי שברים ולצפות בסרטון ההסבר שהמורה שלחה.',
                    deadline: '2026-06-22', author: 'teacher', visibility: 'all_teachers'
                },
                {
                    id: 'm2', date: '2026-05-28', teacher: 'מירי לוי', stage: 'תמיכה וליווי',
                    text: 'שיחת תמיכה אחרי תקופה עמוסה. עזרנו ליובל לארגן את לוח הזמנים שלו ולחלק את המשימות לחלקים קטנים יותר.',
                    nextSteps: 'לנהל יומן למידה שבועי ולסמן כל יום מה הספקתי.',
                    deadline: '2026-06-15', author: 'teacher', visibility: 'student_teacher'
                },
                {
                    id: 'm3', date: '2026-06-09', teacher: 'מירי לוי', stage: 'פגישת מעקב',
                    text: 'הרגשתי שהשיחה עם המורה עזרה לי. הבנתי איך לגשת לשברים בצורה אחרת. עדיין קצת קשה לי עם החילוק אבל אני מרגיש יותר בטוח.',
                    nextSteps: 'לבקש מהמורה עוד דוגמה אחת על חילוק שברים בפגישה הבאה.',
                    deadline: '2026-06-22', author: 'student', visibility: 'student_teacher'
                },
            ],
            student_002: [
                {
                    id: 'm1', date: '2026-06-05', teacher: 'דנה כהן', stage: 'פגישת היכרות',
                    text: 'פגישת היכרות ראשונה עם נועה. דיברנו על תחומי העניין שלה באמנות ובכתיבה. נועה מאוד יצירתית ומביעה את עצמה היטב.',
                    nextSteps: 'נועה תבחר נושא לפרויקט יצירתי שתרצה להעמיק בו.',
                    deadline: '2026-06-19', author: 'teacher', visibility: 'all_teachers'
                },
                {
                    id: 'm2', date: '2026-06-06', teacher: 'דנה כהן', stage: 'פגישת היכרות',
                    text: 'נהניתי מאוד מהשיחה עם המורה דנה. סיפרתי לה שאני אוהבת לכתוב סיפורים ולצייר. היא הציעה לי לשלב את שניהם בפרויקט.',
                    nextSteps: 'לחשוב על רעיון לסיפור מאויר עד הפגישה הבאה.',
                    deadline: '2026-06-19', author: 'student', visibility: 'student_teacher'
                },
            ],
            student_003: [
                {
                    id: 'm1', date: '2026-06-07', teacher: 'אבי שלום', stage: 'הצבת יעדים',
                    text: 'אדם מתעניין מאוד בספורט ובמדעים. הצבנו יעד לשלב פעילות גופנית עם למידה על גוף האדם. אדם מלא אנרגיה ומוטיבציה.',
                    nextSteps: 'לקרוא פרק על מערכת השרירים ולהכין שאלה אחת מעניינת.',
                    deadline: '2026-06-21', author: 'teacher', visibility: 'all_teachers'
                },
            ],
            student_004: [
                {
                    id: 'm1', date: '2026-06-04', teacher: 'רונית אבטליון', stage: 'תמיכה וליווי',
                    text: 'שיחת ליווי עם מיכל. דיברנו על איך להתמודד עם לחץ לפני מבחנים. מיכל למדה כמה טכניקות נשימה והרגעה.',
                    nextSteps: 'לתרגל את תרגיל הנשימה לפני כל משימה גדולה.',
                    deadline: '2026-06-18', author: 'teacher', visibility: 'student_teacher'
                },
            ],
            student_005: [
                {
                    id: 'm1', date: '2026-06-03', teacher: 'אבי שלום', stage: 'פגישת מעקב',
                    text: 'עומר התקדם יפה בקריאה. השיחה התמקדה בחיזוק הביטחון העצמי שלו בהבעה בעל פה מול הכיתה.',
                    nextSteps: 'להכין הצגה קצרה של דקה על נושא אהוב.',
                    deadline: '2026-06-17', author: 'teacher', visibility: 'all_teachers'
                },
            ],
            student_006: [
                {
                    id: 'm1', date: '2026-06-02', teacher: 'דנה כהן', stage: 'סיכום תקופה',
                    text: 'סיכום תקופה עם שירה. עברנו על כל ההישגים שלה ברבעון האחרון. שירה הראתה התמדה מרשימה והתקדמות יפה במדעים.',
                    nextSteps: 'לבחור יעד חדש אחד לרבעון הבא.',
                    deadline: '2026-06-16', author: 'teacher', visibility: 'all_teachers'
                },
            ],
        };

        let currentStudent = 'student_001';
        let currentFilter = 'all';

        const STAGE_ICONS = {
            'פגישת היכרות': '👋',
            'הצבת יעדים': '🎯',
            'פגישת מעקב': '🔄',
            'תמיכה וליווי': '🤝',
            'סיכום תקופה': '📋',
        };

        function formatDate(iso) {
            if (!iso) return '';
            const [y, m, d] = iso.split('-');
            return `${d}.${m}.${y}`;
        }

        function render() {
            const sName = STUDENT_NAMES[currentStudent];
            document.getElementById('sidebarName').textContent = sName.name;
            document.getElementById('sidebarAvatar').textContent = sName.avatar;

            let records = (MENTORING_DATA[currentStudent] || []).slice();
            if (currentFilter !== 'all') records = records.filter(r => r.author === currentFilter);
            // newest first
            records.sort((a, b) => b.date.localeCompare(a.date));

            const list = document.getElementById('convList');
            if (!records.length) {
                list.innerHTML = `<div class="empty-state"><span class="emo">💬</span>אין עדיין תיעוד שיחות להצגה.<br>אפשר להוסיף תיעוד באמצעות הכפתור למעלה.</div>`;
                return;
            }

            list.innerHTML = records.map(r => {
                const isStudent = r.author === 'student';
                const authorBadge = isStudent
                    ? `<span class="author-badge student">📝 נכתב על ידי</span>`
                    : `<span class="author-badge teacher">👩‍🏫 נכתב ע״י המורה</span>`;
                const visBadge = r.visibility === 'all_teachers'
                    ? `<span class="vis-badge all">👥 גלוי לכל המורים ולך</span>`
                    : `<span class="vis-badge private">🔒 גלוי לך ולמורה בלבד</span>`;
                const deadlineChip = r.deadline
                    ? `<span class="deadline-chip">⏰ עד ${formatDate(r.deadline)}</span>` : '';
                return `
                <div class="conv-card ${isStudent ? 'by-student' : ''}">
                    <div class="conv-top">
                        <span class="stage-badge">${STAGE_ICONS[r.stage] || '💬'} ${r.stage}</span>
                        <span class="conv-date">📅 ${formatDate(r.date)}</span>
                        ${authorBadge}
                    </div>
                    <div class="conv-people">
                        <span class="person">👩‍🏫 מורה: <b>${r.teacher}</b></span>
                        <span class="person">🎓 לומד: <b>${STUDENT_NAMES[currentStudent].name}</b></span>
                    </div>
                    <div class="conv-body">${r.text}</div>
                    <div class="next-steps">
                        <span class="ns-ico">🚀</span>
                        <span class="ns-text"><b>צעדים להמשך</b>${r.nextSteps}</span>
                        ${deadlineChip}
                    </div>
                    <div class="visibility-row">מי רואה את התיעוד? ${visBadge}</div>
                </div>`;
            }).join('');
        }

        // ===== Toast =====
        let toastTimer = null;
        function showToast(title, sub) {
            document.getElementById('toastTitle').textContent = title;
            document.getElementById('toastSub').textContent = sub || '';
            const t = document.getElementById('toast');
            t.classList.add('show');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
        }

        // ===== Modal =====
        function openModal() {
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('fDate').value = today;
            document.getElementById('fStudent').value = STUDENT_NAMES[currentStudent].name;
            document.getElementById('fStage').value = 'פגישת מעקב';
            document.getElementById('fText').value = '';
            document.getElementById('fSteps').value = '';
            document.getElementById('fDeadline').value = '';
            document.getElementById('modalOverlay').classList.add('open');
        }
        function closeModal() {
            document.getElementById('modalOverlay').classList.remove('open');
        }
        function saveConv() {
            const date = document.getElementById('fDate').value;
            const stage = document.getElementById('fStage').value;
            const teacher = document.getElementById('fTeacher').value;
            const text = document.getElementById('fText').value.trim();
            const steps = document.getElementById('fSteps').value.trim();
            const deadline = document.getElementById('fDeadline').value;

            if (!date || !text || !steps) {
                showToast('חסרים פרטים', 'נא למלא תאריך, תיעוד שיחה וצעדים להמשך');
                document.querySelector('.toast').style.borderRightColor = '#f6ad55';
                return;
            }
            document.querySelector('.toast').style.borderRightColor = '#48bb78';

            const newRec = {
                id: 'm' + Date.now(), date, teacher, stage, text,
                nextSteps: steps, deadline,
                author: 'student', visibility: 'student_teacher'
            };
            if (!MENTORING_DATA[currentStudent]) MENTORING_DATA[currentStudent] = [];
            MENTORING_DATA[currentStudent].unshift(newRec);
            closeModal();
            // switch to "all" so the new record is visible
            currentFilter = 'all';
            document.querySelectorAll('.filter-tab').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
            render();
            showToast('התיעוד נשמר! 🎉', 'השיחה גלויה לך ולמורה שאיתו נפגשת');
        }

        // ===== Events =====
        document.getElementById('mockStudentSelect').addEventListener('change', (e) => {
            currentStudent = e.target.value;
            render();
        });
        document.getElementById('filterTabs').addEventListener('click', (e) => {
            const btn = e.target.closest('.filter-tab');
            if (!btn) return;
            currentFilter = btn.dataset.filter;
            document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            render();
        });
        document.getElementById('addConvBtn').addEventListener('click', openModal);
        document.getElementById('modalClose').addEventListener('click', closeModal);
        document.getElementById('cancelConvBtn').addEventListener('click', closeModal);
        document.getElementById('saveConvBtn').addEventListener('click', saveConv);
        document.getElementById('modalOverlay').addEventListener('click', (e) => {
            if (e.target.id === 'modalOverlay') closeModal();
        });

        // ================= AI ASSISTANT (Yubi Copilot) =================
        const AI_AVA = `<svg viewBox="0 0 44 44" width="16" height="16" fill="none">
            <rect x="9" y="15" width="26" height="21" rx="6" fill="#fff"/>
            <rect x="15" y="21" width="5" height="5" rx="2" fill="#7c5cff"/>
            <rect x="24" y="21" width="5" height="5" rx="2" fill="#7c5cff"/>
            <path d="M18 30 Q22 33 26 30" stroke="#22d3ee" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        </svg>`;

        let aiSeeded = false;

        function studentRecords() {
            return (MENTORING_DATA[currentStudent] || []).slice().sort((a, b) => b.date.localeCompare(a.date));
        }

        // Build Yubi's summary of all the documentation
        function buildSummary() {
            const recs = studentRecords();
            const name = STUDENT_NAMES[currentStudent].name.split(' ')[0];
            if (!recs.length) {
                return `<div class="ai-summary-card"><h4>✨ סיכום של יובי</h4><p style="font-size:0.79rem;color:var(--text-medium)">עדיין אין שיחות מתועדות. אחרי הפגישה הראשונה אסכם לך הכל כאן! 😊</p></div>`;
            }
            const teachers = [...new Set(recs.map(r => r.teacher))];
            const stages = [...new Set(recs.map(r => r.stage))];
            const openSteps = recs.filter(r => r.nextSteps);
            const nearest = openSteps
                .filter(r => r.deadline)
                .sort((a, b) => a.deadline.localeCompare(b.deadline))[0];

            const items = [];
            items.push(`<li><span class="li-ico">🗂️</span> תיעדנו <b>${recs.length}</b> שיחות מנטורינג עם ${teachers.join(', ')}.</li>`);
            items.push(`<li><span class="li-ico">🎯</span> השלבים שעברנו: ${stages.join(' · ')}.</li>`);
            if (recs[0]) items.push(`<li><span class="li-ico">🕒</span> השיחה האחרונה (${formatDate(recs[0].date)}): ${recs[0].text.slice(0, 70)}…</li>`);
            if (nearest) items.push(`<li><span class="li-ico">⏰</span> הצעד הקרוב ביותר: "${nearest.nextSteps}" — עד <b>${formatDate(nearest.deadline)}</b>.</li>`);
            items.push(`<li><span class="li-ico">💪</span> ${name}, אתה ממש מתמיד בליווי האישי שלך — כל הכבוד!</li>`);

            return `<div class="ai-summary-card"><h4>✨ סיכום של יובי על השיחות שלך</h4><ul>${items.join('')}</ul></div>`;
        }

        // Generate an answer based on the documentation
        function aiAnswer(msg) {
            const recs = studentRecords();
            const name = STUDENT_NAMES[currentStudent].name.split(' ')[0];
            const m = (msg || '').toLowerCase();

            if (!recs.length) return `עדיין אין לי שיחות לסכם 😊 אחרי הפגישה הראשונה אוכל לעזור לך יותר!`;

            const withDeadline = recs.filter(r => r.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline));
            const nearest = withDeadline[0];

            if (/(צעד|משימ|מה עלי|מה אני צריך|לעשות|המשך)/.test(m)) {
                const steps = recs.filter(r => r.nextSteps).map(r => `• ${r.nextSteps}${r.deadline ? ` (עד ${formatDate(r.deadline)})` : ''}`);
                return `הנה הצעדים להמשך שסיכמנו בשיחות שלך:\n${steps.join('\n')}\n\nרוצה שנתחיל מאחד מהם? 💪`;
            }
            if (/(דד.?ליין|מתי|תאריך|דחוף|זמן)/.test(m)) {
                return nearest
                    ? `הדד-ליין הקרוב ביותר שלך הוא ל"${nearest.nextSteps}" — עד <b>${formatDate(nearest.deadline)}</b>. ⏰ עוד יש לך זמן, בוא נתכנן את זה יחד!`.replace(/<\/?b>/g, '')
                    : `אין כרגע תאריך יעד מוגדר בשיחות. אפשר להוסיף אחד כשמתעדים שיחה חדשה 😊`;
            }
            if (/(מורה|מי דיבר|עם מי|נפגש)/.test(m)) {
                const teachers = [...new Set(recs.map(r => r.teacher))];
                return `נפגשת עם: ${teachers.join(', ')}. השיחה האחרונה הייתה עם ${recs[0].teacher} בתאריך ${formatDate(recs[0].date)}. 👩‍🏫`;
            }
            if (/(על מה|מה דיברנו|נושא|סיכום|תזכיר|מה היה)/.test(m)) {
                const last = recs[0];
                return `בשיחה האחרונה (${last.stage}, ${formatDate(last.date)}) דיברתם על:\n"${last.text}"\n\nוסיכמתם להמשך: ${last.nextSteps} 🎯`;
            }
            if (/(יעד|מטר|להשתפר|להתקדם)/.test(m)) {
                const goalRec = recs.find(r => r.stage === 'הצבת יעדים') || recs[0];
                return `היעד שהצבת בשיחה עם ${goalRec.teacher}: "${goalRec.nextSteps}". אני כאן ללוות אותך עד שתשיג אותו! 🌟`;
            }
            if (/(תודה|מגניב|אחלה|מעולה|יאללה)/.test(m)) {
                return `בכיף ${name}! 💜 אני תמיד כאן לעזור לך לעקוב אחרי השיחות והיעדים שלך.`;
            }
            if (/(מי רואה|פרטי|סודי|נראות|מורים אחרים)/.test(m)) {
                return `שיחות שאתה כותב גלויות רק לך ולמורה שאיתו נפגשת 🔒. למורה יש אפשרות להחליט אם תיעוד שלו גלוי לכל המורים או רק לך ולו.`;
            }
            return `שאלה טובה ${name}! 🤔 על סמך ${recs.length} השיחות שלך — אפשר לשאול אותי על הצעדים להמשך, הדד-ליינים, על מה דיברתם, או מי המורים. נסה אחת מההצעות למטה 👇`;
        }

        function aiAddMsg(html, who) {
            const body = document.getElementById('aiBody');
            const row = document.createElement('div');
            row.className = 'ai-msg ' + who;
            row.innerHTML = (who === 'bot' ? `<div class="m-ava">${AI_AVA}</div>` : '') + `<div class="m-bubble">${html}</div>`;
            body.appendChild(row);
            body.scrollTop = body.scrollHeight;
        }
        function aiBotReply(text) {
            const body = document.getElementById('aiBody');
            const t = document.createElement('div');
            t.className = 'ai-msg bot';
            t.innerHTML = `<div class="m-ava">${AI_AVA}</div><div class="ai-typing"><span></span><span></span><span></span></div>`;
            body.appendChild(t);
            body.scrollTop = body.scrollHeight;
            setTimeout(() => { t.remove(); aiAddMsg(text, 'bot'); }, 750 + Math.min(text.length * 9, 800));
        }
        function aiRenderSuggestions() {
            const sug = document.getElementById('aiSuggestions');
            const chips = ['מה הצעדים שלי? 🚀', 'מתי הדד-ליין? ⏰', 'על מה דיברנו? 💬', 'מי רואה את התיעוד? 🔒'];
            sug.innerHTML = chips.map(c => `<button type="button">${c}</button>`).join('');
            sug.querySelectorAll('button').forEach(b => b.addEventListener('click', () => aiSend(b.textContent)));
        }
        function aiSend(text) {
            if (!text.trim()) return;
            aiAddMsg(text, 'user');
            aiBotReply(aiAnswer(text));
        }
        function aiSeed() {
            const body = document.getElementById('aiBody');
            body.innerHTML = '';
            const name = STUDENT_NAMES[currentStudent].name.split(' ')[0];
            aiAddMsg(`היי ${name}! 👋 עברתי על כל שיחות המנטורינג שלך. הנה מה שמצאתי:`, 'bot');
            // summary card as a bot message
            const sumRow = document.createElement('div');
            sumRow.className = 'ai-msg bot';
            sumRow.innerHTML = `<div class="m-ava">${AI_AVA}</div>${buildSummary()}`;
            body.appendChild(sumRow);
            aiAddMsg('אפשר לשאול אותי כל שאלה על השיחות, הצעדים או היעדים שלך 😊', 'bot');
            aiRenderSuggestions();
            aiSeeded = true;
        }
        function openAi() {
            document.getElementById('aiPanel').classList.add('open');
            document.getElementById('aiFab').classList.add('hidden');
            aiSeed(); // re-seed each open so it reflects the current student
        }
        function closeAi() {
            document.getElementById('aiPanel').classList.remove('open');
            document.getElementById('aiFab').classList.remove('hidden');
        }
        document.getElementById('aiFab').addEventListener('click', openAi);
        document.getElementById('aiClose').addEventListener('click', closeAi);
        document.getElementById('aiForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const inp = document.getElementById('aiInput');
            aiSend(inp.value);
            inp.value = '';
        });

        // init
        render();

}
