import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { Icon, type IconName } from './Icons'

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

// ------------------------------------------------------------- Button

type ButtonVariant = 'primary' | 'secondary' | 'success' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  block?: boolean
  loading?: boolean
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-500 text-white active:bg-brand-600 disabled:bg-brand-200',
  success: 'bg-brand-600 text-white active:bg-brand-700 disabled:bg-brand-200',
  secondary: 'bg-white text-brand-600 border border-brand-200 active:bg-brand-50',
  ghost: 'bg-transparent text-body active:bg-black/5',
  danger: 'bg-white text-[--color-danger] border border-red-200 active:bg-red-50',
}

export function Button({
  variant = 'primary',
  block = true,
  loading = false,
  disabled,
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3.5',
        'text-[15px] font-semibold transition-colors tap-target',
        'disabled:cursor-not-allowed disabled:opacity-60',
        block && 'w-full',
        VARIANTS[variant],
        className,
      )}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  )
}

// --------------------------------------------------------------- Card

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <div
      className={cx(
        'rounded-2xl bg-white shadow-[0_1px_3px_rgba(16,24,40,0.06),0_1px_2px_rgba(16,24,40,0.04)]',
        padded && 'p-4',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-[19px] font-bold text-brand-600">{children}</h2>
      {hint && <p className="mt-1 text-sm text-body-soft">{hint}</p>}
    </div>
  )
}

// -------------------------------------------------------------- Field

export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string
  children: ReactNode
  hint?: string
  error?: string | null
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-xs text-[--color-danger]">{error}</span>
      ) : (
        hint && <span className="mt-1.5 block text-xs text-body-soft">{hint}</span>
      )}
    </label>
  )
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: IconName
  suffix?: string
  invalid?: boolean
}

export function Input({ icon, suffix, invalid, className, ...props }: InputProps) {
  return (
    <div
      className={cx(
        'flex items-center gap-2.5 rounded-xl border bg-white px-3.5',
        invalid ? 'border-red-300' : 'border-gray-200 focus-within:border-brand-400',
      )}
    >
      {icon && <Icon name={icon} size={18} className="shrink-0 text-body-soft" />}
      <input
        {...props}
        className={cx(
          'w-full bg-transparent py-3.5 text-ink outline-none placeholder:text-gray-400',
          className,
        )}
      />
      {suffix && <span className="shrink-0 text-sm text-body-soft">{suffix}</span>}
    </div>
  )
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cx(
        'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-3',
        'text-ink outline-none placeholder:text-gray-400 focus:border-brand-400',
        className,
      )}
    />
  )
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
  placeholder?: string
}) {
  return (
    <div className="relative flex items-center rounded-xl border border-gray-200 bg-white px-3.5 focus-within:border-brand-400">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full appearance-none bg-transparent py-3.5 pr-6 text-ink outline-none"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={18} className="pointer-events-none absolute right-3.5 text-body-soft" />
    </div>
  )
}

// -------------------------------------------------------------- misc

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'success' | 'warn' | 'danger'
}) {
  const tones = {
    neutral: 'bg-gray-100 text-body',
    success: 'bg-brand-50 text-brand-600',
    warn: 'bg-orange-50 text-accent-600',
    danger: 'bg-red-50 text-[--color-danger]',
  }
  return (
    <span className={cx('rounded-full px-2.5 py-1 text-xs font-semibold', tones[tone])}>
      {children}
    </span>
  )
}

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: IconName
  title: string
  description?: string
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-500">
        <Icon name={icon} size={26} />
      </div>
      <p className="font-semibold text-ink">{title}</p>
      {description && <p className="max-w-xs text-sm text-body-soft">{description}</p>}
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-body-soft">
      <span className="h-7 w-7 animate-spin rounded-full border-2 border-brand-200 border-t-brand-500" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}
