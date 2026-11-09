import PocketBase from 'pocketbase'
import { advance, today } from './util'

export const PB_URL: string = import.meta.env.VITE_PB_URL || 'http://127.0.0.1:8090'

export const pb = new PocketBase(PB_URL)
pb.autoCancellation(false)

// PocketBase answers 401 when a token is rejected outright (e.g. authRefresh for a deleted account).
// The SDK does not sign out on its own, so do it here and let the app fall back to the login screen.
// (A merely expired token is not a 401; auth.tsx watches for that separately.)
pb.afterSend = (response, data) => {
  if (response.status === 401 && pb.authStore.token) pb.authStore.clear()
  return data
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rec = { id: string; created: string; updated: string; [key: string]: any }

export const uidOwner = () => pb.authStore.record?.id as string

/** Check a habit off for today without ever creating a second log for the same day. */
export async function logHabitToday(habitId: string): Promise<void> {
  const exists = await pb.collection('habit_logs').getList(1, 1, {
    filter: pb.filter('habit = {:h} && date = {:d}', { h: habitId, d: today() }),
    fields: 'id',
  })
  if (exists.totalItems > 0) return
  await pb.collection('habit_logs').create({ user: uidOwner(), habit: habitId, date: today() })
}

/**
 * Pay a bill: record the expense, then move the due date forward.
 * If the second step fails the expense is removed again, so retrying never double-counts.
 */
export async function payBill(s: Rec): Promise<void> {
  const expense = await pb.collection('expenses').create<Rec>({
    user: uidOwner(), title: s.name, amount: s.amount, type: 'expense',
    category: s.category || 'Subscriptions', date: today(), note: 'Bill paid',
  })
  try {
    await pb.collection('subscriptions').update(s.id, { next_due: advance(s.next_due || today(), s.cycle) })
  } catch (e) {
    await pb.collection('expenses').delete(expense.id).catch(() => undefined)
    throw e
  }
}
