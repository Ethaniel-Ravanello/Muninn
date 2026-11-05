import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { Field } from '../types'
import { diffDays, fmtDate, isUrl, money, splitTags, today } from '../util'

/* ---------- brand ---------- */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="Muninn" role="img">
      <defs>
        <linearGradient id="mg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c8cff" />
          <stop offset="0.55" stopColor="#b07cff" />
          <stop offset="1" stopColor="#d4a85a" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="#12141d" stroke="#31364c" />
      <path d="M18 14V50M46 14V50M18 14L46 50M46 14L18 50" stroke="url(#mg)" strokeWidth="5" strokeLinecap="round" fill="none" />
    </svg>
  )
}

/* ---------- modal ---------- */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

/* ---------- small pieces ---------- */
const TONES: Record<string, string> = {
  done: 'green', bought: 'green', active: 'green', asset: 'green', income: 'green',
  in_progress: 'amber', medium: 'amber',
  high: 'red', liability: 'red', expense: 'red', dropped: 'red',
  wanted: 'blue', link: 'blue', movie: 'violet', series: 'violet', anime: 'violet',
  game: 'blue', book: 'gold', tool: 'violet', snippet: 'gold', weekly: 'blue', monthly: 'violet', yearly: 'gold',
}

export function Badge({ value, label, tone, onClick, title }: { value?: string; label?: string; tone?: string; onClick?: () => void; title?: string }) {
  const t = tone ?? TONES[value ?? ''] ?? ''
  const text = label ?? (value ?? '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
  return (
    <span className={`badge ${t}${onClick ? ' click' : ''}`} onClick={onClick} title={title}>
      {text}
    </span>
  )
}

export function Stars({ value }: { value: number }) {
  return (
    <span className="stars" aria-label={`${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= value ? '' : 'off'}>★</span>)}
    </span>
  )
}

export function Progress({ value, tone }: { value: number; tone?: 'warn' | 'over' }) {
  return (
    <div className={`progress ${tone ?? ''}`} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

export function openSearch(q: string) {
  window.dispatchEvent(new CustomEvent('muninn:search', { detail: q }))
}

export function Tags({ value }: { value?: string }) {
  const tags = splitTags(value)
  if (!tags.length) return null
  return (
    <span className="chips">
      {tags.map((t) => (
        <button key={t} className="tag" onClick={(e) => { e.stopPropagation(); openSearch(`#${t}`) }}>#{t}</button>
      ))}
    </span>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'bad' | 'gold' }) {
  return (
    <div className={`card stat ${tone ?? ''}`}>
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      {sub ? <div className="s">{sub}</div> : null}
    </div>
  )
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="grow">
        <h1>{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {children}
    </div>
  )
}

/* ---------- value renderer shared by cards and tables ---------- */
export const MOODS = ['', '😞', '😕', '😐', '🙂', '😄']

export function DateText({ value, warn }: { value: string; warn?: boolean }) {
  let cls = ''
  if (warn) {
    const n = diffDays(value, today())
    cls = n < 0 ? 'due-over' : n <= 30 ? 'due-soon' : ''
  }
  return <span className={cls}>{fmtDate(value)}</span>
}

export function renderValue(f: Field, v: unknown): ReactNode {
  if (v === undefined || v === null || v === '') return null
  switch (f.type) {
    case 'select': {
      const o = f.options?.find((x) => x.value === String(v))
      return <Badge value={String(v)} label={o?.label} />
    }
    case 'date': return <DateText value={String(v)} warn={f.warn} />
    case 'money': return Number(v) ? money(Number(v)) : null
    case 'number': return Number(v) ? String(v) : null
    case 'url': {
      const s = String(v)
      let host = s
      try { host = new URL(s).hostname.replace(/^www\./, '') } catch { /* keep raw */ }
      return isUrl(s) ? <a href={s} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>{host}</a> : s
    }
    case 'tags': return <Tags value={String(v)} />
    case 'rating': return Number(v) ? <Stars value={Number(v)} /> : null
    case 'progress': return <div style={{ minWidth: 110 }}><Progress value={Number(v)} /></div>
    case 'checkbox': return v ? <Badge label={f.label} tone="green" /> : null
    case 'textarea': return <div className="clamp">{String(v)}</div>
    default: return String(v)
  }
}
