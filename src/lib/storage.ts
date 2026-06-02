import { type DBSchema, type IDBPDatabase, openDB } from 'idb'

export interface Doc {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
  // Set when the user has manually renamed the doc. While true, subsequent
  // content edits must not overwrite `title` with `deriveTitle(content)`.
  // Undefined / false = title is auto-derived from the first H1.
  titleOverridden?: boolean
  // Parent page id; null = root level. Adjacency-list hierarchy.
  parentId: string | null
  // Position within the sibling group (same parentId). Kept dense (0,1,2,…).
  order: number
}

interface MarkraDB extends DBSchema {
  documents: {
    key: string
    value: Doc
    indexes: { 'by-updatedAt': number }
  }
}

export const DB_NAME = 'markra-web'
const DB_VERSION = 2

let dbPromise: Promise<IDBPDatabase<MarkraDB>> | null = null

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<MarkraDB>(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const store = db.createObjectStore('documents', { keyPath: 'id' })
          store.createIndex('by-updatedAt', 'updatedAt')
        }
        if (oldVersion < 2) {
          // Backfill parentId/order onto pre-hierarchy docs. Preserve the old
          // default ordering (updatedAt desc) as the initial root order.
          const store = tx.objectStore('documents')
          const all = await store.getAll()
          all.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
          let i = 0
          for (const doc of all) {
            await store.put({ ...doc, parentId: null, order: i++ })
          }
        }
      },
    })
  }
  return dbPromise
}

// Exposed for tests to reset between cases.
export async function __resetDbForTests() {
  if (dbPromise) {
    try {
      const db = await dbPromise
      db.close()
    } catch {
      // ignore — db may have failed to open
    }
  }
  dbPromise = null
}

export async function listDocs(): Promise<Doc[]> {
  const db = await getDb()
  const all = await db.getAll('documents')
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getDoc(id: string): Promise<Doc | undefined> {
  const db = await getDb()
  return db.get('documents', id)
}

export async function putDoc(doc: Doc): Promise<void> {
  const db = await getDb()
  await db.put('documents', doc)
}

export async function deleteDoc(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('documents', id)
}

// Renumber a sibling group to a dense 0,1,2,… sequence (sorted by current
// order). Keeps fractional insertion orders from accumulating.
async function renumberSiblings(
  db: IDBPDatabase<MarkraDB>,
  parentId: string | null,
): Promise<void> {
  const all = await db.getAll('documents')
  const siblings = all
    .filter((d) => d.parentId === parentId)
    .sort((a, b) => a.order - b.order)
  for (let i = 0; i < siblings.length; i++) {
    if (siblings[i].order !== i) {
      await db.put('documents', { ...siblings[i], order: i })
    }
  }
}

// Move a doc to a new parent/order. `newOrder` may be fractional; the target
// sibling group is renumbered to dense integers afterwards. Does NOT bump
// updatedAt — moves should not disturb recency-based lists.
export async function moveDoc(
  id: string,
  newParentId: string | null,
  newOrder: number,
): Promise<void> {
  const db = await getDb()
  const doc = await db.get('documents', id)
  if (!doc) return
  await db.put('documents', { ...doc, parentId: newParentId, order: newOrder })
  await renumberSiblings(db, newParentId)
}
