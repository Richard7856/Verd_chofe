import { useEffect, useState } from 'react'
import { Badge, Button, Field, Input, Select, Spinner } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { PageTitle, Panel, Tabla, Td } from '../AdminShell'
import { useAuth } from '@/context/AuthContext'
import { shortDate } from '@/lib/format'
import {
  cambiarActivoChofer,
  crearChofer,
  listarChoferes,
  listarEmpresas,
  restablecerPassword,
} from '../queries'
import type { Chofer, Empresa } from '@/lib/database.types'

/** Contraseña inicial legible: el chofer la teclea en un celular, al sol. */
function passwordSugerida() {
  const palabras = ['ruta', 'carga', 'viaje', 'motor', 'llanta']
  const palabra = palabras[Math.floor(Math.random() * palabras.length)]
  const numero = Math.floor(1000 + Math.random() * 9000)
  return `${palabra}${numero}`
}

export function Choferes() {
  const { profile } = useAuth()
  const [choferes, setChoferes] = useState<Chofer[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [cargando, setCargando] = useState(true)
  const [creando, setCreando] = useState(false)

  const [form, setForm] = useState({
    nombre: '',
    email: '',
    password: passwordSugerida(),
    empresa_id: '',
    telefono: '',
    licencia_numero: '',
    licencia_vence_el: '',
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creado, setCreado] = useState<{ email: string; password: string } | null>(null)

  async function refrescar() {
    const [c, e] = await Promise.all([
      listarChoferes(),
      listarEmpresas(profile?.empresas_permitidas ?? null),
    ])
    setChoferes(c)
    setEmpresas(e)
    setForm((f) => ({ ...f, empresa_id: f.empresa_id || (e[0]?.id ?? '') }))
    setCargando(false)
  }

  useEffect(() => {
    void refrescar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  async function enviar() {
    setGuardando(true)
    setError(null)
    try {
      await crearChofer({
        nombre: form.nombre.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        empresa_id: form.empresa_id,
        telefono: form.telefono || null,
        licencia_numero: form.licencia_numero || null,
        licencia_vence_el: form.licencia_vence_el || null,
      })

      setCreado({ email: form.email.trim().toLowerCase(), password: form.password })
      setForm({
        nombre: '',
        email: '',
        password: passwordSugerida(),
        empresa_id: form.empresa_id,
        telefono: '',
        licencia_numero: '',
        licencia_vence_el: '',
      })
      setCreando(false)
      await refrescar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el chofer')
    } finally {
      setGuardando(false)
    }
  }

  async function alternarActivo(c: Chofer) {
    await cambiarActivoChofer(c.id, !c.activo)
    await refrescar()
  }

  async function nuevaPassword(c: Chofer) {
    const nueva = passwordSugerida()
    try {
      await restablecerPassword(c.id, nueva)
      setCreado({ email: c.nombre, password: nueva })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la contraseña')
    }
  }

  const listo =
    form.nombre.trim().length >= 3 &&
    form.email.includes('@') &&
    form.password.length >= 8 &&
    form.empresa_id

  return (
    <>
      <PageTitle
        action={
          <Button block={false} onClick={() => setCreando((v) => !v)}>
            <Icon name={creando ? 'x' : 'plus'} size={17} />
            {creando ? 'Cancelar' : 'Nuevo chofer'}
          </Button>
        }
      >
        Choferes
      </PageTitle>

      {/* Las credenciales se muestran una sola vez: no quedan guardadas. */}
      {creado && (
        <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50 p-4">
          <p className="flex items-center gap-2 font-bold text-brand-700">
            <Icon name="checkCircle" size={18} />
            Credenciales generadas
          </p>
          <p className="mt-2 text-sm text-body">
            Pasáselas al chofer por un medio seguro. <strong>No se vuelven a mostrar.</strong>
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg bg-white px-3 py-2">
              <p className="text-xs text-body-soft">Usuario</p>
              <p className="font-mono text-sm text-ink">{creado.email}</p>
            </div>
            <div className="rounded-lg bg-white px-3 py-2">
              <p className="text-xs text-body-soft">Contraseña</p>
              <p className="font-mono text-sm text-ink">{creado.password}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCreado(null)}
            className="mt-3 text-sm font-semibold text-brand-600"
          >
            Ya la anoté, ocultar
          </button>
        </div>
      )}

      {error && (
        <p className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-[--color-danger]">
          <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {creando && (
        <Panel title="Nuevo chofer" className="mb-5">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Nombre completo">
              <Input
                placeholder="Juan Pérez"
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              />
            </Field>

            <Field label="Empresa">
              <Select
                value={form.empresa_id}
                onChange={(v) => setForm({ ...form, empresa_id: v })}
                options={empresas.map((e) => ({ value: e.id, label: e.nombre }))}
              />
            </Field>

            <Field label="Correo (será su usuario)">
              <Input
                type="email"
                autoCapitalize="none"
                placeholder="juan.perez@empresa.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>

            <Field label="Contraseña inicial" hint="Mínimo 8 caracteres. Se muestra al crear.">
              <Input
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>

            <Field label="Teléfono (opcional)">
              <Input
                placeholder="55 1234 5678"
                value={form.telefono}
                onChange={(e) => setForm({ ...form, telefono: e.target.value })}
              />
            </Field>

            <Field label="Licencia (opcional)">
              <Input
                placeholder="LIC-2026-0001"
                value={form.licencia_numero}
                onChange={(e) => setForm({ ...form, licencia_numero: e.target.value })}
              />
            </Field>

            <Field label="Vencimiento de licencia (opcional)">
              <Input
                type="date"
                value={form.licencia_vence_el}
                onChange={(e) => setForm({ ...form, licencia_vence_el: e.target.value })}
              />
            </Field>
          </div>

          <div className="border-t border-gray-100 px-4 py-3">
            <Button block={false} loading={guardando} disabled={!listo} onClick={() => void enviar()}>
              Crear chofer
            </Button>
          </div>
        </Panel>
      )}

      <Panel>
        {cargando ? (
          <Spinner />
        ) : (
          <Tabla
            columnas={['Chofer', 'Teléfono', 'Licencia', 'Vence', 'Estado', '']}
            vacio="Todavía no hay choferes dados de alta."
          >
            {choferes.map((c) => {
              const vencida =
                c.licencia_vence_el != null && new Date(c.licencia_vence_el) < new Date()
              return (
                <tr key={c.id}>
                  <Td className="font-medium text-ink">{c.nombre}</Td>
                  <Td>{c.telefono || '—'}</Td>
                  <Td>{c.licencia_numero || '—'}</Td>
                  <Td>
                    <span className="flex items-center gap-2">
                      {shortDate(c.licencia_vence_el)}
                      {vencida && <Badge tone="danger">Vencida</Badge>}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={c.activo ? 'success' : 'neutral'}>
                      {c.activo ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => void nuevaPassword(c)}
                        className="text-xs font-semibold text-brand-600 hover:underline"
                      >
                        Nueva contraseña
                      </button>
                      <button
                        type="button"
                        onClick={() => void alternarActivo(c)}
                        className="text-xs font-semibold text-body-soft hover:underline"
                      >
                        {c.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </Td>
                </tr>
              )
            })}
          </Tabla>
        )}
      </Panel>
    </>
  )
}
