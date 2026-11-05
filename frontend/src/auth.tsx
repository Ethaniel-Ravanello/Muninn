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

  return (
    <Ctx.Provider value={{ authed, email, logout: () => pb.authStore.clear() }}>{children}</Ctx.Provider>
  )
}

export const useAuth = () => useContext(Ctx)
