import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMotion } from '../a11y/MotionProvider'
import { useI18n } from '../i18n/I18nProvider'

const SLOT_ID = 'a11ySlot'

/**
 * Surfaces that render their own top bar expose an `#a11ySlot`; the control docks
 * there so it never covers the chat panels. Anywhere else it floats.
 */
function useSlot() {
  const [slot, setSlot] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const find = () => setSlot(document.getElementById(SLOT_ID))
    find()
    // Skeleton markup is injected after mount, so watch for the slot appearing.
    const observer = new MutationObserver(find)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  return slot
}

/** WCAG 2.2.2 "Pause, Stop, Hide" control for the product's looping animations. */
export function MotionToggle() {
  const { reduceMotion, setReduceMotion } = useMotion()
  const { t } = useI18n()
  const slot = useSlot()
  const label = reduceMotion ? t('motion.resume') : t('motion.pause')

  const button = (
    <button
      type="button"
      className={`yuvi-motion-toggle${slot ? '' : ' yuvi-motion-toggle-floating'}`}
      aria-pressed={reduceMotion}
      onClick={() => setReduceMotion(!reduceMotion)}
      title={label}
    >
      <span aria-hidden="true">{reduceMotion ? '▶' : '⏸'}</span>
      <span>{label}</span>
    </button>
  )

  return slot ? createPortal(button, slot) : button
}
