// @ts-nocheck
/* eslint-disable */
import './yubiRobot'

export function initDashboard(t, language) {
        const dashboardToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const initialMain = document.getElementById('mainContent');
        if (initialMain) initialMain.dataset.dashboardMount = dashboardToken;
        function isCurrentMount() {
            const main = document.getElementById('mainContent');
            return !!main && main.dataset.dashboardMount === dashboardToken;
        }
        // ================================================
        // LOCALIZE STATIC CHROME (top bar, panes, Yubi launcher/chat)
        // ================================================
        function localizeChrome() {
            document.querySelectorAll('.tt-label[data-tab]').forEach(el => {
                el.textContent = t('dashboard.tabs.' + el.dataset.tab);
            });
            const tbRole = document.getElementById('tbRole');
            if (tbRole) tbRole.textContent = t('dashboard.profile.role');
            const loadingTitle = document.getElementById('dashboardLoadingTitle');
            if (loadingTitle) loadingTitle.textContent = t('dashboard.loading.title');
            const loadingSubtitle = document.getElementById('dashboardLoadingSubtitle');
            if (loadingSubtitle) loadingSubtitle.textContent = t('dashboard.loading.subtitle');
            const chatTitle = document.getElementById('chatPaneTitle');
            if (chatTitle) chatTitle.textContent = t('dashboard.chatPane.title');
            const chatSubtitle = document.getElementById('chatPaneSubtitle');
            if (chatSubtitle) chatSubtitle.textContent = t('dashboard.chatPane.subtitle');
            const calTitle = document.getElementById('calendarPaneTitle');
            if (calTitle) calTitle.textContent = t('dashboard.calendarPane.title');
            const calSubtitle = document.getElementById('calendarPaneSubtitle');
            if (calSubtitle) calSubtitle.textContent = t('dashboard.calendarPane.subtitle');
            const bubbleClose = document.getElementById('yubiBubbleClose');
            if (bubbleClose) bubbleClose.setAttribute('aria-label', t('dashboard.yubi.bubbleCloseAria'));
            const bubbleTitle = document.getElementById('yubiBubbleTitle');
            if (bubbleTitle) bubbleTitle.textContent = t('dashboard.yubi.bubbleTitle');
            const bubbleSubtitle = document.getElementById('yubiBubbleSubtitle');
            if (bubbleSubtitle) bubbleSubtitle.textContent = t('dashboard.yubi.bubbleSubtitle');
            const bubbleBtn = document.getElementById('yubiBubbleBtn');
            if (bubbleBtn) bubbleBtn.textContent = t('dashboard.yubi.bubbleBtn');
            const fab = document.getElementById('yubiFab');
            if (fab) fab.setAttribute('aria-label', t('dashboard.yubi.fabAria'));
            const chatName = document.getElementById('yubiChatName');
            if (chatName) chatName.textContent = t('dashboard.yubi.name');
            const chatSub = document.getElementById('yubiChatSubtitle');
            if (chatSub) chatSub.textContent = t('dashboard.yubi.subtitle');
            document.querySelectorAll('[data-toggle-label]').forEach(el => {
                el.textContent = el.dataset.toggleLabel === 'voice' ? t('dashboard.yubi.modeVoice') : t('dashboard.yubi.modeText');
            });
            const yubiClose = document.getElementById('yubiClose');
            if (yubiClose) yubiClose.setAttribute('aria-label', t('dashboard.yubi.closeAria'));
            const chatInput = document.getElementById('chatInput');
            if (chatInput) chatInput.setAttribute('placeholder', t('dashboard.yubi.inputPlaceholder'));
            const chatForm = document.getElementById('chatForm');
            if (chatForm) {
                const sendBtn = chatForm.querySelector('button[type="submit"]');
                if (sendBtn) sendBtn.setAttribute('aria-label', t('dashboard.yubi.sendAria'));
            }
        }
        localizeChrome();

        // ================================================
        // LOAD DASHBOARD FROM MAPPING DATA (via AI)
        // ================================================
        let currentData = null;
        let currentSourceHash = '';

        function timeoutSignal(ms) {
            const controller = new AbortController();
            const timeoutId = window.setTimeout(() => controller.abort(), ms);
            return { signal: controller.signal, cancel: () => window.clearTimeout(timeoutId) };
        }

        async function getLearnerState() {
            const timeout = timeoutSignal(7000);
            try {
                const resp = await fetch('/api/learner-state', { signal: timeout.signal });
                if (!resp.ok) throw new Error('Learner state error');
                return resp.json();
            } finally {
                timeout.cancel();
            }
        }

        async function updateLearnerState(updates) {
            const resp = await fetch('/api/learner-state', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            if (!resp.ok) throw new Error('Learner state update error');
            return resp.json();
        }

        async function fetchDashboardData(name, mappingData, preferFallback, signal) {
            const timeout = signal ? null : timeoutSignal(preferFallback ? 7000 : 25000);
            const resp = await fetch('/api/generate-dashboard', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: signal || timeout.signal,
                body: JSON.stringify({
                    student_name: name,
                    scores: mappingData.scores,
                    language,
                    prefer_fallback: preferFallback
                })
            });
            if (timeout) timeout.cancel();
            if (!resp.ok) throw new Error('Dashboard API error');
            return resp.json();
        }

        async function loadDashboard() {
            try {
                const learnerState = await getLearnerState();
                if (!isCurrentMount()) return;
                const mappingData = learnerState.mapping_results;
                if (!mappingData) {
                    document.getElementById('dashboardLoading').innerHTML = `
                    <div style="font-size:48px;margin-bottom:16px;">📋</div>
                    <div style="font-size:18px;font-weight:700;color:#3a3360;margin-bottom:12px;">${t('dashboard.noData.title')}</div>
                    <div style="font-size:14px;color:#9a93b5;margin-bottom:24px;">${t('dashboard.noData.subtitle')}</div>
                    <a href="/learner-mapping" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#7c5cff,#9f7afe);color:#fff;border-radius:14px;font-weight:700;text-decoration:none;">${t('dashboard.noData.cta')}</a>
                `;
                    return;
                }

                const name = mappingData.student_name || t('dashboard.profile.defaultName');
                currentSourceHash = JSON.stringify(mappingData) + '|' + language;

                // Update profile name where present (sidebar removed)
                const sbAva = document.getElementById('sidebarAvatar');
                const sbName = document.getElementById('sidebarName');
                if (sbAva) sbAva.textContent = name[0];
                if (sbName) sbName.textContent = name;

                // Check persisted dashboard cache if mapping data hasn't changed
                const cached = learnerState.dashboard_cache;
                if (cached) {
                    try {
                        if (cached.sourceHash === currentSourceHash) {
                            currentData = cached.data;
                            renderDashboard(cached.data);
                            return;
                        }
                    } catch (e) {
                        console.warn('Dashboard cache render failed, regenerating:', e);
                        currentData = null;
                    }
                }

                const fallbackData = await fetchDashboardData(name, mappingData, true);
                if (!isCurrentMount()) return;
                currentData = fallbackData;
                renderDashboard(fallbackData);

                const controller = new AbortController();
                const timeoutId = window.setTimeout(() => controller.abort(), 25000);
                try {
                    const data = await fetchDashboardData(name, mappingData, false, controller.signal);
                    window.clearTimeout(timeoutId);
                    if (!isCurrentMount()) return;
                    currentData = data;
                    void updateLearnerState({ dashboard_cache: { sourceHash: currentSourceHash, data } });
                    renderDashboard(data);
                } catch (aiErr) {
                    window.clearTimeout(timeoutId);
                    console.warn('Dashboard AI refresh skipped:', aiErr);
                    void updateLearnerState({ dashboard_cache: { sourceHash: currentSourceHash, data: fallbackData } });
                }
            } catch (err) {
                console.error('Dashboard generation error:', err);
                if (!isCurrentMount()) return;
                document.getElementById('dashboardLoading').innerHTML = `
                    <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
                    <div style="font-size:18px;font-weight:700;color:#3a3360;">${t('dashboard.error.title')}</div>
                    <div style="font-size:14px;color:#9a93b5;margin-top:8px;">${t('dashboard.error.subtitle')}</div>
                `;
            }
        }

        // ================================================
        // HELPERS for derived content
        // ================================================
        const MASCOT_SVG = `<svg viewBox="0 0 44 44" width="36" height="36" fill="none">
            <rect x="9" y="15" width="26" height="21" rx="6" fill="#fff"/>
            <rect x="15" y="21" width="5" height="5" rx="2" fill="#7c5cff"/>
            <rect x="24" y="21" width="5" height="5" rx="2" fill="#7c5cff"/>
            <path d="M18 30 Q22 33 26 30" stroke="#22d3ee" stroke-width="2.4" fill="none" stroke-linecap="round"/>
            <rect x="17" y="8" width="10" height="8" rx="3" fill="#fff" fill-opacity="0.9"/>
            <rect x="21" y="3.5" width="2.4" height="5" rx="1.2" fill="#c4b5fd"/>
            <circle cx="22.2" cy="2.6" r="2.6" fill="#22d3ee"/>
            <rect x="4" y="20" width="5" height="11" rx="2.5" fill="#fff" fill-opacity="0.9"/>
            <rect x="35" y="20" width="5" height="11" rx="2.5" fill="#fff" fill-opacity="0.9"/>
        </svg>`;

        const STRENGTH_ICONS = {
            'סקרנות': '🔬', 'curiosity': '🔬', 'الفضول': '🔬',
            'התמדה': '🎯', 'persistence': '🎯', 'المثابرة': '🎯',
            'שיתוף פעולה': '🤝', 'collaboration': '🤝', 'التعاون': '🤝',
            'יצירתיות': '🎨', 'creativity': '🎨', 'الإبداع': '🎨',
            'חשיבה': '💡', 'thinking': '💡', 'التفكير': '💡',
            'תקשורת': '🗣️', 'communication': '🗣️', 'التواصل': '🗣️',
            'יוזמה': '🚀', 'initiative': '🚀', 'المبادرة': '🚀',
            'טכנולוגיה': '💻', 'technology': '💻', 'التكنولوجيا': '💻',
            'אחריות': '🛡️', 'responsibility': '🛡️', 'المسؤولية': '🛡️',
            'דמיון': '✨', 'imagination': '✨', 'الخيال': '✨',
            'מנהיגות': '🌟', 'leadership': '🌟', 'القيادة': '🌟',
            'ריכוז': '🎧', 'focus': '🎧', 'التركيز': '🎧'
        };
        // Categorize a strength/subject label across Hebrew, English, and Arabic
        // keywords so display text can stay localized regardless of source language.
        function strengthCategory(name) {
            const n = (name || '').toLowerCase();
            if (/סקרנות|לגלות|לנסות|curiosity|discover|الفضول|اكتشاف/.test(n)) return 'curiosity';
            if (/התמדה|persistence|المثابرة/.test(n)) return 'persistence';
            if (/שתף|עזר|ביחד|collaborat|together|التعاون|مشارك/.test(n)) return 'collaboration';
            if (/להתחיל|לסיים|משימ|task|finish|إنجاز|مهمة/.test(n)) return 'taskFocus';
            if (/יצירת|creativ|إبداع/.test(n)) return 'creativity';
            if (/טכנולוג|tech|تكنولوج|حاسوب/.test(n)) return 'tech';
            if (/תקשורת|communicat|تواصل/.test(n)) return 'communication';
            if (/ריכוז|focus|تركيز/.test(n)) return 'focus';
            if (/רצון|מוטיב|motivat|drive|رغبة|دافع/.test(n)) return 'motivation';
            return 'default';
        }
        function strengthIcon(name) {
            for (const key in STRENGTH_ICONS) if ((name || '').includes(key)) return STRENGTH_ICONS[key];
            return '⭐';
        }
        function strengthLine(name) {
            return t('dashboard.strengthLine.' + strengthCategory(name));
        }
        // Positive reframing of a difficulty into a growth title + supportive how-to
        function difficultyCategory(d) {
            const txt = (d.text || '').toLowerCase();
            if (/ריכוז|focus|تركيز/.test(txt)) return 'focus';
            if (/טכנולוג|דיגיטל|tech|digital|تكنولوج|رقمي/.test(txt)) return 'tech';
            if (/ארגון|תכנון|organiz|plan|تنظيم|تخطيط/.test(txt)) return 'organization';
            return 'default';
        }
        function improveTitle(d) {
            const category = difficultyCategory(d);
            return category === 'default' ? d.text : t('dashboard.improve.title.' + category);
        }
        function improveHow(d) {
            return t('dashboard.improve.how.' + difficultyCategory(d));
        }
        function avgProgress(subjects) {
            if (!subjects.length) return 0;
            return Math.round(subjects.reduce((a, s) => a + (s.progress || 0), 0) / subjects.length);
        }
        function topStrengthLabel(data) {
            const comps = data.competencies || [];
            if (comps.length) return [...comps].sort((a, b) => b.value - a.value)[0].label;
            return (data.mapping && data.mapping.strengths && data.mapping.strengths[0]) || t('dashboard.strengthLine.curiosity');
        }

        // Short, warm task message written as if Yubi just sent it in chat —
        // explains *why* to practice now and connects to the child's world.
        function heroMessage(childName, subject, interests) {
            const first = ((childName || '').split(' ')[0]) || t('dashboard.hero.friend');
            const interest = (interests && interests.length) ? interests[0] : null;
            const link = interest ? t('dashboard.hero.messageLink', { interest }) : '';
            return t('dashboard.hero.message', { first, subject: `<b>${subject}</b>`, link });
        }

        // Categorize a subject name across languages so the hero card illustration
        // and subtitle stay localized regardless of the language the AI returned.
        function subjectCategory(name) {
            const n = (name || '').toLowerCase();
            if (/מדע|science|علوم/.test(n)) return 'science';
            if (/מתמט|חשבון|math|رياضيات/.test(n)) return 'math';
            if (/עבר|שפה|language|arts|لغة/.test(n)) return 'language';
            if (/מחשב|טכנולוג|computer|tech|حاسوب|تكنولوج/.test(n)) return 'tech';
            if (/אנגל|english|إنجليز/.test(n)) return 'english';
            return 'default';
        }
        // Hero illustration + subtitle derived from the focus subject
        function heroSubtitle(name) {
            return t('dashboard.hero.subtitle.' + subjectCategory(name));
        }
        function heroIllu(name) {
            const icons = { science: '🔬', math: '🔢', language: '📖', tech: '💻', english: '🔤', default: '🚀' };
            return icons[subjectCategory(name)];
        }
        function heroFloats(name) {
            const floats = {
                science: ['🌱', '🦋', '✨'],
                math: ['➕', '⭐', '✨'],
                language: ['✏️', '💬', '✨'],
                default: ['⭐', '✨', '💜']
            };
            return floats[subjectCategory(name)] || floats.default;
        }
        // Circular icon background colors for strength cards (rotating soft tones)
        const STRENGTH_BG = ['rgba(246,173,85,0.20)', 'rgba(72,187,120,0.18)', 'rgba(124,92,255,0.18)'];
        // Illustrated icon + soft circle color for "what helps me grow" cards
        function improveVisual(d) {
            const category = difficultyCategory(d);
            const visuals = {
                focus: { emoji: '⏱️', bg: 'rgba(72,187,120,0.16)' },
                tech: { emoji: '💻', bg: 'rgba(99,179,237,0.18)' },
                organization: { emoji: '🗂️', bg: 'rgba(124,92,255,0.16)' },
                default: { emoji: '🌱', bg: 'rgba(246,173,85,0.18)' }
            };
            return visuals[category];
        }

        // ================================================
        // RENDER DASHBOARD (home + deep views)
        // ================================================
        function renderDashboard(data) {
            resetChat();

            const main = document.getElementById('mainContent');
            main.innerHTML = `
                <section class="view active" id="view-home"></section>
                <section class="view" id="view-subjects"></section>
                <section class="view" id="view-goals"></section>
                <section class="view" id="view-strengths"></section>
                <section class="view" id="view-learning"></section>
                <section class="view" id="view-agency"></section>
            `;

            renderHome(data);
            renderSubjectsView(data);
            renderGoalsView(data);
            renderStrengthsView(data);
            renderLearningView(data);
            renderAgencyView(data);

            setupNav();
            injectCopilotSparks();
            updateTopProfile();
        }

        // -------- HOME --------
        function renderHome(data) {
            const subjects = data.subjects || [];
            const strengths = (data.mapping && data.mapping.strengths) || [];
            const difficulties = data.difficulties || [];
            const goals = data.goals || [];
            const week = avgProgress(subjects);
            const top = topStrengthLabel(data);
            const lowSubject = [...subjects].sort((a, b) => (a.progress || 0) - (b.progress || 0))[0];
            const heroSubject = lowSubject ? lowSubject.name : t('dashboard.home.taskDefault');

            const home = document.getElementById('view-home');
            home.innerHTML = `
                <div class="greeting fade-in">
                    <div class="greeting-text">
                        <h1>${t('dashboard.home.greeting', { name: data.name })}</h1>
                        <p>${t('dashboard.home.greetingSub')}</p>
                    </div>
                </div>

                <div class="home-section">
                    <div class="hero-card fade-in">
                        <div class="hero-yubi" id="heroYubiRobot"></div>
                        <div class="hero-bubble">
                            <div class="hero-bubble-head">
                                <span class="hero-yubi-name">${t('dashboard.home.yubiName')}</span>
                                <span class="hero-yubi-badge">${t('dashboard.home.yubiBadge')}</span>
                            </div>
                            <div class="hero-msg-text">${heroMessage(data.name, heroSubject, (data.mapping && data.mapping.interests) || [])}</div>
                            <a class="hero-cta" href="/learning/">${heroIllu(heroSubject)} ${t('dashboard.home.heroCta')}</a>
                        </div>
                    </div>
                </div>

                <div class="home-grid">
                    <div class="panel fade-in">
                        <div class="home-section-head">
                            <h2>${t('dashboard.home.subjectsTitle')}</h2>
                            <button class="see-more-btn" data-goto="subjects">${t('dashboard.home.seeAllSubjects')}</button>
                        </div>
                        <div class="subjects-summary">
                            ${subjects.slice(0, 3).map(s => `
                                <div class="subject-row">
                                    <div class="subject-row-name">${s.name}</div>
                                    <div class="subject-bar-wrap">
                                        <div class="subject-bar-track">
                                            <div class="subject-bar-fill" style="width:0%; background:${s.gradient}" data-target="${s.progress}"></div>
                                        </div>
                                        <span class="subject-bar-pill ${s.levelClass}">${s.level}</span>
                                    </div>
                                    <div class="subject-row-ico" style="background:${s.iconBg}">${s.icon}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <div class="panel fade-in">
                        <div class="home-section-head">
                            <h2>${t('dashboard.home.goalsTitle')}</h2>
                            <button class="see-more-btn" data-goto="goals">${t('dashboard.home.seeAllGoals')}</button>
                        </div>
                        <div class="steps-list">
                            <div class="step-card">
                                <span class="step-grip">⠿⠿</span>
                                <span class="step-text">${(goals[0] && goals[0].text) || t('dashboard.home.goalDefault1')}</span>
                                <span class="step-check" role="button" tabindex="0">✓</span>
                            </div>
                            <div class="step-card">
                                <span class="step-grip">⠿⠿</span>
                                <span class="step-text">${(goals[1] && goals[1].text) || t('dashboard.home.goalDefault2')}</span>
                                <span class="step-check" role="button" tabindex="0">✓</span>
                            </div>
                        </div>
                    </div>

                    <div class="panel fade-in">
                        <div class="home-section-head">
                            <h2>${t('dashboard.home.difficultiesTitle')}</h2>
                            <span class="see-more-btn" style="cursor:default;background:none;">${t('dashboard.home.difficultiesSub')}</span>
                        </div>
                        <div class="difficulties-list">
                            ${difficulties.length ? difficulties.map(d => `
                                <div class="difficulty-item">
                                    <span class="difficulty-subject-tag">${d.subject || t('dashboard.home.difficultyDefaultSubject')}</span>
                                    <span class="difficulty-text">${d.text}</span>
                                    ${d.status ? `<span class="difficulty-status ${d.statusClass || ''}">${d.status}</span>` : ''}
                                </div>
                            `).join('') : `<div style="font-size:0.82rem;color:#9a93b5;padding:6px 2px;">${t('dashboard.home.noDifficulties')}</div>`}
                        </div>
                    </div>

                    <div class="panel fade-in">
                        <div class="home-section-head">
                            <h2>${t('dashboard.home.improveTitle')}</h2>
                        </div>
                        <div class="improve-list">
                            ${difficulties.slice(0, 2).map(d => {
                                const v = improveVisual(d);
                                return `
                                <div class="improve-card">
                                    <div class="improve-top">
                                        <div class="improve-main">
                                            <div class="improve-title">${improveTitle(d)}</div>
                                            <button class="improve-toggle">${t('dashboard.home.howToggle')}</button>
                                        </div>
                                        <div class="improve-ico" style="background:${v.bg}">${v.emoji}</div>
                                    </div>
                                    <div class="improve-tip">${improveHow(d)}</div>
                                </div>`;
                            }).join('')}
                        </div>
                    </div>

                    ${(() => {
                        const agency = deriveAgency(data);
                        const topComp = [...agency].sort((a, b) => b.score - a.score)[0];
                        return `
                    <div class="panel fade-in agency-summary" style="grid-column:1 / -1">
                        <div class="home-section-head">
                            <h2>${t('dashboard.home.agencyTitle')}</h2>
                            <button class="see-more-btn" data-goto="agency">${t('dashboard.home.agencySeeAll')}</button>
                        </div>
                        <div class="agency-summary-body">
                            <div class="agency-mini-radar">${agencyRadarSVG(agency)}</div>
                            <div class="agency-summary-side">
                                <div class="agency-highlight">${t('dashboard.home.agencyHighlight', { name: `<strong>${topComp.icon} ${topComp.name}</strong>` })}</div>
                                <div class="agency-chip-row">
                                    ${agency.map(a => {
                                        const lv = agencyLevel(a.score);
                                        return `<span class="agency-chip" style="background:${lv.soft};color:${lv.color}">${a.icon} ${a.name}</span>`;
                                    }).join('')}
                                </div>
                            </div>
                        </div>
                    </div>`;
                    })()}
                </div>
            `;

            // wire "show more" buttons
            home.querySelectorAll('[data-goto]').forEach(b => {
                b.addEventListener('click', () => switchView(b.dataset.goto));
            });
            // wire improve expanders
            home.querySelectorAll('.improve-toggle').forEach(btn => {
                btn.addEventListener('click', () => {
                    const card = btn.closest('.improve-card');
                    card.classList.toggle('open');
                    btn.textContent = card.classList.contains('open') ? t('dashboard.home.howToggleDone') : t('dashboard.home.howToggle');
                });
            });
            // wire step check circles
            home.querySelectorAll('.step-check').forEach(chk => {
                const toggle = () => {
                    chk.classList.toggle('done');
                    if (chk.classList.contains('done')) {
                        showLiveToast(t('dashboard.home.stepDoneToast'), t('dashboard.home.stepDoneToastSub'), '✅');
                    }
                };
                chk.addEventListener('click', toggle);
                chk.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
            });
            animateBars(home.querySelectorAll('.subject-bar-fill'));
            mountHeroYubi();
        }

        // Mount Yubi's robot head inside the daily-task message bubble
        function mountHeroYubi() {
            const el = document.getElementById('heroYubiRobot');
            if (!el || el.querySelector('canvas')) return;
            const go = () => mountYubiRobot(el, {
                view: 'head',
                isActive: () => el.offsetParent !== null
            });
            if (window.YubiRobot) go();
            else { const id = setInterval(() => { if (window.YubiRobot) { clearInterval(id); go(); } }, 60); }
        }
        let subjectIndex = 0;
        function renderSubjectsView(data) {
            const subjects = data.subjects || [];
            const el = document.getElementById('view-subjects');
            // Per-subject accent palette (clean, kid-friendly, no "alarming" red)
            const accents = [
                { solid: '#48bb78', soft: 'rgba(72,187,120,0.12)', grad: 'linear-gradient(90deg,#48bb78,#68d391)' }, // green
                { solid: '#6366f1', soft: 'rgba(99,102,241,0.12)', grad: 'linear-gradient(90deg,#6366f1,#818cf8)' }, // indigo
                { solid: '#f6ad55', soft: 'rgba(246,173,85,0.16)', grad: 'linear-gradient(90deg,#f6ad55,#fbd38d)' }, // amber
                { solid: '#ed64a6', soft: 'rgba(237,100,166,0.12)', grad: 'linear-gradient(90deg,#ed64a6,#f687b3)' }, // pink
                { solid: '#7c5cff', soft: 'rgba(124,92,255,0.12)', grad: 'linear-gradient(90deg,#7c5cff,#9f7afe)' }  // purple
            ];

            // Generic syllabus fallback so every card is full for the demo
            const genericSteps = {
                'מתמטיקה': ['שברים פשוטים', 'מספרים מעורבים', 'חיבור וחיסור שברים', 'בעיות מילוליות', 'אחוזים ראשונים'],
                'מדעים': ['מבנה התא', 'מחזור המים', 'כוחות ותנועה', 'מערכת השמש', 'ניסויים מעשיים'],
                'עברית': ['חלקי הדיבור', 'זיהוי שמות עצם', 'זיהוי פעלים', 'הבנת הנקרא', 'כתיבת חיבור'],
                'אנגלית': ['זמן הווה פשוט', 'אוצר מילים - משפחה', 'תיאור עצמי', 'שאלות ותשובות', 'קריאת טקסט קצר'],
                'מחשבים': ['מבוא לאינטרנט', 'חיפוש מידע', 'דואר אלקטרוני', 'בטיחות ברשת', 'יצירת מצגת']
            };

            function buildSteps(s) {
                // Prefer real curriculum from the data; otherwise use a friendly fallback
                let items = [];
                if (s.curriculum && s.curriculum.length) {
                    items = s.curriculum.map(c => ({
                        topic: c.topic,
                        state: c.statusClass === 'curr-done' ? 'done'
                             : c.statusClass === 'curr-current' ? 'current' : 'upcoming'
                    }));
                } else {
                    const list = genericSteps[s.name] || ['שלב ראשון', 'שלב שני', 'שלב שלישי'];
                    const done = Math.max(1, Math.round((s.progress || 0) / 100 * list.length));
                    items = list.map((t, idx) => ({
                        topic: t,
                        state: idx < done ? 'done' : (idx === done ? 'current' : 'upcoming')
                    }));
                }
                return items.slice(0, 5);
            }

            function cardHTML(s, i) {
                const ac = accents[i % accents.length];
                const steps = buildSteps(s);
                const total = s.lessonsTotal || (genericSteps[s.name] ? genericSteps[s.name].length * 4 : 20);
                const completed = s.lessonsDone != null ? s.lessonsDone : Math.round((s.progress || 0) / 100 * total);
                return `
                    <div class="subj-card fade-in">
                        <div class="subj-top">
                            <div class="subj-id">
                                <div class="subj-ico" style="background:${s.iconBg || ac.soft}">${s.icon || '📘'}</div>
                                <div>
                                    <div class="subj-name">${s.name}</div>
                                    <div class="subj-lessons">${t('dashboard.subjects.lessonsCompleted', { completed, total })}</div>
                                </div>
                            </div>
                            <span class="subj-badge" style="background:${ac.soft}; color:${ac.solid}">
                                <span class="bdot" style="background:${ac.solid}"></span> ${s.level || t('dashboard.subjects.defaultLevel')}
                            </span>
                        </div>
                        <div class="subj-bar-row">
                            <div class="subj-bar"><div class="subj-fill" style="background:${ac.grad}" data-target="${s.progress || 0}"></div></div>
                            <span class="subj-pct">${s.progress || 0}%</span>
                        </div>
                        <div class="subj-next-label">${t('dashboard.subjects.continueLabel')}</div>
                        <div class="subj-list">
                            ${steps.map(st => `
                                <div class="subj-item ${st.state}">
                                    <span class="subj-mark" style="${st.state === 'done' ? `background:${ac.solid};border-color:${ac.solid};color:#fff` : st.state === 'current' ? `border-color:${ac.solid};color:${ac.solid}` : ''}">${st.state === 'done' ? '✓' : st.state === 'current' ? '◷' : ''}</span>
                                    <span class="subj-topic">${st.topic}</span>
                                </div>
                            `).join('')}
                        </div>
                        <button class="subj-cta" style="background:${ac.soft}; color:${ac.solid}" data-subject="${s.name}">${t('dashboard.subjects.continueCta')}</button>
                    </div>`;
            }

            if (!subjects.length) {
                el.innerHTML = `
                    <button class="view-back" data-goto="home">${t('dashboard.backToDashboard')}</button>
                    <div class="view-head"><h1>${t('dashboard.subjects.title')}</h1><p>${t('dashboard.subjects.loadingSub')}</p></div>`;
                el.querySelector('[data-goto]').addEventListener('click', () => switchView('home'));
                return;
            }

            // Keep the index in range (state persists between renders within the session)
            if (subjectIndex >= subjects.length || subjectIndex < 0) subjectIndex = 0;

            el.innerHTML = `
                <button class="view-back" data-goto="home">${t('dashboard.backToDashboard')}</button>
                <div class="view-head"><h1>${t('dashboard.subjects.title')}</h1><p>${t('dashboard.subjects.hintSub')}</p></div>
                <div class="subj-chips">
                    ${subjects.map((s, i) => {
                        const ac = accents[i % accents.length];
                        return `<button class="subj-chip" data-idx="${i}" style="${i === subjectIndex ? `background:${ac.grad}` : ''}">
                            <span class="chip-ico">${s.icon || '📘'}</span> ${s.name}
                        </button>`;
                    }).join('')}
                </div>
                <div class="subj-carousel">
                    <button class="subj-arrow" id="subjPrev" aria-label="${t('dashboard.subjects.prevAria')}">→</button>
                    <div class="subj-coverflow" id="subjStage"></div>
                    <button class="subj-arrow" id="subjNext" aria-label="${t('dashboard.subjects.nextAria')}">←</button>
                </div>
                <div class="subj-dots">
                    ${subjects.map((_, i) => `<span class="subj-dot ${i === subjectIndex ? 'active' : ''}" data-idx="${i}"></span>`).join('')}
                </div>
            `;

            const stage = el.querySelector('#subjStage');

            function showSubject(idx, dir) {
                const prevIdx = subjectIndex;
                subjectIndex = (idx + subjects.length) % subjects.length;
                const n = subjects.length;
                if (dir === undefined && n > 1) {
                    // pick a natural slide direction based on where we came from
                    if (subjectIndex === (prevIdx + 1) % n) dir = 'next';
                    else if (subjectIndex === (prevIdx - 1 + n) % n) dir = 'prev';
                    else dir = subjectIndex > prevIdx ? 'next' : 'prev';
                }
                const prevI = (subjectIndex - 1 + n) % n;
                const nextI = (subjectIndex + 1) % n;

                // Build slides: previous (small) · current (focus) · next (small)
                let slides = `<div class="subj-slide center" data-idx="${subjectIndex}">${cardHTML(subjects[subjectIndex], subjectIndex)}</div>`;
                if (n > 1) {
                    slides = `<div class="subj-slide side prev" data-idx="${prevI}">${cardHTML(subjects[prevI], prevI)}</div>`
                           + slides;
                    if (n > 2) {
                        slides += `<div class="subj-slide side next" data-idx="${nextI}">${cardHTML(subjects[nextI], nextI)}</div>`;
                    }
                }
                stage.innerHTML = slides;

                // restart the slide-in animation in the travel direction
                stage.classList.remove('anim-next', 'anim-prev');
                if (dir) {
                    void stage.offsetWidth; // force reflow so the animation replays
                    stage.classList.add(dir === 'prev' ? 'anim-prev' : 'anim-next');
                }

                // Clicking a side card brings it to the center
                stage.querySelectorAll('.subj-slide.side').forEach(sl => {
                    sl.addEventListener('click', () => showSubject(parseInt(sl.dataset.idx, 10)));
                });

                // sync chips + dots active state
                el.querySelectorAll('.subj-chip').forEach((c, i) => {
                    const ac = accents[i % accents.length];
                    if (i === subjectIndex) { c.classList.add('active'); c.style.background = ac.grad; }
                    else { c.classList.remove('active'); c.style.background = ''; }
                });
                el.querySelectorAll('.subj-dot').forEach((d, i) => d.classList.toggle('active', i === subjectIndex));
                // animate progress bar of the focused card + wire CTA
                const center = stage.querySelector('.subj-slide.center');
                const fill = center && center.querySelector('.subj-fill');
                if (fill) requestAnimationFrame(() => { fill.style.width = (fill.dataset.target || 0) + '%'; });
                const cta = center && center.querySelector('.subj-cta');
                if (cta) cta.addEventListener('click', () => { window.location.href = '/learning/'; });
            }

            el.querySelector('[data-goto]').addEventListener('click', () => switchView('home'));
            el.querySelector('#subjPrev').addEventListener('click', () => showSubject(subjectIndex - 1, 'prev'));
            el.querySelector('#subjNext').addEventListener('click', () => showSubject(subjectIndex + 1, 'next'));
            el.querySelectorAll('.subj-chip').forEach(c => c.addEventListener('click', () => showSubject(parseInt(c.dataset.idx, 10))));
            el.querySelectorAll('.subj-dot').forEach(d => d.addEventListener('click', () => showSubject(parseInt(d.dataset.idx, 10))));

            showSubject(subjectIndex);
        }

        // -------- DEEP: GOALS (mentoring documentation carousel) --------
        function persistDashboard() {
            try {
                if (currentSourceHash && currentData) {
                    void updateLearnerState({ dashboard_cache: { sourceHash: currentSourceHash, data: currentData } });
                }
            } catch (e) { /* ignore */ }
        }

        // Build the seed mentoring-session documentation records shown in "היעדים שלי".
        function deriveGoalDocs(data) {
            const learner = data.name || 'התלמיד/ה';
            return [
                {
                    date: '5.5.2026', teacher: 'המורה רותם', learner, stage: 'מפגש היכרות',
                    transcript: `נפגשנו להיכרות ראשונית ו${learner} הגיע/ה בסקרנות ובמצב רוח טוב. שיתפנו על תחומי העניין — בעיקר יצירה, משחקים ומחשבים. דיברנו על המקצועות בבית הספר: בעברית מורגש ביטחון יפה, ובמתמטיקה יש עדיין מעט חוסר ביטחון. סיכמנו שנתחיל ממשימות קטנות וכיפיות שיבנו תחושת מסוגלות, ושנשלב נושאים שאהובים על ${learner} כדי שהלמידה תהיה מהנה ומשמעותית.`,
                    aiSummary: `נפגשתם להיכרות 😊 גילינו שאתה אוהב יצירה, משחקים ומחשבים, ושבעברית אתה מרגיש בטוח. במתמטיקה נתחיל לאט ובכיף כדי לבנות ביטחון.`,
                    nextSteps: [{ text: 'לתרגל 10 דקות כתיבה ביום על נושא אהוב', deadline: '19.5.2026' }]
                },
                {
                    date: '21.5.2026', teacher: 'המורה רותם', learner, stage: 'מפגש מעקב',
                    transcript: `במפגש המעקב ראינו התקדמות יפה בביטוי הכתוב. ${learner} כתב/ה סיפור קצר וקראנו אותו יחד בהנאה. עדיין יש קושי קל בארגון הרעיונות לפסקאות, אז עבדנו על מבנה ברור של התחלה–אמצע–סוף. ${learner} היה/הייתה מרוכז/ת מאוד, שיתף/ה פעולה ושאל/ה שאלות טובות. ניכר רצון אמיתי להשתפר.`,
                    aiSummary: `כל הכבוד! 🌟 כתבת סיפור קצר וקראתם אותו יחד. עכשיו נתאמן לסדר את הרעיונות לפסקאות — התחלה, אמצע וסוף.`,
                    nextSteps: [
                        { text: 'לכתוב סיפור עם 3 פסקאות ברורות', deadline: '28.5.2026' },
                        { text: 'לקרוא ספר קצר ולספר עליו', deadline: '4.6.2026' }
                    ]
                },
                {
                    date: '8.6.2026', teacher: 'המורה דנה', learner, stage: 'מפגש העמקה',
                    transcript: `התמקדנו במתמטיקה. בנינו ביטחון דרך משחק מספרים, ו${learner} פתר/ה תרגילי שברים בהצלחה ובחיוך. גילינו יחד שכשמפרקים בעיה לצעדים קטנים — ההתמודדות הופכת להרבה יותר קלה. ${learner} אמר/ה שהוא/היא מתחיל/ה ליהנות יותר מהמקצוע, וזו התקדמות נהדרת בגישה וברגש.`,
                    aiSummary: `מתמטיקה נהיית כיפית! 🎉 פתרת תרגילי שברים בהצלחה, וראינו שפירוק בעיה לצעדים קטנים עוזר המון. אתה מתחיל ליהנות מהמקצוע 💪`,
                    nextSteps: [{ text: 'לפתור 5 תרגילי שברים ביום בקצב נינוח', deadline: '15.6.2026' }]
                }
            ];
        }

        // Open Yubi chat and produce a short AI-style summary of a documentation record.
        function summarizeDocInChat(i) {
            const docs = (currentData && currentData._goalDocs) || [];
            const doc = docs[i];
            if (!doc) return;
            openChat();
            addMsg(`סכם/י לי בבקשה בקצרה את התיעוד מ"${doc.stage}" (${doc.date}) 🙏`, 'user');
            const core = (doc.aiSummary && doc.aiSummary.trim()) ? doc.aiSummary : autoDocSummary(doc);
            const steps = (doc.nextSteps || [])
                .filter(s => s && s.text)
                .map(s => `• ${s.text}${s.deadline ? ` <span style="color:#c97a16;font-weight:600">(עד ${s.deadline})</span>` : ''}`)
                .join('<br>');
            const stepsBlock = steps ? `<br><br><strong>הצעדים הקרובים שלך:</strong><br>${steps}` : '';
            botReply(`הנה התקציר שלי ✨<br><br>${core}${stepsBlock}<br><br>אני כאן ללוות אותך בכל אחד מהם 💜`);
        }

        // Friendly fallback summary for documentation the student wrote themselves.
        function autoDocSummary(doc) {
            const t = (doc.transcript || '').trim().replace(/\s+/g, ' ');
            const short = t.length > 150 ? t.slice(0, 150).replace(/[,\.;:!\s]+\S*$/, '') + '…' : t;
            const who = doc.teacher ? ` עם ${doc.teacher}` : '';
            return short
                ? `כל הכבוד על התיעוד! 🌟 ב"${doc.stage}"${who} סיכמת: ${short}`
                : `כל הכבוד על התיעוד של "${doc.stage}"${who}! 🌟 כל מפגש כזה מקדם אותך צעד קדימה.`;
        }

        function renderGoalsView(data) {
            if (!Array.isArray(data.goalDocs)) data.goalDocs = deriveGoalDocs(data);
            const docs = data.goalDocs;
            data._goalDocs = docs;
            if (typeof data._docIndex !== 'number') data._docIndex = 0;
            if (data._docIndex >= docs.length) data._docIndex = docs.length - 1;
            if (data._docIndex < 0) data._docIndex = 0;

            const carouselHtml = docs.length ? `
                <div class="docs-carousel">
                    <button class="docs-arrow" id="docNext" aria-label="${t('dashboard.subjects.nextAria')}">›</button>
                    <div class="docs-stage" id="docStage"></div>
                    <button class="docs-arrow" id="docPrev" aria-label="${t('dashboard.subjects.prevAria')}">‹</button>
                </div>
                <div class="docs-dots" id="docDots"></div>
            ` : `
                <div class="docs-empty">
                    <div class="emoji">📝</div>
                    <h3>${t('dashboard.goals.emptyTitle')}</h3>
                    <p>${t('dashboard.goals.emptySubtitle')}</p>
                </div>
            `;

            const el = document.getElementById('view-goals');
            el.innerHTML = `
                <button class="view-back" data-goto="home">${t('dashboard.backToDashboard')}</button>
                <div class="view-head"><h1>${t('dashboard.goals.title')}</h1><p>${t('dashboard.goals.subtitle')}</p></div>
                ${carouselHtml}
                <div style="text-align:center"><button class="docs-add-btn" id="docAddBtn">➕ הוספת תיעוד מפגש</button></div>
                ${docs.length ? `
                <div class="docs-timeline" id="docTimeline">
                    <div class="docs-tl-title">📋 כל המפגשים שלי</div>
                    <div class="docs-tl-list" id="docTlList"></div>
                </div>` : ''}
                ${docFormHtml(data)}
            `;
            el.querySelector('[data-goto]').addEventListener('click', () => switchView('home'));

            const rerender = () => renderGoalsView(data);
            wireDocForm(el, data, rerender);
            el.querySelector('#docAddBtn').addEventListener('click', () => openDocForm(el, data));

            if (!docs.length) return;

            const renderCard = (dir) => {
                const i = data._docIndex;
                const doc = docs[i];
                const stage = el.querySelector('#docStage');
                const steps = (doc.nextSteps || []).filter(s => s && s.text).map(s => `
                    <div class="doc-next-item"><span>${s.text}</span>${s.deadline ? `<span class="doc-deadline">⏳ עד ${s.deadline}</span>` : ''}</div>`).join('');
                const nextBlock = steps ? `
                        <div class="doc-next">
                            <div class="doc-next-title">🎯 צעדים להמשך</div>
                            ${steps}
                        </div>` : '';
                stage.innerHTML = `
                    <div class="doc-card" data-doc="${i}">
                        <div class="doc-top">
                            <span class="doc-stage-badge">${doc.stage}</span>
                            <span class="doc-date">📅 ${doc.date}</span>
                        </div>
                        <div class="doc-people">
                            <span class="doc-person"><span class="lbl">מורה:</span> 👩‍🏫 ${doc.teacher}</span>
                            <span class="doc-person"><span class="lbl">לומד/ת:</span> 🧒 ${doc.learner}</span>
                        </div>
                        <div class="doc-section-label">📝 תיעוד השיחה</div>
                        <div class="doc-transcript clamp">${doc.transcript || '—'}</div>
                        ${nextBlock}
                        <div class="doc-foot" id="docFoot">
                            <span class="doc-hint">👆 לחץ לתיעוד המלא</span>
                        </div>
                    </div>`;

                // arrows + dots state
                el.querySelector('#docPrev').disabled = (i === 0);
                el.querySelector('#docNext').disabled = (i === docs.length - 1);
                el.querySelector('#docDots').innerHTML = docs.map((_, k) =>
                    `<span class="docs-dot ${k === i ? 'active' : ''}" data-dot="${k}"></span>`).join('');
                el.querySelectorAll('.docs-dot').forEach(d => d.addEventListener('click', () => {
                    const k = parseInt(d.dataset.dot, 10);
                    if (k === data._docIndex) return;
                    const d2 = k > data._docIndex ? 'next' : 'prev';
                    data._docIndex = k;
                    renderCard(d2);
                }));
                el.querySelectorAll('.docs-tl-row').forEach(r => r.classList.toggle('active', parseInt(r.dataset.tl, 10) === i));

                // expand on click → full documentation + summarize button
                const card = stage.querySelector('.doc-card');
                card.addEventListener('click', (e) => {
                    if (e.target.closest('.doc-summarize-btn')) return;
                    card.classList.toggle('expanded');
                    const foot = card.querySelector('#docFoot');
                    if (card.classList.contains('expanded')) {
                        foot.innerHTML = `<button class="doc-summarize-btn" data-sum="${i}">✨ סכם לי בקצרה</button><span class="doc-hint">סיכום חכם של יובי</span>`;
                        foot.querySelector('.doc-summarize-btn').addEventListener('click', (ev) => {
                            ev.stopPropagation();
                            summarizeDocInChat(i);
                        });
                    } else {
                        foot.innerHTML = `<span class="doc-hint">👆 לחץ לתיעוד המלא</span>`;
                    }
                });

                // slide animation
                if (dir) {
                    stage.classList.remove('anim-next', 'anim-prev');
                    void stage.offsetWidth;
                    stage.classList.add(dir === 'prev' ? 'anim-prev' : 'anim-next');
                }
            };

            // → right arrow advances forward, ← left arrow goes back (RTL-friendly)
            el.querySelector('#docNext').addEventListener('click', () => {
                if (data._docIndex < docs.length - 1) { data._docIndex++; renderCard('next'); }
            });
            el.querySelector('#docPrev').addEventListener('click', () => {
                if (data._docIndex > 0) { data._docIndex--; renderCard('prev'); }
            });

            // timeline list (overview of all meetings) — fills the screen + quick jump
            const tlList = el.querySelector('#docTlList');
            if (tlList) {
                tlList.innerHTML = docs.map((d, k) => `
                    <div class="docs-tl-row" data-tl="${k}">
                        <span class="docs-tl-dot"></span>
                        <div class="docs-tl-main">
                            <div class="docs-tl-stage">${d.stage}</div>
                            <div class="docs-tl-meta">👩‍🏫 ${d.teacher}</div>
                        </div>
                        <span class="docs-tl-date">📅 ${d.date}</span>
                    </div>`).join('');
                tlList.querySelectorAll('.docs-tl-row').forEach(row => row.addEventListener('click', () => {
                    const k = parseInt(row.dataset.tl, 10);
                    if (k === data._docIndex) return;
                    const d2 = k > data._docIndex ? 'next' : 'prev';
                    data._docIndex = k;
                    renderCard(d2);
                    document.querySelector('.docs-carousel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }));
            }

            renderCard();
        }

        // ----- Add-documentation form (student self-reporting on mentoring sessions) -----
        const DOC_STAGES = ['מפגש היכרות', 'מפגש מעקב', 'מפגש העמקה', 'מפגש תכנון', 'מפגש סיכום', 'אחר'];

        function docStepRowHtml() {
            return `
                <div class="docstep-row">
                    <input type="text" class="step-text" placeholder="צעד להמשך...">
                    <input type="date" class="step-deadline" aria-label="תאריך דד-ליין">
                    <button type="button" class="docstep-remove" title="הסרה">✕</button>
                </div>`;
        }

        function docFormHtml(data) {
            return `
            <div class="docform-overlay" id="docFormOverlay">
                <div class="docform">
                    <h2>📝 תיעוד מפגש מנטורינג</h2>
                    <div class="docform-sub">מלא/י את הפרטים על השיחה שלך עם המורה</div>
                    <div class="docform-grid">
                        <div class="docform-field"><label>📅 תאריך</label><input type="date" id="df_date"></div>
                        <div class="docform-field"><label>🎯 שלב המפגש</label><select id="df_stage">${DOC_STAGES.map(s => `<option>${s}</option>`).join('')}</select></div>
                        <div class="docform-field"><label>👩‍🏫 שם המורה</label><input type="text" id="df_teacher" placeholder="לדוגמה: המורה רותם"></div>
                        <div class="docform-field"><label>🧒 שם הלומד/ת</label><input type="text" id="df_learner" value="${(data.name || '').replace(/"/g, '&quot;')}"></div>
                    </div>
                    <div class="docform-field"><label>💬 תיעוד השיחה</label><textarea id="df_transcript" placeholder="על מה דיברתם? מה למדת? איך הרגשת?"></textarea></div>
                    <div class="docform-field">
                        <label>✅ צעדים להמשך + דד-ליין</label>
                        <div id="df_steps">${docStepRowHtml()}</div>
                        <button type="button" class="docform-addstep" id="df_addstep">➕ עוד צעד</button>
                    </div>
                    <div class="docform-actions">
                        <button type="button" class="docform-save" id="df_save">שמירה 💜</button>
                        <button type="button" class="docform-cancel" id="df_cancel">ביטול</button>
                    </div>
                </div>
            </div>`;
        }

        function todayYmd() {
            const d = new Date();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${d.getFullYear()}-${m}-${day}`;
        }

        function ymdToDisplay(v) {
            if (!v) return '';
            const parts = v.split('-');
            if (parts.length !== 3) return v;
            return `${parseInt(parts[2], 10)}.${parseInt(parts[1], 10)}.${parts[0]}`;
        }

        function openDocForm(el) {
            const overlay = el.querySelector('#docFormOverlay');
            if (!overlay) return;
            const dateInput = overlay.querySelector('#df_date');
            if (dateInput && !dateInput.value) dateInput.value = todayYmd();
            overlay.classList.add('open');
            const teacher = overlay.querySelector('#df_teacher');
            if (teacher) setTimeout(() => teacher.focus(), 50);
        }

        function wireDocForm(el, data, rerender) {
            const overlay = el.querySelector('#docFormOverlay');
            if (!overlay) return;
            const close = () => overlay.classList.remove('open');

            overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
            overlay.querySelector('#df_cancel').addEventListener('click', close);

            const stepsWrap = overlay.querySelector('#df_steps');
            overlay.querySelector('#df_addstep').addEventListener('click', () => {
                stepsWrap.insertAdjacentHTML('beforeend', docStepRowHtml());
            });
            stepsWrap.addEventListener('click', (e) => {
                const rm = e.target.closest('.docstep-remove');
                if (!rm) return;
                const rows = stepsWrap.querySelectorAll('.docstep-row');
                if (rows.length > 1) {
                    rm.closest('.docstep-row').remove();
                } else {
                    const row = rm.closest('.docstep-row');
                    row.querySelector('.step-text').value = '';
                    row.querySelector('.step-deadline').value = '';
                }
            });

            overlay.querySelector('#df_save').addEventListener('click', () => {
                const transcript = overlay.querySelector('#df_transcript').value.trim();
                if (!transcript) {
                    showLiveToast('רגע אחד 😊', 'כדאי לכתוב כמה מילים על השיחה לפני השמירה', '✍️');
                    overlay.querySelector('#df_transcript').focus();
                    return;
                }
                const steps = [];
                overlay.querySelectorAll('.docstep-row').forEach(row => {
                    const text = row.querySelector('.step-text').value.trim();
                    if (text) steps.push({ text, deadline: ymdToDisplay(row.querySelector('.step-deadline').value) });
                });
                const doc = {
                    date: ymdToDisplay(overlay.querySelector('#df_date').value) || ymdToDisplay(todayYmd()),
                    teacher: overlay.querySelector('#df_teacher').value.trim() || 'המורה שלי',
                    learner: overlay.querySelector('#df_learner').value.trim() || data.name || 'התלמיד/ה',
                    stage: overlay.querySelector('#df_stage').value,
                    transcript,
                    aiSummary: '',
                    nextSteps: steps,
                    own: true
                };
                data.goalDocs.push(doc);
                data._docIndex = data.goalDocs.length - 1;
                persistDashboard();
                close();
                showLiveToast('התיעוד נשמר! 🌟', 'יובי שמר את המפגש ברשימת היעדים שלך', '📝');
                if (rerender) rerender();
            });
        }

        // -------- DEEP: STRENGTHS --------
        // -------- DEEP: AGENCY ("מצפן הפעלנות") --------
        function agencyLevel(score) {
            if (score >= 85) return { label: 'כוח-על',       color: '#2f855a', soft: 'rgba(72,187,120,0.16)' };
            if (score >= 68) return { label: 'מתחזק',         color: '#5a4bd0', soft: 'rgba(99,102,241,0.14)' };
            if (score >= 50) return { label: 'בונה',          color: '#2b86b3', soft: 'rgba(76,201,240,0.16)' };
            return              { label: 'מתחיל לגלות', color: '#7c5cff', soft: 'rgba(159,122,254,0.16)' };
        }

        // Friendly, kid-safe model of the 6 "agency" components from the spec.
        function deriveAgency(data) {
            if (data.agency && data.agency.length) return data.agency;
            const seed = (data.name || 'תלמיד').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
            const vary = (base, i) => Math.max(44, Math.min(96, base + ((seed * (i + 3)) % 19) - 9));
            const defs = [
                { key: 'motivation', name: 'אני אוהב ללמוד את זה', term: 'מוטיבציה ורלוונטיות', icon: '🔥', base: 78,
                  hi: 'אתה מתחבר ללמידה כשהיא קשורה למה שמעניין אותך 🔥',
                  lo: 'כשנמצא נושאים שמדברים אליך — הלמידה תהפוך לכיף שלך',
                  meaning: 'כמה הלמידה מרגישה לך מעניינת, חשובה וקשורה לחיים שלך — ועד כמה אתה מאמין שתצליח.',
                  tip: 'בוא נבחר נושא שאתה אוהב ונבנה עליו משימה קצרה' },
                { key: 'growth', name: 'אני לא מוותר', term: 'תודעת צמיחה', icon: '🌱', base: 85,
                  hi: 'אתה ממשיך לנסות גם כשקשה — וזה כוח ענק 💪',
                  lo: 'כל טעות היא הזדמנות ללמוד — נתאמן על זה ביחד',
                  meaning: 'איך אתה מתמודד עם אתגרים וקשיים, וכמה אתה מוכן להשקיע מאמץ — בלי להשוות את עצמך לאחרים.',
                  tip: 'כשמשהו קשה, נחלק אותו לצעד אחד קטן בכל פעם' },
                { key: 'initiative', name: 'אני לוקח אחריות', term: 'יוזמה ואחריות', icon: '🚀', base: 66,
                  hi: 'אתה לוקח חלק פעיל בלמידה ויודע לפעול לבד 🚀',
                  lo: 'נתרגל לבחור משימה ולהתחיל אותה בעצמך — צעד אחר צעד',
                  meaning: 'כמה אתה מעורב באופן פעיל בלמידה, ויכול לפעול באופן עצמאי בתוך מסגרת ברורה.',
                  tip: 'בחר היום משימה אחת שתתחיל בה בלי שיזכירו לך' },
                { key: 'regulation', name: 'אני שולט ברגשות שלי', term: 'ויסות עצמי', icon: '🧘', base: 60,
                  hi: 'אתה יודע להירגע ולהמשיך גם אחרי תסכול 🧘',
                  lo: 'נלמד טריקים קטנים להירגע כשמתעצבנים — וזה ממש עוזר',
                  meaning: 'היכולת לזהות ולנהל רגשות בצורה טובה, להתמודד עם תסכול ולחץ, ולקום אחרי כישלון.',
                  tip: 'כשמרגישים תסכול — שלוש נשימות עמוקות ואז ממשיכים' },
                { key: 'awareness', name: 'אני מכיר את עצמי', term: 'מודעות עצמית', icon: '🪞', base: 72,
                  hi: 'אתה יודע במה אתה טוב ומה עוזר לך ללמוד 🪞',
                  lo: 'נגלה יחד מה הדרך שהכי מתאימה לך ללמוד בה',
                  meaning: 'כמה אתה מעריך את ההתקדמות שלך, מזהה מה אתה צריך, ובוחר דרכים שמתאימות לך ללמוד.',
                  tip: 'בסוף משימה, כתוב משפט אחד: מה עזר לי היום?' },
                { key: 'support', name: 'יש לי על מי לסמוך', term: 'תמיכה וחוויות רגשיות', icon: '🤝', base: 88,
                  hi: 'אתה יודע לבקש עזרה כשצריך — וזה חכם מאוד 🤝',
                  lo: 'תמיד יש מי שישמח לעזור לך — גם יובי כאן בשבילך',
                  meaning: 'תחושת הביטחון והשייכות שלך, והיכולת לבקש ולקבל עזרה כשאתה צריך.',
                  tip: 'כשנתקעים — מבקשים עזרה ממורה, מחבר או מיובי' }
            ];
            return defs.map((d, i) => {
                const score = vary(d.base, i);
                return {
                    key: d.key, name: d.name, term: d.term, icon: d.icon, score,
                    kidLine: score >= 60 ? d.hi : d.lo,
                    meaning: d.meaning, tip: d.tip,
                    source: i % 2 === 0 ? 'מהמיפוי 🧭' : 'משיחה עם יובי 💬'
                };
            });
        }

        // Build a hexagon radar chart (SVG) for the 6 agency components.
        function agencyRadarSVG(items) {
            const size = 240, c = size / 2, R = 88, n = items.length;
            const ang = i => (-90 + i * (360 / n)) * Math.PI / 180;
            const pt = (i, r) => [c + r * Math.cos(ang(i)), c + r * Math.sin(ang(i))];
            const poly = (r) => items.map((_, i) => pt(i, r).map(x => x.toFixed(1)).join(',')).join(' ');

            let rings = '';
            [0.25, 0.5, 0.75, 1].forEach(f => {
                rings += `<polygon points="${poly(R * f)}" fill="none" stroke="#e9e3f8" stroke-width="1"/>`;
            });
            let axes = '';
            items.forEach((_, i) => {
                const [x, y] = pt(i, R);
                axes += `<line x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#efeafb" stroke-width="1"/>`;
            });
            const dataPoly = items.map((it, i) => pt(i, R * (it.score / 100)).map(x => x.toFixed(1)).join(',')).join(' ');
            let dots = '', labels = '';
            items.forEach((it, i) => {
                const [dx, dy] = pt(i, R * (it.score / 100));
                dots += `<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="3.6" fill="#7c5cff"/>`;
                const [lx, ly] = pt(i, R + 17);
                labels += `<text x="${lx.toFixed(1)}" y="${(ly + 5).toFixed(1)}" text-anchor="middle" font-size="16">${it.icon}</text>`;
            });
            return `<svg viewBox="0 0 ${size} ${size}" class="agency-radar-svg" role="img" aria-label="מצפן הפעלנות">
                <defs><linearGradient id="agGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stop-color="#9f7afe"/><stop offset="1" stop-color="#4cc9f0"/></linearGradient></defs>
                ${rings}${axes}
                <polygon points="${dataPoly}" fill="url(#agGrad)" fill-opacity="0.32" stroke="url(#agGrad)" stroke-width="2.5" stroke-linejoin="round"/>
                ${dots}${labels}
            </svg>`;
        }

        function renderAgencyView(data) {
            const agency = deriveAgency(data);
            const el = document.getElementById('view-agency');
            el.innerHTML = `
                <button class="view-back" data-goto="home">${t('dashboard.backToDashboard')}</button>
                <div class="view-head"><h1>${t('dashboard.agency.title')}</h1><p>${t('dashboard.agency.subtitle')}</p></div>
                <div class="agency-radar-wrap fade-in">${agencyRadarSVG(agency)}</div>
                <div class="agency-cards">
                    ${agency.map(a => {
                        const lv = agencyLevel(a.score);
                        return `
                        <div class="agency-card fade-in" data-key="${a.key}">
                            <div class="agency-card-head">
                                <div class="agency-ico" style="background:${lv.soft}">${a.icon}</div>
                                <div class="agency-card-main">
                                    <div class="agency-name">${a.name}</div>
                                    <div class="agency-line">${a.kidLine}</div>
                                </div>
                                <span class="agency-pill" style="background:${lv.soft};color:${lv.color}">${lv.label}</span>
                                <span class="agency-caret">▾</span>
                            </div>
                            <div class="agency-bar"><div class="agency-fill" data-target="${a.score}" style="background:linear-gradient(90deg,#9f7afe,#4cc9f0)"></div></div>
                            <div class="agency-detail">
                                <div class="agency-meaning"><strong>${t('dashboard.agency.meaningLabel')}</strong> ${a.meaning}</div>
                                <div class="agency-next"><b>${t('dashboard.agency.nextLabel')}</b><span>${a.tip}</span></div>
                                <div class="agency-source">${a.source}</div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            `;
            el.querySelector('[data-goto]').addEventListener('click', () => switchView('home'));
            requestAnimationFrame(() => setTimeout(() => {
                el.querySelectorAll('.agency-fill').forEach(f => { f.style.width = f.dataset.target + '%'; });
            }, 150));
            el.querySelectorAll('.agency-card').forEach(card => {
                card.querySelector('.agency-card-head').addEventListener('click', () => card.classList.toggle('open'));
            });
        }

        function renderStrengthsView(data) {
            const m = data.mapping || {};
            const strengths = m.strengths || [];
            const interests = m.interests || [];
            const prefs = m.preferences || [];
            const comps = data.competencies || [];

            const badge = (label, explain) => `<button class="badge" data-explain="${explain.replace(/"/g, '&quot;')}">${label}</button>`;

            const el = document.getElementById('view-strengths');
            el.innerHTML = `
                <button class="view-back" data-goto="home">${t('dashboard.backToDashboard')}</button>
                <div class="view-head"><h1>${t('dashboard.strengths.title')}</h1><p>${t('dashboard.strengths.subtitle')}</p></div>

                <div class="deep-block">
                    <div class="deep-block-title">${t('dashboard.strengths.sectionStrengths')}</div>
                    <div class="badge-grid">${strengths.map(s => badge(`${strengthIcon(s)} ${s}`, strengthLine(s))).join('')}</div>
                </div>
                <div class="deep-block">
                    <div class="deep-block-title">${t('dashboard.strengths.sectionSkills')}</div>
                    <div class="badge-grid">${comps.map(c => badge(`${c.icon} ${c.label}`, c.descriptor || '')).join('')}</div>
                </div>
                <div class="deep-block">
                    <div class="deep-block-title">${t('dashboard.strengths.sectionInterests')}</div>
                    <div class="badge-grid">${interests.map(i => badge(`✨ ${i}`, t('dashboard.strengths.interestExplain'))).join('')}</div>
                </div>
                ${prefs.length ? `<div class="deep-block">
                    <div class="deep-block-title">${t('dashboard.strengths.sectionPreferences')}</div>
                    <div class="badge-grid">${prefs.map(p => badge(`👍 ${p}`, t('dashboard.strengths.prefExplain'))).join('')}</div>
                </div>` : ''}

                <div class="badge-explain" id="strengthExplain"></div>
            `;
            el.querySelector('[data-goto]').addEventListener('click', () => switchView('home'));
            const explainEl = el.querySelector('#strengthExplain');
            el.querySelectorAll('.badge').forEach(b => {
                b.addEventListener('click', () => {
                    el.querySelectorAll('.badge').forEach(x => x.classList.remove('selected'));
                    b.classList.add('selected');
                    explainEl.textContent = b.dataset.explain;
                    explainEl.classList.add('show');
                });
            });
        }

        // -------- DEEP: LEARNING PROFILE --------
        function renderLearningView(data) {
            const m = data.mapping || {};
            const prefs = m.preferences || [];
            const el = document.getElementById('view-learning');
            const helps = prefs.length ? prefs : [t('dashboard.learning.defaultHelp1'), t('dashboard.learning.defaultHelp2'), t('dashboard.learning.defaultHelp3')];
            el.innerHTML = `
                <button class="view-back" data-goto="home">${t('dashboard.backToDashboard')}</button>
                <div class="view-head"><h1>${t('dashboard.learning.title')}</h1><p>${t('dashboard.learning.subtitle')}</p></div>

                <div class="lp-card fade-in">
                    <h3>${t('dashboard.learning.styleTitle')}</h3>
                    <div style="font-size:0.85rem;color:var(--text-medium);line-height:1.5">${m.learningStyle || t('dashboard.learning.styleDefault')}</div>
                </div>
                <div class="lp-card fade-in">
                    <h3>${t('dashboard.learning.helpsTitle')}</h3>
                    <div class="lp-list">${helps.map(h => `<div class="lp-row"><span class="lp-dot" style="background:#48bb78"></span> ${h}</div>`).join('')}</div>
                </div>
                <div class="lp-card fade-in">
                    <h3>${t('dashboard.learning.hurtsTitle')}</h3>
                    <div class="lp-list">
                        <div class="lp-row"><span class="lp-dot" style="background:#f6ad55"></span> ${t('dashboard.learning.hurts1')}</div>
                        <div class="lp-row"><span class="lp-dot" style="background:#f6ad55"></span> ${t('dashboard.learning.hurts2')}</div>
                    </div>
                </div>
                <div class="lp-card fade-in">
                    <h3>${t('dashboard.learning.environmentTitle')}</h3>
                    <div style="font-size:0.85rem;color:var(--text-medium);line-height:1.5">${m.environment || t('dashboard.learning.environmentDefault')}</div>
                </div>
            `;
            el.querySelector('[data-goto]').addEventListener('click', () => switchView('home'));
        }

        // ================================================
        // VIEW SWITCHING + NAV
        // ================================================
        function switchView(view) {
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            const target = document.getElementById('view-' + view);
            if (target) target.classList.add('active');
            document.querySelectorAll('.nav-item[data-view]').forEach(n => {
                n.classList.toggle('active', n.dataset.view === view);
            });
            const mc = document.getElementById('mainContent');
            if (mc) mc.scrollTo ? mc.scrollTo(0, 0) : (mc.scrollTop = 0);
            window.scrollTo(0, 0);
        }

        function setupNav() {
            document.querySelectorAll('.nav-item[data-view]').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    switchView(item.dataset.view);
                });
            });
        }



        function animateBars(els) {
            requestAnimationFrame(() => {
                setTimeout(() => {
                    els.forEach(el => { el.style.width = el.dataset.target + '%'; });
                }, 120);
            });
        }

        // ================================================
        // LIVE TOAST (real-time feel)
        // ================================================
        let toastTimer = null;
        function showLiveToast(text, sub, ico) {
            const toast = document.getElementById('liveToast');
            const txt = document.getElementById('toastText');
            toast.querySelector('.toast-ico').textContent = ico || '📡';
            txt.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
            toast.classList.add('show');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => toast.classList.remove('show'), 4200);
        }

        // ================================================
        // YUBI CHAT (text + voice/Jarvis demo)
        // ================================================
        const YUBI_SVG = `<svg viewBox="0 0 44 44" width="18" height="18" fill="none">
            <rect x="9" y="15" width="26" height="21" rx="6" fill="#fff"/>
            <rect x="15" y="21" width="5" height="5" rx="2" fill="#7c5cff"/>
            <rect x="24" y="21" width="5" height="5" rx="2" fill="#7c5cff"/>
            <path d="M18 30 Q22 33 26 30" stroke="#22d3ee" stroke-width="2.6" fill="none" stroke-linecap="round"/>
        </svg>`;

        let chatSeeded = false;
        let voiceTimers = [];

        function firstName() {
            return currentData ? currentData.name.split(' ')[0] : 'חבר';
        }

        // Personalized reply that proves Yubi knows the kid
        function generateReply(msg) {
            const d = currentData;
            if (!d) return 'בוא נתחיל! 😊';
            const m = (msg || '').toLowerCase();
            const name = firstName();
            const interests = d.mapping.interests;
            const strengths = d.mapping.strengths;
            const subjects = d.subjects;
            const diffs = d.difficulties;
            const best = [...subjects].sort((a, b) => b.progress - a.progress)[0];

            if (/(שלום|היי|הי |מה נשמע|מה קורה|בוקר טוב|היי)/.test(m))
                return `היי ${name}! 😊 ראיתי שאתה ממש מתקדם ב${best.name} ושאתה אוהב ${interests[0]}. במה אפשר לעזור היום?`;
            if (/(חוזק|טוב ב|במה אני טוב|מצטיין|מה אני יודע)/.test(m))
                return `אתה ממש חזק ב${best.name} (${best.level})! 💪 והחוזקות הבולטות שלך הן ${strengths.slice(0,2).join(' ו')}. תמשיך ככה!`;
            if (/(מתמטיק|חשבון|שברים|כפל)/.test(m)) {
                const md = diffs.find(x => x.subject === 'מתמטיקה');
                return md ? `במתמטיקה אנחנו עכשיו על "${md.text}" 🔢. בוא נפרק את זה לצעדים קטנים — אני בטוח שתצליח!`
                          : `מתמטיקה זה תחום שאתה מתקדם בו יפה! רוצה תרגול קטן ביחד?`;
            }
            if (/(קשה|לא מבין|תקוע|עזרה|לא מצליח|מתקשה)/.test(m))
                return `אל דאגה ${name} 🌟 ראיתי שאתה עובד על "${diffs[0].text}". זה לגמרי טבעי שלוקח זמן. בוא ננסה יחד צעד קטן אחד?`;
            if (/(משעמם|לא בא לי|אין חשק|לא כיף)/.test(m))
                return `מבין אותך 😄 אולי ננסה לחבר את הלמידה ל${interests[0]} או ${interests[1]}? ככה זה הרבה יותר כיף בשבילך!`;
            if (/(יעד|מטרה|מטרות|רוצה להשיג)/.test(m)) {
                const g = d.goals.find(x => !x.done);
                return g ? `היעד הקרוב שלך הוא: "${g.text}" 🎯. אני כאן ללוות אותך עד שתשיג אותו!`
                         : `כל הכבוד — סיימת את כל היעדים! 🎉 רוצה שנוסיף יעד חדש?`;
            }
            if (/(תודה|מגניב|אחלה|יאללה|מעולה)/.test(m))
                return `בכיף ${name}! 💜 אני תמיד כאן בשבילך.`;
            return `מעניין! 🤔 דרך אגב, ראיתי שאתה אוהב ${interests[Math.floor(Math.random() * interests.length)]} — נוכל לשלב את זה בלמידה. רוצה לנסות?`;
        }

        function addMsg(text, who) {
            const body = document.getElementById('chatBody');
            const row = document.createElement('div');
            row.className = 'msg-row ' + who;
            row.innerHTML = (who === 'bot' ? `<div class="msg-ava">${YUBI_SVG}</div>` : '') +
                `<div class="bubble">${text}</div>`;
            body.appendChild(row);
            body.scrollTop = body.scrollHeight;
        }

        function botReply(text) {
            const body = document.getElementById('chatBody');
            const typing = document.createElement('div');
            typing.className = 'msg-row bot';
            typing.innerHTML = `<div class="msg-ava">${YUBI_SVG}</div><div class="typing"><span></span><span></span><span></span></div>`;
            body.appendChild(typing);
            body.scrollTop = body.scrollHeight;
            setTimeout(() => {
                typing.remove();
                addMsg(text, 'bot');
            }, 850 + Math.min(text.length * 12, 900));
        }

        // ================================================
        // COPILOT SECTION SPARKS (hover summary buttons)
        // ================================================
        function sectionKeyFromHeading(t) {
            t = (t || '').trim();
            if (/יעזור|להתקדם/.test(t)) return 'improve';
            if (/מקצוע/.test(t)) return 'subjects';
            if (/יעד/.test(t)) return 'goals';
            if (/חיזוק/.test(t)) return 'difficulties';
            if (/פעלנות|מצפן/.test(t)) return 'agency';
            if (/חוזק|כישור|עניין|כוח/.test(t)) return 'strengths';
            if (/לומד|סגנון|למידה/.test(t)) return 'learning';
            return 'generic';
        }

        function buildSectionSummary(key, data, heading) {
            data = data || {};
            const subjects = data.subjects || [];
            switch (key) {
                case 'subjects': {
                    const avg = avgProgress(subjects);
                    const sorted = [...subjects].sort((a, b) => (a.progress || 0) - (b.progress || 0));
                    const weak = sorted[0], strong = sorted[sorted.length - 1];
                    const list = subjects.slice(0, 4).map(s => `• ${s.name} — ${s.progress || 0}%`).join('<br>');
                    return {
                        html: `הנה תמונת המצב במקצועות שלך 📚<br><br>${list || 'עוד אין מקצועות להצגה'}<br><br>הממוצע שלך כרגע <strong>${avg}%</strong>.${strong ? ` הכי חזק/ה ב<strong>${strong.name}</strong> 🌟` : ''}${weak && weak !== strong ? ` שווה לשים פוקוס על <strong>${weak.name}</strong>.` : ''}`,
                        cta: weak ? { label: `💪 בוא נתרגל ${weak.name}`, msg: `אני רוצה לתרגל ${weak.name}` } : null
                    };
                }
                case 'goals': {
                    const goals = data.goals || [];
                    if (!goals.length) return { html: 'עוד לא הגדרנו יעדים יחד 🎯 רוצה שנבחר יעד ראשון?', cta: { label: '🎯 בוא נגדיר יעד', msg: 'עזור לי להגדיר יעד חדש' } };
                    const list = goals.slice(0, 4).map(g => `• ${g.text || g}`).join('<br>');
                    return { html: `היעדים שלך כרגע 🎯<br><br>${list}<br><br>כל צעד קטן מקרב אותך! 💜`, cta: { label: '✅ עזור לי להתקדם', msg: `עזור לי להתקדם ביעד: ${goals[0].text || goals[0]}` } };
                }
                case 'difficulties': {
                    const diff = data.difficulties || [];
                    if (!diff.length) return { html: 'אין כרגע נושאים שדורשים חיזוק מיוחד — כל הכבוד! 🎉', cta: null };
                    const list = diff.slice(0, 4).map(d => `• ${d.text}${d.subject ? ` <span style="color:#9a93b5">(${d.subject})</span>` : ''}`).join('<br>');
                    return { html: `זיהיתי כמה נושאים ששווה לחזק 🧩<br><br>${list}<br><br>אל דאגה — נעבוד עליהם יחד בקצב שלך.`, cta: { label: `🚀 בוא נתחיל`, msg: `בוא נעבוד על ${diff[0].text}` } };
                }
                case 'improve': {
                    const diff = data.difficulties || [];
                    const tips = diff.slice(0, 2).map(d => `• ${improveTitle(d)}`).join('<br>');
                    return { html: `כמה דברים קטנים שיכולים לעזור לך להתקדם ✨<br><br>${tips || '• להתמיד בתרגול קצר כל יום 💪'}<br><br>רוצה שאלווה אותך צעד-צעד?`, cta: { label: '👣 כן, בוא נתחיל', msg: 'עזור לי להתקדם צעד צעד' } };
                }
                case 'agency': {
                    const agency = deriveAgency(data);
                    const top = [...agency].sort((a, b) => b.score - a.score)[0];
                    const chips = agency.map(a => `• ${a.icon} ${a.name}`).join('<br>');
                    return { html: `מצפן הפעלנות שלך 🧭<br><br>${chips}<br><br>הכוח הבולט שלך הוא <strong>${top.icon} ${top.name}</strong> — אפשר להישען עליו! 🌟`, cta: { label: '🧭 איך לחזק עוד?', msg: 'איך אני יכול לחזק את כישורי הפעלנות שלי?' } };
                }
                case 'strengths': {
                    const s = (data.mapping && data.mapping.strengths) || [];
                    return { html: `החוזקות שלך 💪<br><br>${s.slice(0, 5).map(x => `• ${x}`).join('<br>') || 'נגלה אותן יחד!'}<br><br>אלה הדברים שאפשר להישען עליהם בכל אתגר.`, cta: { label: '✨ איך לנצל אותן?', msg: 'איך אני יכול להשתמש בחוזקות שלי בלמידה?' } };
                }
                case 'learning': {
                    const ls = (data.mapping && data.mapping.learningStyle) || 'למידה בקצב אישי עם הרבה דוגמאות';
                    return { html: `ככה אתה לומד הכי טוב 🧭<br><br>${ls}<br><br>אני אתאים את ההסברים בדיוק לסגנון הזה 💜`, cta: { label: '🎨 התאם לי משימה', msg: 'תכין לי משימה שמתאימה לסגנון הלמידה שלי' } };
                }
                default:
                    return { html: `הנה סקירה קצרה על "${heading}" ✨ אני כאן כדי לעזור לך להבין ולהתקדם.`, cta: { label: '💬 בוא נדבר על זה', msg: `ספר לי עוד על ${heading}` } };
            }
        }

        function copilotSummarize(key, heading) {
            openChat();
            addMsg(`ספר/י לי על "${heading}" 👀`, 'user');
            const s = buildSectionSummary(key, currentData, heading);
            const cta = s.cta
                ? `<br><br><button class="chat-cta" onclick="sendUserMsg('${String(s.cta.msg).replace(/'/g, "\\'")}')">${s.cta.label}</button>`
                : '';
            botReply(s.html + cta);
        }

        function injectCopilotSparks() {
            const heads = document.querySelectorAll(
                '#mainContent .home-section-head h2, #mainContent .deep-block-title, #mainContent .lp-card h3'
            );
            heads.forEach(h => {
                if (h.querySelector('.copilot-spark')) return;
                const heading = h.textContent.trim();
                const key = sectionKeyFromHeading(heading);
                const btn = document.createElement('button');
                btn.className = 'copilot-spark';
                btn.type = 'button';
                btn.innerHTML = '<span class="cs-ico">✨</span> סיכום מיובי';
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    copilotSummarize(key, heading);
                });
                h.appendChild(btn);
            });
        }

        function renderSuggestions() {
            const sug = document.getElementById('chatSuggestions');
            const chips = ['במה אני טוב? 💪', 'עזור לי במתמטיקה 🔢', 'מה היעדים שלי? 🎯', 'קצת משעמם לי 😅'];
            sug.innerHTML = chips.map(c => `<button type="button">${c}</button>`).join('');
            sug.querySelectorAll('button').forEach(b => {
                b.addEventListener('click', () => sendUserMsg(b.textContent));
            });
        }

        function sendUserMsg(text) {
            if (!text.trim()) return;
            addMsg(text, 'user');
            const reply = generateReply(text);
            botReply(reply);
        }

        function resetChat() {
            const body = document.getElementById('chatBody');
            if (body) body.innerHTML = '';
            chatSeeded = false;
            // reset voice stage
            clearVoice();
        }

        function seedChat() {
            if (chatSeeded) return;
            chatSeeded = true;
            addMsg(generateReply('שלום'), 'bot');
            renderSuggestions();
        }

        // ---- Voice (Jarvis) ----
        function orbState(s) {
            const orb = document.getElementById('jarvisOrb');
            orb.className = 'jarvis-orb ' + (s === 'idle' ? 'idle' : s === 'listening' ? 'active listening' : 'active');
        }
        function clearVoice() {
            voiceTimers.forEach(t => clearTimeout(t));
            voiceTimers = [];
            const mic = document.getElementById('micBtn');
            if (mic) mic.classList.remove('recording');
            orbState('idle');
            const cap = document.getElementById('voiceCaption');
            if (cap) cap.textContent = t('dashboard.yubi.voiceIdle');
        }
        function startVoiceDemo() {
            clearVoice();
            const cap = document.getElementById('voiceCaption');
            const mic = document.getElementById('micBtn');
            mic.classList.add('recording');
            orbState('listening');
            cap.textContent = t('dashboard.yubi.voiceListening');
            voiceTimers.push(setTimeout(() => {
                orbState('idle');
                mic.classList.remove('recording');
                cap.textContent = t('dashboard.yubi.voiceThinking');
            }, 2000));
            voiceTimers.push(setTimeout(() => {
                const reply = generateReply('שלום');
                orbState('speaking');
                cap.textContent = '🔊 ' + reply;
            }, 2900));
            voiceTimers.push(setTimeout(() => {
                orbState('idle');
                document.getElementById('voiceCaption').textContent = t('dashboard.yubi.voiceAgain');
            }, 7500));
        }

        // ---- Open / close / mode ----
        function openChat() {
            document.getElementById('yubiChat').classList.add('open');
            document.getElementById('yubiLauncher').classList.add('hidden');
            seedChat();
        }
        function closeChat() {
            document.getElementById('yubiChat').classList.remove('open');
            document.getElementById('yubiLauncher').classList.remove('hidden');
            clearVoice();
        }

        document.getElementById('yubiFab').addEventListener('click', openChat);
        document.getElementById('yubiBubbleBtn').addEventListener('click', openChat);
        document.getElementById('yubiBubbleClose').addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('yubiBubble').style.display = 'none';
        });
        document.getElementById('yubiClose').addEventListener('click', closeChat);
        document.getElementById('chatForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const input = document.getElementById('chatInput');
            sendUserMsg(input.value);
            input.value = '';
        });
        document.querySelectorAll('.mode-toggle button').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.mode-toggle button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const chat = document.getElementById('yubiChat');
                if (btn.dataset.mode === 'voice') {
                    chat.classList.add('voice');
                    clearVoice();
                } else {
                    chat.classList.remove('voice');
                    clearVoice();
                }
            });
        });
        document.getElementById('micBtn').addEventListener('click', startVoiceDemo);

        // ================================================
        // TOP TABS: Dashboard / Chat (teachers) / Calendar
        // ================================================
        let currentMode = 'dashboard';
        let activeTeacher = null;

        const TEACHERS = [
            {
                id: 'rotem', name: 'המורה רותם', subject: 'מתמטיקה', avatar: 'ר', color: '#7c5cff', online: true, unread: 1,
                messages: [
                    { from: 'them', text: 'היי! ראיתי שהתקדמת יפה בשברים השבוע 👏', day: 'אתמול', time: '14:20' },
                    { from: 'me', text: 'תודה! עדיין קצת מתקשה בבעיות מילוליות 😅', day: 'אתמול', time: '14:25' },
                    { from: 'them', text: 'בוא נעבור על זה יחד במפגש הבא. הכנתי לך דוגמאות מהחיים שיעזרו 🙂', day: 'אתמול', time: '14:31' }
                ]
            },
            {
                id: 'dana', name: 'המורה דנה', subject: 'מדעים', avatar: 'ד', color: '#48bb78', online: false, unread: 1,
                messages: [
                    { from: 'them', text: 'אל תשכח/י להביא את הניסוי הקטן למפגש ביום ראשון 🔬', day: 'היום', time: '09:10' }
                ]
            }
        ];

        function updateTopProfile() {
            if (!currentData) return;
            const n = (currentData.name || 'תלמיד/ה').trim();
            const nameEl = document.getElementById('tbName');
            const avaEl = document.getElementById('tbAva');
            if (nameEl) nameEl.textContent = n;
            if (avaEl) avaEl.textContent = n.charAt(0) || 'ת';
        }

        function updateChatBadge() {
            const total = TEACHERS.reduce((s, t) => s + (t.unread || 0), 0);
            const badge = document.getElementById('chatBadge');
            if (!badge) return;
            if (total > 0) { badge.textContent = total; badge.style.display = ''; }
            else badge.style.display = 'none';
        }

        function renderTeacherList() {
            const wrap = document.getElementById('msgTeachers');
            wrap.innerHTML = '<div class="msg-teachers-title">המורים שלי</div>' +
                TEACHERS.map(t => {
                    const last = t.messages[t.messages.length - 1];
                    const preview = last ? (last.from === 'me' ? 'את/ה: ' : '') + last.text : '';
                    return `<div class="teacher-item ${activeTeacher === t.id ? 'active' : ''}" data-teacher="${t.id}">
                        <div class="teacher-ava" style="background:linear-gradient(135deg,${t.color},${t.color}cc)">${t.avatar}</div>
                        <div class="teacher-info">
                            <div class="teacher-name">${t.name}</div>
                            <div class="teacher-sub">${t.subject}</div>
                            <div class="teacher-preview">${preview}</div>
                        </div>
                        ${t.unread ? `<span class="teacher-unread">${t.unread}</span>` : ''}
                    </div>`;
                }).join('');
            wrap.querySelectorAll('.teacher-item').forEach(el => {
                el.addEventListener('click', () => selectTeacher(el.dataset.teacher));
            });
        }

        function selectTeacher(id) {
            activeTeacher = id;
            const t = TEACHERS.find(x => x.id === id);
            if (t) t.unread = 0;
            updateChatBadge();
            renderTeacherList();
            renderThread();
        }

        function renderThread() {
            const thread = document.getElementById('msgThread');
            const t = TEACHERS.find(x => x.id === activeTeacher);
            if (!t) {
                thread.innerHTML = `<div class="thread-empty"><div class="te-ico">💬</div><div>בחר/י מורה כדי להתחיל לשוחח</div></div>`;
                return;
            }
            let lastDay = '';
            const body = t.messages.map(m => {
                let dayHdr = '';
                if (m.day && m.day !== lastDay) { lastDay = m.day; dayHdr = `<div class="m-day">${m.day}</div>`; }
                return `${dayHdr}<div class="m-bubble ${m.from}">${m.text}<span class="m-time">${m.time}</span></div>`;
            }).join('');
            thread.innerHTML = `
                <div class="thread-head">
                    <div class="teacher-ava" style="background:linear-gradient(135deg,${t.color},${t.color}cc)">${t.avatar}</div>
                    <div>
                        <div class="th-name">${t.name}</div>
                        <div class="th-sub">${t.online ? '<span class="live-dot"></span> מחובר/ת עכשיו' : t.subject}</div>
                    </div>
                </div>
                <div class="thread-body" id="threadBody">${body}</div>
                <form class="thread-input" id="threadForm">
                    <input id="threadInput" type="text" placeholder="כתוב/כתבי ל${t.name}..." autocomplete="off">
                    <button type="submit" aria-label="שלח">➤</button>
                </form>`;
            const tb = document.getElementById('threadBody');
            tb.scrollTop = tb.scrollHeight;
            document.getElementById('threadForm').addEventListener('submit', e => {
                e.preventDefault();
                const inp = document.getElementById('threadInput');
                sendTeacherMsg(inp.value);
                inp.value = '';
            });
        }

        function sendTeacherMsg(text) {
            text = (text || '').trim();
            if (!text) return;
            const t = TEACHERS.find(x => x.id === activeTeacher);
            if (!t) return;
            const now = new Date();
            const hh = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
            t.messages.push({ from: 'me', text, day: 'היום', time: hh });
            renderThread();
            setTimeout(() => {
                const replies = ['קיבלתי! אענה לך בהקדם 🙂', 'כל הכבוד על השאלה 👏 נדבר על זה במפגש', 'מעולה, רשמתי לי 📝', 'אחלה! ממשיכים ככה 💪'];
                t.messages.push({ from: 'them', text: replies[Math.floor(Math.random() * replies.length)], day: 'היום', time: hh });
                if (currentMode === 'chat' && activeTeacher === t.id) renderThread();
            }, 1400);
        }

        const CALENDAR = [
            {
                dnum: '21', dlabel: 'יום ראשון', dsub: '21 ביוני 2026', events: [
                    { time: '10:00', ico: '👩‍🏫', title: 'מפגש עם המורה רותם — מתמטיקה', tag: 'מפגש', color: '#7c5cff', soft: '#f3eeff' },
                    { time: '16:00', ico: '✏️', title: 'תרגול שברים — 15 דקות', tag: 'משימה', color: '#48bb78', soft: '#eafaf1' }
                ]
            },
            {
                dnum: '23', dlabel: 'יום שלישי', dsub: '23 ביוני 2026', events: [
                    { time: '12:00', ico: '🔬', title: 'ניסוי מדעים עם המורה דנה', tag: 'מפגש', color: '#7c5cff', soft: '#f3eeff' }
                ]
            },
            {
                dnum: '25', dlabel: 'יום חמישי', dsub: '25 ביוני 2026', events: [
                    { time: 'כל היום', ico: '🎯', title: 'יעד: לסיים 3 משימות קצרות', tag: 'יעד', color: '#f6ad55', soft: '#fff5e8' }
                ]
            }
        ];

        function renderCalendar() {
            const wrap = document.getElementById('calAgenda');
            wrap.innerHTML = CALENDAR.map(d => `
                <div class="cal-day">
                    <div class="cal-day-head">
                        <div class="cal-day-num"><b>${d.dnum}</b><span>יוני</span></div>
                        <div><div class="cal-day-label">${d.dlabel}</div><div class="cal-day-sub">${d.dsub}</div></div>
                    </div>
                    <div class="cal-events">
                        ${d.events.map(e => `
                            <div class="cal-event" style="--ev-color:${e.color};--ev-soft:${e.soft}">
                                <div class="cal-ev-time">${e.time}</div>
                                <div class="cal-ev-ico">${e.ico}</div>
                                <div class="cal-ev-body"><div class="cal-ev-title">${e.title}</div></div>
                                <span class="cal-ev-tag">${e.tag}</span>
                            </div>`).join('')}
                    </div>
                </div>`).join('');
        }

        function setMode(mode) {
            currentMode = mode;
            document.getElementById('mainContent').style.display = mode === 'dashboard' ? '' : 'none';
            document.getElementById('chatPane').style.display = mode === 'chat' ? '' : 'none';
            document.getElementById('calendarPane').style.display = mode === 'calendar' ? '' : 'none';
            document.querySelectorAll('#topTabs .tt-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
            if (mode === 'chat') {
                if (!activeTeacher && TEACHERS.length) activeTeacher = TEACHERS[0].id;
                renderTeacherList();
                renderThread();
            }
            if (mode === 'calendar') renderCalendar();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        document.querySelectorAll('#topTabs .tt-btn').forEach(b => {
            b.addEventListener('click', () => setMode(b.dataset.mode));
        });
        updateChatBadge();

        // ================================================
        // EVENTS
        // ================================================

        // Initial render from mapping data
        loadDashboard();

        // Simulate a live update shortly after load (demo "alive" feel)
        setTimeout(() => {
            if (currentData) {
                showLiveToast('הכל מוכן! זה המרחב האישי שלך ביובי 💜', 'יובי כאן לעזור לך בכל שלב', '🚀');
            }
        }, 3500);

    function mountYubiRobot(container, options) {
        if (!container || container.querySelector('canvas')) return;
        try {
            window.YubiRobot.mount(container, options);
        } catch (err) {
            console.warn('Yubi robot mount failed:', err);
            container.classList.add('robot-fallback');
            container.innerHTML = MASCOT_SVG;
        }
    }
    function __whenRobotReady(fn){ if (window.YubiRobot) return fn(); const id = setInterval(() => { if (window.YubiRobot) { clearInterval(id); fn(); } }, 60); }
  __whenRobotReady(() => {
    const launcher = document.getElementById('yubiLauncher');
    const chat = document.getElementById('yubiChat');
        mountYubiRobot(document.getElementById('yubiFabRobot'), { view: 'full', isActive: () => launcher && !launcher.classList.contains('hidden') });
        mountYubiRobot(document.getElementById('yubiHeadRobot'), { view: 'head', isActive: () => chat && chat.classList.contains('open') });
  });
  window.sendUserMsg = sendUserMsg;
}
