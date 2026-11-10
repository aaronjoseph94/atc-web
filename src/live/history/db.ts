/**
 * IndexedDB storage for the transcript history and the retained call audio.
 *
 * Everything here is best effort: private windows, blocked storage and test
 * environments have no IndexedDB (or one that throws), and the history then
 * simply lasts as long as the page.
 */

const DB_NAME = 'atc-history'
const VERSION = 1
export const STORE = { entries: 'entries', clips: 'clips' } as const

let opening: Promise<IDBDatabase | null> | null = null

export function openDb(): Promise<IDBDatabase | null> {
  if (opening) return opening
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE.entries)) {
          const s = db.createObjectStore(STORE.entries, { keyPath: 'id' })
          s.createIndex('airport', 'airport')
          s.createIndex('at', 'at')
        }
        if (!db.objectStoreNames.contains(STORE.clips)) {
          const s = db.createObjectStore(STORE.clips, { keyPath: 'id' })
          s.createIndex('at', 'start')
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opening
}

function done(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true)
    tx.onerror = () => resolve(false)
    tx.onabort = () => resolve(false)
  })
}

/** Write (or replace) records. */
export async function putAll<T>(store: string, items: T[]): Promise<void> {
  if (!items.length) return
  const db = await openDb()
  if (!db) return
  try {
    const tx = db.transaction(store, 'readwrite')
    const s = tx.objectStore(store)
    for (const it of items) s.put(it)
    await done(tx)
  } catch {
    // Quota or a closed connection: the history is a nicety, carry on without it.
  }
}

/** Every record whose index value equals `value`. */
export async function getByIndex<T>(store: string, index: string, value: IDBValidKey | IDBKeyRange): Promise<T[]> {
  const db = await openDb()
  if (!db) return []
  try {
    const tx = db.transaction(store, 'readonly')
    const req = tx.objectStore(store).index(index).getAll(value)
    return await new Promise<T[]>((resolve) => {
      req.onsuccess = () => resolve(req.result as T[])
      req.onerror = () => resolve([])
    })
  } catch {
    return []
  }
}

export async function getOne<T>(store: string, id: string): Promise<T | null> {
  const db = await openDb()
  if (!db) return null
  try {
    const req = db.transaction(store, 'readonly').objectStore(store).get(id)
    return await new Promise<T | null>((resolve) => {
      req.onsuccess = () => resolve((req.result as T) ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

/**
 * Drop records older than `minAt` (by the `at` index), then the oldest beyond
 * `keep`. Keeps the store bounded however long the app is left open.
 */
export async function prune(store: string, minAt: number, keep: number): Promise<void> {
  const db = await openDb()
  if (!db) return
  try {
    const tx = db.transaction(store, 'readwrite')
    const index = tx.objectStore(store).index('at')
    const countReq = index.count()
    await new Promise<void>((resolve) => {
      countReq.onsuccess = () => resolve()
      countReq.onerror = () => resolve()
    })
    let excess = Math.max(0, (countReq.result ?? 0) - keep)
    // Oldest first: delete while too old or too many.
    const cursorReq = index.openCursor()
    cursorReq.onsuccess = () => {
      const c = cursorReq.result
      if (!c) return
      const at = c.key as number
      if (at < minAt || excess > 0) {
        c.delete()
        excess--
        c.continue()
      }
    }
    await done(tx)
  } catch {
    // Ignore: next prune will try again.
  }
}
