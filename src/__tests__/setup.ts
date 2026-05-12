import 'fake-indexeddb/auto'
import { afterEach } from 'vitest'
import { __resetDbForTests } from '../lib/storage'

afterEach(async () => {
  // Close any open connection first so deleteDatabase isn't blocked.
  await __resetDbForTests()
  const { indexedDB } = globalThis
  const dbs = await indexedDB.databases()
  await Promise.all(
    dbs.map((db) => new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(db.name!)
      req.onsuccess = () => resolve()
      req.onerror = () => resolve()
      req.onblocked = () => resolve()
    })),
  )
})
