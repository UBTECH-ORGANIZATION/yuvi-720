// @ts-nocheck
/* eslint-disable */

export function initLearningPortal() {
        // ================================================
        // DATA
        // ================================================
        const SUBJECTS = [
            {
                id: 'math',
                name: 'מתמטיקה',
                icon: '🔢',
                iconBg: 'rgba(124,92,255,0.1)',
                gradient: 'linear-gradient(135deg, #7c5cff, #9f7afe)',
                desc: 'גיאומטריה, חשבון ואלגברה',
                progress: 35,
                recommended: true,
                reason: 'ראיתי שאתה אוהב אתגרים ויש לך חשיבה ויזואלית חזקה - גיאומטריה זה בדיוק בשבילך! נתחיל מזוויות ונתקדם למשולשים.',
                stages: [
                    { id: 's1', title: 'סוגי זוויות', desc: 'לזהות זוויות חדות, ישרות, קהות ושטוחות', status: 'current' },
                    { id: 's2', title: 'מדידת זוויות', desc: 'שימוש במד-זווית', status: 'locked' },
                    { id: 's3', title: 'זוויות משלימות', desc: 'זוויות שסכומן 180°', status: 'locked' },
                    { id: 's4', title: 'זוויות במשולש', desc: 'סכום זוויות במשולש', status: 'locked' },
                    { id: 's5', title: 'משולשים - סיכום', desc: 'חזרה על הנלמד', status: 'locked' },
                ]
            },
            {
                id: 'science',
                name: 'מדעים',
                icon: '🔬',
                iconBg: 'rgba(99,179,237,0.1)',
                gradient: 'linear-gradient(135deg, #63b3ed, #4299e1)',
                desc: 'חשמל, אנרגיה ותופעות טבע',
                progress: 20,
                recommended: true,
                reason: 'ציינת שמדע בידור מעניין אותך - נתחיל מניסויים בחשמל שאפשר לעשות בבית!',
                stages: [
                    { id: 's1', title: 'מעגל חשמלי פשוט', desc: 'בניית מעגל עם סוללה ונורה', status: 'current' },
                    { id: 's2', title: 'מוליכים ומבודדים', desc: 'מה מעביר חשמל ומה לא', status: 'locked' },
                    { id: 's3', title: 'מעגל טורי ומקבילי', desc: 'חיבור נורות בסדר שונה', status: 'locked' },
                ]
            },
            {
                id: 'robotics',
                name: 'רובוטיקה',
                icon: '🤖',
                iconBg: 'rgba(72,187,120,0.1)',
                gradient: 'linear-gradient(135deg, #48bb78, #38a169)',
                desc: 'תכנות, חיישנים ובנייה',
                progress: 0,
                recommended: true,
                reason: 'אמרת שרובוטיקה מעניינת אותך! נתחיל מהבסיס - איך רובוט "חושב" ומקבל החלטות.',
                stages: [
                    { id: 's1', title: 'מהו רובוט?', desc: 'היכרות עם חלקי רובוט בסיסי', status: 'current' },
                    { id: 's2', title: 'חיישנים', desc: 'איך רובוט מרגיש את הסביבה', status: 'locked' },
                    { id: 's3', title: 'פקודות בסיסיות', desc: 'תכנות תנועה פשוטה', status: 'locked' },
                ]
            },
            {
                id: 'english',
                name: 'אנגלית',
                icon: '🌍',
                iconBg: 'rgba(246,173,85,0.1)',
                gradient: 'linear-gradient(135deg, #f6ad55, #ed8936)',
                desc: 'קריאה, כתיבה ואוצר מילים',
                progress: 55,
                recommended: false,
                stages: [
                    { id: 's1', title: 'Reading Comprehension', desc: 'הבנת טקסט בסיסי', status: 'done' },
                    { id: 's2', title: 'Vocabulary - Animals', desc: 'מילים חדשות: בעלי חיים', status: 'current' },
                    { id: 's3', title: 'Simple Sentences', desc: 'בניית משפטים פשוטים', status: 'locked' },
                ]
            },
            {
                id: 'art',
                name: 'אמנות דיגיטלית',
                icon: '🎨',
                iconBg: 'rgba(236,72,153,0.1)',
                gradient: 'linear-gradient(135deg, #ec4899, #be185d)',
                desc: 'עיצוב, ציור ויצירה',
                progress: 10,
                recommended: false,
                stages: [
                    { id: 's1', title: 'צבעים ראשוניים', desc: 'הכרת גלגל הצבעים', status: 'current' },
                    { id: 's2', title: 'קומפוזיציה', desc: 'סידור אלמנטים בתמונה', status: 'locked' },
                ]
            },
            {
                id: 'tech',
                name: 'טכנולוגיה',
                icon: '💻',
                iconBg: 'rgba(34,211,238,0.1)',
                gradient: 'linear-gradient(135deg, #22d3ee, #06b6d4)',
                desc: 'תכנות, אלגוריתמים וחשיבה',
                progress: 45,
                recommended: false,
                stages: [
                    { id: 's1', title: 'מהו אלגוריתם?', desc: 'צעדים לפתרון בעיה', status: 'done' },
                    { id: 's2', title: 'לולאות', desc: 'פעולות שחוזרות על עצמן', status: 'current' },
                    { id: 's3', title: 'תנאים', desc: 'החלטות בתוכנית', status: 'locked' },
                ]
            }
        ];

        // Game questions for math angles
        const GAME_QUESTIONS = [
            {
                visual: { angle: 45, label: '?' },
                question: 'מה סוג הזווית הזו?',
                answers: ['זווית חדה', 'זווית ישרה', 'זווית קהה', 'זווית שטוחה'],
                correct: 0,
                hint: 'זווית חדה היא כל זווית שקטנה מ-90°'
            },
            {
                visual: { angle: 90, label: '?' },
                question: 'מה סוג הזווית הזו?',
                answers: ['זווית חדה', 'זווית ישרה', 'זווית קהה', 'זווית שטוחה'],
                correct: 1,
                hint: 'זווית ישרה נראית בדיוק כמו פינה של דף'
            },
            {
                visual: { angle: 135, label: '?' },
                question: 'מה סוג הזווית הזו?',
                answers: ['זווית חדה', 'זווית ישרה', 'זווית קהה', 'זווית שטוחה'],
                correct: 2,
                hint: 'זווית קהה גדולה מ-90° אבל קטנה מ-180°'
            },
            {
                visual: { angle: 60, label: '60°' },
                question: 'הזווית הזו היא 60°. איך נסווג אותה?',
                answers: ['חדה - כי קטנה מ-90°', 'ישרה - כי קרובה ל-90°', 'קהה - כי גדולה מ-45°', 'שטוחה'],
                correct: 0,
                hint: 'המבחן היחיד: האם היא קטנה, שווה, או גדולה מ-90°?'
            },
            {
                visual: { angle: 180, label: '?' },
                question: 'כשהקווים יוצרים קו ישר אחד, מה סוג הזווית?',
                answers: ['חדה', 'ישרה', 'קהה', 'שטוחה - 180°'],
                correct: 3,
                hint: 'כשאין "פינה" בכלל והקווים ישרים - זו זווית שטוחה'
            },
            {
                visual: { angle: 110, label: '110°' },
                question: 'זווית של 110° היא:',
                answers: ['חדה', 'ישרה', 'קהה', 'שטוחה'],
                correct: 2,
                hint: '110° גדולה מ-90° וקטנה מ-180°, אז...'
            }
        ];

        // Yubi responses
        const YUBI_CORRECT_RESPONSES = [
            'מעולה! 🎉 ענית נכון! אתה ממש תופס את זה',
            'בול! 🌟 רואה שאתה מבין את הנושא',
            'יופי! ✨ זה בדיוק נכון. אתה מתקדם יפה!',
            'נכון! 💪 ככה ממשיכים. אתה עושה עבודה מצוינת',
        ];

        const YUBI_WRONG_RESPONSES = [
            { text: 'אופס, לא בדיוק 🤔 אבל בוא נבין את זה ביחד!', followup: '' },
            { text: 'כמעט! אל תדאג, אני כאן כדי לעזור 😊', followup: '' },
            { text: 'לא נורא בכלל! בוא נחשוב על זה שנייה ביחד 💡', followup: '' },
        ];

        // ================================================
        // STATE
        // ================================================
        let currentScreen = 'portal';
        let currentSubject = null;
        let currentQuestionIdx = 0;
        let score = 0;
        let wrongCount = 0;
        let lessonOffered = false;

        // ================================================
        // RENDER: Portal
        // ================================================
        function renderPortal() {
            const grid = document.getElementById('subjectsGrid');
            grid.innerHTML = SUBJECTS.map(s => `
                <div class="subject-card fade-in" onclick="openSubject('${s.id}')">
                    ${s.recommended ? '<span class="recommended-badge">⭐ מומלץ לך</span>' : ''}
                    <div class="subject-card-icon" style="background: ${s.iconBg}">${s.icon}</div>
                    <h3>${s.name}</h3>
                    <p>${s.desc}</p>
                    <div class="subject-card-progress">
                        <div class="subject-card-progress-fill" style="width: ${s.progress}%; background: ${s.gradient}"></div>
                    </div>
                    <div class="subject-card-meta">${s.progress > 0 ? s.progress + '% הושלם' : 'עוד לא התחלת'}</div>
                </div>
            `).join('');
        }

        // ================================================
        // RENDER: Topics
        // ================================================
        function openSubject(subjectId) {
            currentSubject = SUBJECTS.find(s => s.id === subjectId);
            if (!currentSubject) return;

            switchScreen('topics');
            updateBreadcrumb(['פורטל הלמידה', currentSubject.name]);

            const container = document.getElementById('topicsContent');
            container.innerHTML = `
                <div class="topics-back" onclick="switchScreen('portal')">← חזרה למקצועות</div>
                
                <div class="topics-header">
                    <div class="topics-header-icon" style="background: ${currentSubject.iconBg}">${currentSubject.icon}</div>
                    <div>
                        <h1>${currentSubject.name}</h1>
                        <p>${currentSubject.desc}</p>
                    </div>
                </div>

                ${currentSubject.reason ? `
                <div class="topics-reason">
                    <strong>💡 למה בחרנו לך את זה:</strong> ${currentSubject.reason}
                </div>` : ''}

                <div class="stages-list">
                    ${currentSubject.stages.map((st, i) => `
                        <div class="stage-item ${st.status === 'locked' ? 'locked' : ''}" onclick="openGame('${st.id}', ${i})">
                            <div class="stage-number ${st.status}">${st.status === 'done' ? '✓' : i + 1}</div>
                            <div class="stage-info">
                                <h4>${st.title}</h4>
                                <p>${st.desc}</p>
                            </div>
                            ${st.status === 'done' ? '<span class="stage-badge done">הושלם</span>' : 
                              st.status === 'current' ? '<span class="stage-badge current">התחל</span>' : ''}
                        </div>
                    `).join('')}
                </div>
            `;
        }

        // ================================================
        // RENDER: Game
        // ================================================
        function openGame(stageId, stageIdx) {
            switchScreen('game');

            const stage = currentSubject.stages[stageIdx];
            document.getElementById('gameTitle').textContent = stage.title;
            document.getElementById('gameStage').textContent = `שלב ${stageIdx + 1}`;
            updateBreadcrumb(['פורטל הלמידה', currentSubject.name, stage.title]);

            // Load the interactive game into the iframe (real learning content)
            const frame = document.getElementById('gameFrame');
            frame.src = `/learning/game.html?subject=${encodeURIComponent(currentSubject.id)}&stage=${encodeURIComponent(stage.title)}`;

            // Opening message (req: opening/closing messages between content)
            document.getElementById('yubiChatBody').innerHTML = '';
            wrongCount = 0;
            lessonOffered = false;
            addYubiMessage(`היי! 👋 פתחתי לך את "${stage.title}". זה משחק קצר ואינטראקטיבי — תתקדם בקצב שלך, ואני כאן לכל שאלה או רמז 💡`);
        }

        // ================================================
        // GAME <-> AGENT BRIDGE (postMessage from iframe)
        // ================================================
        const ENCOURAGE = [
            'וואו, רצף מנצח! 🔥 אתה ממש בעניינים',
            'איזה כיף לראות אותך מצליח ברצף! 🌟 ככה ממשיכים',
            'אתה על גל של הצלחות! 💪 גאה בך',
        ];
        let lastIdleAt = 0;

        window.addEventListener('message', (e) => {
            const d = e.data || {};
            if (d.source !== 'yuvilab-game') return;

            switch (d.type) {
                case 'progress':
                    // mirror "where am I" in the toolbar
                    document.getElementById('gameStage').textContent = `אתגר ${d.challenge}/${d.total}`;
                    break;
                case 'correct':
                    // brief positive acknowledgement (not every time, to avoid spam)
                    if (d.streak && d.streak % 2 === 0) {
                        addYubiMessage('יפה מאוד! ✨ אתה תופס את זה ממש טוב');
                    }
                    break;
                case 'wrong':
                    wrongCount++;
                    if (wrongCount >= 3 && !lessonOffered) {
                        lessonOffered = true;
                        setTimeout(() => {
                            addYubiMessage('שמתי לב שהנושא הזה קצת מבלבל 🤔 זה ממש בסדר! לפעמים צריך הסבר מסודר לפני שממשיכים לתרגל.');
                            setTimeout(() => {
                                addYubiMessage('מה דעתך שאכין לך לומדה קצרה ונקודתית על זוויות? 📐 הסבר ברור עם דוגמאות, ובסוף כמה תרגילים קלים כדי לוודא שהבנת. אחרי זה תוכל לחזור לבדיוק לנקודה שבה אתה עכשיו.');
                                setTimeout(() => {
                                    addYubiActionButton('כן, תלמד אותי! 📖', () => {
                                        addYubiMessage('מעולה! 🎉 אני מכין לך עכשיו לומדה מותאמת אישית על סוגי זוויות. תמיד אפשר לחזור לפה — לאותו מקום בדיוק שבו הפסקת 💪');
                                        setTimeout(() => {
                                            window.location.href = '/learning/lesson.html?topic=angles';
                                        }, 2000);
                                    });
                                }, 1200);
                            }, 1800);
                        }, 800);
                    }
                    break;
                case 'streak':
                    addYubiMessage(ENCOURAGE[Math.min(d.streak === 5 ? 2 : 0, ENCOURAGE.length - 1)]);
                    break;
                case 'idle':
                    // proactive agent: nudge after inactivity
                    if (Date.now() - lastIdleAt < 12000) break;
                    lastIdleAt = Date.now();
                    addYubiMessage('הכול בסדר? 🙂 אם תקוע/ה — לחץ/י על "💡 רמז" במשחק, או פשוט תכתוב/י לי כאן ונעבור על זה ביחד.');
                    break;
                case 'misconception':
                    // repeated errors -> pedagogical alternative (req: alternative content)
                    addYubiMessage('שמתי לב שהאתגר הזה קצת מבלבל 🤔 זה ממש בסדר! הוספתי לך במשחק כרטיס עם סרטון הסבר קצר — לפעמים לראות זה יותר קל מלקרוא 🎬');
                    setTimeout(() => addYubiMessage('רוצה שאסביר את זה בדרך אחרת? פשוט כתוב/י לי "תסביר" 😊'), 1400);
                    break;
                case 'break':
                    addYubiMessage('עבדת יפה! 🧘 קח/י הפסקה קטנה אם בא לך — אני אחכה כאן. כשמוכנים, ממשיכים!');
                    break;
                case 'complete':
                    // closing message (req: closing messages between content)
                    addYubiMessage(`כל הכבוד, סיימת את השלב! 🏆 אספת ${d.stars} כוכבים ${'⭐'.repeat(Math.max(d.earned || 1, 1))}`);
                    setTimeout(() => addYubiMessage(d.earned >= 3 ? 'שליטה מלאה! אתה מוכן לשלב הבא 🚀' : 'יופי של התקדמות! אפשר תמיד לחזור ולתרגל עוד 💪'), 1400);
                    break;
                case 'exit':
                    switchScreen('topics');
                    openSubject(currentSubject.id);
                    break;
            }
        });

        // ================================================
        // CHAT
        // ================================================
        const BOT_SVG = `<svg viewBox="0 0 36 36" width="24" height="24" fill="none"><rect x="8" y="12" width="20" height="16" rx="4" fill="#7c5cff"/><rect x="12" y="16" width="4" height="4" rx="1.5" fill="#fff"/><rect x="20" y="16" width="4" height="4" rx="1.5" fill="#fff"/><rect x="15" y="22" width="6" height="2" rx="1" fill="#c4b5fd"/><rect x="14" y="6" width="8" height="6" rx="2" fill="#9f7afe"/><rect x="17" y="3" width="2" height="4" rx="1" fill="#c4b5fd"/><circle cx="18" cy="2" r="2" fill="#22d3ee"/></svg>`;

        function addYubiMessage(text) {
            const body = document.getElementById('yubiChatBody');
            const msg = document.createElement('div');
            msg.className = 'chat-msg bot';
            msg.innerHTML = `
                <div class="avatar">${BOT_SVG}</div>
                <div class="chat-bubble bot">${text}</div>
            `;
            body.appendChild(msg);
            body.scrollTop = body.scrollHeight;
        }

        function addYubiActionButton(label, onClick) {
            const body = document.getElementById('yubiChatBody');
            const msg = document.createElement('div');
            msg.className = 'chat-msg bot';
            msg.innerHTML = `
                <div class="avatar">${BOT_SVG}</div>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <button class="lesson-offer-btn" style="
                        font-family: 'Rubik', sans-serif;
                        font-size: 0.85rem;
                        font-weight: 700;
                        color: #fff;
                        background: linear-gradient(135deg, #7c5cff, #9f7afe);
                        border: none;
                        border-radius: 12px;
                        padding: 12px 22px;
                        cursor: pointer;
                        box-shadow: 0 6px 18px rgba(124,92,255,0.3);
                        transition: transform 0.2s, box-shadow 0.2s;
                        white-space: nowrap;
                    ">${label}</button>
                    <span style="font-size:0.68rem;color:#a0aec0;text-align:center;">אפשר גם להמשיך לתרגל</span>
                </div>
            `;
            const btn = msg.querySelector('.lesson-offer-btn');
            btn.addEventListener('click', onClick);
            btn.addEventListener('mouseenter', () => { btn.style.transform = 'translateY(-2px)'; btn.style.boxShadow = '0 10px 24px rgba(124,92,255,0.4)'; });
            btn.addEventListener('mouseleave', () => { btn.style.transform = ''; btn.style.boxShadow = '0 6px 18px rgba(124,92,255,0.3)'; });
            body.appendChild(msg);
            body.scrollTop = body.scrollHeight;
        }

        function addUserChatMessage(text) {
            const body = document.getElementById('yubiChatBody');
            const msg = document.createElement('div');
            msg.className = 'chat-msg user';
            msg.innerHTML = `<div class="chat-bubble user">${text}</div>`;
            body.appendChild(msg);
            body.scrollTop = body.scrollHeight;
        }

        function handleUserChat() {
            const input = document.getElementById('yubiInput');
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            addUserChatMessage(text);

            const frame = document.getElementById('gameFrame');
            const subjName = currentSubject ? currentSubject.name : 'הנושא';

            setTimeout(() => {
                const lower = text.toLowerCase();
                if (lower.includes('עזרה') || lower.includes('לא מבין') || lower.includes('קשה') || lower.includes('רמז') || lower.includes('תקוע') || lower.includes('לא מצליח')) {
                    // If already failed enough or explicitly struggling, offer lesson
                    if ((wrongCount >= 2 || lower.includes('לא מצליח') || lower.includes('קשה לי')) && !lessonOffered) {
                        lessonOffered = true;
                        addYubiMessage('אני רואה שהנושא הזה דורש עוד קצת הסבר 🤔 זה ממש בסדר! לפעמים צריך לומדה מסודרת לפני שמתרגלים.');
                        setTimeout(() => {
                            addYubiMessage('מה דעתך שאכין לך לומדה קצרה על זוויות? 📐 הסבר ברור עם דוגמאות ותרגילים. אחרי זה תוכל לחזור לבדיוק לנקודה שבה אתה עכשיו!');
                            setTimeout(() => {
                                addYubiActionButton('כן, תלמד אותי! 📖', () => {
                                    addYubiMessage('מעולה! 🎉 אני מכין לך עכשיו לומדה מותאמת אישית. תמיד אפשר לחזור לפה — לאותו מקום בדיוק שבו הפסקת 💪');
                                    setTimeout(() => {
                                        window.location.href = '/learning/lesson.html?topic=angles';
                                    }, 2000);
                                });
                            }, 1200);
                        }, 1500);
                    } else {
                        addYubiMessage('בטח! 💡 הנה רמז למשחק — הדגשתי לך אותו על המסך.');
                        if (frame && frame.contentWindow) frame.contentWindow.postMessage({ target: 'yuvilab-game', cmd: 'hint' }, '*');
                        setTimeout(() => addYubiMessage('נסה/י עכשיו שוב — אני בטוח שתצליח/י! ואם עדיין קשה, נעבור על זה צעד-צעד 😊'), 1000);
                    }
                } else if (lower.includes('תסביר') || lower.includes('הסבר') || lower.includes('איך')) {
                    addYubiMessage(`בוא נפרק את זה ב${subjName} לצעדים קטנים וברורים 🧩`);
                    setTimeout(() => addYubiMessage('אני יכול גם להעמיק יותר או להביא דוגמה מהחיים — מה יעזור לך יותר? 😊'), 1400);
                } else if (lower.includes('משעמם') || lower.includes('קל מדי')) {
                    addYubiMessage('הבנתי! 😄 אם זה קל לך — אפשר לדלג קדימה לאתגר הבא או לעבור לשלב מתקדם יותר. רוצה שאתאים לך אתגר קשה יותר?');
                } else if (lower.includes('כן') || lower.includes('בסדר') || lower.includes('הבנתי') || lower.includes('תודה')) {
                    addYubiMessage('מעולה! 💪 אני כאן לידך לכל אורך הדרך. תמשיך/י בקצב שלך.');
                } else {
                    addYubiMessage('שאלה טובה! 😊 תמשיך/י לשחק, ואם משהו לא ברור — כתוב/י לי "רמז" או "תסביר" ואני כאן.');
                }
            }, 700);
        }

        // ================================================
        // NAVIGATION
        // ================================================
        function switchScreen(name) {
            document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
            document.getElementById('screen' + capitalize(name)).classList.add('active');
            currentScreen = name;

            if (name === 'portal') {
                updateBreadcrumb(['פורטל הלמידה']);
            }
        }

        function updateBreadcrumb(parts) {
            const bc = document.getElementById('breadcrumb');
            bc.innerHTML = parts.map((p, i) => {
                const isLast = i === parts.length - 1;
                const isClickable = !isLast;
                let html = '';
                if (i > 0) html += '<span class="sep">›</span>';
                if (isClickable && i === 0) {
                    html += `<span class="clickable" onclick="switchScreen('portal')">${p}</span>`;
                } else if (isClickable && i === 1) {
                    html += `<span class="clickable" onclick="openSubject('${currentSubject?.id}')">${p}</span>`;
                } else {
                    html += `<span class="${isLast ? 'active' : ''}">${p}</span>`;
                }
                return html;
            }).join('');
        }

        function capitalize(str) {
            return str.charAt(0).toUpperCase() + str.slice(1);
        }

        // ================================================
        // EVENTS
        // ================================================
        document.getElementById('yubiSendBtn').addEventListener('click', handleUserChat);
        document.getElementById('yubiInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleUserChat();
        });
        document.getElementById('exitGameBtn').addEventListener('click', () => {
            switchScreen('topics');
            openSubject(currentSubject.id);
        });

        // ================================================
        // INIT
        // ================================================
        renderPortal();

  window.openSubject=openSubject; window.switchScreen=switchScreen; window.openGame=openGame;
}
