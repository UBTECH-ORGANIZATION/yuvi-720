// @ts-nocheck
/* eslint-disable */

export function initLessonPlayer() {
    const TOTAL_SLIDES = 10;
    let currentSlide = 0;
    let exerciseCorrect = 0;

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
