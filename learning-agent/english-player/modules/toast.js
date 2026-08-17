/* A transient corner toast for failures that are about the moment, not the
 * lesson — a grading round-trip that dropped, audio that would not start.
 * Appended into the page these read as part of the material; floated in the
 * corner (the same shape the host app uses) they read as what they are: a
 * passing condition the learner can ignore or act on.
 *
 * Boot failures do NOT come here — with no lesson behind them, the full-page
 * `.lp-error` takeover in player.js remains the honest surface.
 */

import { el, icon } from './dom.js';

let holder = null;

export function toast(message) {
  if (!message) return;
  if (!holder || !holder.isConnected) {
    holder = el('div', { class: 'lp-toasts' });
    document.body.append(holder);
  }
  const note = el('div', { class: 'lp-toast', role: 'alert' }, [
    icon('alert'),
    el('span', { class: 'lp-toast__msg', text: message }),
  ]);
  const leave = () => {
    if (!note.isConnected) return;
    note.dataset.leaving = '';
    // Let the fade play; remove even if the animation event never fires.
    setTimeout(() => note.remove(), 400);
  };
  note.addEventListener('click', leave);
  setTimeout(leave, 6000);
  holder.append(note);
}
