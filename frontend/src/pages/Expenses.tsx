import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useCollection } from '../data'
import type { Rec } from '../pb'
import { RecordModal } from '../components/RecordModal'
import { Badge, Empty, PageHead, Progress, Stat } from '../components/ui'
import { opts, type Field } from '../types'
import { addMonths, fmtDate, money, monthLabel, today } from '../util'

const DEFAULT_CATEGORIES = ['Food', 'Transport', 'Bills', 'Shopping', 'Health', 'Entertainment', 'Education', 'Subscriptions', 'Other']

export default function ExpensesPage() {
  const [month, setMonth] = useState(today().slice(0, 7))
  const filter = `date >= "${month}-01" && date <= "${month}-31"`
  const tx = useCollection('expenses', { sort: '-date,-created', filter })
  const budgets = useCollection('budgets', { sort: 'category' })
  const [editTx, setEditTx] = useState<Rec | 'new' | null>(null)
  const [editBudget, setEditBudget] = useState<Rec | 'new' | null>(null)
  const [type, setType] = useState('')

  const stats = useMemo(() => {
    const spent: Record<string, number> = {}
    let income = 0
    let expense = 0
    tx.items.forEach((t) => {
      const a = Number(t.amount) || 0
      if (t.type === 'income') income += a
      else {
        expense += a
        const c = t.category || 'Uncategorised'
        spent[c] = (spent[c] || 0) + a
      }
    })
    return { spent, income, expense }
  }, [tx.items])

  const categories = useMemo(() => {
    const names = new Set<string>([...budgets.items.map((b) => String(b.category)), ...Object.keys(stats.spent)])
    return [...names].map((name) => {
      const b = budgets.items.find((x) => x.category === name)
      return { name, budget: b ? Number(b.amount) || 0 : 0, rec: b, spent: stats.spent[name] || 0 }
    }).sort((a, b) => b.spent - a.spent)
  }, [budgets.items, stats.spent])

  const totalBudget = budgets.items.reduce((s, b) => s + (Number(b.amount) || 0), 0)
  const suggest = [...new Set([...DEFAULT_CATEGORIES, ...budgets.items.map((b) => String(b.category)), ...tx.items.map((t) => String(t.category || '')).filter(Boolean)])]

  const txFields: Field[] = [
    { name: 'type', label: 'Type', type: 'select', options: opts('expense', 'income'), default: 'expense', required: true },
    { name: 'amount', label: 'Amount', type: 'money', required: true },
    { name: 'title', label: 'Description', type: 'text', required: true, full: true },
    { name: 'category', label: 'Category', type: 'text', suggest },
    { name: 'date', label: 'Date', type: 'date', default: today(), required: true },
    { name: 'note', label: 'Note', type: 'text', full: true },
  ]
  const budgetFields: Field[] = [
    { name: 'category', label: 'Category', type: 'text', required: true, suggest },
    { name: 'amount', label: 'Monthly budget', type: 'money', required: true },
  ]

  const shown = tx.items.filter((t) => !type || t.type === type)

  return (
    <div className="page">
      <PageHead title="Expenses & Budget" sub="Daily spending against your monthly budget per category.">
        <button className="btn" onClick={() => setEditBudget('new')}>Set budget</button>
        <button className="btn primary" onClick={() => setEditTx('new')}><Plus size={16} /> Add transaction</button>
      </PageHead>

      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn" aria-label="Previous month" onClick={() => setMonth(addMonths(`${month}-01`, -1).slice(0, 7))}><ChevronLeft size={16} /></button>
        <h2 style={{ minWidth: 170, textAlign: 'center' }}>{monthLabel(month)}</h2>
        <button className="btn" aria-label="Next month" onClick={() => setMonth(addMonths(`${month}-01`, 1).slice(0, 7))}><ChevronRight size={16} /></button>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Spent" value={money(stats.expense)} tone="bad" />
        <Stat label="Income" value={money(stats.income)} tone="good" />
        <Stat label="Balance" value={money(stats.income - stats.expense)} tone="gold" />
        <Stat label="Budget left" value={totalBudget ? money(totalBudget - stats.expense) : '-'} sub={totalBudget ? `of ${money(totalBudget)}` : 'Set a budget'} />
      </div>

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="card-title">By category</div>
          {categories.length === 0 ? <div className="muted">No spending or budgets yet.</div> : categories.map((c) => {
            const pct = c.budget ? (c.spent / c.budget) * 100 : 0
            return (
              <div key={c.name} style={{ marginBottom: 12, cursor: c.rec ? 'pointer' : 'default' }} onClick={() => c.rec && setEditBudget(c.rec)}>
                <div className="row small">
                  <span className="grow" style={{ fontWeight: 550 }}>{c.name}</span>
                  <span className={pct > 100 ? 'due-over' : 'muted'}>{money(c.spent)}{c.budget ? ` / ${money(c.budget)}` : ''}</span>
                </div>
                {c.budget ? <Progress value={pct} tone={pct > 100 ? 'over' : pct > 80 ? 'warn' : undefined} /> : <div className="small faint">No budget set</div>}
              </div>
            )
          })}
        </div>

        <div>
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="chips">
              {['', 'expense', 'income'].map((t) => <button key={t || 'all'} className={`chip${type === t ? ' on' : ''}`} onClick={() => setType(t)}>{t ? t[0].toUpperCase() + t.slice(1) : 'All'}</button>)}
            </div>
          </div>
          {tx.loading ? <div className="muted">Loading...</div> : shown.length === 0 ? <Empty>No transactions this month.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Description</th><th>Category</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={t.id} onClick={() => setEditTx(t)}>
                      <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(t.date)}</td>
                      <td>{t.title}</td>
                      <td>{t.category ? <Badge value="" label={t.category} /> : null}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }} className={t.type === 'income' ? '' : ''}>
                        <span style={{ color: t.type === 'income' ? 'var(--green)' : 'var(--text)' }}>{t.type === 'income' ? '+' : '-'}{money(t.amount)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editTx && (
        <RecordModal
          title={editTx === 'new' ? 'Add transaction' : 'Edit transaction'}
          fields={txFields}
          initial={editTx === 'new' ? undefined : editTx}
          onSave={async (d) => { if (editTx === 'new') await tx.create(d); else await tx.update(editTx.id, d) }}
          onDelete={editTx === 'new' ? undefined : () => tx.remove(editTx.id)}
          onClose={() => setEditTx(null)}
        />
      )}
      {editBudget && (
        <RecordModal
          title={editBudget === 'new' ? 'Set budget' : 'Edit budget'}
          fields={budgetFields}
          initial={editBudget === 'new' ? undefined : editBudget}
          onSave={async (d) => {
            // one budget per category: update if it exists
            const existing = budgets.items.find((b) => String(b.category).toLowerCase() === String(d.category).toLowerCase())
            if (editBudget !== 'new') await budgets.update(editBudget.id, d)
            else if (existing) await budgets.update(existing.id, d)
            else await budgets.create(d)
          }}
          onDelete={editBudget === 'new' ? undefined : () => budgets.remove(editBudget.id)}
          onClose={() => setEditBudget(null)}
        />
      )}
    </div>
  )
}
