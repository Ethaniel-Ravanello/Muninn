import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { LogOut, Menu, Plus, Search } from 'lucide-react'
import { useAuth } from '../auth'
import { pb } from '../pb'
import { NAV } from '../modules'
import { useReminderItems } from '../reminders'
import { today } from '../util'
import { Logo, Modal } from './ui'
import { QuickInbox } from './QuickInbox'
import { SearchPalette } from './SearchPalette'

export default function Layout() {
  const { email, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState<string | null>(null)
  const [capture, setCapture] = useState(false)
  const [inboxCount, setInboxCount] = useState(0)
  const loc = useLocation()
  const rem = useReminderItems()

  const refreshInbox = useCallback(async () => {
    try { setInboxCount((await pb.collection('inbox').getList(1, 1)).totalItems) } catch { /* offline */ }
  }, [])

  useEffect(() => { void refreshInbox() }, [refreshInbox, loc.pathname])
  useEffect(() => {
    window.addEventListener('muninn:changed', refreshInbox)
    return () => window.removeEventListener('muninn:changed', refreshInbox)
  }, [refreshInbox])
  useEffect(() => setOpen(false), [loc.pathname])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch('') }
      if (e.altKey && e.key.toLowerCase() === 'i') { e.preventDefault(); setCapture(true) }
    }
    const onSearch = (e: Event) => setSearch(String((e as CustomEvent).detail ?? ''))
    window.addEventListener('keydown', onKey)
    window.addEventListener('muninn:search', onSearch)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('muninn:search', onSearch)
    }
  }, [])

  const due = rem.items.filter((i) => i.due <= today()).length

  // one gentle browser notification per day, only if the user enabled them on the Reminders page
  useEffect(() => {
    if (rem.loading || due === 0 || !('Notification' in window) || Notification.permission !== 'granted') return
    if (localStorage.getItem('muninn:notified') === today()) return
    localStorage.setItem('muninn:notified', today())
    new Notification('Muninn', { body: `${due} thing${due > 1 ? 's' : ''} due today or overdue.` })
  }, [rem.loading, due])

  return (
    <div className="app">
      <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Main navigation">
        <div className="brand">
          <Logo size={34} />
          <div>
            <div className="brand-name">MUNINN</div>
            <div className="brand-sub">Memory</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((g) => (
            <div className="nav-group" key={g.title}>
              <div className="nav-title">{g.title}</div>
              {g.items.map((n) => {
                const count = n.badge === 'inbox' ? inboxCount : n.badge === 'reminders' ? due : 0
                return (
                  <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                    <n.icon size={17} />
                    {n.label}
                    {count > 0 && <span className="count">{count}</span>}
                  </NavLink>
                )
              })}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <span title={email}>{email}</span>
          <button className="icon-btn" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>
        </div>
      </aside>
      <div className={`backdrop${open ? ' open' : ''}`} onClick={() => setOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <button className="search-btn" onClick={() => setSearch('')}>
            <Search size={15} /> Search everything <span className="kbd">Ctrl K</span>
          </button>
          <span className="spacer" />
          <button className="btn" onClick={() => setCapture(true)} title="Quick capture (Alt+I)"><Plus size={16} /> Capture</button>
        </header>
        <Outlet />
      </div>

      {search !== null && <SearchPalette initial={search} onClose={() => setSearch(null)} />}
      {capture && (
        <Modal title="Quick capture" onClose={() => setCapture(false)}>
          <QuickInbox autoFocus onAdded={() => setCapture(false)} />
        </Modal>
      )}
    </div>
  )
}
