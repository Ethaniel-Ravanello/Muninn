import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { logHabitToday, pb, payBill, type Rec } from './pb'
import { addDays, advance, money, today } from './util'

export type Source = 'reminder' | 'task' | 'bill' | 'maintenance' | 'document' | 'contact'

export interface RItem {
  key: string
  title: string
  sub?: string
  due: string
  source: Source
  route: string
  rec: Rec
  action?: { label: string; run: () => Promise<void> }
}

const HORIZON_DAYS = 60

function nextAfterToday(due: string, repeat: string): string {
  let d = advance(due, repeat)
  let guard = 0
  while (d <= today() && guard++ < 2000) d = advance(d, repeat)
  return d
}

async function load(): Promise<RItem[]> {
  const get = (c: string, filter: string) => pb.collection(c).getFullList<Rec>({ filter }).catch(() => [] as Rec[])
  const [rem, tasks, subs, habits, docs, contacts] = await Promise.all([
    get('reminders', 'done = false'),
    get('tasks', 'due != "" && status != "done"'),
    get('subscriptions', 'active = true && next_due != ""'),
    get('habits', 'kind = "maintenance" && archived = false'),
    get('documents', 'expires != ""'),
    get('contacts', 'contact_every_days > 0'),
  ])
  const limit = addDays(today(), HORIZON_DAYS)
  const out: RItem[] = []

  rem.forEach((r) => out.push({
    key: `rem-${r.id}`, title: r.title, sub: r.repeat && r.repeat !== 'none' ? `Repeats ${r.repeat}` : r.notes || undefined,
    due: r.due, source: 'reminder', route: '/reminders', rec: r,
    action: {
      label: 'Done',
      run: async () => {
        if (r.repeat && r.repeat !== 'none') await pb.collection('reminders').update(r.id, { due: nextAfterToday(r.due, r.repeat) })
        else await pb.collection('reminders').update(r.id, { done: true })
      },
    },
  }))

  tasks.forEach((t) => out.push({
    key: `task-${t.id}`, title: t.title, sub: t.project || undefined, due: t.due, source: 'task', route: '/tasks', rec: t,
    action: { label: 'Complete', run: async () => { await pb.collection('tasks').update(t.id, { status: 'done', done_at: today() }) } },
  }))

  subs.forEach((s) => out.push({
    key: `bill-${s.id}`, title: s.name, sub: money(s.amount), due: s.next_due, source: 'bill', route: '/subscriptions', rec: s,
    action: { label: 'Paid', run: () => payBill(s) },
  }))

  habits.filter((h) => h.interval_days > 0).forEach((h) => out.push({
    key: `maint-${h.id}`, title: h.name, sub: `Every ${h.interval_days} days`,
    due: h.last_done ? addDays(h.last_done, h.interval_days) : today(), source: 'maintenance', route: '/habits', rec: h,
    action: {
      label: 'Done',
      run: async () => {
        await pb.collection('habits').update(h.id, { last_done: today() })
        await logHabitToday(h.id)
      },
    },
  }))

  docs.forEach((d) => out.push({
    key: `doc-${d.id}`, title: `${d.title} expires`, sub: d.number || undefined, due: d.expires, source: 'document', route: '/vault', rec: d,
  }))

  contacts.forEach((c) => out.push({
    key: `contact-${c.id}`, title: `Reach out to ${c.name}`, sub: `Every ${c.contact_every_days} days`,
    due: c.last_contact ? addDays(c.last_contact, c.contact_every_days) : today(), source: 'contact', route: '/contacts', rec: c,
    action: { label: 'Contacted', run: async () => { await pb.collection('contacts').update(c.id, { last_contact: today() }) } },
  }))

  return out.filter((i) => i.due <= limit).sort((a, b) => a.due.localeCompare(b.due))
}

interface ReminderState { items: RItem[]; loading: boolean; reload: () => Promise<void> }
const Ctx = createContext<ReminderState | null>(null)

/**
 * Loads the due items once for the whole app (sidebar badge, dashboard and the Reminders page
 * used to load them three times). Any `muninn:changed` event reloads, debounced so a burst
 * of edits causes a single refresh.
 */
export function ReminderProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<RItem[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try { setItems(await load()) } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    void reload()
    let t: number | undefined
    const h = () => { window.clearTimeout(t); t = window.setTimeout(() => void reload(), 200) }
    window.addEventListener('muninn:changed', h)
    return () => { window.clearTimeout(t); window.removeEventListener('muninn:changed', h) }
  }, [reload])

  const value = useMemo(() => ({ items, loading, reload }), [items, loading, reload])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useReminderItems(): ReminderState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useReminderItems must be used inside <ReminderProvider>')
  return v
}

/** Tell other widgets (sidebar badge, dashboard) that data changed. */
export const notifyChanged = () => window.dispatchEvent(new Event('muninn:changed'))
