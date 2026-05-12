# md.qixin.ch — Typora-style Web Markdown Editor

**Status:** Approved 2026-05-12
**Owner:** chenqixin.life@gmail.com

## 1. Goal & Scope

Build a single-page web app that provides a Typora-style WYSIWYG markdown editing experience. Serve it as static files from `/opt/app/md/dist` via Caddy at `md.qixin.ch`. All user data lives in the browser (IndexedDB). No backend, no auth, no AI, no sync.

This is inspired by [markra](https://github.com/murongg/markra) but does **not** fork or port it. markra is a Tauri desktop app under AGPL-3.0; we instead build a minimal SPA on top of the same underlying editor engine (Milkdown), avoiding the Tauri dependencies and AGPL obligations.

### Non-goals
- AI features
- Real filesystem access / sync
- Collaboration or sharing
- Multi-user accounts
- Mobile-optimized layout (must remain usable on mobile, but no special tuning)
- Image hosting (images embed as data URLs only)
- Plugin system

## 2. Stack

| Concern | Choice | Reason |
|---|---|---|
| Bundler | Vite | Fast, simple, matches markra precedent |
| UI | React 19 + TypeScript | Required by Milkdown React bindings; familiar |
| Editor engine | `@milkdown/crepe` | Milkdown's batteries-included preset; ships GFM, tables, math (KaTeX), code blocks (PrismJS), slash menu, and a Typora-like default theme |
| Storage | IndexedDB via `idb` library | Promise wrapper, tiny, well maintained |
| Settings | `localStorage` | Theme + last-opened doc id only |
| Styling | Plain CSS modules | Tailwind is overkill for a sidebar + status bar |
| Package manager | npm | Already available on host; no global install needed |
| State | `useState` / `useReducer` | No state library needed at this scope |

## 3. Features

### Editor (delegated to Crepe)
- Inline WYSIWYG rendering of: headings, paragraphs, lists, blockquotes, horizontal rules
- GFM: tables, task lists, strikethrough, autolinks
- Code blocks with PrismJS syntax highlighting
- Math expressions via KaTeX (`$inline$` and `$$block$$`)
- Image embedding (paste / drag-drop → stored inline as data URLs in markdown)
- Slash menu (`/` to insert blocks)
- Undo / redo

### App shell (built by us)
- **Sidebar** (toggleable, default visible on desktop, hidden on mobile)
  - "New document" button
  - Search box (filters by title, case-insensitive substring)
  - Document list, ordered by `updatedAt` desc
  - Active document highlighted
  - Hover button on a doc row: delete (with confirm). Renaming happens implicitly by editing the H1 inside the document — there is no separate rename action, since `title` is derived from content.
- **Editor pane**
  - Centered, max-width ~780px for readability
  - Holds the Milkdown Crepe instance for the active document
- **Status bar** (bottom)
  - Word count of current doc
  - "Saved Xs ago" indicator that updates live; switches to "Saving…" while a write is in flight
  - Theme toggle (light / dark)
  - Sidebar toggle hint

### Document I/O
- **Import:** drag-drop `.md` file onto the app, or "Import" button in the sidebar — creates a new document
- **Export:** "Export" button downloads current doc as `<title>.md`
- **No "export all as zip"** in v1 (would require an extra dep like `jszip`; defer)

### Keyboard shortcuts
| Combo | Action |
|---|---|
| `⌘N` / `Ctrl+N` | New document |
| `⌘S` / `Ctrl+S` | Export current as `.md` (intercept browser save) |
| `⌘K` / `Ctrl+K` | Focus search in sidebar |
| `⌘\` / `Ctrl+\` | Toggle sidebar |

## 4. Data Model

IndexedDB database `markra-web`, version `1`, single object store `documents` keyed by `id`:

```ts
type Doc = {
  id: string;          // crypto.randomUUID()
  title: string;       // derived from first H1 in content, falls back to "Untitled"
  content: string;     // raw markdown source
  createdAt: number;   // Date.now()
  updatedAt: number;   // Date.now()
};
```

**Title derivation:** on every save, parse content for the first `# ` heading and use its text as `title`. If none, `title = "Untitled"`. Truncate to 80 chars for display in the sidebar.

**Settings** in `localStorage`:
```
markra.theme           = "light" | "dark"
markra.lastOpenedDocId = string | null
markra.sidebarOpen     = "true" | "false"
```

## 5. UI Layout

```
┌──────────────┬─────────────────────────────────────────┐
│  Sidebar     │                                         │
│  ──────────  │              Editor pane                │
│ [+ New]      │      (Milkdown Crepe, max-width         │
│ [🔍 Search]  │       780px, centered, scrollable)      │
│              │                                         │
│ • Doc A      │                                         │
│ • Doc B  ◀   │                                         │
│ • Doc C      │                                         │
│   …          │                                         │
│              │                                         │
├──────────────┴─────────────────────────────────────────┤
│ 1,243 words · saved 2s ago         ☾  ⌘\ to hide       │
└────────────────────────────────────────────────────────┘
```

- Sidebar width: 260px fixed; collapses to 0 when toggled off
- Editor pane: flex-grow, vertical scrolling
- Status bar: fixed bottom, ~32px tall

## 6. File Structure

```
/opt/app/md/
├── docs/superpowers/specs/2026-05-12-md-editor-design.md   # this file
├── src/
│   ├── main.tsx                  # React entry, mounts <App />
│   ├── App.tsx                   # shell, active doc id + sidebar state
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   ├── Editor.tsx            # Milkdown Crepe wrapper, onChange callback
│   │   └── StatusBar.tsx
│   ├── lib/
│   │   ├── storage.ts            # idb CRUD: listDocs / getDoc / putDoc / deleteDoc
│   │   ├── ioFile.ts             # importMarkdownFile / downloadMarkdown
│   │   ├── theme.ts              # applyTheme, getStoredTheme
│   │   └── deriveTitle.ts        # first-H1 extraction
│   ├── hooks/
│   │   ├── useDocs.ts            # list + active doc state, exposes mutators
│   │   └── useShortcuts.ts       # global keyboard bindings
│   └── styles/
│       ├── app.css               # shell layout
│       ├── theme.css             # light/dark vars
│       └── editor-overrides.css  # tweaks on top of Crepe defaults
├── index.html
├── package.json
├── package-lock.json
├── vite.config.ts
├── tsconfig.json
└── dist/                          # built output (Caddy serves this)
```

## 7. Storage / Save Flow

1. On editor `onChange`, push the new content into a debounced save (500ms).
2. Debounced save derives title from content, calls `storage.putDoc({...doc, content, title, updatedAt: Date.now()})`.
3. Status bar listens to the save lifecycle (`pending → in-flight → done`) and updates the indicator.
4. On app start: read `markra.lastOpenedDocId`. If valid and exists, load it; else open the most recently updated doc; else create a new "Welcome" doc seeded with usage tips.

## 8. Build & Deploy

### Local build
```sh
cd /opt/app/md
npm install
npm run build   # → /opt/app/md/dist
```

### Caddy
Update `/etc/caddy/sites/md.qixin.ch.conf`:
```caddy
md.qixin.ch {
    root * /opt/app/md/dist
    encode gzip zstd
    try_files {path} /index.html
    file_server
}
```
Reload: `systemctl reload caddy`.

(`try_files` is belt-and-suspenders. v1 has no client-side routing, so it's not strictly required — but it costs nothing and keeps the door open for hash-or-path routes later.)

### Updating
Future deploys: `git pull && npm install && npm run build`. No service to restart (Caddy reads the new files immediately).

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Browser storage quota exhaustion | Catch IndexedDB write errors, surface toast "Storage full — export and delete old docs". |
| No backup story | Manual `.md` export per doc. Note this in a first-run "Welcome" doc. |
| Single browser / single profile silo | Documented as a known limitation in the Welcome doc. |
| Large pasted images bloat storage | Out of scope for v1; users can delete docs. Document in Welcome. |
| Crepe theme ≠ Typora pixel-for-pixel | `editor-overrides.css` is the seam for future tweaks; v1 ships Crepe defaults. |

## 10. Acceptance Criteria

A reasonable user can, in a fresh Chrome browser at `md.qixin.ch`:
1. See a Welcome document already loaded.
2. Create a new document via the sidebar button or `⌘N`.
3. Type markdown and see it rendered inline (a `# heading` becomes a styled heading, etc.).
4. Reload the page and find their document still there with content intact.
5. Switch between documents by clicking in the sidebar.
6. Delete a document.
7. Import a local `.md` file via drag-drop.
8. Export the current document as `.md`.
9. Toggle between light and dark themes, and have the choice persist across reloads.
10. Toggle the sidebar via `⌘\`.

The site loads (first paint) in under 2 seconds on a typical broadband connection.
