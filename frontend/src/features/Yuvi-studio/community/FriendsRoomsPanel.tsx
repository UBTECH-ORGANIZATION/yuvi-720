import { useEffect, useState } from 'react'
import { useI18n } from '../../../i18n/I18nProvider'
import { normalizeDesign } from '../YuviDesign'
import {
  getCommunityRooms, getRoomSharing, updateRoomSharing,
  type CommunityRoom,
} from '../../../services/api'

export function FriendsRoomsPanel({
  onVisit, visitingOwnerId, visitFailed,
}: {
  onVisit: (ownerId: string) => void
  visitingOwnerId: string | null
  visitFailed: boolean
}) {
  const { t } = useI18n()
  const [rooms, setRooms] = useState<CommunityRoom[]>([])
  const [shared, setShared] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [savingShare, setSavingShare] = useState(false)

  useEffect(() => {
    let active = true
    Promise.all([getCommunityRooms(), getRoomSharing()])
      .then(([cards, sharing]) => {
        if (!active) return
        setRooms(cards)
        setShared(sharing.shared)
      })
      .catch(() => { if (active) setLoadFailed(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const toggleSharing = async () => {
    if (savingShare) return
    setSavingShare(true)
    try { setShared((await updateRoomSharing(!shared)).shared) }
    finally { setSavingShare(false) }
  }

  return <section className="ys-friends" aria-label={t('YuviStudio.community.title')}>
    <label className="ys-friends__toggle ys-friends__toggle--top">
      <span>{t('YuviStudio.community.sharing')}</span>
      <input type="checkbox" checked={shared} onChange={() => void toggleSharing()} disabled={savingShare} />
      <span className="ys-friends__switch" aria-hidden="true" />
    </label>
    {loading && <p className="ys-empty">{t('YuviStudio.community.loading')}</p>}
    {!loading && loadFailed && <p className="ys-empty">{t('YuviStudio.community.loadFailed')}</p>}
    {!loading && !loadFailed && rooms.length === 0 && <p className="ys-empty">{t('YuviStudio.community.empty')}</p>}
    {visitFailed && <p className="ys-empty">{t('YuviStudio.community.unavailable')}</p>}
    {!loadFailed && rooms.length > 0 && (
      <div className="ys-friends__list">
        {rooms.map((room) => <FriendRoomCard key={room.owner_id} room={room}
          pending={visitingOwnerId === room.owner_id} onVisit={() => onVisit(room.owner_id)} />)}
      </div>
    )}
  </section>
}

function FriendRoomCard({ room, pending, onVisit }: { room: CommunityRoom; pending: boolean; onVisit: () => void }) {
  const { t } = useI18n()
  const design = normalizeDesign(room.yuvi_design)
  return <button className="ys-friends__room" type="button" onClick={onVisit} disabled={pending}
    aria-label={t('YuviStudio.community.visit')} aria-busy={pending}>
    <span className={`ys-friends__yuvi-face is-face-${design.equipped.face ?? 'plain'} is-head-${design.equipped.headTop ?? 'plain'}`} aria-hidden="true"
      style={{ '--yuvi-body': design.colors.body, '--yuvi-eyes': design.colors.eyes, '--yuvi-smile': design.colors.smile, '--yuvi-glow': design.colors.glow } as React.CSSProperties}>
      <i className="ys-friends__yuvi-ear ys-friends__yuvi-ear--start" />
      <i className="ys-friends__yuvi-ear ys-friends__yuvi-ear--end" />
      <i className="ys-friends__yuvi-antenna" />
      <i className="ys-friends__yuvi-visor" />
      <i className="ys-friends__yuvi-eye ys-friends__yuvi-eye--start" />
      <i className="ys-friends__yuvi-eye ys-friends__yuvi-eye--end" />
      <i className="ys-friends__yuvi-smile" />
      <i className="ys-friends__yuvi-accessory" />
      <i className="ys-friends__yuvi-headgear" />
    </span>
    <strong dir="auto">{room.display_name}</strong>
  </button>
}
