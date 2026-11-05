import { useCallback, useEffect, useState } from 'react'
import { pb, uidOwner, type Rec } from './pb'
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
    action: {
      label: 'Paid',
      run: async () => {
        await pb.collection('expenses').create({
          user: uidOwner(), title: s.name, amount: s.amount, type: 'expense',
          category: s.category || 'Subscriptions', date: today(), note: 'Bill paid',
        })
        await pb.collection('subscriptions').update(s.id, { next_due: advance(s.next_due, s.cycle) })
      },
    },
  }))

  habits.filter((h) => h.interval_days > 0).forEach((h) => out.push({
    key: `maint-${h.id}`, title: h.name, sub: `Every ${h.interval_days} days`,
    due: h.last_done ? addDays(h.last_done, h.interval_days) : today(), source: 'maintenance', route: '/habits', rec: h,
    action: {
      label: 'Done',
      run: async () => {
        await pb.collection('habits').update(h.id, { last_done: today() })
        await pb.collection('habit_logs').create({ user: uidOwner(), habit: h.id, date: today() })
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

export function useReminderItems() {
  const [items, setItems] = useState<RItem[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try { setItems(await load()) } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    void reload()
    const h = () => void reload()
    window.addEventListener('muninn:changed', h)
    return () => window.removeEventListener('muninn:changed', h)
  }, [reload])

  return { items, loading, reload }
}

/** Tell other widgets (sidebar badge, dashboard) that data changed. */
export const notifyChanged = () => window.dispatchEvent(new Event('muninn:changed'))
