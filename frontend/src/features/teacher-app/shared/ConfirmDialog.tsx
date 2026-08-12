/* "Are you sure?", in the app's own dialog.
 *
 * `window.confirm` was doing this job: browser chrome with no theme, no RTL,
 * buttons labelled in the BROWSER's language rather than the teacher's, and no
 * room to say what is about to be lost. The naming prompts were replaced for
 * exactly those reasons; the confirmations were left behind.
 *
 * The destructive button carries the destructive styling and the plain wording
 * ("Delete the group"), never "OK" — a teacher who has stopped reading dialogs
 * should still be able to tell the two buttons apart at a glance.
 */

import { Modal } from '../../../components/primitives/Modal'
import { useI18n } from '../../../i18n/I18nProvider'

interface Props {
  open: boolean
  title: string
  /** What will happen, in one sentence. Optional only when the title says it. */
  body?: string
  confirmLabel: string
  /** Styles the confirm button as destructive. */
  destructive?: boolean
  busy?: boolean
  onClose: () => void
  onConfirm: () => void
}

export function ConfirmDialog({
  open, title, body, confirmLabel, destructive, busy, onClose, onConfirm,
}: Props) {
  const { t } = useI18n()
  return (
    <Modal open={open} onClose={onClose} titleId="tch-confirm-title" className="tch-confirm">
      <h2 id="tch-confirm-title" className="tch-prompt__title" dir="auto">{title}</h2>
      {body ? <p className="tch-confirm__body" dir="auto">{body}</p> : null}
      <div className="tch-prompt__actions">
        <button type="button" className="sp-btn sp-btn--ghost sp-btn--sm" onClick={onClose}>
          {t('tch.subgroups.cancel')}
        </button>
        <button
          type="button"
          className={`sp-btn sp-btn--sm${destructive ? ' sp-btn--danger' : ''}`}
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
