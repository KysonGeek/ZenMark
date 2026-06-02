# Wiki Tree — Hierarchical Pages for md.qixin.ch

**Status:** Draft 2026-06-02
**Owner:** chenqixin.life@gmail.com

## 1. Goal & Scope

Evolve the current flat-list markdown editor into a **simplified enterprise wiki**:
pages can be nested into a tree, like Obsidian's file tree and Confluence's page
hierarchy. Storage stays **purely local (IndexedDB), single-user** — this issue
only restructures the existing flat document list into a hierarchy and rebuilds
the sidebar as a tree.

### Hierarchy model: Confluence-style "page = node"

There is **one** node type. Every node is a page that:

- has its own markdown content, and
- can have child pages.

There is **no** separate "folder" type. A page with children acts as a section;
a page without children is a leaf. This is the simplest model and matches
Confluence.

### In scope

- `parentId` + `order` on documents; IndexedDB migration.
- Tree-building in `useDocs`; create-as-child, cascade delete, move (reparent/reorder).
- Sidebar rebuilt as a recursive tree: expand/collapse, hover add-child / delete,
  double-click rename, **drag-and-drop** to reparent and reorder.
- Search switches the sidebar to a flat filtered list; clearing returns to the tree.

### Non-goals (explicitly deferred)

- **Internal links / wikilinks / backlinks** (`[[page]]`) — separate future issue;
  needs Milkdown parse/render changes, independent of the tree.
- Backend, sync, multi-user, accounts, real-time collaboration.
- A distinct folder type (we use page = node instead).
- Per-page permissions, history/versioning, comments.

All non-goals from the original spec (`2026-05-12-md-editor-design.md`) still hold.

## 2. Data Model

Extend the existing `Doc` interface in `src/lib/storage.ts`:

```ts
interface Doc {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
  titleOverridden?: boolean
  parentId: string | null   // NEW: parent page id; null = root level
  order: number             // NEW: position within its sibling group
}
```

- `parentId` references another `Doc.id`, or `null` for root-level pages.
- `order` is a non-negative integer that orders siblings (same `parentId`).
  Within any sibling group, `order` values are kept as a dense `0,1,2,…` sequence.
  Reordering renumbers the affected sibling group — trivial at single-user local
  scale, and avoids floating-point/fractional-index complexity.

### Migration (DB_VERSION 1 → 2)

In `openDB`'s `upgrade(db, oldVersion)`:

- For `oldVersion < 2`: open a `versionchange`-transaction cursor over all
  existing `documents`, sort by `updatedAt` descending (current default order),
  and write back each with `parentId = null` and `order = 0,1,2,…`.
- The `by-updatedAt` index is retained (still used by `listDocs`).

A page with a missing/dangling `parentId` (should not happen, but defensively)
is treated as root-level when building the tree.

## 3. Storage Layer (`src/lib/storage.ts`)

Existing functions (`listDocs`, `getDoc`, `putDoc`, `deleteDoc`,
`__resetDbForTests`) stay. Add:

- `getDescendantIds(id, allDocs?): string[]` — returns ids of the entire subtree
  **excluding** `id` itself (or a variant returning the full set including `id`;
  the cascade-delete caller uses id + descendants). Computed in-memory from the
  full doc list to avoid N queries.
- `moveDoc(id, newParentId, newOrder)` — sets `parentId`/`order` on the moved
  doc, then renumbers the target sibling group to a dense sequence. Pure storage
  write; cycle prevention is enforced by the caller (`useDocs`) which has the
  tree in memory.

Renumbering helper (internal): given a `parentId`, read all siblings, sort by
`order`, write back dense `0,1,2,…`.

## 4. `useDocs` Hook (`src/hooks/useDocs.ts`)

`docs` still returns the flat `Doc[]` (used by QuickOpen, Outline, word count,
search). Add a derived `tree` for the sidebar.

### Tree shape

```ts
interface TreeNode {
  doc: Doc
  children: TreeNode[]
}
```

Built in-memory: group by `parentId`, sort each group by `order`, recurse from
root (`parentId === null`). Memoized off the `docs` array.

### API changes

- `createDoc(content?, parentId = null)` — new optional `parentId`. New page's
  `order` = (max sibling order in that group) + 1. After create, the new page is
  active; the parent (if any) should be auto-expanded by the sidebar.
- `removeDoc(id)` — now **cascade-deletes the whole subtree** (the page + all
  descendants). Returns `{ docs: Doc[]; placeholderId: string | null }` where
  `docs` is the snapshot of every deleted doc (for whole-subtree Undo). The
  placeholder logic (spin up a blank page when the very last doc is deleted) is
  preserved.
- `restoreDoc(docs: Doc[])` — signature changes from a single doc to an **array**;
  re-inserts every doc in the snapshot with original ids/parentId/order/timestamps,
  then activates the originally-deleted root of the subtree.
- `moveDoc(id, newParentId, newOrder)` — guards against cycles (reject if
  `newParentId` is `id` or any descendant of `id`), then delegates to storage
  `moveDoc`, then refreshes. No-op if nothing changes.
- `renameDoc`, `saveDoc`, `importDoc` — unchanged. `importDoc` creates a
  root-level page (`parentId = null`).

## 5. Sidebar → Tree (`src/components/Sidebar.tsx` + new `TreeNode.tsx`)

### Rendering

- New recursive `TreeNode` component renders one `Doc` row plus its children.
- Each row: a disclosure triangle (only when the node has children; toggles
  expand/collapse), the title (indented by depth), and on hover a `+`
  (create child) and `×` (delete) button.
- Active page highlighted as today. Double-click title → inline rename (reuse
  existing edit-in-place logic, lifted into `TreeNode`).
- **Collapse state** persisted in `localStorage` (e.g. `markra.collapsed` =
  JSON array of collapsed ids). Default expanded.

### Create / delete affordances

- Top "+ New" button → `createDoc()` at root.
- Row `+` → `createDoc('# Untitled\n\n', node.id)`; auto-expand that node.
- Row `×` → cascade delete (drives the existing Undo toast; message reflects
  child count, e.g. `Deleted "X" and 3 sub-pages`).

### Drag-and-drop

Native HTML5 DnD (`draggable`, `dragstart`/`dragover`/`drop`/`dragend`).

- A row is split into three drop zones by cursor Y:
  - top third → insert as **sibling before** this node,
  - bottom third → insert as **sibling after** this node,
  - middle third → drop **into** this node as a child (appended to its children).
- Visual feedback: an insertion line for before/after; a highlight ring for
  "into". Maintain a small `dropTarget` state `{ id, position: 'before'|'after'|'into' }`.
- On drop, translate the target into `(newParentId, newOrder)` and call
  `moveDoc`. Computing `newOrder`: for before/after, it's the index among the
  target's siblings (renumber handles the rest); for into, it's end of the
  target's children.
- **Cycle guard:** `useDocs.moveDoc` rejects dropping a node onto itself or any
  of its descendants (also suppress the drop-target highlight in that case).

### Search

- When the search box is non-empty: render a **flat filtered list** of pages
  whose title matches (current behavior), ignoring the tree.
- When empty: render the tree.

## 6. Unchanged Surfaces

- `Editor` / `SourceEditor` (Crepe), view modes, themes, autosave, status bar,
  word count.
- `QuickOpen`, `Outline` — operate on the flat `docs` array; no change.
- `.md` drag-import → root-level page.
- `OnboardingCard`, toasts (Undo wiring extended for arrays).

## 7. Testing

- `storage.test.ts`: v1→v2 migration assigns `parentId=null` + dense `order`;
  `getDescendantIds` returns the full subtree; `moveDoc` reparents and renumbers
  siblings densely.
- `useDocs.test.ts`: `createDoc` under a parent appends with correct order;
  cascade `removeDoc` deletes the subtree and snapshot restores it; `moveDoc`
  rejects cycles (drop into own descendant) and updates parent/order otherwise.
- Existing tests (`deriveTitle`, `ioFile`, plus current `useDocs`/`storage`
  cases) continue to pass after the `Doc` shape change — update fixtures to
  include `parentId`/`order`.

## 8. Open Risks

- **Drag-and-drop UX** is the most intricate piece (drop-zone math, indicators,
  cycle guard). Keep the first implementation minimal (before/after/into +
  insertion line) and iterate.
- **Migration correctness** — guard with a focused test using a seeded v1 DB.
- Deep nesting indentation on narrow widths — acceptable for now (matches
  existing "usable on mobile, no special tuning" stance).
