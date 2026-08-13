import { useEffect, useState } from 'react'
import { Badge, Button, Field, Input, Select, Spinner, TextArea, cx } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { PageTitle, Panel, Tabla, Td } from '../AdminShell'
import { clockTime, shortDate } from '@/lib/format'
import {
  enviarAviso,
  generarRecordatorios,
  listarAvisos,
  listarChoferes,
  type AvisoAdmin,
} from '../queries'
import type { Chofer, TipoAviso } from '@/lib/database.types'

const TIPOS: Array<{ value: TipoAviso; label: string }> = [
  { value: 'aviso', label: 'Aviso' },
  { value: 'recordatorio', label: 'Recordatorio' },
  { value: 'urgente', label: 'Urgente' },
]

const TONO: Record<TipoAviso, 'neutral' | 'warn' | 'danger'> = {
  aviso: 'neutral',
  recordatorio: 'warn',
  urgente: 'danger',
}

export function Avisos() {
  const [avisos, setAvisos] = useState<AvisoAdmin[]>([])
  const [choferes, setChoferes] = useState<Chofer[]>([])
  const [cargando, setCargando] = useState(true)
  const [redactando, setRedactando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const [destino, setDestino] = useState<'todos' | string>('todos')
  const [tipo, setTipo] = useState<TipoAviso>('aviso')
  const [titulo, setTitulo] = useState('')
  const [cuerpo, setCuerpo] = useState('')

  async function refrescar() {
    const [a, c] = await Promise.all([listarAvisos(), listarChoferes()])
    setAvisos(a)
    setChoferes(c)
    setCargando(false)
  }

  useEffect(() => {
    void refrescar()
  }, [])

  const activos = choferes.filter((c) => c.activo)

  async function enviar() {
    setEnviando(true)
    setError(null)
    setOk(null)
    try {
      const destinatarios = destino === 'todos' ? activos : activos.filter((c) => c.id === destino)
      if (destinatarios.length === 0) throw new Error('No hay choferes activos a quienes avisar')

      await enviarAviso({
        empresaId: destinatarios[0].empresa_id,
        choferIds: destinatarios.map((c) => c.id),
        titulo,
        cuerpo,
        tipo,
      })

      setOk(`Aviso enviado a ${destinatarios.length} chofer(es).`)
      setTitulo('')
      setCuerpo('')
      setRedactando(false)
      await refrescar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el aviso')
    } finally {
      setEnviando(false)
    }
  }

  async function recordatoriosAhora() {
    setError(null)
    setOk(null)
    try {
      const creados = await generarRecordatorios()
      setOk(
        creados === 0
          ? 'Nadie quedó pendiente: todos los choferes activos ya registraron su entrada hoy.'
          : `Se generaron ${creados} recordatorio(s) para quienes no registraron entrada hoy.`,
      )
      await refrescar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron generar los recordatorios')
    }
  }

  const listo = titulo.trim().length >= 3 && cuerpo.trim().length >= 1

  return (
    <>
      <PageTitle
        action={
          <div className="flex gap-2">
            <Button block={false} variant="secondary" onClick={() => void recordatoriosAhora()}>
              <Icon name="clock" size={16} />
              Recordar a los que faltan
            </Button>
            <Button block={false} onClick={() => setRedactando((v) => !v)}>
              <Icon name={redactando ? 'x' : 'plus'} size={17} />
              {redactando ? 'Cancelar' : 'Nuevo aviso'}
            </Button>
          </div>
        }
      >
        Avisos
      </PageTitle>

      {ok && (
        <p className="mb-4 flex items-start gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">
          <Icon name="checkCircle" size={17} className="mt-0.5 shrink-0" />
          {ok}
        </p>
      )}
      {error && (
        <p className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-[--color-danger]">
          <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {redactando && (
        <Panel title="Nuevo aviso" className="mb-5">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Para">
              <Select
                value={destino}
                onChange={setDestino}
                options={[
                  { value: 'todos', label: `Todos los choferes activos (${activos.length})` },
                  ...activos.map((c) => ({ value: c.id, label: c.nombre })),
                ]}
              />
            </Field>

            <Field label="Tipo">
              <Select
                value={tipo}
                onChange={(v) => setTipo(v as TipoAviso)}
                options={TIPOS}
              />
            </Field>

            <div className="sm:col-span-2">
              <Field label="Título">
                <Input
                  placeholder="Revisión de unidades el viernes"
                  maxLength={120}
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                />
              </Field>
            </div>

            <div className="sm:col-span-2">
              <Field label="Mensaje" hint={`${cuerpo.trim().length} / 2000 caracteres`}>
                <TextArea
                  rows={4}
                  maxLength={2000}
                  placeholder="Escribí el aviso que va a ver el chofer al abrir la app…"
                  value={cuerpo}
                  onChange={(e) => setCuerpo(e.target.value)}
                />
              </Field>
            </div>
          </div>

          <div className="border-t border-gray-100 px-4 py-3">
            <Button block={false} loading={enviando} disabled={!listo} onClick={() => void enviar()}>
              Enviar aviso
            </Button>
          </div>
        </Panel>
      )}

      <Panel
        title="Enviados"
        action={
          <span className="text-sm text-body-soft">
            El recordatorio automático corre de lunes a sábado a las 10:00
          </span>
        }
      >
        {cargando ? (
          <Spinner />
        ) : (
          <Tabla
            columnas={['Fecha', 'Chofer', 'Tipo', 'Título', 'Mensaje', 'Estado']}
            vacio="Todavía no se envió ningún aviso."
          >
            {avisos.map((a) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap">
                  {shortDate(a.created_at)}
                  <span className="block text-xs text-body-soft">{clockTime(a.created_at)}</span>
                </Td>
                <Td className="font-medium text-ink">{a.chofer?.nombre ?? '—'}</Td>
                <Td>
                  <Badge tone={TONO[a.tipo]}>{a.tipo}</Badge>
                  {a.origen === 'automatico' && (
                    <span className="ml-1 text-xs text-body-soft">auto</span>
                  )}
                </Td>
                <Td className="font-medium text-ink">{a.titulo}</Td>
                <Td className="max-w-sm text-body">{a.cuerpo}</Td>
                <Td>
                  <span
                    className={cx(
                      'text-xs font-semibold',
                      a.leido_el ? 'text-brand-600' : 'text-body-soft',
                    )}
                  >
                    {a.leido_el ? `Leído ${shortDate(a.leido_el)}` : 'Sin leer'}
                  </span>
                </Td>
              </tr>
            ))}
          </Tabla>
        )}
      </Panel>
    </>
  )
}
