/**
 * YuviLab 720 - Learner Mapping
 * Chat window with Yubi 3D robot + single question navigation
 */

class LearnerMappingApp {
    constructor() {
        this.studentName = 'יובל כהן';
        this.questionnaire = null;
        this.allQuestions = [];
        this.questionPartMap = [];
        this.currentIndex = 0;
        this.answers = {};
        this.totalQuestions = 0;
        this.currentScreen = 'chat';
        this.chatMode = 'intro'; // 'intro' or 'section'

        // Intro messages
        this.introMessages = [
            `היי ${this.studentName}!`,
            'אני יובי, הרובוט החכם שלך',
            'בוא נכיר איך נוח לך ללמוד - מה מעניין אותך, איך אתה מרגיש, ומה עוזר לך',
            'ביחד נעבור על כמה שאלות קצרות. אין תשובות נכונות או לא נכונות - פשוט תענה לפי ההרגשה שלך',
            'מוכן? זה ייקח רק כמה דקות ✨'
        ];

        // Section transition messages
        this.sectionMessages = [
            ['בוא נתחיל! ספר לי קצת על מה שמעניין אותך בלימודים'],
            ['מעולה! עכשיו אני רוצה לשמוע קצת על איך אתה מרגיש כשאתה לומד'],
            ['יופי! עכשיו נדבר על הדרך שנוחה לך - מה עוזר לך להצליח'],
            ['כמעט סיימנו! עוד כמה שאלות קצרות על איך נוח לך ללמוד']
        ];

        this.init();
    }

    async init() {
        await this.loadQuestionnaire();
        this.bindEvents();
        this.playIntroChat();
    }

    async loadQuestionnaire() {
        try {
            const resp = await fetch('/api/questionnaire');
            this.questionnaire = await resp.json();
            this.flattenQuestions();
        } catch (err) {
            console.error('Failed to load questionnaire:', err);
        }
    }

    flattenQuestions() {
        this.allQuestions = [];
        this.questionPartMap = [];
        this.questionnaire.parts.forEach((part, partIdx) => {
            part.questions.forEach(q => {
                this.allQuestions.push(q);
                this.questionPartMap.push({ partIndex: partIdx, partTitle: part.title });
            });
        });
        this.totalQuestions = this.allQuestions.length;
    }

    bindEvents() {
        document.getElementById('chatActionBtn').addEventListener('click', () => this.onChatAction());
        document.getElementById('arrowLeft').addEventListener('click', () => this.navigateNext());
        document.getElementById('arrowRight').addEventListener('click', () => this.navigatePrev());
        document.getElementById('viewResultsBtn').addEventListener('click', () => {
            window.location.href = '/learner-mapping/results.html';
        });

        document.addEventListener('keydown', (e) => {
            if (this.currentScreen !== 'question') return;
            if (e.key === 'ArrowLeft') this.navigateNext();
            if (e.key === 'ArrowRight') this.navigatePrev();
        });
    }

    // ============================
    // CHAT
    // ============================
    async playIntroChat() {
        this.chatMode = 'intro';
        this.setStep(0);
        await this.playChatSequence('chatBody', this.introMessages, 'בואו נתחיל');
    }

    async showSectionChat(partIndex) {
        this.chatMode = 'section';
        this.showScreen('chat');
        const msgs = this.sectionMessages[partIndex] || ['בוא נמשיך'];
        const btnText = 'המשך';
        document.getElementById('chatBody').innerHTML = '';
        document.getElementById('chatFooter').style.display = 'none';
        document.getElementById('chatStatus').textContent = 'מקליד...';
        await this.playChatSequence('chatBody', msgs, btnText);
    }

    async playChatSequence(containerId, messages, actionText) {
        const container = document.getElementById(containerId);
        const footer = document.getElementById('chatFooter');
        const statusEl = document.getElementById('chatStatus');
        footer.style.display = 'none';
        statusEl.textContent = 'מקליד...';

        for (let i = 0; i < messages.length; i++) {
            // Show typing
            const typing = this.createTypingBubble();
            container.appendChild(typing);
            this.scrollChat(container);

            const delay = 600 + messages[i].length * 15;
            await this.wait(Math.min(delay, 1500));

            // Replace with message
            container.removeChild(typing);
            const row = document.createElement('div');
            row.className = 'chat-row bot';
            row.innerHTML = `
                <div class="bot-avatar">
                    <svg viewBox="0 0 36 36" width="32" height="32" fill="none">
                        <rect x="8" y="12" width="20" height="16" rx="4" fill="#7c5cff"/>
                        <rect x="12" y="16" width="4" height="4" rx="1.5" fill="#fff"/>
                        <rect x="20" y="16" width="4" height="4" rx="1.5" fill="#fff"/>
                        <rect x="15" y="22" width="6" height="2" rx="1" fill="#c4b5fd"/>
                        <rect x="14" y="6" width="8" height="6" rx="2" fill="#9f7afe"/>
                        <rect x="17" y="3" width="2" height="4" rx="1" fill="#c4b5fd"/>
                        <circle cx="18" cy="2" r="2" fill="#22d3ee"/>
                        <rect x="4" y="16" width="4" height="8" rx="2" fill="#9f7afe"/>
                        <rect x="28" y="16" width="4" height="8" rx="2" fill="#9f7afe"/>
                    </svg>
                </div>
                <div class="chat-bubble bot">${messages[i]}</div>
            `;
            container.appendChild(row);
            this.scrollChat(container);

            await this.wait(300);
        }

        // Show action button
        statusEl.textContent = 'מחובר';
        document.getElementById('chatActionText').textContent = actionText;
        footer.style.display = 'flex';
        footer.style.opacity = '0';
        requestAnimationFrame(() => {
            footer.style.transition = 'opacity 0.3s ease';
            footer.style.opacity = '1';
        });
    }

    createTypingBubble() {
        const row = document.createElement('div');
        row.className = 'chat-row bot typing-row';
        row.innerHTML = `
            <div class="bot-avatar">
                <svg viewBox="0 0 36 36" width="32" height="32" fill="none">
                    <rect x="8" y="12" width="20" height="16" rx="4" fill="#7c5cff"/>
                    <rect x="12" y="16" width="4" height="4" rx="1.5" fill="#fff"/>
                    <rect x="20" y="16" width="4" height="4" rx="1.5" fill="#fff"/>
                    <rect x="15" y="22" width="6" height="2" rx="1" fill="#c4b5fd"/>
                    <rect x="14" y="6" width="8" height="6" rx="2" fill="#9f7afe"/>
                    <rect x="17" y="3" width="2" height="4" rx="1" fill="#c4b5fd"/>
                    <circle cx="18" cy="2" r="2" fill="#22d3ee"/>
                    <rect x="4" y="16" width="4" height="8" rx="2" fill="#9f7afe"/>
                    <rect x="28" y="16" width="4" height="8" rx="2" fill="#9f7afe"/>
                </svg>
            </div>
            <div class="chat-bubble typing">
                <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
            </div>
        `;
        return row;
    }

    scrollChat(container) {
        container.scrollTop = container.scrollHeight;
    }

    onChatAction() {
        if (this.chatMode === 'intro') {
            // Start first question
            this.currentIndex = 0;
            this.showScreen('question');
            this.renderQuestion('enter-left');
        } else if (this.chatMode === 'summary') {
            // Continue to next section's questions
            this.showScreen('question');
            this.renderQuestion('enter-left');
        }
    }

    wait(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    // ============================
    // SCREENS
    // ============================
    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById(`screen-${screenId}`).classList.add('active');
        this.currentScreen = screenId;

        const progress = document.getElementById('progressSection');
        if (screenId === 'question') {
            progress.classList.add('visible');
            this.setStep(1);
        } else {
            progress.classList.remove('visible');
        }
    }

    setStep(n) {
        document.querySelectorAll('#stepper .step').forEach((el, i) => {
            el.classList.toggle('active', i === n);
            el.classList.toggle('done', i < n);
        });
    }

    // ============================
    // QUESTION
    // ============================
    renderQuestion(animClass) {
        const card = document.getElementById('questionCard');
        const q = this.allQuestions[this.currentIndex];
        const partInfo = this.questionPartMap[this.currentIndex];

        // Clean title (remove emojis)
        const cleanTitle = partInfo.partTitle.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
        document.getElementById('questionPartBadge').textContent = cleanTitle;

        document.getElementById('questionNumber').textContent = this.currentIndex + 1;
        document.getElementById('questionText').textContent = q.text;

        const grid = document.getElementById('optionsGrid');
        grid.innerHTML = '';
        const options = q.options || [];

        options.forEach((opt, idx) => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            if (this.answers[q.id] === idx) btn.classList.add('selected');
            // Split leading emoji from the label so it can be styled separately
            const raw = String(opt);
            const emojiMatch = raw.match(/^([\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}])\s*/u);
            const emoji = emojiMatch ? emojiMatch[1] : '';
            const label = emojiMatch ? raw.slice(emojiMatch[0].length) : raw;
            btn.innerHTML = `${emoji ? `<span class="option-emoji">${emoji}</span>` : '<span class="option-emoji"></span>'}<span class="option-label">${label}</span><span class="option-check">✔</span>`;
            btn.addEventListener('click', () => this.selectOption(q.id, idx, btn));
            grid.appendChild(btn);
        });

        document.getElementById('arrowRight').classList.toggle('disabled', this.currentIndex === 0);

        if (animClass) {
            card.classList.remove('question-enter-left', 'question-enter-right');
            void card.offsetWidth;
            card.classList.add(`question-${animClass}`);
        }

        this.updateProgress();
    }

    selectOption(questionId, optionIdx, btnEl) {
        this.answers[questionId] = optionIdx;
        document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
        btnEl.classList.add('selected');

        setTimeout(() => {
            if (this.currentIndex < this.totalQuestions - 1) {
                this.navigateNext();
            } else {
                this.submitQuestionnaire();
            }
        }, 350);
    }

    navigateNext() {
        const q = this.allQuestions[this.currentIndex];
        if (this.answers[q.id] === undefined) return;

        const currentPart = this.questionPartMap[this.currentIndex].partIndex;
        this.currentIndex++;

        if (this.currentIndex >= this.totalQuestions) {
            // Last section completed - show summary then submit
            this.showSectionSummary(currentPart, true);
            return;
        }

        const nextPart = this.questionPartMap[this.currentIndex].partIndex;
        if (nextPart !== currentPart) {
            // Section boundary - show summary
            this.showSectionSummary(currentPart, false);
        } else {
            this.renderQuestion('enter-left');
        }
    }

    async showSectionSummary(partIndex, isLast) {
        this.chatMode = 'summary';
        this.isLastSection = isLast;
        this.showScreen('chat');
        this.setStep(2);

        const container = document.getElementById('chatBody');
        const footer = document.getElementById('chatFooter');
        container.innerHTML = '';
        footer.style.display = 'none';
        document.getElementById('chatStatus').textContent = 'חושב...';

        // Gather Q&A for this section
        const part = this.questionnaire.parts[partIndex];
        const qa_pairs = part.questions.map(q => {
            const ansIdx = this.answers[q.id];
            const ansText = ansIdx !== undefined ? (q.options[ansIdx] || '') : '';
            return { question: q.text, answer: ansText };
        });

        // Remember the section context so the free-chat LLM has something to react to
        this.lastSectionContext = `${part.title} — ` +
            qa_pairs.map(p => `${p.question}: ${p.answer}`).join(' | ');

        // Show typing
        const typing = this.createTypingBubble();
        container.appendChild(typing);
        this.scrollChat(container);

        // Call LLM for summary (streaming)
        let summaryText = '';
        try {
            // Remove typing, create empty bot bubble for streaming
            container.removeChild(typing);
            const { row, bubble } = this.createStreamBubble(container);

            const resp = await fetch('/api/section-summary-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ part_title: part.title, questions_and_answers: qa_pairs, student_name: this.studentName })
            });

            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const payload = line.slice(6);
                    if (payload === '[DONE]') break;
                    try {
                        const parsed = JSON.parse(payload);
                        if (parsed.text) {
                            summaryText += parsed.text;
                            bubble.innerHTML = this.escapeHtml(summaryText).replace(/\n/g, '<br>');
                            this.scrollChat(container);
                        }
                    } catch (e) {}
                }
            }
        } catch (err) {
            if (typing.parentNode) container.removeChild(typing);
            summaryText = 'תודה על התשובות! רוצה להוסיף משהו נוסף שחשוב לך שאדע?';
            await this.showBotMessage(container, summaryText);
        }

        if (!this.chatHistory) this.chatHistory = [];
        this.chatHistory.push({ role: 'assistant', content: summaryText });

        document.getElementById('chatStatus').textContent = 'מחובר';

        // Show free-text input + continue button
        this.showSummaryFooter(footer, isLast);
    }

    createStreamBubble(container) {
        const row = document.createElement('div');
        row.className = 'chat-row bot';
        row.innerHTML = `
            <div class="bot-avatar">
                <svg viewBox="0 0 36 36" width="32" height="32" fill="none">
                    <rect x="8" y="12" width="20" height="16" rx="4" fill="#7c5cff"/>
                    <rect x="12" y="16" width="4" height="4" rx="1.5" fill="#fff"/>
                    <rect x="20" y="16" width="4" height="4" rx="1.5" fill="#fff"/>
                    <rect x="15" y="22" width="6" height="2" rx="1" fill="#c4b5fd"/>
                    <rect x="14" y="6" width="8" height="6" rx="2" fill="#9f7afe"/>
                    <rect x="17" y="3" width="2" height="4" rx="1" fill="#c4b5fd"/>
                    <circle cx="18" cy="2" r="2" fill="#22d3ee"/>
                    <rect x="4" y="16" width="4" height="8" rx="2" fill="#9f7afe"/>
                    <rect x="28" y="16" width="4" height="8" rx="2" fill="#9f7afe"/>
                </svg>
            </div>
            <div class="chat-bubble bot"></div>
        `;
        container.appendChild(row);
        this.scrollChat(container);
        const bubble = row.querySelector('.chat-bubble');
        return { row, bubble };
    }

    async showBotMessage(container, text) {
        const row = document.createElement('div');
        row.className = 'chat-row bot';
        row.innerHTML = `
            <div class="bot-avatar">
                <svg viewBox="0 0 36 36" width="32" height="32" fill="none">
                    <rect x="8" y="12" width="20" height="16" rx="4" fill="#7c5cff"/>
                    <rect x="12" y="16" width="4" height="4" rx="1.5" fill="#fff"/>
                    <rect x="20" y="16" width="4" height="4" rx="1.5" fill="#fff"/>
                    <rect x="15" y="22" width="6" height="2" rx="1" fill="#c4b5fd"/>
                    <rect x="14" y="6" width="8" height="6" rx="2" fill="#9f7afe"/>
                    <rect x="17" y="3" width="2" height="4" rx="1" fill="#c4b5fd"/>
                    <circle cx="18" cy="2" r="2" fill="#22d3ee"/>
                    <rect x="4" y="16" width="4" height="8" rx="2" fill="#9f7afe"/>
                    <rect x="28" y="16" width="4" height="8" rx="2" fill="#9f7afe"/>
                </svg>
            </div>
            <div class="chat-bubble bot">${this.escapeHtml(text).replace(/\n/g, '<br>')}</div>
        `;
        container.appendChild(row);
        this.scrollChat(container);
    }

    showSummaryFooter(footer, isLast) {
        footer.innerHTML = `
            <div class="summary-footer">
                <div class="free-text-row">
                    <input type="text" id="freeTextInput" class="free-text-input" placeholder="רוצה להוסיף משהו? (לא חובה)" />
                    <button class="send-btn" id="sendFreeTextBtn">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    </button>
                </div>
                <button class="chat-action-btn" id="continueBtn">
                    <span>${isLast ? 'סיימנו! הצג תוצאות' : 'המשך לחלק הבא'}</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
            </div>
        `;
        footer.style.display = 'flex';
        footer.style.opacity = '0';
        requestAnimationFrame(() => {
            footer.style.transition = 'opacity 0.3s ease';
            footer.style.opacity = '1';
        });

        // Bind events
        document.getElementById('continueBtn').addEventListener('click', () => {
            if (isLast) {
                this.submitQuestionnaire();
            } else {
                this.onChatAction();
            }
        });

        document.getElementById('sendFreeTextBtn').addEventListener('click', () => this.sendFreeText());
        document.getElementById('freeTextInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.sendFreeText();
        });
    }

    escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async sendFreeText() {
        const input = document.getElementById('freeTextInput');
        const sendBtn = document.getElementById('sendFreeTextBtn');
        const text = input.value.trim();
        if (!text) return;

        // Show the student's message
        const container = document.getElementById('chatBody');
        const userRow = document.createElement('div');
        userRow.className = 'chat-row user';
        userRow.innerHTML = `<div class="chat-bubble user">${this.escapeHtml(text)}</div>`;
        container.appendChild(userRow);
        this.scrollChat(container);

        if (!this.freeTextNotes) this.freeTextNotes = [];
        this.freeTextNotes.push(text);
        if (!this.chatHistory) this.chatHistory = [];
        this.chatHistory.push({ role: 'user', content: text });

        input.value = '';
        input.disabled = true;
        if (sendBtn) sendBtn.disabled = true;

        // Typing indicator while Yubi thinks
        const typing = this.createTypingBubble();
        container.appendChild(typing);
        this.scrollChat(container);

        let reply = '';
        try {
            if (typing.parentNode) container.removeChild(typing);
            const { row, bubble } = this.createStreamBubble(container);

            const resp = await fetch('/api/mapping-chat-stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    student_name: this.studentName,
                    context: this.lastSectionContext || '',
                    history: this.chatHistory.slice(-10)
                })
            });

            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    const payload = line.slice(6);
                    if (payload === '[DONE]') break;
                    try {
                        const parsed = JSON.parse(payload);
                        if (parsed.text) {
                            reply += parsed.text;
                            bubble.innerHTML = this.escapeHtml(reply).replace(/\n/g, '<br>');
                            this.scrollChat(container);
                        }
                    } catch (e) {}
                }
            }
        } catch (err) {
            if (typing.parentNode) container.removeChild(typing);
            reply = 'תודה ששיתפת! רשמתי את זה. יש עוד משהו שתרצה לספר לי?';
            await this.showBotMessage(container, reply);
        }

        this.chatHistory.push({ role: 'assistant', content: reply });

        input.disabled = false;
        if (sendBtn) sendBtn.disabled = false;
        input.focus();
    }

    navigatePrev() {
        if (this.currentIndex <= 0) return;
        this.currentIndex--;
        this.renderQuestion('enter-right');
    }

    updateProgress() {
        const answered = Object.keys(this.answers).length;
        const percent = Math.round((answered / this.totalQuestions) * 100);
        document.getElementById('progressFill').style.width = `${percent}%`;
        
        // Show part-based progress: "חלק X מתוך 3 | שאלה Y מתוך Z"
        const partInfo = this.questionPartMap[this.currentIndex];
        const partIndex = partInfo.partIndex;
        const totalParts = this.questionnaire.parts.length;
        const partQuestions = this.questionnaire.parts[partIndex].questions;
        const questionInPart = this.allQuestions.slice(0, this.currentIndex + 1)
            .filter((_, i) => this.questionPartMap[i].partIndex === partIndex).length;
        
        document.getElementById('progressLabel').textContent = 
            `חלק ${partIndex + 1} מתוך ${totalParts} • שאלה ${questionInPart} מתוך ${partQuestions.length}`;
        document.getElementById('progressCounter').textContent = `${percent}%`;
    }

    // ============================
    // SUBMIT
    // ============================
    async submitQuestionnaire() {
        this.showScreen('complete');
        this.setStep(3);

        try {
            const resp = await fetch('/api/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ student_id: 'student_1', student_name: this.studentName, answers: this.answers })
            });
            const result = await resp.json();
            localStorage.setItem('mapping_results', JSON.stringify(result));
        } catch (err) {
            console.error('Submit error:', err);
        }

        setTimeout(() => {
            document.getElementById('loadingAnimation').style.display = 'none';
            document.getElementById('viewResultsBtn').style.display = '';
        }, 2500);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new LearnerMappingApp();
});
