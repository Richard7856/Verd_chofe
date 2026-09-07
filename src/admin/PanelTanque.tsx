import { useCallback, useEffect, useState } from 'react'
import { Badge, Spinner } from '@/components/ui'
import { Icon } from '@/components/Icons'
import { Panel, Tabla, Td } from './AdminShell'
import { liters, shortDate } from '@/lib/format'
import {
  balanceCombustible,
  listarUnidades,
  registrarCorte,
  type BalanceCombustible,
} from './queries'
import type { Unidad } from '@/lib/database.types'

interface Fila {
  unidad: Unidad
  balance: BalanceCombustible | null
}

/**
 * El tanque llevado como una cuenta: se parte de una medición real y se
 * suma lo cargado y se resta lo consumido.
 *
 *     saldo = corte + cargado − (km ÷ rendimiento)
 *
 * Cuando se vuelve a medir, la diferencia contra el saldo teórico es la
 * merma del periodo. Un faltante sostenido es lo que delata el robo; el de
 * un día se pierde en el margen de error, porque el rendimiento real varía
 * con la carga, el tráfico y el manejo.
 *
 * Sin corte no se muestra saldo: un número inventado tendría apariencia de
 * dato y es peor que el hueco.
 */
export function PanelTanque({ fecha }: { fecha: string }) {
  const [filas, setFilas] = useState<Fila[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const unidades = (await listarUnidades()).filter((u) => u.activo)
      const balances = await Promise.all(
        unidades.map((u) => balanceCombustible(u.id, fecha).catch(() => null)),
      )
      setFilas(unidades.map((unidad, i) => ({ unidad, balance: balances[i] })))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo calcular el saldo')
    } finally {
      setCargando(false)
    }
  }, [fecha])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function aforar(f: Fila) {
    const teorico = f.balance?.saldo ?? null
    const mensaje = teorico
      ? `¿Cuántos litros tiene el tanque de ${f.unidad.placa}?\n\nEl sistema calcula ${teorico} L al ${shortDate(fecha)}. La diferencia queda registrada como merma.`
      : `¿Cuántos litros tiene el tanque de ${f.unidad.placa}?\n\nEste es el corte inicial: de acá en adelante se lleva la cuenta.`

    const texto = window.prompt(mensaje)
    if (texto == null) return

    const litros = Number(texto.replace(',', '.'))
    if (!Number.isFinite(litros) || litros < 0) {
      window.alert('Escribí un número de litros válido.')
      return
    }

    setOcupado(f.unidad.id)
    setError(null)
    try {
      await registrarCorte({
        empresa_id: f.unidad.empresa_id,
        unidad_id: f.unidad.id,
        fecha,
        litros,
        litros_teoricos: teorico,
        nota: null,
      })
      await cargar()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el corte')
    } finally {
      setOcupado(null)
    }
  }

  return (
    <Panel
      title="Tanque por unidad"
      action={<span className="text-xs text-body-soft">al {shortDate(fecha)}</span>}
    >
      {error && (
        <p className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-[--color-danger]">
          {error}
        </p>
      )}

      {cargando ? (
        <Spinner />
      ) : (
        <Tabla
          columnas={['Unidad', 'Último corte', 'Había', '+ Cargado', '− Consumido', '= Debe quedar', '']}
          vacio="No hay unidades activas."
        >
          {filas.map((f) => {
            const b = f.balance
            return (
              <tr key={f.unidad.id}>
                <Td>
                  <span className="font-mono font-medium text-ink">{f.unidad.placa}</span>
                  <span className="block text-[11px] text-body-soft">
                    {f.unidad.rendimiento_km_litro ?? 8} km/L
                  </span>
                </Td>

                {b ? (
                  <>
                    <Td className="whitespace-nowrap text-body-soft">{shortDate(b.corte_fecha)}</Td>
                    <Td className="tabular-nums">{liters(Number(b.corte_litros))}</Td>
                    <Td className="tabular-nums text-brand-600">
                      +{liters(Number(b.litros_cargados))}
                    </Td>
                    <Td className="tabular-nums text-body">
                      −{liters(Number(b.litros_consumidos))}
                      <span className="block text-[11px] text-body-soft">
                        {Math.round(Number(b.km_recorridos))} km
                      </span>
                    </Td>
                    <Td className="tabular-nums font-semibold text-ink">
                      {liters(Number(b.saldo))}
                    </Td>
                  </>
                ) : (
                  <Td className="text-body-soft" colSpan={5}>
                    <span className="flex items-center gap-2">
                      <Icon name="alert" size={14} className="text-accent-600" />
                      Sin corte: hay que medir el tanque una vez para empezar.
                    </span>
                  </Td>
                )}

                <Td className="text-right">
                  <button
                    type="button"
                    disabled={ocupado === f.unidad.id}
                    onClick={() => void aforar(f)}
                    className="whitespace-nowrap text-xs font-semibold text-brand-600 hover:underline disabled:opacity-40"
                  >
                    {b ? 'Medir tanque' : 'Corte inicial'}
                  </button>
                </Td>
              </tr>
            )
          })}
        </Tabla>
      )}

      <p className="border-t border-gray-100 px-4 py-2.5 text-[11px] leading-relaxed text-body-soft">
        <Badge tone="neutral">Cómo leerlo</Badge>{' '}
        “Debe quedar” es lo que el sistema calcula, no una medición. Al volver a medir el tanque, la
        diferencia contra ese número es la merma del periodo: lo que importa es que se repita, no un
        día suelto. Y el cálculo se apoya en los kilómetros declarados — si esos no cuadran contra la
        ruta de TripDrive, el faltante se esconde ahí.
      </p>
    </Panel>
  )
}
