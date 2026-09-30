# Changelog

Changes made with Claude Code. Times are local (EDT). They come from file modification times and
session logs, so they're accurate to within a few minutes; one entry notes where the exact time wasn't recorded.

---

## 2026-09-30

### 02:02 — Designs saved to Redis, kept for good, editable by anyone with the code
- `server/handoff-store.js`: designs stored per code (`mozu:design:CODE`, no expiry); `keep(code)` makes a scan
  permanent (a scan whose `expiresAt` is null never expires). Both stores (memory and Redis).
- `server/handoff-api.js`, `server/server.js`, `api/design.js` (new): `GET /api/design?code=` loads the design,
  `PUT` saves `{ items }`. Anyone with the code can save, several at once; each save replaces the design (the
  latest wins) and bumps its version. Saving keeps the code for good. A separate `edits` rate limit (1200 per 10 min).
- Configurator: `components/useDesignSync.ts` (new) saves each change ~0.7 s after it's made, picks up others'
  saves every 4 s when it has no unsaved changes of its own, and sends a pending change when the tab closes.
  Samples and files get **Save & get a code**. A status line shows Saved / Saving… / why not.
- Tests: 8 new (store: designs never expire, unsaved codes still do; API: shared saving, permanence, bad requests,
  the Vercel function).
- (An edit lock allowing one editor at a time was built first, then removed at the user's request.)

### 01:45 — The configurator replaces the old prototype as the site
- Removed `apps/web/index.html` (the packed prototype) and `apps/web/scan-import.js`.
- `apps/configurator` is built as a static site (`npm run export`, `MOZU_STATIC_EXPORT=1`) and `scripts/build-web.js`
  puts it in `public/`, which Vercel serves and `npm start` serves locally. Vercel settings, `api/*.js`, Redis and
  the `/scan` redirects are unchanged; the page calls `/api/scan-handoff` on its own site.
- The configurator's server routes are gone (a static site can't have them): samples are plain files
  (`scripts/copy-samples.mjs` → `public/samples/`); `next dev` proxies `/api` and `/scan` to the local server instead.
  It now also opens the phone's "Open on this device" links (`?poly=…&scan=…`).
- `npm start` builds, then serves; `npm run serve` serves without rebuilding. `server/server.js` serves `public/`
  and says so when it hasn't been built.
- CI: the site build moved to the job that installs dependencies. `.vercelignore`: the configurator (and the SDK's
  source it builds from) now go to Vercel.
- `README.md` rewritten for the configurator; server tests updated (36 in all).

## 2026-09-29

### 15:02 — "Build house" sends the whole home (mozu.homescan/1)
- iPad (`apps/ios/MozuScanner`): `Models/RoomScan.swift` adds room `id`/`name`/`type` and a `HomeScan` type;
  `Scan/RoomCaptureController.swift`: each saved room gets a UUID and "Room n", and `buildHouse()` wraps all
  `savedScans` as one `HomeScan` (`house`); `Export/Handoff.swift`: `ScanHandoff.send` takes a room or a home;
  `Views/HouseResultView.swift`: **Send house to MOZU web**, Share house, Advanced address, and the code card
  (`HandoffTicketView`, now shared with the single-room screen); `Views/ContentView.swift` passes the house.
  Syntax-checked only; needs an Xcode build.
- Handoff server (`server/handoff-api.js`): accepts `mozu.homescan/1` uploads, validated room by room with the
  SDK's `parseHomeScan`; a home with a broken room is kept with `warnings` in the reply; one with no usable room
  is refused. Single-room uploads are unchanged. 2 new server tests.
- Prototype (`apps/web/scan-import.js`): given a home, uses its kitchen (or its only room), otherwise explains.
- Viewer (`apps/configurator/lib/home.ts`): a home without `connections` (the iPad doesn't send them) gets them
  from `findConnections`. 1 new test.
- `README.md`: how to send a whole home.

### 14:52 — Configurator: one item class, free placement, edit menu on the item, swapping
- Cabinets and scanned furniture are now one kind of thing (`Item`, `apps/configurator/lib/items.ts`): all can be
  added from the library (new Furniture group), removed, moved, rotated and given a colour/texture per part.
  Scanned furniture is drawn as real shapes (bed, sofa, table, desk, chair, storage, TV, appliance;
  `lib/furnitureMesh.ts`) instead of boxes, with beds, sofas and storage turned back-to-wall.
- Placement is free on the floor, no longer tied to walls; released parallel and within 12 cm of a wall an item
  snaps flush. Dropped on another item, the two swap places (each settling into the nearest spot it fits).
- The edit menu floats above the selected item and follows it: rotate clockwise (↻, R; Shift for 15°), colour &
  texture per part, remove (or Delete), close (or Esc). `components/ItemToolbar.tsx` (new),
  `components/ItemPanel.tsx` (replaces ModulePanel), `components/Viewer.tsx` (rewritten), `lib/itemMesh.ts` (new).
- Removed: `lib/furniture.ts`, `components/ModulePanel.tsx`, `ModuleInspector.tsx`, `ObjectInspector.tsx`,
  `test/furniture.test.ts`. New `test/items.test.ts` (10 tests).

### 13:53 — Configurator: move and turn the furniture from the scan
- Beds, storage, tables and other scanned furniture can be dragged freely around the floor, staying inside the room
  and clear of other furniture, cabinets, door swings and windows at their height; pushed into something they
  slide along it. Rotate 90° (or R), and "Put back where scanned". Cabinet placement respects moved furniture.
- `apps/configurator/lib/furniture.ts` (new): moves kept beside the scan (never changing it); `objectFits`.
  `lib/placement.ts`: `outlineFits`. `lib/scene.ts`: scanned objects tagged for picking; `positionObject`.
- `components/ObjectInspector.tsx` (new), `components/Viewer.tsx`: one selection (a module or a piece of
  furniture), free drag for furniture, rotate/reset.
- `apps/configurator/test/furniture.test.ts` (new): 6 tests.

### 13:49 — CI checks the viewer and the SDK source
- `.github/workflows/test.yml`: new `viewer` job: `npm ci`, fails if `packages/scan-sdk/dist` doesn't match its
  source, type-checks the SDK, runs the viewer's tests and production build. The existing `test` job is unchanged.
- `apps/configurator/test/` (new): 14 tests for walls, placement (incl. door swings, windows, dragging) and loading.
  `npm run test:viewer` from the root.
- Root `package.json`: `npm test` now runs `test/**/*.test.js` only; newer Node 22 also collects `.ts` tests
  and would have run the viewer's tests without the TypeScript loader.
- `packages/scan-sdk`: `@types/node` added to its own dev dependencies (its type-check relied on the viewer's).

### 13:32 — Configurator: drag modules, module pictures, redesigned modules UI
- Drag a module in the 3D view: it slides along the nearest wall (or into another visible room), snapping to the
  closest position where it fits; if nothing fits nearby it goes back when released. Picking in 3D now ignores
  outline lines (Three.js treats a ray within a metre of a line as a hit, which selected the wrong module).
  Delete removes the selected module, Escape deselects.
- `apps/configurator/lib/thumbnails.ts` (new): a picture of each module, rendered with the same 3D builder
  (one shared off-screen renderer); placed modules' pictures show their current finish.
- `apps/configurator/lib/placement.ts`: `wallsByDistance` and `nearestFit` for dragging.
- `apps/configurator/components/ModulePanel.tsx` (rewritten), `ModuleInspector.tsx` (new), `app/globals.css`:
  group tabs and a grid of picture cards; placed list with pictures; a finish editor that opens at the bottom
  when a module is selected (doors & drawers / carcass, one swatch family at a time, custom colour, texture and
  sheen). 3D labels no longer draw over the panels.

### 13:05 — Configurator: sample modules with changeable colour and texture
- `apps/configurator/lib/modules.ts` (new): 15 sample modules in 5 groups (Kitchen base, Kitchen wall, Kitchen
  tall, Wardrobes, Living & storage), standard sizes, described as data.
- `apps/configurator/lib/moduleMesh.ts` (new): builds a module in code: carcass boards, recessed plinth, doors,
  drawers, appliance panel or open shelves, bar handles; separate finishes for fronts and carcass.
- `apps/configurator/lib/finishes.ts` (new): MOZU's 48 surface finishes (names and colours from the iPad
  catalogue), plus custom colour, texture (smooth, wood grain, fabric, leather) and sheen (matte, satin, gloss,
  metallic). Textures are generated patterns tinted by the colour; the real MOZU texture scans aren't in the repo.
- `apps/configurator/lib/placement.ts` (new): puts a module against the first free stretch of wall, clear of doors
  and their swing, archways, windows at its height, scanned furniture and other modules, and inside the room.
- `apps/configurator/components/ModulePanel.tsx` (new), `Viewer.tsx`, `lib/scene.ts`, `app/globals.css`: module
  library panel, placed list with remove, click-to-select in 3D, finish editor for doors & drawers and carcass,
  "Use on all modules". Placed modules are not saved.

### 12:01 — SDK: room labels kept, home scans parsed, shared walls and doors linked
- `packages/scan-sdk/src/serialize.ts`: `parseScan` keeps room `id`, `name`, `type`. New `parseHomeScan`
  (reads `mozu.homescan/1`, or a single `mozu.roomscan/1` as a one-room home; returns `{ home, warnings }`,
  leaving out and explaining bad rooms and bad connections) and `serializeHomeScan`.
- `packages/scan-sdk/src/types.ts`: optional `connections` on `HomeScan`: `opening` records (the same door in
  two rooms) and `wall` records (the two faces of one wall), pointing at rooms by `id`.
- `packages/scan-sdk/src/links.ts` (new): `findConnections(rooms)` works the connections out from geometry
  (parallel walls facing away from each other, within a wall's thickness, overlapping; same-type openings
  overlapping by half their width). SDK `dist/` rebuilt.
- `samples/twobedroom.roomscan.json`: the five connections (3 shared walls, 2 shared doors).
- `test/scan-sdk-home.test.js` (new): 12 tests; runs with `npm test` and in CI.
- `apps/configurator/lib/home.ts`: loads through `parseHomeScan`; no longer reads labels from the raw JSON.

### 11:54 — Viewer loads scans from the phone by code
- `apps/configurator/app/api/scan-handoff/route.ts`: new route that fetches a scan by code from the handoff
  API (`MOZU_HANDOFF_URL`, default `http://localhost:3000`). Server-side, so no CORS; passes the visitor's
  address on so the handoff API's per-network rate limit still applies per person; 502 with a clear message
  when the handoff service can't be reached.
- `apps/configurator/app/scan/[code]/page.tsx`: `/scan/B7K4M2` opens that code in the viewer.
- `apps/configurator/components/Viewer.tsx`, `app/globals.css`: "Code from the phone" box; `?code=` in the
  address opens that scan on load.
- `README.md`: how to load codes, and how to point the viewer at the Vercel deploy.

### 11:43 — 3D viewer for scans (`apps/configurator`)
- New Next.js + TypeScript + Three.js app at `apps/configurator`: loads a scan through `@mozu/scan-sdk` and
  renders every room at its real position: polygon floors (any shape), one wall per edge with doors, windows
  and archways cut in, fixtures as labelled markers at their height, objects as boxes lifted by elevation.
  Room menu to isolate a room, ceiling toggle, orbit camera that frames the scene. Viewer only.
- Root `package.json`: npm workspaces (`packages/scan-sdk`, `apps/configurator`) and `npm run viewer`.
  New root `package-lock.json`.
- `.vercelignore`: `apps/configurator` is not uploaded, so the handoff deploy doesn't install Next.js.
- `.gitignore`: `.next/`, `next-env.d.ts`, `*.tsbuildinfo`.

### 11:34 — Multi-room format and two-bedroom fixture
- `packages/scan-sdk/src/types.ts`: new `HomeScan` (`mozu.homescan/1`: `{ schema, rooms: RoomScan[], capturedAt }`)
  and optional `id`, `name`, `type` on `RoomScan`. SDK `dist/` rebuilt.
- `samples/twobedroom.roomscan.json`: wrapped in `mozu.homescan/1`; field names fixed to the real format
  (`{x, z}` points, `type`, `offset`, `unitSystem: "metric"`, `source: "manual"`); Bedroom A door offset 1150 and
  Bedroom B door offset 750 so both line up with the hallway doors; shelf moved against the wall; both beds
  moved clear of the door swings (Bedroom A's bed is now a 1400 mm double; a 1600 mm bed can't clear both the
  door and the wardrobe in that room).

## 2026-09-25

### 17:18 — Merged colleague's Vercel hosting (origin/main) with local work
- Brought local `main` up to `origin/main` (3 commits: Vercel hosting with Redis-backed codes, sample room on
  non-LiDAR phones, in-page confirm box). Local work stays uncommitted on top.
- Conflicts resolved:
  - `server/server.js`: kept the colleague's version (scan handling moved into `server/handoff-api.js`), and
    applied the socket-workaround removal in `server/handoff-api.js` instead.
  - `README.md`: kept the colleague's wording, replaced the outdated "SDK drops fixtures" note with the SDK notes.
- `apps/web/scan-import.js` merged automatically (colleague's UI changes + local parsing changes).
- All 20 tests in `test/` pass.

### 14:30 — README updated for the SDK changes
- `README.md`: says the page and server now read sockets through the built SDK, explains how to rebuild it,
  and lists the new optional scan fields.
- Also fixed the 3D-markers note from 2026-09-24, which had been inserted in the middle of another sentence.

### 14:28 — Scan SDK: new optional fields, rebuilt
- `packages/scan-sdk/src/types.ts`: optional `wallIds` on `RoomScan`, `id` on openings/objects/fixtures,
  and `elevation` on objects.
- `packages/scan-sdk/src/serialize.ts`: `parseScan` now keeps `wallIds`, but only when no polygon corner was
  dropped (they are matched to edges by position).
- `packages/scan-sdk/dist/mozu-scan-sdk.js` and `dist/mozu-scan-sdk.global.js`: rebuilt from `src/`.
- Schema is still `mozu.roomscan/1`; older scans load unchanged.

### 14:25 — iPad app: object elevation and stable IDs
- `apps/ios/MozuScanner/Models/RoomScan.swift`: optional `wallIds`, `id` on openings/objects/fixtures, and
  `elevation` on objects. Fixture IDs are generated by the app, since RoomPlan has no fixtures.
- `apps/ios/MozuScanner/Scan/FloorplanBuilder.swift`: fills those fields in. Each polygon edge is matched to
  the roughly parallel RoomPlan wall its midpoint lies on (within 30 cm), or `nil`. Object elevation is its
  bottom height above the floor.
- Scan confidence is still a hard-coded 0.92; there's a `TODO` in `FloorplanBuilder.swift`.
- Syntax-checked only: not yet compiled (this Mac's Swift toolchain is broken). Needs an Xcode build.

### 14:24 — Removed the socket workarounds (after verifying the rebuilt SDK)
- `apps/web/scan-import.js` and `server/server.js`: no longer copy `fixtures` from the raw JSON over the SDK's
  result; both now get sockets from the SDK. Their "SDK failed to load" fallback parsers fill in `fixtures`
  themselves.

### 14:24 — Scan SDK rebuilt so `dist/` matches `src/`
- `packages/scan-sdk/dist/*`: rebuilt with `npm ci && npm run build`. The old build dropped `fixtures`
  (sockets) when parsing a scan.

### 14:23 — iPad app: window sill heights measured from the floor
- `apps/ios/MozuScanner/Scan/FloorplanBuilder.swift`: `mapOpenings` now takes the floor level and subtracts
  it. Sills were measured from where the AR session started (about chest height), so they were usually wrong
  or clamped to 0.

---

## 2026-09-24

### Before 19:18 (exact time not recorded) — Added `.gitignore`
- `.gitignore`: macOS files, `node_modules/`, `.env` files, logs, and Xcode's generated project and build
  output. It was later edited by hand (19:21).

### ~19:18 — Checked the iPad → website format (no files changed)
- Compared the iPad's scan format with what the server and website read, and ran a realistic iPad-style scan
  through the server and converter. Everything matched.

### ~18:35 — 3D view: markers for doors, windows and sockets
- `apps/web/scan-import.js`: adds its own markers to the prototype's 3D scene: green frames for doors, blue
  frames for windows, small coloured squares for sockets and other service points, each at the right wall
  and height. `apps/web/index.html` (the packed prototype) was not changed.
- `README.md`: described the 3D markers.
