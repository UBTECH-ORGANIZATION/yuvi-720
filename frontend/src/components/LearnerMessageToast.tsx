/* "Your teacher wrote to you" — said the moment it happens, wherever the
 * learner is standing.
 *
 * Rides the `direct_message` frame on the stream the page already holds (the
 * frame carries WHO, never the words — reading anything still goes through the
 * thread's membership check). Suppressed on the chat screen itself: a toast
 * announcing the conversation you are already looking at is noise.
 */

import { useEffect, useState } from 'react'
import { navigate, useRoute } from '../app/router'
import { useI18n } from '../i18n/I18nProvider'
import { subscribe } from '../services/realtime'
import { Icon } from './primitives'
import { Toast } from './Toast'

export function LearnerMessageToast() {
  const { t } = useI18n()
  const pathname = useRoute()
  const [visible, setVisible] = useState(false)
  const onChat = pathname.startsWith('/student-dashboard/chat')

  useEffect(() => {
    if (onChat) return
    return subscribe('learner-triggers', () => '/api/agent/triggers/subscribe', (frame) => {
      if (frame.type === 'direct_message' && frame.sender === 'teacher') setVisible(true)
    })
  }, [onChat])

  if (!visible || onChat) return null
  return (
    <Toast
      icon={<Icon name="message" size={20} />}
      title={t('sdash.msgToast.title')}
      actionLabel={t('sdash.msgToast.open')}
      onAction={() => { setVisible(false); navigate('/student-dashboard/chat') }}
      onDismiss={() => setVisible(false)}
    />
  )
}
