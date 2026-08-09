import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { CatalogoFoto, CatalogoItem } from './database.types'

/**
 * Los catálogos (ítems de condiciones y slots de foto) los define el cliente
 * en la base. Se cachean en localStorage porque el chofer puede abrir la app
 * en el patio sin señal y el check list tiene que armarse igual.
 */

const CACHE_KEY = 'choferes.catalogos.v1'

export interface Catalogos {
  items: CatalogoItem[]
  fotos: CatalogoFoto[]
}

function leerCache(): Catalogos | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as Catalogos) : null
  } catch {
    return null
  }
}

export function useCatalogos(empresaId: string | null) {
  const [catalogos, setCatalogos] = useState<Catalogos | null>(() => leerCache())
  const [loading, setLoading] = useState(!catalogos)

  useEffect(() => {
    if (!empresaId) return

    async function cargar() {
      const [items, fotos] = await Promise.all([
        supabase
          .from('checklist_catalogo_items')
          .select('*')
          .eq('empresa_id', empresaId!)
          .eq('activo', true)
          .order('orden'),
        supabase
          .from('checklist_catalogo_fotos')
          .select('*')
          .eq('empresa_id', empresaId!)
          .eq('activo', true)
          .order('orden'),
      ])

      // Sin conexión se sigue usando lo cacheado en vez de romper la pantalla.
      if (items.error || fotos.error) {
        setLoading(false)
        return
      }

      const siguiente: Catalogos = { items: items.data ?? [], fotos: fotos.data ?? [] }
      setCatalogos(siguiente)
      setLoading(false)
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(siguiente))
      } catch {
        // cuota llena: no es crítico
      }
    }

    void cargar()
  }, [empresaId])

  return { catalogos, loading }
}
