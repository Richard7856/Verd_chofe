import { useEffect, useState } from 'react'
import { Badge, Button, Field, Input, Select, Spinner } from '@/components/ui'
import { NumberField } from '@/components/NumberField'
import { Icon } from '@/components/Icons'
import { PageTitle, Panel, Tabla, Td } from '../AdminShell'
import { crearUnidad, listarEmpresas, listarUnidades } from '../queries'
import { useAuth } from '@/context/AuthContext'
import type { Empresa, EstadoUnidad, Unidad } from '@/lib/database.types'

const ESTADOS: Record<EstadoUnidad, { label: string; tone: 'success' | 'warn' | 'neutral' }> = {
  disponible: { label: 'Disponible', tone: 'success' },
  en_ruta: { label: 'En ruta', tone: 'warn' },
  mantenimiento: { label: 'Mantenimiento', tone: 'warn' },
  inactiva: { label: 'Inactiva', tone: 'neutral' },
}

export function Unidades() {
  const { profile } = useAuth()
  const [unidades, setUnidades] = useState<Unidad[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [cargando, setCargando] = useState(true)
  const [creando, setCreando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    empresa_id: '',
    placa: '',
    alias: '',
    marca: '',
    modelo: '',
    anio: null as number | null,
  })

  async function refrescar() {
    const [u, e] = await Promise.all([
      listarUnidades(),
      listarEmpresas(profile?.empresas_permitidas ?? null),
    ])
    setUnidades(u)
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
      await crearUnidad({
        empresa_id: form.empresa_id,
        placa: form.placa.trim().toUpperCase(),
        alias: form.alias.trim() || null,
        marca: form.marca.trim() || null,
        modelo: form.modelo.trim() || null,
        anio: form.anio,
      })
      setForm({ ...form, placa: '', alias: '', marca: '', modelo: '', anio: null })
      setCreando(false)
      await refrescar()
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : 'No se pudo crear la unidad'
      setError(
        mensaje.includes('duplicate') || mensaje.includes('unique')
          ? 'Ya existe una unidad con esa placa en la empresa.'
          : mensaje,
      )
    } finally {
      setGuardando(false)
    }
  }

  const listo = form.placa.trim().length >= 3 && form.empresa_id

  return (
    <>
      <PageTitle
        action={
          <Button block={false} onClick={() => setCreando((v) => !v)}>
            <Icon name={creando ? 'x' : 'plus'} size={17} />
            {creando ? 'Cancelar' : 'Nueva unidad'}
          </Button>
        }
      >
        Unidades
      </PageTitle>

      {error && (
        <p className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-[--color-danger]">
          <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {creando && (
        <Panel title="Nueva unidad" className="mb-5">
          <div className="grid gap-4 p-4 sm:grid-cols-3">
            <Field label="Empresa">
              <Select
                value={form.empresa_id}
                onChange={(v) => setForm({ ...form, empresa_id: v })}
                options={empresas.map((e) => ({ value: e.id, label: e.nombre }))}
              />
            </Field>

            <Field label="Placa">
              <Input
                placeholder="ABC123"
                value={form.placa}
                onChange={(e) => setForm({ ...form, placa: e.target.value.toUpperCase() })}
              />
            </Field>

            <Field label="Alias (opcional)">
              <Input
                placeholder="Hilux blanca"
                value={form.alias}
                onChange={(e) => setForm({ ...form, alias: e.target.value })}
              />
            </Field>

            <Field label="Marca (opcional)">
              <Input
                placeholder="Toyota"
                value={form.marca}
                onChange={(e) => setForm({ ...form, marca: e.target.value })}
              />
            </Field>

            <Field label="Modelo (opcional)">
              <Input
                placeholder="Hilux"
                value={form.modelo}
                onChange={(e) => setForm({ ...form, modelo: e.target.value })}
              />
            </Field>

            <Field label="Año (opcional)">
              <NumberField
                placeholder="2022"
                value={form.anio}
                onChange={(v) => setForm({ ...form, anio: v })}
              />
            </Field>
          </div>

          <div className="border-t border-gray-100 px-4 py-3">
            <Button block={false} loading={guardando} disabled={!listo} onClick={() => void enviar()}>
              Crear unidad
            </Button>
          </div>
        </Panel>
      )}

      <Panel>
        {cargando ? (
          <Spinner />
        ) : (
          <Tabla
            columnas={['Placa', 'Alias', 'Marca / Modelo', 'Año', 'Estado']}
            vacio="Todavía no hay unidades dadas de alta."
          >
            {unidades.map((u) => (
              <tr key={u.id}>
                <Td className="font-mono font-medium text-ink">{u.placa}</Td>
                <Td>{u.alias || '—'}</Td>
                <Td>{[u.marca, u.modelo].filter(Boolean).join(' ') || '—'}</Td>
                <Td className="tabular-nums">{u.anio ?? '—'}</Td>
                <Td>
                  <Badge tone={ESTADOS[u.estado].tone}>{ESTADOS[u.estado].label}</Badge>
                </Td>
              </tr>
            ))}
          </Tabla>
        )}
      </Panel>
    </>
  )
}
