import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../i18n/I18nProvider'

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
}

export function Modal({ open, onClose, titleId, children, className, overlay = true }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const { direction } = useI18n()

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
  // Yubi along the scroll position — letting it scroll would fly him off the
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
      onClick={onClose}
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
        {children}
      </div>
    </div>,
    document.body
  )
}
