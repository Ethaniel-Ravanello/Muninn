export type FieldType =
  | 'text' | 'textarea' | 'number' | 'money' | 'date' | 'time'
  | 'select' | 'checkbox' | 'url' | 'tags' | 'rating' | 'progress'

export interface Option { value: string; label: string }

export interface Field {
  name: string
  label: string
  type: FieldType
  options?: Option[]
  required?: boolean
  placeholder?: string
  /** a function is evaluated each time the form opens (use it for "today" so it never goes stale) */
  default?: unknown | (() => unknown)
  /** span both columns in the form */
  full?: boolean
  /** do not render on list cards / tables */
  hideInList?: boolean
  /** colour dates red when past and amber when within 30 days */
  warn?: boolean
  /** autocomplete suggestions for text inputs */
  suggest?: string[]
}

export const opts = (...values: string[]): Option[] =>
  values.map((v) => ({ value: v, label: v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) }))
