# MOZU Design

Scan a room (or a whole home) with a LiDAR iPhone or iPad, then open it in the RoomMuse configurator on any computer
and furnish it.

```
phone app ──scan──▶ MOZU web (Vercel) ──6-character code──▶ type it on the laptop ──▶ rooms appear in the configurator
```

## What's in this folder

| Folder / file | What it is |
|---|---|
| `apps/ios/` | The scanning app (Swift, RoomPlan + LiDAR, socket detection) |
| `apps/configurator/` | The website: RoomMuse configurator (Next.js + Three.js), built as a static site; see below |
| `packages/scan-sdk/` | The shared `mozu.roomscan/1` (one room) and `mozu.homescan/1` (several rooms) formats and floorplan engine |
| `server/handoff-store.js` | Codes: 6 characters, 24 hours, stored in Redis (production) or memory (laptop) |
| `server/handoff-api.js` | The handoff API, shared by the laptop server and Vercel |
| `server/server.js` | Laptop server (`npm start`) |
| `api/` | The same API as Vercel functions |
| `vercel.json`, `scripts/build-web.js` | Vercel build and routing; the build puts the configurator in `public/` |
| `test/` | `npm test` (also runs on every push, `.github/workflows/test.yml`); the viewer's own tests: `npm run test:viewer` |
| `samples/kitchen.roomscan.json` | A 4 m × 3 m kitchen with a door and two sockets, for testing |
| `samples/twobedroom.roomscan.json` | A two-bedroom flat (`mozu.homescan/1`): hallway, L-shaped bedroom, rectangular bedroom |

Node 20 or newer. Run `npm install` once (and after pulling changes).

## The configurator (apps/configurator)

The website. It opens a scan by **Code from the phone**, from a `/scan/B7K4M2` link, from a sample, or from a
`mozu.roomscan/1` / `mozu.homescan/1` file, with every room at its real position. The **Rooms** menu isolates one;
**Show ceilings** adds ceilings. The right-hand panel adds cabinets and furniture; click an item for its menu
(rotate, colour and texture, remove), drag it to move it, drop it on another to swap them. Nothing is saved yet.

It's deployed as a static site (`npm run build` → `public/`), beside the handoff API: the page calls
`/api/scan-handoff` on its own site, and `/scan/:code` redirects to `/?code=:code`.

**While working on it**, for live reload:
```bash
npm start          # terminal 1: the site and the code API on http://localhost:3000
npm run viewer     # terminal 2: a live-reloading copy on http://localhost:3100
```
The copy on 3100 sends `/api/*` and `/scan/*` to port 3000. To use the Vercel deploy's codes instead, create
`apps/configurator/.env.local` with `MOZU_HANDOFF_URL=https://your-project.vercel.app` and restart `npm run viewer`.

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
3. On any computer, open the production address, type the code into **Code from the phone** (upper or lower case,
   dashes and spaces are fine) and click **Load**. Or open the address the phone shows (`…/scan/B7K4M2`).
4. The room appears in 3D with its doors, windows, sockets and the furniture the scan found. Add cabinets and
   furniture from the right-hand panel.

Codes last 24 hours. If a code has expired, tap **Send to MOZU web** again; you don't need to rescan.

**A whole home:** after each room tap **Scan next room** instead, and **Build house** after the last one. The house
screen's **Send house to MOZU web** uploads every room as one `mozu.homescan/1` under a single code, with the rooms
in their real positions, and the configurator shows the whole home.

---

## Local development

```bash
npm start          # builds the site, then http://localhost:3000 with codes kept in memory
npm run serve      # the same without rebuilding
npm test           # store, API, rate limits, /scan links, Vercel functions
npm run test:viewer  # the configurator: walls, placement, items, loading
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
Open http://localhost:3000, type the code into **Code from the phone** and click **Load** (or open
`http://localhost:3000/scan/$CODE`). The room is 4.00 × 3.00 m with a 2.50 m ceiling, 1 door (green frame on the back
wall) and 2 sockets (0.3 m and 1.1 m high). Send `samples/twobedroom.roomscan.json` instead for a whole home.

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
- **The configurator** fetches `GET /api/scan-handoff?code=…` and reads the scan with the SDK: any polygon
  (L-shaped rooms included), walls with doors and windows cut in, sockets at their height, and the scanned
  furniture as items you can move, recolour or remove.
- The server parses scans with the built SDK (`packages/scan-sdk/dist`), sockets included; the configurator uses
  its source. After changing `packages/scan-sdk/src`, rebuild it: `npm run build -w packages/scan-sdk` (CI fails if
  `dist` is out of date).
- Scans may also carry optional `wallIds` (RoomPlan's wall UUIDs, one per polygon edge), `id` on openings,
  objects and fixtures, and `elevation` (bottom height above the floor) on objects. The schema is still
  `mozu.roomscan/1`; older scans without these fields load exactly as before.
- Several rooms travel together as `mozu.homescan/1` (`{ schema, rooms, capturedAt, connections? }`); read one with
  the SDK's `parseHomeScan`. `connections` records which doors and walls two rooms share (a door between two rooms
  is scanned once per room); `findConnections(rooms)` works them out from the rooms' geometry.

| Address | What it does |
|---|---|
| `/` | the configurator |
| `/?code=B7K4M2` or `/scan/B7K4M2` | opens the configurator and loads that code |
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
| The page says "The site has not been built yet" | You ran `npm run serve` before building. Run `npm start` (it builds first). |
| "Port 3000 is already in use" | `PORT=3100 npm start`, or stop the other server: `lsof -ti:3000 \| xargs kill` |
| Xcode: "Signing for MozuScanner requires a development team" | Install step 4: pick your Team. |
| Xcode: "Failed to register bundle identifier" | Choose a unique bundle identifier (install step 4). |
| App crashes the moment scanning starts (iOS 26) | Run the **MozuScanner** scheme generated by xcodegen; it turns off Metal API Validation, which causes this crash. |
| No internet at the site | On the floorplan screen tap **Share scan**, AirDrop the file to the Mac, save it with a `.json` ending, and open it with **File…**. |
