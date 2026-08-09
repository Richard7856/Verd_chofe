import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { EstadoItem } from './database.types'

/**
 * Almacenamiento local. La app tiene que funcionar completa sin señal:
 * el chofer llena el check list en el patio (donde casi nunca hay datos)
 * y la sincronización ocurre cuando vuelve la conexión.
 *
 * Las fotos se guardan como Blob acá y sólo se suben al confirmar el envío.
 */

export type DraftKind = 'checklist' | 'fuel'

export interface ChecklistDraft {
  clientUuid: string
  kind: 'checklist'
  step: number
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

export interface OutboxEntry {
  clientUuid: string
  kind: DraftKind
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
    dbPromise = openDB<ChoferesDB>('verdfrut-choferes', 1, {
      upgrade(database) {
        database.createObjectStore('drafts', { keyPath: 'clientUuid' })

        const photos = database.createObjectStore('photos', { keyPath: 'key' })
        photos.createIndex('byDraft', 'clientUuid')

        const outbox = database.createObjectStore('outbox', { keyPath: 'clientUuid' })
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
  return all
    .filter((d) => d.kind === kind)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
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

// ------------------------------------------------------------- outbox

export async function enqueue(clientUuid: string, kind: DraftKind) {
  await (await db()).put('outbox', {
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

export async function markOutbox(clientUuid: string, patch: Partial<OutboxEntry>) {
  const d = await db()
  const existing = await d.get('outbox', clientUuid)
  if (!existing) return
  await d.put('outbox', { ...existing, ...patch, lastAttemptAt: Date.now() })
}

export async function dequeue(clientUuid: string) {
  await (await db()).delete('outbox', clientUuid)
}

// ------------------------------------------------------------- utils

export function newClientUuid() {
  return crypto.randomUUID()
}
