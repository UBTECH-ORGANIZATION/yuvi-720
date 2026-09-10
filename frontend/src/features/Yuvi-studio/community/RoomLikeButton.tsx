import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { Icon } from '../../../components/primitives'
import { useI18n } from '../../../i18n/I18nProvider'

/** A lightweight room reaction that lives over the visitor's Three.js scene. */
export function RoomLikeButton({ liked, pending, onToggle }: {
  liked: boolean
  pending: boolean
  onToggle: () => void
}) {
  const { t } = useI18n()
  const [localLiked, setLocalLiked] = useState(liked)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const glowRef = useRef<HTMLSpanElement | null>(null)
  const pulseRef = useRef<HTMLSpanElement | null>(null)
  const particleRef = useRef<HTMLSpanElement | null>(null)
  const lockedRef = useRef(false)

  useEffect(() => { setLocalLiked(liked) }, [liked])
  useEffect(() => () => { gsap.killTweensOf([buttonRef.current, glowRef.current, pulseRef.current, particleRef.current]) }, [])

  const react = () => {
    if (pending || lockedRef.current) return
    lockedRef.current = true
    setLocalLiked((current) => !current)
    onToggle()
    const button = buttonRef.current
    const glow = glowRef.current
    const pulse = pulseRef.current
    const particle = particleRef.current
    if (!button || !glow || !pulse || !particle) return
    gsap.timeline({ onComplete: () => { lockedRef.current = false } })
      .set([button, glow, pulse, particle], { willChange: 'transform, opacity' })
      .set(glow, { opacity: 0 })
      .set(pulse, { scale: 0.5, opacity: 0.9 })
      .set(particle, { y: 0, opacity: 1, scale: 0.72 })
      .to(button, { scale: 1.3, y: -10, duration: 0.16, ease: 'power2.out' })
      .to(glow, { opacity: 1, duration: 0.12, ease: 'power2.out' }, '<')
      .to(pulse, { scale: 2.15, opacity: 0, duration: 0.48, ease: 'power2.out' }, '<')
      .to(particle, { y: -34, scale: 1.08, opacity: 0, duration: 0.48, ease: 'power2.out' }, '<')
      .to(glow, { opacity: 0, duration: 0.42, ease: 'power2.out' }, '<')
      .to(button, { scale: 1, y: 0, duration: 0.28, ease: 'back.out(1.45)' }, '-=0.28')
      .set([button, glow, pulse, particle], { clearProps: 'willChange' })
  }

  const label = localLiked ? t('YuviStudio.community.unlike') : t('YuviStudio.community.like')
  return <div className={`ys-room-like${localLiked ? ' is-liked' : ''}`}>
    <span className="ys-room-like__glow" ref={glowRef} aria-hidden />
    <span className="ys-room-like__pulse" ref={pulseRef} aria-hidden />
    <span className="ys-room-like__particle" ref={particleRef} aria-hidden><Icon name="thumbUp" size={17} /></span>
    <button ref={buttonRef} type="button" onClick={react} disabled={pending} aria-pressed={localLiked}
      aria-label={label} title={label}>
      <Icon name="thumbUp" size={21} />
    </button>
  </div>
}