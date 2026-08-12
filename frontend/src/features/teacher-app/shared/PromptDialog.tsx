/* Asking the teacher for one short string, in the app's own voice.
 *
 * This replaces `window.prompt`, which the roster and the sub-group form both
 * used. A native prompt is browser chrome: it ignores the app's theme, ignores
 * `direction` so a Hebrew question renders with LTR affordances, labels its own
 * buttons in the *browser's* language rather than the teacher's, and cannot be
 * styled or tested. On a page that has just opened a dialog it also stacks a
 * second, uglier dialog on top of the first.
 *
 * Deliberately minimal: one label, one field, confirm and cancel. Anything that
 * needs two fields is a form, and a form belongs in its own component.
 */

import { useEffect, useState } from 'react'
import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'

interface Props {
  open: boolean
  /** The question, already translated. */
  label: string
  /** Prefilled value — a rename starts from the current name. */
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
  /** Called with the trimmed value. Never called with an empty string. */
  onConfirm: (value: string) => void
  onClose: () => void
}

export function PromptDialog({
  open, label, initialValue = '', placeholder, confirmLabel, onConfirm, onClose,
}: Props) {
  const { t } = useI18n()
  const [value, setValue] = useState(initialValue)

  // Reopening for a different sub-group must not show the previous one's name.
  useEffect(() => {
    if (open) setValue(initialValue)
  }, [open, initialValue])

  const ready = Boolean(value.trim())
  const submit = () => {
    if (!ready) return
    onConfirm(value.trim())
  }

  return (
    <Modal open={open} onClose={onClose} titleId="tch-prompt-title" className="tch-prompt">
      <h2 id="tch-prompt-title" className="tch-prompt__title" dir="auto">{label}</h2>
      <input
        className="sp-input"
        value={value}
        dir="auto"
        autoFocus
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
      />
      <div className="tch-prompt__actions">
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onClose}>
          {t('tch.subgroup.cancel')}
        </button>
        <button type="button" className="sp-btn sp-btn--sm" disabled={!ready} onClick={submit}>
          {confirmLabel ?? t('tch.subgroup.keepSave')}
        </button>
      </div>
    </Modal>
  )
}
