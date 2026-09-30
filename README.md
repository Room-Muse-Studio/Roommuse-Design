# MOZU Design

Scan a room with a LiDAR iPhone or iPad, then open it in the MOZU Kitchen Workflow prototype on any computer.

```
phone app ──scan──▶ MOZU web (Vercel) ──6-character code──▶ type it on the laptop ──▶ room appears in the prototype
```

## What's in this folder

| Folder / file | What it is |
|---|---|
| `apps/ios/` | The scanning app (Swift, RoomPlan + LiDAR, socket detection) |
| `apps/web/index.html` | The prototype, one packed file. The only addition is the scan import section at the very end. |
| `apps/web/scan-import.js` | Turns a room scan into the prototype's room format, and draws doors/sockets in 3D |
| `apps/configurator/` | RoomMuse configurator (Next.js + Three.js). For now a read-only 3D viewer for scans; see below |
| `packages/scan-sdk/` | The shared `mozu.roomscan/1` (one room) and `mozu.homescan/1` (several rooms) formats and floorplan engine |
| `server/handoff-store.js` | Codes: 6 characters, 24 hours, stored in Redis (production) or memory (laptop) |
| `server/handoff-api.js` | The handoff API, shared by the laptop server and Vercel |
| `server/server.js` | Laptop server (`npm start`) |
| `api/` | The same API as Vercel functions |
| `vercel.json`, `scripts/build-web.js` | Vercel build and routing |
| `test/` | `npm test` (also runs on every push, `.github/workflows/test.yml`); the viewer's own tests: `npm run test:viewer` |
| `samples/kitchen.roomscan.json` | A 4 m × 3 m kitchen with a door and two sockets, for testing |
| `samples/twobedroom.roomscan.json` | A two-bedroom flat (`mozu.homescan/1`): hallway, L-shaped bedroom, rectangular bedroom |

The handoff server and prototype have no npm dependencies. Node 20 or newer is needed to run them locally.
The viewer in `apps/configurator` does; see below.

## 3D viewer (apps/configurator)

```bash
cd ~/Projects/mozu-design
npm install        # once: installs the viewer and links packages/scan-sdk into it
npm run viewer     # http://localhost:3100
```

It opens `samples/twobedroom.roomscan.json`. Pick another sample, or open any `mozu.roomscan/1` or
`mozu.homescan/1` file with **File…**. Rooms render at their real positions; the **Rooms** menu isolates one,
and **Show ceilings** adds ceilings. Viewer only: no editing yet. It isn't deployed; Vercel skips
`apps/configurator` (`.vercelignore`).

**Scans from the phone:** type the 6-character code into **Code from the phone**, or open
`http://localhost:3100/scan/B7K4M2` (or `/?code=B7K4M2`). The viewer fetches it from the handoff API through its own
`/api/scan-handoff` route, so there are no cross-origin problems. By default that's the laptop server
(`npm start`, port 3000). To use the Vercel deploy instead, create `apps/configurator/.env.local` with:

```
MOZU_HANDOFF_URL=https://your-project.vercel.app
```

and restart `npm run viewer`. The phone's own **Open** link still goes to the prototype; point it at the viewer by
opening `/scan/<code>` on port 3100 instead.

---

## Production (Vercel)

### One-time setup

1. **Create the Vercel project.** Either import the GitHub repo in the Vercel dashboard (every push to `main`
   deploys), or from this folder:
   ```bash
   npm i -g vercel
   vercel login
   vercel link
   ```
   Framework preset: **Other**. The build settings come from `vercel.json`; leave them alone.
2. **Add the code store.** Vercel dashboard → the project → **Storage** → **Create** → **Upstash for Redis**
   (the free plan is enough) → connect it to the project for Production, Preview and Development. This sets
   `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Without them the API answers 503 instead of quietly
   losing codes.
3. **Deploy:** push to `main`, or run `vercel --prod`.
4. **Check it** (replace the address with yours):
   ```bash
   BASE=https://your-project.vercel.app
   curl -s $BASE/api/health; echo
   curl -s -X POST $BASE/api/scan-handoff -H 'content-type: application/json' \
     --data-binary @samples/kitchen.roomscan.json; echo
   ```
   Expect `{"ok":true,"store":"redis"}` and then `{"code":"B7K4M2","url":"https://…/scan/B7K4M2",…}`.
5. **Build the address into the app:** set `ScanHandoff.defaultWebBase` in
   `apps/ios/MozuScanner/Export/Handoff.swift` to the production address, then reinstall the app.

### Optional settings (Vercel → Settings → Environment Variables)

| Variable | Default | Meaning |
|---|---|---|
| `RATE_LIMIT_UPLOADS` | `20` | Scans one network may upload per 10 minutes (`0` = no limit) |
| `RATE_LIMIT_LOOKUPS` | `60` | Code lookups one network may make per 10 minutes, so codes can't be guessed |

---

## Install the app on your phone (development install)

You need a Mac with Xcode, an **iPhone 12 Pro or later Pro model** (or an iPad Pro with LiDAR) on iOS 17 or
later, a USB cable, and an Apple ID. A free Apple ID works, but the app then stops opening after 7 days;
plug in and press ⌘R again to refresh it.

1. Install **Xcode** from the Mac App Store, open it once and accept the licence, then:
   ```bash
   sudo xcode-select -s /Applications/Xcode.app
   brew install xcodegen
   ```
2. Add your Apple ID: **Xcode → Settings → Accounts → +**.
3. Generate and open the project:
   ```bash
   cd apps/ios
   xcodegen generate
   open MozuScanner.xcodeproj
   ```
   Re-run `xcodegen generate` whenever Swift files are added or removed.
4. **Signing:** click the blue **MozuScanner** project → target **MozuScanner** → **Signing & Capabilities** →
   tick **Automatically manage signing**, pick your **Team**, and set a unique bundle identifier
   (e.g. `com.yourname.mozuscanner`).
5. **Phone:** plug it in and tap **Trust**. Turn on **Settings → Privacy & Security → Developer Mode** and restart
   when asked (the option appears after the phone has been connected to Xcode once).
6. Pick your phone as the run destination and press **⌘R**. The first time, go to **Settings → General → VPN &
   Device Management**, trust your Apple ID, and press ⌘R again.

## Scan and send a room

1. On the phone: **Start scan**, walk slowly around the room pointing at every wall, the floor edges, doors,
   windows and sockets. Tap **Finish room**, then **Use this room**.
2. On the floorplan screen, tap **Send to MOZU web**. A 6-character code appears, e.g. `B7K4M2`.
3. On any computer, open the production address, type the code in the box at the top (upper or lower case,
   dashes and spaces are fine) and click **Load code**. If the kitchen already has cabinets you'll be asked
   before they're replaced.
4. The page reloads with your room and opens the Kitchen Workflow room setup. Width, depth, ceiling height,
   doors, windows and sockets are filled in. Choose each door's opening direction there (the scan can't tell
   which side the hinges are on). The workflow also lists the water, drainage and appliance power a kitchen needs;
   the scan can't see pipes, so mark those positions under **Connections and mobility**.

Codes last 24 hours. If a code has expired, tap **Send to MOZU web** again; you don't need to rescan.

**A whole home:** after each room tap **Scan next room** instead, and **Build house** after the last one. The house
screen's **Send house to MOZU web** uploads every room as one `mozu.homescan/1` under a single code, with the rooms
in their real positions. Open that code in the RoomMuse viewer (`apps/configurator`) to see the whole home. The
prototype page plans one room: given a home it uses its kitchen if it has exactly one, and otherwise explains.

---

## Local development

```bash
npm start          # http://localhost:3000, codes kept in memory
npm test           # store, API, rate limits, /scan links, Vercel functions
```

`npm start` uses Redis instead of memory if `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set (for example
after `vercel env pull .env`, then `set -a; . ./.env; set +a; npm start`).

Pretend to be the phone:
```bash
BASE=http://localhost:3000
CODE=$(curl -s -X POST $BASE/api/scan-handoff -H 'content-type: application/json' \
  --data-binary @samples/kitchen.roomscan.json | sed 's/.*"code":"\([^"]*\)".*/\1/')
echo "Your code is: $CODE"
```
Open http://localhost:3000, type the code and click **Load code**. The room is 4.00 × 3.00 m with a 2.50 m
ceiling, 1 door (green frame on the back wall) and 2 sockets (yellow squares: 1.1 m high on the back wall,
0.3 m on the right wall). You can also skip the code: **Load scan file** → `samples/kitchen.roomscan.json`.

To send from the phone to your laptop, the phone needs an HTTPS address for it. Run
`cloudflared tunnel --url http://localhost:3000` (`brew install cloudflared`), and put the address it prints into
the app's **Advanced → MOZU web address** field. **Reset** there returns to production.

---

## How the pieces fit together

- **The phone** sends the scan (`mozu.roomscan/1` JSON) to `POST /api/scan-handoff` and shows the `code` it
  gets back (`apps/ios/MozuScanner/Export/Handoff.swift`).
- **The server** checks the scan (at least 3 corners, 2 MB at most), keeps it under a random 6-character code
  for **24 hours**, and rate-limits each network. Codes use `23456789ABCDEFGHJKMNPQRSTVWXYZ` (no 0/O, 1/I/L or U).
  In production codes live in Redis, so every Vercel instance sees them and they survive redeploys. Codes are
  claimed with an atomic `SET NX`, so two uploads can never get the same code.
- **The page** fetches `GET /api/scan-handoff?code=…`, and `scan-import.js` translates the scan:

  | Scan | Prototype |
  |---|---|
  | `polygon` (corners) | room width × depth (a room at an angle is straightened; an L-shaped room uses its outer rectangle, with a warning) |
  | `height` | ceiling height |
  | `openings` | Kitchen Workflow doors and windows, on the back / left / right / front wall |
  | `objects` | "no-cabinet" obstacle areas |
  | `fixtures` sockets, switches, pipes, vents | Kitchen Workflow service points (fixed) |
  | `fixtures` radiators | obstacle areas |

  It saves the room through the prototype's own "saved project" slot and reloads the page, so the prototype
  itself is not patched. The previous saved project is kept under
  `mozu.prototype.kitchenWorkflow.project.v2.before-scan` in the browser's storage.
- **3D markers**: the prototype's 3D room only draws walls, so `scan-import.js` adds its own markers for doors,
  windows and service points. It reaches the scene through the page's React internals; if a future export of the
  prototype renames them, the markers stop appearing but the 2D room plan is unaffected.
- The page and the server both parse scans with the built SDK (`packages/scan-sdk/dist`), sockets included.
  After changing `packages/scan-sdk/src`, rebuild it: `cd packages/scan-sdk && npm ci && npm run build`.
- Scans may also carry optional `wallIds` (RoomPlan's wall UUIDs, one per polygon edge), `id` on openings,
  objects and fixtures, and `elevation` (bottom height above the floor) on objects. The schema is still
  `mozu.roomscan/1`; older scans without these fields load exactly as before.
- Several rooms travel together as `mozu.homescan/1` (`{ schema, rooms, capturedAt, connections? }`); read one with
  the SDK's `parseHomeScan`. `connections` records which doors and walls two rooms share (a door between two rooms
  is scanned once per room); `findConnections(rooms)` works them out from the rooms' geometry.

| Address | What it does |
|---|---|
| `/` | the prototype |
| `/?code=B7K4M2` or `/scan/B7K4M2` | opens the prototype and loads that code |
| `/scan?poly=…&h=…&scan=…` | the app's "Open in MOZU on this device" link |
| `POST /api/scan-handoff` | upload a scan → `{ code, url, expiresAt }` (201), or `{ error }` with 400, 413, 429 or 503 |
| `GET /api/scan-handoff?code=…` | fetch it → `{ code, scan, expiresAt }` (200), 400 bad code, 404 unknown/expired, 429 |
| `GET /api/health` | `{ ok: true, store }` (200), or 503 when the store can't be reached |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| App says "Could not reach MOZU" | Check the phone's internet connection. If you changed **Advanced → MOZU web address**, tap **Reset**. |
| App says "Too many requests" | One network sent more than 20 scans in 10 minutes. Wait, or raise `RATE_LIMIT_UPLOADS`. |
| "MOZU could not reach its storage" (503) | Redis isn't connected to the Vercel project, or Upstash is down. Check `/api/health` and the project's Storage tab. |
| "That code was not found or has expired" | Codes last 24 hours. Tap **Send to MOZU web** again; you don't need to rescan. |
| Page is slow the first time | The prototype is one large file (about 30 MB compressed). Later visits load from the browser cache. |
| Code box says "Codes need the MOZU server" | You opened `index.html` by double-clicking it. Use the production address or `npm start`. |
| "Port 3000 is already in use" | `PORT=3100 npm start`, or stop the other server: `lsof -ti:3000 \| xargs kill` |
| Xcode: "Signing for MozuScanner requires a development team" | Install step 4: pick your Team. |
| Xcode: "Failed to register bundle identifier" | Choose a unique bundle identifier (install step 4). |
| App crashes the moment scanning starts (iOS 26) | Run the **MozuScanner** scheme generated by xcodegen; it turns off Metal API Validation, which causes this crash. |
| No room plan visible after loading | Click **Start Workflow Auto Design** in the Kitchen view; the room setup (with the plan) is the first screen. |
| No internet at the site | On the floorplan screen tap **Share scan**, AirDrop the file to the Mac, save it with a `.json` ending, and use **Load scan file**. |
