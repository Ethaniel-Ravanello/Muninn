import { useState } from 'react'
import { pb, PB_URL } from '../pb'
import { Logo } from '../components/ui'
import { errMsg } from '../util'

const ALLOW_SIGNUP = import.meta.env.VITE_ALLOW_SIGNUP !== 'false'

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (mode === 'up') {
        await pb.collection('users').create({ email, password, passwordConfirm: password })
      }
      await pb.collection('users').authWithPassword(email, password)
    } catch (err) {
      const msg = errMsg(err)
      setError(msg.includes('Failed to fetch') || msg.includes('fetch') ? `Cannot reach the server at ${PB_URL}. Is PocketBase running?` : msg)
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="logo-big">
          <Logo size={64} />
          <h1 style={{ letterSpacing: '0.08em' }}>MUNINN</h1>
          <div className="tag-line">The raven of memory. Everything you want to remember, in one place.</div>
        </div>
        <div className="grid" style={{ gap: 12 }}>
          <label className="f"><span className="lbl">Email</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></label>
          <label className="f"><span className="lbl">Password</span>
            <input type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} minLength={8}
              onChange={(e) => setPassword(e.target.value)} required /></label>
          {error && <div className="err">{error}</div>}
          <button className="btn primary" type="submit" disabled={busy}>{mode === 'in' ? 'Sign in' : 'Create account'}</button>
          {ALLOW_SIGNUP && (
            <button type="button" className="btn ghost" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError('') }}>
              {mode === 'in' ? 'First time? Create an account' : 'Back to sign in'}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
