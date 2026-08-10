/* Yuvi thinking.
 *
 * Waiting is the one part of a chat you cannot design away, so it may as well
 * be the same waiting everywhere: the learner's companion and the teacher's
 * assistant show this identical orbit rather than each inventing a spinner.
 * Extracted from CompanionChat so there is one keyframe, not two that drift.
 *
 * `role="status"` with the label on the wrapper: a screen reader announces
 * "Yuvi is thinking" once, and the three dots stay `aria-hidden` decoration.
 */

import './thinking-orbit.css'

export function ThinkingOrbit({ label }: { label: string }) {
  return (
    <div className="sp-thinking" role="status" aria-label={label}>
      <span className="sp-thinking__orbit" aria-hidden="true">
        <i /><i /><i />
      </span>
      <span>{label}</span>
    </div>
  )
}
