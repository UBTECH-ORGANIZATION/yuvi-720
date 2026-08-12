/* Close a popover when the teacher looks away from it.
 *
 * Every menu on these screens was open-until-clicked-again, which is fine until
 * one of them sits over the thing underneath: the roster's "עוד" panel covers
 * the table header, so the first click on a column to sort it went into the
 * open menu instead. A popover that has to be dismissed by finding its own
 * button again is a trap, not a control.
 *
 * Escape closes it too — a popover you can only leave with the mouse is worse
 * for anyone who opened it with the keyboard.
 */

import { useEffect, type RefObject } from 'react'

export function useDismiss(
  ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void,
) {
  useEffect(() => {
    if (!open) return

    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (target && ref.current && !ref.current.contains(target)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    // `pointerdown`, not `click`: by the time a click completes, the element
    // under it may already have handled it inside the open menu.
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [ref, open, onClose])
}
