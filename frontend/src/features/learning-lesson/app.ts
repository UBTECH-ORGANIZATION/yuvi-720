// @ts-nocheck
/* eslint-disable */

import { mintLaunch, emit, CURRENT_LEARNER_ID } from '../../services/xapi'
import { getBrain } from '../../services/brain'
import { reportIdle } from '../../services/agents'

// This lesson is the P1 reference lomda — the conformance reference for xAPI
// instrumentation (§8.3). It reports real events to the LRS so the brain's
// mastery/current_state come from actual learning, not invented numbers.
const OBJECTIVE_ID = 'math-angles'
const SUBJECT = 'math'
const UNIT_ID = 'YuviDori-math-angles-0001'
const COMPONENT_ID = 'YuviDori-math-angles-0001-lesson'

export function initLessonPlayer() {
    const TOTAL_SLIDES = 10;
    let currentSlide = 0;
    let exerciseCorrect = 0;
    let slx = null;                 // slxapi launch context (once minted)
    let completedEmitted = false;   // emit `completed` at most once
    const exerciseTotal = document.querySelectorAll('.exercise-options').length || 1;

    function resumeSlide(idx) {
        if (typeof idx === 'number' && idx > 0 && idx < TOTAL_SLIDES) showSlide(idx);
    }

    // Bootstrap: mint a launch, emit `enter`, and resume from the brain (F1.6).
    (async () => {
        try {
            const launch = await mintLaunch({
                learner_id: CURRENT_LEARNER_ID,
                objective_id: OBJECTIVE_ID, subject: SUBJECT,
                unit_id: UNIT_ID, component_id: COMPONENT_ID,
            });
            slx = launch.slxapi;
            emit(slx, {
                verb: 'enter', objectId: COMPONENT_ID, objectType: 'onlinelesson',
                extensions: { objective_id: OBJECTIVE_ID, subject: SUBJECT },
            });
            const brain = await getBrain(CURRENT_LEARNER_ID);
            const token = brain?.current_state?.resume_token;
            if (token && typeof token.slide === 'number') resumeSlide(token.slide);
        } catch {
            // Degrade honestly: the lesson still runs without the event pipeline.
        }
    })();

    // Idle detection (R5): absence of interaction isn't an xAPI verb, so we report
    // it. The trigger engine turns "no interaction for 60s in a task" into a gentle
    // proactive nudge from the companion.
    let idleTimer = null;
    function resetIdle() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => reportIdle(OBJECTIVE_ID), 60000);
    }
    ['click', 'keydown', 'pointermove'].forEach((ev) =>
        document.addEventListener(ev, resetIdle, { passive: true })
    );
    resetIdle();


    function showSlide(idx) {
        document.querySelectorAll('.slide').forEach(s => s.classList.remove('active'));
        const target = document.querySelector(`.slide[data-slide="${idx}"]`);
        if (target) target.classList.add('active');
        currentSlide = idx;

        // Update progress
        const pct = Math.round(((idx + 1) / TOTAL_SLIDES) * 100);
        document.getElementById('progressFill').style.width = pct + '%';
        document.getElementById('progressLabel').textContent = `שקופית ${idx + 1} מתוך ${TOTAL_SLIDES}`;

        // Nav buttons
        document.getElementById('prevBtn').style.display = idx === 0 ? 'none' : 'inline-block';

        // On completion slide, hide nav
        if (idx === TOTAL_SLIDES - 1) {
            document.getElementById('navArea').style.display = 'none';
            document.getElementById('correctCount').textContent = exerciseCorrect;
            // Emit `completed` once — assessment component, real success + score
            // (only after the summary is shown, per §8.1). Score stays internal.
            if (slx && !completedEmitted) {
                completedEmitted = true;
                const scaled = Math.round((exerciseCorrect / exerciseTotal) * 100) / 100;
                emit(slx, {
                    verb: 'completed', objectId: COMPONENT_ID, objectType: 'assignment',
                    success: exerciseCorrect / exerciseTotal >= 0.6, scoreScaled: scaled,
                    extensions: {
                        objective_id: OBJECTIVE_ID, subject: SUBJECT,
                        is_assessment: true, resume_token: { slide: idx },
                    },
                });
            }
        } else {
            document.getElementById('navArea').style.display = 'flex';
        }

        // Next button text
        const nextBtn = document.getElementById('nextBtn');
        if (idx === TOTAL_SLIDES - 2) {
            nextBtn.textContent = 'סיום! 🏆';
        } else {
            nextBtn.textContent = 'הבא →';
        }

        // Draw canvases if they exist on this slide
        requestAnimationFrame(drawCanvases);
    }

    function nextSlide() {
        if (currentSlide < TOTAL_SLIDES - 1) showSlide(currentSlide + 1);
    }
    function prevSlide() {
        if (currentSlide > 0) showSlide(currentSlide - 1);
    }

    // Draw angle canvases
    function drawAngle(canvasId, angleDeg, color, label) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const cx = 80, cy = 100, len = 60;
        ctx.clearRect(0, 0, 160, 160);

        const startAngle = 0;
        const endAngle = -angleDeg * Math.PI / 180;

        // Draw arc
        ctx.beginPath();
        ctx.arc(cx, cy, 25, startAngle, endAngle, true);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Draw lines
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + len, cy);
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + len * Math.cos(endAngle), cy + len * Math.sin(endAngle));
        ctx.stroke();

        // Label
        ctx.font = 'bold 14px Rubik';
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.fillText(label, cx + 10, cy - 35);

        // Dot at vertex
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#7c5cff';
        ctx.fill();
    }

    function drawCanvases() {
        drawAngle('canvasAcute', 45, '#22d3ee', '45°');
        drawAngle('canvasRight', 90, '#48bb78', '90°');
        drawAngle('canvasObtuse', 130, '#f6ad55', '130°');
        drawAngle('canvasStraight', 180, '#fc8181', '180°');
    }

    // Exercise interaction
    document.querySelectorAll('.exercise-options').forEach((optGroup, groupIdx) => {
        const correctIdx = parseInt(optGroup.dataset.correct);
        const feedbackEl = document.getElementById('fb' + (groupIdx + 1));
        const buttons = optGroup.querySelectorAll('.exercise-opt');

        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.classList.contains('disabled')) return;
                const chosen = parseInt(btn.dataset.idx);
                buttons.forEach(b => b.classList.add('disabled'));

                if (chosen === correctIdx) {
                    btn.classList.add('correct');
                    feedbackEl.textContent = '🎉 מעולה! תשובה נכונה!';
                    feedbackEl.className = 'exercise-feedback show success';
                    exerciseCorrect++;
                } else {
                    btn.classList.add('wrong');
                    buttons[correctIdx].classList.add('correct');
                    feedbackEl.textContent = '😊 לא נורא! התשובה הנכונה מסומנת בירוק';
                    feedbackEl.className = 'exercise-feedback show fail';
                }

                // Report the answer to the LRS (verb `answered`). success + score
                // are real; a wrong answer carries a misconception hint for the
                // coach/pedagogical triggers (P4). resume_token enables F1.6.
                if (slx) {
                    const correct = chosen === correctIdx;
                    emit(slx, {
                        verb: 'answered',
                        objectId: `${COMPONENT_ID}-q${groupIdx + 1}`,
                        objectType: 'question',
                        success: correct,
                        scoreScaled: correct ? 1 : 0,
                        response: String(chosen),
                        extensions: {
                            objective_id: OBJECTIVE_ID, subject: SUBJECT,
                            question_id: `q${groupIdx + 1}`,
                            resume_token: { slide: currentSlide },
                            ...(correct ? {} : { misconception: 'angle_type_confusion' }),
                        },
                    });
                }
            });
        });
    });

    // Keyboard navigation
    document.addEventListener('keydown', e => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            // In RTL: ArrowLeft = forward, ArrowRight = back
            if (e.key === 'ArrowLeft') nextSlide();
            else prevSlide();
        }
    });

    // Init
    showSlide(0);

  window.prevSlide=prevSlide; window.nextSlide=nextSlide;
}
