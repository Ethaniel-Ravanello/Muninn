import type { ComponentType } from 'react'
import {
  Bell, Bookmark, CalendarDays, CheckSquare, Clapperboard, ClipboardCheck, CreditCard, FileLock2, Gift,
  HeartPulse, Inbox, LayoutDashboard, Landmark, NotebookPen, Repeat, StickyNote, Target, Users, Wallet,
} from 'lucide-react'
import { opts, type Field } from './types'
import { payBill, type Rec } from './pb'
import { diffDays, money, today } from './util'

export interface RowAction {
  label: string
  show?: (r: Rec) => boolean
  /** may return a patch that is applied to the record */
  run: (r: Rec) => Promise<Record<string, unknown> | void>
}

export interface Summary { label: string; value: string; tone?: 'good' | 'bad' | 'gold'; sub?: string }

export interface Module {
  route: string
  collection: string
  title: string
  sub: string
  newLabel: string
  fields: Field[]
  titleField: string
  titleOf?: (r: Rec) => string
  linkField?: string
  /** records open on their own page (/route/:id) instead of the popup form */
  detailRoute?: boolean
  sort: string
  /**
   * Light list: only these fields are downloaded for the list view (PocketBase `fields` syntax), e.g.
   * `content:excerpt(240,true)` returns a short preview instead of the whole text. Text search is then
   * done by the server, because the full text is not on the client.
   */
  listFields?: string
  view: 'cards' | 'table'
  filterFields?: string[]
  searchFields: string[]
  summary?: (rows: Rec[]) => Summary[]
  actions?: RowAction[]
  /** clicking this select badge cycles to the next option */
  cycleField?: string
  beforeSave?: (data: Record<string, unknown>) => Record<string, unknown>
  /** count linked records, e.g. tasks per goal */
  related?: { collection: string; field: string; doneWhen: (r: Rec) => boolean; label: string }
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

const monthlyOf = (r: Rec) => {
  const a = Number(r.amount) || 0
  return r.cycle === 'weekly' ? (a * 52) / 12 : r.cycle === 'yearly' ? a / 12 : a
}

export const MODULES: Module[] = [
  {
    route: 'goals', collection: 'goals', title: 'Goals', sub: 'The big picture above your projects and tasks.',
    newLabel: 'New goal', titleField: 'title', sort: '-created', view: 'cards', filterFields: ['status'],
    searchFields: ['title', 'description'],
    fields: [
      { name: 'title', label: 'Goal', type: 'text', required: true, full: true },
      { name: 'description', label: 'Why / what does success look like?', type: 'textarea', hideInList: false },
      { name: 'period', label: 'Horizon', type: 'select', options: opts('year', 'quarter', 'month'), default: 'year' },
      { name: 'target_date', label: 'Target date', type: 'date' },
      { name: 'status', label: 'Status', type: 'select', options: opts('active', 'done', 'dropped'), default: 'active', required: true },
      { name: 'progress', label: 'Progress', type: 'progress' },
    ],
    related: { collection: 'tasks', field: 'goal', doneWhen: (r) => r.status === 'done', label: 'linked tasks done' },
    summary: (rows) => {
      const active = rows.filter((r) => r.status === 'active')
      return [
        { label: 'Active goals', value: String(active.length) },
        { label: 'Avg progress', value: `${Math.round(avg(active.map((r) => Number(r.progress) || 0)))}%`, tone: 'gold' },
        { label: 'Completed', value: String(rows.filter((r) => r.status === 'done').length), tone: 'good' },
      ]
    },
  },
  {
    route: 'subscriptions', collection: 'subscriptions', title: 'Subscriptions & Bills', sub: 'Recurring payments, with due dates you will not miss.',
    newLabel: 'New bill', titleField: 'name', sort: 'next_due', view: 'table', filterFields: ['cycle'],
    searchFields: ['name', 'category', 'notes'],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Internet, electricity token, Spotify' },
      { name: 'amount', label: 'Amount', type: 'money' },
      { name: 'cycle', label: 'Repeats', type: 'select', options: opts('weekly', 'monthly', 'yearly'), default: 'monthly', required: true },
      { name: 'next_due', label: 'Next due', type: 'date', warn: true, default: today },
      { name: 'category', label: 'Category', type: 'text', suggest: ['Utilities', 'Internet', 'Streaming', 'Apps', 'Insurance', 'Rent'] },
      { name: 'active', label: 'Active', type: 'checkbox', default: true, placeholder: 'Active' },
      { name: 'notes', label: 'Notes', type: 'textarea', hideInList: true },
    ],
    actions: [{
      label: 'Mark paid',
      show: (r) => !!r.active,
      run: async (r) => { await payBill(r) },
    }],
    summary: (rows) => {
      const act = rows.filter((r) => r.active)
      const monthly = act.reduce((s, r) => s + monthlyOf(r), 0)
      const soon = act.filter((r) => r.next_due && diffDays(r.next_due, today()) <= 7).length
      return [
        { label: 'Per month', value: money(monthly), tone: 'gold' },
        { label: 'Per year', value: money(monthly * 12) },
        { label: 'Due in 7 days', value: String(soon), tone: soon ? 'bad' : undefined },
      ]
    },
  },
  {
    route: 'media', collection: 'media', title: 'Watchlist, Reading & Gaming', sub: 'Everything in your backlog, with ratings when you finish.',
    newLabel: 'Add to backlog', titleField: 'title', linkField: 'url', sort: '-updated', view: 'cards', filterFields: ['type', 'status'],
    searchFields: ['title', 'notes', 'tags'], cycleField: 'status',
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, full: true },
      { name: 'type', label: 'Type', type: 'select', options: opts('movie', 'series', 'anime', 'book', 'game'), default: 'movie', required: true },
      { name: 'status', label: 'Status', type: 'select', options: opts('planned', 'in_progress', 'done', 'dropped'), default: 'planned', required: true },
      { name: 'rating', label: 'Rating', type: 'rating' },
      { name: 'url', label: 'Link', type: 'url', hideInList: true },
      { name: 'tags', label: 'Tags', type: 'tags' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    beforeSave: (d) => (d.status === 'done' && !d.done_at ? { ...d, done_at: today() } : d),
    summary: (rows) => [
      { label: 'In progress', value: String(rows.filter((r) => r.status === 'in_progress').length) },
      { label: 'Planned', value: String(rows.filter((r) => r.status === 'planned').length) },
      { label: 'Finished', value: String(rows.filter((r) => r.status === 'done').length), tone: 'good' },
      { label: 'Avg rating', value: avg(rows.filter((r) => r.rating > 0).map((r) => r.rating)).toFixed(1), tone: 'gold' },
    ],
  },
  {
    route: 'wishlist', collection: 'wishlist', title: 'Wishlist', sub: 'Park it here first. Buy it if you still want it later.',
    newLabel: 'New wish', titleField: 'name', linkField: 'url', sort: '-created', view: 'cards', filterFields: ['status', 'urgency'],
    searchFields: ['name', 'store', 'notes'], cycleField: 'status',
    fields: [
      { name: 'name', label: 'Item', type: 'text', required: true, full: true },
      { name: 'price', label: 'Price', type: 'money' },
      { name: 'urgency', label: 'Urgency', type: 'select', options: opts('low', 'medium', 'high'), default: 'medium', required: true },
      { name: 'status', label: 'Status', type: 'select', options: opts('wanted', 'bought', 'dropped'), default: 'wanted', required: true },
      { name: 'store', label: 'Store', type: 'text' },
      { name: 'url', label: 'Store link', type: 'url', hideInList: true },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    summary: (rows) => {
      const wanted = rows.filter((r) => r.status === 'wanted')
      return [
        { label: 'Still wanted', value: String(wanted.length) },
        { label: 'Total cost', value: money(wanted.reduce((s, r) => s + (Number(r.price) || 0), 0)), tone: 'gold' },
        { label: 'High urgency', value: String(wanted.filter((r) => r.urgency === 'high').length), tone: 'bad' },
      ]
    },
  },
  {
    route: 'bookmarks', collection: 'bookmarks', title: 'Bookmarks & Resources', sub: 'Links, tools and snippets, sorted by the same categories as your notes.',
    newLabel: 'New bookmark', titleField: 'title', linkField: 'url', sort: '-created', view: 'cards', filterFields: ['kind', 'category'],
    searchFields: ['title', 'url', 'content', 'category', 'tags'],
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, full: true },
      { name: 'url', label: 'URL', type: 'url', hideInList: true },
      { name: 'kind', label: 'Type', type: 'select', options: opts('link', 'tool', 'snippet'), default: 'link', required: true },
      { name: 'category', label: 'Category', type: 'text', placeholder: 'Same names as Notes categories' },
      { name: 'tags', label: 'Tags', type: 'tags' },
      { name: 'pinned', label: 'Pinned', type: 'checkbox', placeholder: 'Pin to top', hideInList: true },
      { name: 'content', label: 'Snippet / notes', type: 'textarea' },
    ],
  },
  {
    route: 'notes', collection: 'notes', title: 'Notes', sub: 'Long-form thinking, organised by category.',
    newLabel: 'New note', titleField: 'title', detailRoute: true, sort: '-updated', view: 'cards', filterFields: ['category'],
    listFields: 'id,created,updated,title,category,tags,pinned,content:excerpt(240,true)',
    searchFields: ['title', 'content', 'category', 'tags'],
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, full: true },
      { name: 'category', label: 'Category', type: 'text' },
      { name: 'tags', label: 'Tags', type: 'tags' },
      { name: 'pinned', label: 'Pinned', type: 'checkbox', placeholder: 'Pin to top', hideInList: true },
      { name: 'content', label: 'Content', type: 'textarea' },
    ],
  },
  {
    route: 'journal', collection: 'journal', title: 'Journal', sub: 'A daily log: what happened and how it felt.',
    newLabel: 'New entry', titleField: 'date', titleOf: (r) => new Date(r.date + 'T00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    sort: '-date', view: 'cards', searchFields: ['content', 'tags', 'date'],
    fields: [
      { name: 'date', label: 'Date', type: 'date', required: true, default: today },
      { name: 'mood', label: 'Mood', type: 'rating' },
      { name: 'tags', label: 'Tags', type: 'tags', full: true },
      { name: 'content', label: 'Entry', type: 'textarea' },
    ],
    summary: (rows) => {
      const m = today().slice(0, 7)
      const month = rows.filter((r) => String(r.date).startsWith(m))
      return [
        { label: 'Entries this month', value: String(month.length) },
        { label: 'Avg mood (month)', value: avg(month.filter((r) => r.mood > 0).map((r) => r.mood)).toFixed(1), tone: 'gold' },
        { label: 'Total entries', value: String(rows.length) },
      ]
    },
  },
  {
    route: 'contacts', collection: 'contacts', title: 'People', sub: 'Stay in touch with the people who matter.',
    newLabel: 'New contact', titleField: 'name', sort: 'name', view: 'cards', filterFields: ['relation'],
    searchFields: ['name', 'relation', 'notes', 'email'],
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'relation', label: 'Relation', type: 'text', suggest: ['Family', 'Friend', 'Work', 'Network', 'Mentor'] },
      { name: 'phone', label: 'Phone', type: 'text' },
      { name: 'email', label: 'Email', type: 'text' },
      { name: 'last_contact', label: 'Last contact', type: 'date' },
      { name: 'contact_every_days', label: 'Reach out every (days)', type: 'number', placeholder: 'e.g. 30' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    actions: [{ label: 'Contacted today', run: async () => ({ last_contact: today() }) }],
    summary: (rows) => {
      const overdue = rows.filter((r) => r.contact_every_days > 0 && (!r.last_contact || diffDays(today(), r.last_contact) >= r.contact_every_days))
      return [
        { label: 'People', value: String(rows.length) },
        { label: 'Overdue to contact', value: String(overdue.length), tone: overdue.length ? 'bad' : 'good' },
      ]
    },
  },
  {
    route: 'vault', collection: 'documents', title: 'Document Vault', sub: 'IDs, policies and warranties, with expiry dates.',
    newLabel: 'New document', titleField: 'title', sort: 'expires', view: 'table', filterFields: ['kind'],
    searchFields: ['title', 'number', 'notes'],
    fields: [
      { name: 'title', label: 'Document', type: 'text', required: true, placeholder: 'Passport, SIM A, Motor insurance' },
      { name: 'kind', label: 'Type', type: 'select', options: opts('id', 'insurance', 'warranty', 'finance', 'other'), default: 'id', required: true },
      { name: 'number', label: 'Number / reference', type: 'text' },
      { name: 'expires', label: 'Expires', type: 'date', warn: true },
      { name: 'notes', label: 'Notes', type: 'textarea', hideInList: true },
    ],
    summary: (rows) => {
      const dated = rows.filter((r) => r.expires)
      return [
        { label: 'Documents', value: String(rows.length) },
        { label: 'Expiring in 60 days', value: String(dated.filter((r) => { const n = diffDays(r.expires, today()); return n >= 0 && n <= 60 }).length), tone: 'gold' },
        { label: 'Expired', value: String(dated.filter((r) => diffDays(r.expires, today()) < 0).length), tone: 'bad' },
      ]
    },
  },
  {
    route: 'health', collection: 'health_logs', title: 'Health Log', sub: 'Weight, sleep, checkups and medication in one timeline.',
    newLabel: 'Log entry', titleField: 'type', sort: '-date', view: 'table', filterFields: ['type'],
    searchFields: ['type', 'notes', 'unit'],
    fields: [
      { name: 'date', label: 'Date', type: 'date', required: true, default: today },
      { name: 'type', label: 'Type', type: 'select', options: opts('weight', 'blood_pressure', 'sleep', 'checkup', 'medication', 'other'), default: 'weight', required: true },
      { name: 'value', label: 'Value', type: 'number' },
      { name: 'unit', label: 'Unit', type: 'text', placeholder: 'kg, hours, mmHg' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    summary: (rows) => {
      const w = rows.filter((r) => r.type === 'weight' && r.value > 0)
      return [
        { label: 'Latest weight', value: w[0] ? `${w[0].value} ${w[0].unit || 'kg'}` : '-' },
        { label: 'Change vs previous', value: w[1] ? `${(w[0].value - w[1].value > 0 ? '+' : '')}${(w[0].value - w[1].value).toFixed(1)}` : '-' },
        { label: 'Entries', value: String(rows.length) },
      ]
    },
  },
  {
    route: 'net-worth', collection: 'accounts', title: 'Net Worth', sub: 'Assets minus liabilities: the long-term picture.',
    newLabel: 'New account', titleField: 'name', sort: 'name', view: 'table', filterFields: ['kind'],
    searchFields: ['name', 'notes'],
    fields: [
      { name: 'name', label: 'Account / asset', type: 'text', required: true, placeholder: 'Savings, Motorbike, Credit card' },
      { name: 'kind', label: 'Type', type: 'select', options: opts('asset', 'liability'), default: 'asset', required: true },
      { name: 'balance', label: 'Balance', type: 'money' },
      { name: 'notes', label: 'Notes', type: 'textarea', hideInList: true },
    ],
    summary: (rows) => {
      const a = rows.filter((r) => r.kind === 'asset').reduce((s, r) => s + (Number(r.balance) || 0), 0)
      const l = rows.filter((r) => r.kind === 'liability').reduce((s, r) => s + (Number(r.balance) || 0), 0)
      return [
        { label: 'Assets', value: money(a), tone: 'good' },
        { label: 'Liabilities', value: money(l), tone: 'bad' },
        { label: 'Net worth', value: money(a - l), tone: 'gold' },
      ]
    },
  },
]

/* ---------- navigation ---------- */
export interface NavItem { to: string; label: string; icon: ComponentType<{ size?: number }>; end?: boolean; badge?: 'inbox' | 'reminders' }
export const NAV: { title: string; items: NavItem[] }[] = [
  { title: 'Home', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/inbox', label: 'Inbox', icon: Inbox, badge: 'inbox' },
  ] },
  { title: 'Plan', items: [
    { to: '/tasks', label: 'Tasks', icon: CheckSquare },
    { to: '/calendar', label: 'Calendar', icon: CalendarDays },
    { to: '/goals', label: 'Goals', icon: Target },
    { to: '/reminders', label: 'Reminders', icon: Bell, badge: 'reminders' },
  ] },
  { title: 'Life', items: [
    { to: '/habits', label: 'Habits & Routines', icon: Repeat },
    { to: '/journal', label: 'Journal', icon: NotebookPen },
    { to: '/health', label: 'Health', icon: HeartPulse },
  ] },
  { title: 'Money', items: [
    { to: '/expenses', label: 'Expenses & Budget', icon: Wallet },
    { to: '/subscriptions', label: 'Subscriptions', icon: CreditCard },
    { to: '/net-worth', label: 'Net Worth', icon: Landmark },
    { to: '/wishlist', label: 'Wishlist', icon: Gift },
  ] },
  { title: 'Library', items: [
    { to: '/notes', label: 'Notes', icon: StickyNote },
    { to: '/bookmarks', label: 'Bookmarks', icon: Bookmark },
    { to: '/media', label: 'Watch / Read / Play', icon: Clapperboard },
    { to: '/contacts', label: 'People', icon: Users },
    { to: '/vault', label: 'Document Vault', icon: FileLock2 },
  ] },
  { title: 'Reflect', items: [
    { to: '/review', label: 'Review', icon: ClipboardCheck },
  ] },
]

/* ---------- global search ---------- */
export interface SearchTarget { collection: string; route: string; label: string; fields: string[]; titleOf: (r: Rec) => string }
const t = (f: string) => (r: Rec) => String(r[f] ?? '')
export const SEARCH_TARGETS: SearchTarget[] = [
  { collection: 'tasks', route: '/tasks', label: 'Tasks', fields: ['title', 'notes', 'project', 'tags'], titleOf: t('title') },
  { collection: 'events', route: '/calendar', label: 'Events', fields: ['title', 'location', 'notes'], titleOf: t('title') },
  { collection: 'goals', route: '/goals', label: 'Goals', fields: ['title', 'description'], titleOf: t('title') },
  { collection: 'notes', route: '/notes', label: 'Notes', fields: ['title', 'content', 'category', 'tags'], titleOf: t('title') },
  { collection: 'bookmarks', route: '/bookmarks', label: 'Bookmarks', fields: ['title', 'url', 'content', 'category', 'tags'], titleOf: t('title') },
  { collection: 'journal', route: '/journal', label: 'Journal', fields: ['content', 'tags'], titleOf: (r) => `${r.date} - ${String(r.content).slice(0, 60)}` },
  { collection: 'media', route: '/media', label: 'Watch / Read / Play', fields: ['title', 'notes', 'tags'], titleOf: t('title') },
  { collection: 'wishlist', route: '/wishlist', label: 'Wishlist', fields: ['name', 'store', 'notes'], titleOf: t('name') },
  { collection: 'contacts', route: '/contacts', label: 'People', fields: ['name', 'relation', 'notes'], titleOf: t('name') },
  { collection: 'documents', route: '/vault', label: 'Vault', fields: ['title', 'number', 'notes'], titleOf: t('title') },
  { collection: 'subscriptions', route: '/subscriptions', label: 'Subscriptions', fields: ['name', 'category'], titleOf: t('name') },
  { collection: 'expenses', route: '/expenses', label: 'Expenses', fields: ['title', 'category', 'note'], titleOf: t('title') },
  { collection: 'habits', route: '/habits', label: 'Habits', fields: ['name', 'notes'], titleOf: t('name') },
  { collection: 'reminders', route: '/reminders', label: 'Reminders', fields: ['title', 'notes'], titleOf: t('title') },
  { collection: 'inbox', route: '/inbox', label: 'Inbox', fields: ['text'], titleOf: t('text') },
]
