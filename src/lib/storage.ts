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
}

interface MarkraDB extends DBSchema {
  documents: {
    key: string
    value: Doc
    indexes: { 'by-updatedAt': number }
  }
}

const DB_NAME = 'markra-web'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<MarkraDB>> | null = null

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<MarkraDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore('documents', { keyPath: 'id' })
        store.createIndex('by-updatedAt', 'updatedAt')
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
