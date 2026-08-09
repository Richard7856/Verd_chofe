import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { EstadoItem } from './database.types'

/**
 * Almacenamiento local. La app tiene que funcionar completa sin señal:
 * el chofer llena el check list en el patio (donde casi nunca hay datos)
 * y la sincronización ocurre cuando vuelve la conexión.
 *
 * El check list se parte en dos momentos del turno:
 *
 *   apertura → entrada, condiciones y fotos. Se hace temprano y deja el
 *              turno abierto (`estado = 'en_progreso'` en la base).
 *   cierre   → salida, resumen y firma. Se hace al terminar y lo pasa a
 *              `completado`.
 *
 * Entre una y otra el borrador sigue vivo acá, porque el cierre necesita los
 * datos de la apertura para el resumen.
 */

export type DraftKind = 'checklist' | 'fuel'
export type ChecklistFase = 'apertura' | 'cierre'

export interface ChecklistDraft {
  clientUuid: string
  kind: 'checklist'
  fase: ChecklistFase
  step: number
  /** id en `checklists_unidad`, disponible recién cuando la apertura sincroniza */
  remoteId: string | null
  /** true cuando la apertura ya subió: el cierre no vuelve a mandar fotos */
  aperturaEnviada: boolean
  vehicleId: string | null
  depotId: string | null
  checklistDate: string
  entryAt: string | null
  odometerStart: number | null
  entryLat: number | null
  entryLng: number | null
  exitAt: string | null
  odometerEnd: number | null
  exitLat: number | null
  exitLng: number | null
  shiftLabel: string | null
  observations: string | null
  /**
   * `label` se guarda junto al estado para congelar el texto del ítem tal como
   * lo vio el chofer: el catálogo puede editarse después y el registro
   * histórico tiene que seguir diciendo lo que decía al firmarse.
   */
  items: Record<string, { status: EstadoItem; note?: string; label?: string }>
  signature: Blob | null
  signedAt: string | null
  updatedAt: number
}

export interface FuelDraft {
  clientUuid: string
  kind: 'fuel'
  step: number
  vehicleId: string | null
  /** turno al que se carga el gasto, si hay uno abierto */
  checklistId: string | null
  loadedOn: string
  stationName: string | null
  liters: number | null
  pricePerLiter: number | null
  totalAmount: number | null
  odometer: number | null
  folio: string | null
  lat: number | null
  lng: number | null
  updatedAt: number
}

export type Draft = ChecklistDraft | FuelDraft

export interface StoredPhoto {
  /** `${clientUuid}:${slotCode}` — un slot, una foto */
  key: string
  clientUuid: string
  slotCode: string
  label: string
  blob: Blob
  takenAt: string
  lat: number | null
  lng: number | null
}

export type OutboxStatus = 'pending' | 'syncing' | 'failed'
export type OutboxKind = 'checklist_apertura' | 'checklist_cierre' | 'fuel'

export interface OutboxEntry {
  /** `${clientUuid}:${kind}` — apertura y cierre conviven en la cola */
  id: string
  clientUuid: string
  kind: OutboxKind
  status: OutboxStatus
  attempts: number
  lastError: string | null
  queuedAt: number
  lastAttemptAt: number | null
}

interface ChoferesDB extends DBSchema {
  drafts: { key: string; value: Draft }
  photos: { key: string; value: StoredPhoto; indexes: { byDraft: string } }
  outbox: { key: string; value: OutboxEntry; indexes: { byStatus: OutboxStatus } }
}

let dbPromise: Promise<IDBPDatabase<ChoferesDB>> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB<ChoferesDB>('verdfrut-choferes', 2, {
      upgrade(database, oldVersion) {
        // v1 guardaba el check list como un solo envío. Los borradores viejos
        // no tienen `fase` ni `remoteId`, así que se descartan en vez de
        // migrarlos: son de la etapa de pruebas y no hay datos que perder.
        if (oldVersion > 0) {
          for (const name of ['drafts', 'photos', 'outbox'] as const) {
            if (database.objectStoreNames.contains(name)) database.deleteObjectStore(name)
          }
        }

        database.createObjectStore('drafts', { keyPath: 'clientUuid' })

        const photos = database.createObjectStore('photos', { keyPath: 'key' })
        photos.createIndex('byDraft', 'clientUuid')

        const outbox = database.createObjectStore('outbox', { keyPath: 'id' })
        outbox.createIndex('byStatus', 'status')
      },
    })
  }
  return dbPromise
}

// ------------------------------------------------------------- drafts

export async function saveDraft(draft: Draft) {
  const d = await db()
  await d.put('drafts', { ...draft, updatedAt: Date.now() })
}

export async function getDraft(clientUuid: string) {
  return (await db()).get('drafts', clientUuid)
}

export async function getActiveDraft(kind: DraftKind): Promise<Draft | undefined> {
  const all = await (await db()).getAll('drafts')
  return all.filter((d) => d.kind === kind).sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

/** El check list en curso, sin importar en qué fase esté. */
export async function getChecklistDraft(): Promise<ChecklistDraft | undefined> {
  const found = await getActiveDraft('checklist')
  return found?.kind === 'checklist' ? found : undefined
}

export async function deleteDraft(clientUuid: string) {
  const d = await db()
  const tx = d.transaction(['drafts', 'photos'], 'readwrite')
  await tx.objectStore('drafts').delete(clientUuid)

  const index = tx.objectStore('photos').index('byDraft')
  for await (const cursor of index.iterate(clientUuid)) {
    await cursor.delete()
  }
  await tx.done
}

// ------------------------------------------------------------- fotos

export async function savePhoto(photo: StoredPhoto) {
  await (await db()).put('photos', photo)
}

export async function getPhotos(clientUuid: string) {
  return (await db()).getAllFromIndex('photos', 'byDraft', clientUuid)
}

export async function deletePhoto(key: string) {
  await (await db()).delete('photos', key)
}

/** Tras subir la apertura, las fotos ya viven en Storage: liberan espacio. */
export async function deletePhotosOf(clientUuid: string) {
  const d = await db()
  const tx = d.transaction('photos', 'readwrite')
  const index = tx.store.index('byDraft')
  for await (const cursor of index.iterate(clientUuid)) {
    await cursor.delete()
  }
  await tx.done
}

// ------------------------------------------------------------- outbox

const outboxId = (clientUuid: string, kind: OutboxKind) => `${clientUuid}:${kind}`

export async function enqueue(clientUuid: string, kind: OutboxKind) {
  await (await db()).put('outbox', {
    id: outboxId(clientUuid, kind),
    clientUuid,
    kind,
    status: 'pending',
    attempts: 0,
    lastError: null,
    queuedAt: Date.now(),
    lastAttemptAt: null,
  })
}

export async function getOutbox(): Promise<OutboxEntry[]> {
  return (await db()).getAll('outbox')
}

export async function getPendingCount() {
  const entries = await getOutbox()
  return entries.filter((e) => e.status !== 'syncing').length
}

export async function markOutbox(id: string, patch: Partial<OutboxEntry>) {
  const d = await db()
  const existing = await d.get('outbox', id)
  if (!existing) return
  await d.put('outbox', { ...existing, ...patch, lastAttemptAt: Date.now() })
}

export async function dequeue(id: string) {
  await (await db()).delete('outbox', id)
}

// ------------------------------------------------------------- utils

export function newClientUuid() {
  return crypto.randomUUID()
}
