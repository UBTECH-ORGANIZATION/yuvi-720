import { LanguageSwitcher } from './LanguageSwitcher'

interface AppBarProps {
  studentName: string
  studentSubtitle: string
}

export function AppBar({ studentName, studentSubtitle }: AppBarProps) {
  const initials = studentName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)

  return (
    <header className="app-bar">
      <div className="app-bar-user">
        <div className="user-avatar">{initials}</div>
        <div className="user-meta">
          <span className="user-name">{studentName}</span>
          <span className="user-sub">{studentSubtitle}</span>
        </div>
      </div>
      <LanguageSwitcher />
    </header>
  )
}