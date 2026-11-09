import { useCallback, useEffect, useRef, useState } from 'react'
import { pb, uidOwner, type Rec } from './pb'
import { notifyChanged } from './reminders'
import { errMsg } from './util'

interface Opts {
  sort?: string
  filter?: string
  /** PocketBase `fields` selector, e.g. "id,title,content:excerpt(200,true)" for a light list */
  fields?: string
}

/** Loads a whole collection for the signed-in user and exposes CRUD helpers. */
export function useCollection<T extends Rec = Rec>(name: string, opts: Opts = {}) {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { sort, filter, fields } = opts
  const alive = useRef(true)
  const seq = useRef(0)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const reload = useCallback(async () => {
    const mine = ++seq.current
    try {
      const r = await pb.collection(name).getFullList<T>({ sort, filter, fields })
      // a newer request was started meanwhile (e.g. the filter changed): drop this stale answer
      if (!alive.current || mine !== seq.current) return
      setItems(r)
      setError('')
    } catch (e) {
      if (alive.current && mine === seq.current) setError(errMsg(e))
    } finally {
      if (alive.current && mine === seq.current) setLoading(false)
    }
  }, [name, sort, filter, fields])

  useEffect(() => { void reload() }, [reload])

  const create = useCallback(async (data: Record<string, unknown>) => {
    const r = await pb.collection(name).create<T>({ ...data, user: uidOwner() })
    await reload()
    notifyChanged()
    return r
  }, [name, reload])

  const update = useCallback(async (id: string, data: Record<string, unknown>) => {
    // optimistic: the UI reacts instantly, the server call confirms
    setItems((prev) => prev.map((x) => (x.id === id ? ({ ...x, ...data } as T) : x)))
    try {
      await pb.collection(name).update(id, data)
      notifyChanged()
    } catch (e) {
      await reload()
      throw e
    }
  }, [name, reload])

  const remove = useCallback(async (id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id))
    try {
      await pb.collection(name).delete(id)
      notifyChanged()
    } catch (e) {
      await reload()
      throw e
    }
  }, [name, reload])

  return { items, loading, error, reload, create, update, remove }
}
