import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import type { CatalogoFoto, CatalogoItem } from './database.types'

/**
 * Los catálogos (ítems de condiciones y recuadros de foto) los define el
 * cliente en la base. Se cachean en localStorage porque el chofer puede abrir
 * la app en el patio sin señal y el check list tiene que armarse igual.
 */

// v2: las fotos ganaron `momento`. Una caché v1 no lo trae, y sin este cambio
// de clave las fotos de cierre no aparecerían hasta vaciar el navegador.
const CACHE_KEY = 'choferes.catalogos.v2'

export interface Catalogos {
  items: CatalogoItem[]
  fotos: CatalogoFoto[]
  /** Fotos del paso de evidencia, al abrir el turno. */
  fotosApertura: CatalogoFoto[]
  /** Fotos que se piden al cerrar, junto al kilometraje final. */
  fotosCierre: CatalogoFoto[]
}

function partir(items: CatalogoItem[], fotos: CatalogoFoto[]): Catalogos {
  return {
    items,
    fotos,
    // `momento` puede faltar en filas viejas: se asume apertura.
    fotosApertura: fotos.filter((f) => (f.momento ?? 'apertura') === 'apertura'),
    fotosCierre: fotos.filter((f) => f.momento === 'cierre'),
  }
}

function leerCache(): { items: CatalogoItem[]; fotos: CatalogoFoto[] } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function useCatalogos(empresaId: string | null) {
  const [crudo, setCrudo] = useState(() => leerCache())
  const [loading, setLoading] = useState(!crudo)

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

      const siguiente = { items: items.data ?? [], fotos: fotos.data ?? [] }
      setCrudo(siguiente)
      setLoading(false)
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(siguiente))
      } catch {
        // cuota llena: no es crítico
      }
    }

    void cargar()
  }, [empresaId])

  const catalogos = useMemo(
    () => (crudo ? partir(crudo.items, crudo.fotos) : null),
    [crudo],
  )

  return { catalogos, loading }
}
