import type { ButtonHTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)]',
  secondary: 'bg-black/5 text-[var(--color-text)] hover:bg-black/10',
  danger: 'bg-[var(--color-danger)] text-white hover:opacity-90',
  ghost: 'text-[var(--color-text)] hover:bg-black/5',
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  )
}

export function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return (
    <label className="mb-3 block text-sm">
      <span className="mb-1 block font-medium text-[var(--color-text)]">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-[var(--color-danger)]">{error}</span>}
    </label>
  )
}

/** Same look as Field, but a plain div instead of <label>. Use this when
 * wrapping more than one interactive control (e.g. a button group, or the
 * product picker's list of buttons) - a native <label> forwards clicks to
 * "the current form control inside it" as a post-dispatch step, which can
 * misfire onto whatever element replaces the one just clicked once React
 * re-renders in response to that same click. */
export function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3 block text-sm">
      <span className="mb-1 block font-medium text-[var(--color-text)]">{label}</span>
      {children}
    </div>
  )
}

const inputClasses =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-[var(--color-text)] outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20'

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={inputClasses} {...props} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={inputClasses} {...props} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={inputClasses} {...props} />
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-text)] sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[var(--color-text-muted)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 ${className}`}>
      {children}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-muted)]">
      {children}
    </div>
  )
}

export function Checkbox({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="mb-3 flex items-center gap-2 text-sm text-[var(--color-text)]">
      <input type="checkbox" className="h-5 w-5 rounded border-[var(--color-border)]" {...props} />
      {label}
    </label>
  )
}

export function FieldsetLabel(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className="mb-1 block text-sm font-medium text-[var(--color-text)]" {...props} />
}
