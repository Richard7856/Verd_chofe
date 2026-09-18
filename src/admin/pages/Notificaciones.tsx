import { useEffect, useState } from 'react'
import { Badge, Button, Field, Input, Select, Spinner, cx } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { PageTitle, Panel } from '../AdminShell'
import { useAuth } from '@/context/AuthContext'
import {
  detectarChatsTelegram,
  esperarRespuestaTelegram,
  estadoTelegram,
  guardarTelegram,
  listarEmpresas,
  probarTelegram,
  type EstadoTelegram,
} from '../queries'
import type { Empresa } from '@/lib/database.types'

interface ChatDetectado {
  id: string
  titulo: string
  tipo: string
}

/**
 * Lee la respuesta cruda de getUpdates y saca los chats que le escribieron al
 * bot. Telegram no tiene forma de preguntar "¿en qué grupos estás?": el chat
 * aparece recién cuando alguien manda un mensaje ahí.
 */
function chatsDeLaRespuesta(contenido: string | null): ChatDetectado[] {
  if (!contenido) return []
  try {
    const json = JSON.parse(contenido) as {
      ok?: boolean
      result?: Array<Record<string, { chat?: { id: number; title?: string; first_name?: string; type?: string } }>>
    }
    if (!json.ok || !Array.isArray(json.result)) return []

    const mapa = new Map<string, ChatDetectado>()
    for (const update of json.result) {
      // El chat puede venir en message, edited_message, channel_post…
      for (const valor of Object.values(update)) {
        const chat = valor?.chat
        if (!chat) continue
        mapa.set(String(chat.id), {
          id: String(chat.id),
          titulo: chat.title ?? chat.first_name ?? 'Chat',
          tipo: chat.type ?? '—',
        })
      }
    }
    return [...mapa.values()]
  } catch {
    return []
  }
}

/**
 * Avisos por Telegram.
 *
 * El aviso lo manda la base de datos, no esta pantalla: acá sólo se guarda a
 * qué chat. El token del bot se escribe una vez y queda cifrado en Vault —
 * nunca vuelve al navegador, así que si se pierde hay que pedir uno nuevo a
 * BotFather en vez de consultarlo.
 */
export function Notificaciones() {
  const { profile } = useAuth()
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaId, setEmpresaId] = useState('')
  const [estado, setEstado] = useState<EstadoTelegram | null>(null)

  const [token, setToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [activo, setActivo] = useState(true)

  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [probando, setProbando] = useState(false)
  const [detectando, setDetectando] = useState(false)
  const [detectados, setDetectados] = useState<ChatDetectado[]>([])
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    void listarEmpresas(profile?.empresas_permitidas ?? null).then((e) => {
      setEmpresas(e)
      setEmpresaId((actual) => actual || (e[0]?.id ?? ''))
    })
  }, [profile?.empresas_permitidas])

  useEffect(() => {
    if (!empresaId) return
    setCargando(true)
    setError(null)
    setAviso(null)
    setDetectados([])
    setToken('')
    estadoTelegram(empresaId)
      .then((e) => {
        setEstado(e)
        setChatId(e.chat_id ?? '')
        setActivo(e.activo)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudo leer la configuración'))
      .finally(() => setCargando(false))
  }, [empresaId])

  async function guardar() {
    setGuardando(true)
    setError(null)
    setAviso(null)
    try {
      await guardarTelegram({
        empresaId,
        chatId: chatId.trim(),
        token: token.trim() || null,
        activo,
      })
      setToken('')
      setEstado(await estadoTelegram(empresaId))
      setAviso('Configuración guardada.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  async function probar() {
    setProbando(true)
    setError(null)
    setAviso(null)
    try {
      const id = await probarTelegram(empresaId)
      if (id == null) {
        setError('No se envió nada: revisá que el token esté guardado y los avisos encendidos.')
        return
      }
      const r = await esperarRespuestaTelegram(id)
      if (r.status_code === 200) {
        setAviso('Mensaje enviado. Revisá el chat de Telegram.')
      } else {
        setError(explicar(r.status_code, r.contenido, r.error))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar la prueba')
    } finally {
      setProbando(false)
    }
  }

  async function detectar() {
    setDetectando(true)
    setError(null)
    setAviso(null)
    setDetectados([])
    try {
      const id = await detectarChatsTelegram(empresaId)
      if (id == null) throw new Error('Guardá primero el token del bot')

      const r = await esperarRespuestaTelegram(id)
      if (r.status_code !== 200) {
        setError(explicar(r.status_code, r.contenido, r.error))
        return
      }

      const chats = chatsDeLaRespuesta(r.contenido)
      setDetectados(chats)
      if (chats.length === 0) {
        setAviso(
          'Telegram no tiene mensajes recientes para este bot. Mandale un mensaje al bot (o al grupo donde está) y probá de nuevo.',
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo consultar Telegram')
    } finally {
      setDetectando(false)
    }
  }

  const listo = chatId.trim().length > 0 && (estado?.con_token || token.trim().length > 0)

  return (
    <>
      <PageTitle
        action={
          empresas.length > 1 ? (
            <div className="w-56">
              <Select
                value={empresaId}
                onChange={setEmpresaId}
                options={empresas.map((e) => ({ value: e.id, label: e.nombre }))}
              />
            </div>
          ) : undefined
        }
      >
        Avisos por Telegram
      </PageTitle>

      {error && (
        <p className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-[--color-danger]">
          <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {aviso && (
        <p className="mb-4 flex items-start gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">
          <Icon name="checkCircle" size={17} className="mt-0.5 shrink-0" />
          {aviso}
        </p>
      )}

      {cargando ? (
        <Spinner />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <Panel title="Configuración">
            <div className="space-y-4 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={estado?.con_token ? 'success' : 'neutral'}>
                  {estado?.con_token ? 'Token guardado' : 'Sin token'}
                </Badge>
                <Badge tone={estado?.chat_id ? 'success' : 'neutral'}>
                  {estado?.chat_id ? `Chat ${estado.chat_id}` : 'Sin chat'}
                </Badge>
                <Badge tone={estado?.activo ? 'success' : 'warn'}>
                  {estado?.activo ? 'Avisos encendidos' : 'Avisos apagados'}
                </Badge>
              </div>

              <Field
                label="Token del bot"
                hint={
                  estado?.con_token
                    ? 'Ya está guardado y cifrado. Dejalo vacío para no cambiarlo.'
                    : 'Te lo da @BotFather al crear el bot.'
                }
              >
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder={estado?.con_token ? '•••••••••••••••••' : '1234567890:AA...'}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </Field>

              <Field label="Chat al que avisar" hint="Un grupo empieza con -100. Una persona, con su número.">
                <Input
                  icon="bell"
                  placeholder="-1001234567890"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                />
              </Field>

              <Button
                block={false}
                variant="secondary"
                loading={detectando}
                disabled={!estado?.con_token}
                onClick={() => void detectar()}
              >
                <Icon name="refresh" size={16} />
                Detectar chat
              </Button>

              {detectados.length > 0 && (
                <div className="space-y-1.5 rounded-xl border border-gray-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-body-soft">
                    Chats que le escribieron al bot
                  </p>
                  {detectados.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setChatId(c.id)}
                      className={cx(
                        'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm',
                        chatId === c.id ? 'bg-brand-50 text-brand-700' : 'hover:bg-gray-50',
                      )}
                    >
                      <span className="min-w-0 truncate font-medium text-ink">{c.titulo}</span>
                      <span className="shrink-0 font-mono text-xs text-body-soft">{c.id}</span>
                    </button>
                  ))}
                </div>
              )}

              <Field label="Estado">
                <Select
                  value={activo ? 'si' : 'no'}
                  onChange={(v) => setActivo(v === 'si')}
                  options={[
                    { value: 'si', label: 'Avisar cuando un chofer pida carga' },
                    { value: 'no', label: 'No avisar por ahora' },
                  ]}
                />
              </Field>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-gray-100 px-4 py-3">
              <Button block={false} loading={guardando} disabled={!listo} onClick={() => void guardar()}>
                Guardar
              </Button>
              <Button
                block={false}
                variant="secondary"
                loading={probando}
                disabled={!estado?.con_token || !estado?.chat_id}
                onClick={() => void probar()}
              >
                Enviar prueba
              </Button>
            </div>
          </Panel>

          <Panel title="Cómo se arma">
            <ol className="space-y-3 p-4 text-sm text-body">
              {[
                <>
                  En Telegram, escribile a <b>@BotFather</b> y mandá <code>/newbot</code>. Te
                  devuelve un token largo.
                </>,
                <>Pegá el token acá y dale <b>Guardar</b>.</>,
                <>
                  Creá el grupo donde quieras recibir los avisos y agregá al bot. Conviene un
                  grupo aunque al principio esté una sola persona: sumar a la segunda después no
                  obliga a tocar nada.
                </>,
                <>
                  En ese chat mandá <code>/start@tubot</code> —con el nombre del bot— y tocá{' '}
                  <b>Detectar chat</b>. Tiene que ser un comando que lo mencione: en los grupos,
                  Telegram no le deja ver los mensajes comunes, así que un “hola” suelto no lo
                  despierta. En un chat privado con el bot, cualquier mensaje sirve.
                </>,
                <>
                  <b>Guardar</b> otra vez y <b>Enviar prueba</b> para confirmar.
                </>,
              ].map((paso, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-600">
                    {i + 1}
                  </span>
                  <span className="min-w-0">{paso}</span>
                </li>
              ))}
            </ol>

            <div className="border-t border-gray-100 px-4 py-3 text-xs text-body-soft">
              <p>
                El aviso lo manda la base de datos, no el navegador: sale igual con el panel
                cerrado. Si Telegram falla, la solicitud del chofer se guarda de todas formas —
                el aviso nunca la bloquea.
              </p>
              <p className="mt-2">
                El token queda cifrado y no se puede volver a leer desde acá. Si se pierde, se
                pide uno nuevo a BotFather.
              </p>
              <p className="mt-2">
                Si un grupo chico crece y Telegram lo convierte en supergrupo, le cambia el
                identificador y los avisos dejan de llegar sin decir nada. Se arregla volviendo a
                tocar <b>Detectar chat</b> y guardando.
              </p>
            </div>
          </Panel>
        </div>
      )}
    </>
  )
}

/** Traduce la respuesta de Telegram a algo accionable. */
function explicar(status: number | null, contenido: string | null, error: string | null): string {
  if (error) return `No se pudo contactar a Telegram: ${error}`

  let descripcion = ''
  try {
    descripcion = (JSON.parse(contenido ?? '{}') as { description?: string }).description ?? ''
  } catch {
    descripcion = contenido ?? ''
  }

  if (status === 401) return 'El token del bot no es válido. Pedí uno nuevo a @BotFather.'
  if (status === 400 && /chat not found/i.test(descripcion))
    return 'Ese chat no existe o el bot no está adentro. Agregá el bot al grupo y volvé a detectar.'
  if (status === 403)
    return 'El bot no puede escribir en ese chat. Agregalo al grupo (o escribile primero desde tu cuenta).'

  return `Telegram respondió ${status ?? '—'}: ${descripcion || 'sin detalle'}`
}
