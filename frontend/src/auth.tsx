import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { pb } from './pb'

interface AuthState {
  authed: boolean
  email: string
  logout: () => void
}

const Ctx = createContext<AuthState>({ authed: false, email: '', logout: () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(pb.authStore.isValid)
  const [email, setEmail] = useState<string>(pb.authStore.record?.email ?? '')

  useEffect(() => {
    return pb.authStore.onChange(() => {
      setAuthed(pb.authStore.isValid)
      setEmail(pb.authStore.record?.email ?? '')
    })
  }, [])

  // Keep the session alive and notice when it ends.
  // PocketBase does not answer 401 for an expired token: it treats you as a guest, so lists come back
  // empty (it looks like your data vanished) and saves fail. So we watch the token ourselves.
  useEffect(() => {
    const refresh = () => {
      if (!pb.authStore.isValid) return
      // a network error is ignored on purpose: opening the app offline must not log you out
      pb.collection('users').authRefresh().catch((e: { status?: number }) => {
        if (e?.status === 401 || e?.status === 403 || e?.status === 404) pb.authStore.clear()
      })
    }
    const check = () => { if (pb.authStore.token && !pb.authStore.isValid) pb.authStore.clear() }
    const onVisible = () => { if (document.visibilityState === 'visible') { check(); refresh() } }

    refresh() // every app start extends the session
    const checkTimer = window.setInterval(check, 30_000)
    const refreshTimer = window.setInterval(refresh, 6 * 60 * 60 * 1000)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(checkTimer)
      window.clearInterval(refreshTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return (
    <Ctx.Provider value={{ authed, email, logout: () => pb.authStore.clear() }}>{children}</Ctx.Provider>
  )
}

export const useAuth = () => useContext(Ctx)
