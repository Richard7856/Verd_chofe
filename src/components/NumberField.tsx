import { useEffect, useRef, useState } from 'react'
import { Input } from './ui'
import type { IconName } from './Icons'

/**
 * Campo numérico que no pelea con el dedo del chofer.
 *
 * Un input controlado con `value={numero}` y `onChange={parse}` hace imposible
 * escribir decimales: al teclear "6." el parseo devuelve 6, el componente
 * re-renderiza como "6" y el punto desaparece. Nunca se llega a "6.89".
 *
 * La solución es guardar el texto tal cual se escribe y emitir el número sólo
 * cuando es válido, resincronizando desde afuera únicamente si el valor
 * externo dejó de coincidir con lo tecleado.
 */
export function NumberField({
  value,
  onChange,
  decimales = false,
  icon,
  suffix,
  placeholder,
  invalid,
  readOnly,
}: {
  value: number | null
  onChange: (value: number | null) => void
  /** true permite punto decimal; false sólo enteros (kilometraje) */
  decimales?: boolean
  icon?: IconName
  suffix?: string
  placeholder?: string
  invalid?: boolean
  readOnly?: boolean
}) {
  const [texto, setTexto] = useState(() => (value == null ? '' : String(value)))
  const ultimoEmitido = useRef<number | null>(value)

  // Resincronizar sólo ante cambios que vengan de afuera (por ejemplo, al
  // recuperar un borrador). Si el valor externo es el que acabamos de emitir,
  // no se toca el texto: eso es lo que borraba el punto.
  useEffect(() => {
    if (value !== ultimoEmitido.current) {
      setTexto(value == null ? '' : String(value))
      ultimoEmitido.current = value
    }
  }, [value])

  function manejar(entrada: string) {
    // Los teclados en español suelen ofrecer coma: se acepta como punto.
    let limpio = entrada.replace(',', '.')
    limpio = decimales ? limpio.replace(/[^\d.]/g, '') : limpio.replace(/\D/g, '')

    // Un solo punto decimal
    if (decimales) {
      const partes = limpio.split('.')
      if (partes.length > 2) limpio = `${partes[0]}.${partes.slice(1).join('')}`
    }

    setTexto(limpio)

    // "", "." y "6." son estados intermedios válidos mientras se escribe:
    // no son números todavía, pero tampoco un error.
    if (limpio === '' || limpio === '.') {
      ultimoEmitido.current = null
      onChange(null)
      return
    }

    const numero = Number(limpio)
    if (Number.isFinite(numero)) {
      ultimoEmitido.current = numero
      onChange(numero)
    }
  }

  return (
    <Input
      type="text"
      inputMode={decimales ? 'decimal' : 'numeric'}
      icon={icon}
      suffix={suffix}
      placeholder={placeholder}
      invalid={invalid}
      readOnly={readOnly}
      value={texto}
      onChange={(event) => manejar(event.target.value)}
    />
  )
}
