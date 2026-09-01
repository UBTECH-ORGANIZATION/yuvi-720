import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../i18n/I18nProvider'
import { Icon } from './Icon'

/* Shared modal primitive.

   The app has several hand-rolled dialogs; this is the one that behaves
   correctly for keyboard and screen-reader users: Escape closes, Tab is trapped
   inside, and focus returns to whatever opened it. */

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

interface ModalProps {
  open: boolean
  onClose: () => void
  titleId: string
  children: ReactNode
  className?: string
  /** Dim the page behind. Off when the modal is meant to sit *within* the scene
   *  rather than on top of it. */
  overlay?: boolean
  /** Whether a click on the backdrop closes it. Default yes.
   *
   *  Off for dialogs holding work in progress — a mis-click a pixel outside a
   *  long form should not throw the form away. Escape still closes: it is the
   *  keyboard's only exit and pressing it is deliberate in a way that clicking
   *  past the edge of a dialog is not. Callers that turn this off should be
   *  keeping the draft anyway, so neither exit loses anything. */
  dismissible?: boolean
  /** Render a close X in the dialog's top corner. For dialogs whose only other
   *  exits are the backdrop and Escape — both invisible affordances. */
  withClose?: boolean
}

export function Modal({
  open, onClose, titleId, children, className, overlay = true, dismissible = true,
  withClose = false,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const { direction, t } = useI18n()

  // Held in a ref so the focus effect below can depend on `open` alone. Callers
  // routinely pass an inline arrow, and if that identity were a dependency the
  // effect would tear down and re-run on EVERY render — including the re-render
  // caused by typing a character, which would yank focus out of the field the
  // user is typing into after each keystroke.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement as HTMLElement | null

    const focusable = () => [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) || [])]
    // Focus the dialog itself, not the first field: auto-focusing a text input
    // pops the keyboard on mobile and makes the caret jump before the user has
    // read the dialog. Tab still lands on the first field.
    dialogRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Escape closes the innermost open thing. A tooltip inside the dialog
        // listens on `window` too, and both handlers fire — so without this,
        // dismissing "what is a פעילות?" also threw away the form behind it.
        // Checked by looking rather than by coordinating: anything that opens
        // on Escape can rely on it without registering anywhere.
        //
        // Document-wide, not `dialogRef.querySelector`: a tooltip renders into
        // the body so that no scroll box can crop it, which means it is no
        // longer a descendant of the dialog it belongs to. Scoping the lookup
        // to the dialog silently stopped finding it, and Escape went back to
        // throwing away the form behind the bubble. Nothing else is open at the
        // time — a pointer or a key elsewhere dismisses a tooltip first.
        if (document.querySelector('[role="tooltip"]:not([hidden])')) return
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      returnFocusRef.current?.focus?.()
    }
  }, [open])

  // Freeze the page behind. Beyond the usual reason, the landing page animates
  // Yuvi along the scroll position — letting it scroll would fly him off the
  // scene the dialog is part of.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  if (!open) return null

  // Portal to <body>: a transformed ancestor (the landing page animates several)
  // becomes the containing block for `position: fixed`, which silently pushes a
  // centred modal off-centre.
  return createPortal(
    <div
      className={`sp-modal-backdrop${overlay ? '' : ' sp-modal-backdrop--bare'}`}
      role="presentation"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        className={`sp-modal${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        dir={direction}
        onClick={(event) => event.stopPropagation()}
      >
        {withClose ? (
          <button
            type="button"
            className="sp-modal__close"
            onClick={onClose}
            aria-label={t('modal.close')}
          >
            <Icon name="close" size={16} aria-hidden />
          </button>
        ) : null}
        {children}
      </div>
    </div>,
    document.body
  )
}
