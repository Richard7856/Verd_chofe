import { useState, type FormEvent } from 'react'
import { useAuth } from '@/context/AuthContext'
import { Button, Field, Input } from '@/components/ui'
import { Icon } from '@/components/Icons'

export function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="safe-top safe-bottom flex min-h-dvh flex-col justify-center bg-white px-6 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-9 flex flex-col items-center gap-3 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500 text-white">
            <Icon name="truck" size={32} />
          </span>
          {/* Neutro a propósito: `dash` sirve a Euromex, Garritas, Cigarros y
              Verdfrut. La empresa del chofer recién se sabe al entrar, y desde
              ahí la cabecera muestra su nombre. */}
          <div>
            <h1 className="text-2xl font-extrabold text-brand-600">Choferes</h1>
            <p className="text-sm text-body-soft">Check list de unidad y combustible</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Correo">
            <Input
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              placeholder="chofer@empresa.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>

          <Field label="Contraseña">
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>

          {error && (
            <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-[--color-danger]">
              <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}

          <Button type="submit" loading={loading} className="mt-2">
            Entrar
          </Button>
        </form>

        <p className="mt-8 text-center text-xs text-body-soft">
          ¿Olvidaste tu contraseña? Pedile a tu supervisor que te la restablezca.
        </p>
      </div>
    </div>
  )
}
