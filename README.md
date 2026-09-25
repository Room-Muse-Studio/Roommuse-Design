# MOZU Design

Scan a room with a LiDAR iPhone or iPad, then open it in the MOZU Kitchen Workflow prototype on any computer.
Sign in to keep every design as a project in your account; every change is saved as you work.

```
phone app ──scan──▶ MOZU web (Vercel) ──6-character code──▶ type it on the laptop ──▶ room appears in the prototype
                                                                                    └──▶ autosaved to your account
```

## What's in this folder

| Folder / file | What it is |
|---|---|
| `apps/ios/` | The scanning app (Swift, RoomPlan + LiDAR, socket detection) |
| `apps/web/index.html`, `shell.js`, `shell.css` | The app shell: sign-in, the projects gallery, and the header around the editor |
| `apps/web/shell-config.js` | Public Firebase settings for sign-in (fill in once, see *Accounts & projects*) |
| `apps/web/editor.html` | The prototype, one packed file, shown inside the shell. The only additions are the scan import section and two script tags at the very end. |
| `apps/web/scan-import.js` | Turns a room scan into the prototype's room format, and draws doors/sockets in 3D |
| `apps/web/project-sync.js` | Runs inside the editor: autosaves the open project to the account |
| `packages/scan-sdk/` | The shared `mozu.roomscan/1` format and floorplan engine |
| `server/handoff-store.js` | Codes: 6 characters, 24 hours, stored in Redis (production) or memory (laptop) |
| `server/app-store.js` | Users, sessions and projects on the same Redis / memory store |
| `server/handoff-api.js`, `auth-api.js`, `project-api.js` | The APIs, shared by the laptop server and Vercel |
| `server/firebase-token.js` | Checks Firebase sign-in tokens with `node:crypto` (no SDK) |
| `server/server.js` | Laptop server (`npm start`) |
| `api/` | The same APIs as Vercel functions |
| `vercel.json`, `scripts/build-web.js` | Vercel build and routing |
| `test/` | `npm test` (also runs on every push, `.github/workflows/test.yml`) |
| `samples/kitchen.roomscan.json` | A 4 m × 3 m kitchen with a door and two sockets, for testing |

There are no npm dependencies. Node 20 or newer is needed to run it locally.

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

### Settings (Vercel → Settings → Environment Variables)

| Variable | Default | Meaning |
|---|---|---|
| `FIREBASE_PROJECT_ID` | – | **Needed for sign-in.** The Firebase project id (see *Accounts & projects*). Without it sign-in answers 503. |
| `RATE_LIMIT_UPLOADS` | `20` | Scans one network may upload per 10 minutes (`0` = no limit) |
| `RATE_LIMIT_LOOKUPS` | `60` | Code lookups one network may make per 10 minutes, so codes can't be guessed |
| `RATE_LIMIT_SESSIONS` | `30` | Sign-ins one network may attempt per 10 minutes |
| `RATE_LIMIT_READS` / `RATE_LIMIT_WRITES` | `600` / `300` | Project reads / saves one account may make per 10 minutes |
| `SESSION_TTL_DAYS` | `30` | How long a sign-in lasts (renewed on use) |
| `MAX_PROJECT_BYTES` | `524288` | Largest project (512 KB; a full kitchen is ~10–40 KB) |
| `MAX_PROJECTS_PER_USER` | `100` | Projects per account |

---

## Accounts & projects

Sign-in uses **Firebase Authentication** (free): email + password, or Google. Firebase only proves who the
person is; MOZU's own server then issues a 30-day session cookie and keeps the projects in Redis, next to
the scan codes. Passwords never reach our server, and password-reset / verification emails come from Firebase.

### One-time setup (about 15 minutes)

1. Go to **console.firebase.google.com** → **Create a project** (any name, e.g. `roommuse`; Analytics can be
   off). The free **Spark** plan is enough.
2. **Build → Authentication → Get started**. On **Sign-in method** enable **Email/Password**, then **Google**
   (pick a support email).
3. **Authentication → Settings → Authorized domains → Add domain**: your Vercel address
   (e.g. `roommuse-design.vercel.app`). `localhost` is already listed.
4. **Project settings** (gear) → **Your apps** → **</> Web** → register an app (no hosting). Copy `apiKey`,
   `authDomain` and `projectId` from the config it shows into `apps/web/shell-config.js`. These are public
   values; the Authorized domains list is what protects them. Optionally restrict the API key by HTTP
   referrer in Google Cloud Console.
5. In Vercel → **Settings → Environment Variables** add `FIREBASE_PROJECT_ID` = the same `projectId`, for
   Production, Preview and Development. Redeploy.
6. Optional: **Authentication → Templates** to put the MOZU name on the reset and verification emails.

Until steps 4–5 are done the site shows "Sign-in isn't set up yet" and offers guest mode only.

### How it works

- `/` is the shell. Signed out: the sign-in screen (or, while unconfigured, straight into guest mode).
  Signed in: **My projects**, a gallery with New / Open / Rename / Duplicate / Delete.
- Opening a project writes it into the prototype's own "saved project" slot in the browser and loads
  `editor.html?project=<id>` in a frame; the prototype restores the slot exactly as it always has.
- `project-sync.js` watches the editor and saves 2 seconds after the last change (10 at most), also when the
  tab is hidden or closed, or when you go back to the gallery. The header shows *Saved 12:03*, *Saving…*,
  *Offline — changes are kept on this device*, or *Changed elsewhere* with a choice of versions when the same
  project was saved from another tab or device.
- **Guest mode** ("Try without an account") is the old behaviour: everything stays in that browser. A design
  saved there shows up as **Import the design saved on this device** after signing in.
- A scan code (`/scan/B7K4M2` or `/?code=`) while signed in creates a new project for the room; signed out it
  loads into guest mode as before.
- Sessions and projects are checked on every request: a project belongs to the account that created it, others
  get a 404. Writes require same-origin JSON requests (no cross-site forms), and per-account rate limits keep a
  runaway page from filling the store.
- Email verification is encouraged with a banner (and a resend button), not required.

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
   windows and sockets. Tap **Finish room**, then **Use this room**. (Send one room at a time: the multi-room
   "Build house" screen has no send button.)
2. On the floorplan screen, tap **Send to MOZU web**. A 6-character code appears, e.g. `B7K4M2`.
3. On any computer, open the production address and sign in (or choose **Try without an account**). Open a
   project, type the code in the box at the top (upper or lower case, dashes and spaces are fine) and click
   **Load code**. If the kitchen already has cabinets you'll be asked before they're replaced. Opening
   `…/scan/B7K4M2` directly while signed in creates a new project for the room.
4. The page reloads with your room and opens the Kitchen Workflow room setup. Width, depth, ceiling height,
   doors, windows and sockets are filled in. Choose each door's opening direction there (the scan can't tell
   which side the hinges are on). The workflow also lists the water, drainage and appliance power a kitchen needs;
   the scan can't see pipes, so mark those positions under **Connections and mobility**.

Codes last 24 hours. If a code has expired, tap **Send to MOZU web** again; you don't need to rescan.

---

## Local development

```bash
npm start          # http://localhost:3000, codes, sessions and projects kept in memory
npm test           # stores, handoff / auth / projects APIs, rate limits, /scan links, Vercel functions
npm run build      # what Vercel runs: assembles public/
```

`npm start` uses Redis instead of memory if `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set (for example
after `vercel env pull .env`, then `set -a; . ./.env; set +a; npm start`). Sign-in works locally once
`shell-config.js` is filled in and `FIREBASE_PROJECT_ID` is exported (`localhost` is an authorized domain by
default); without them the local site runs in guest mode, and `http://localhost:3000/?signin` shows the sign-in
screen anyway. Tests never need Firebase: they sign tokens with a throw-away key.

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
- The SDK's built file (`packages/scan-sdk/dist`) drops `fixtures` when it parses a scan, so both the page
  and the server read the sockets from the raw JSON instead.

| Address | What it does |
|---|---|
| `/` | the shell: sign-in, then **My projects**; `/?open=<id>` reopens a project, `/?signin` forces the sign-in screen, `/?guest` guest mode |
| `/editor.html` | the prototype itself (the shell loads it in a frame; opened directly it sends you back to `/`) |
| `/?code=B7K4M2` or `/scan/B7K4M2` | loads that code: into a new project when signed in, into guest mode otherwise |
| `/scan?poly=…&h=…&scan=…` | the app's "Open in MOZU on this device" link |
| `POST /api/scan-handoff` | upload a scan → `{ code, url, expiresAt }` (201), or `{ error }` with 400, 413, 429 or 503 |
| `GET /api/scan-handoff?code=…` | fetch it → `{ code, scan, expiresAt }` (200), 400 bad code, 404 unknown/expired, 429 |
| `POST /api/auth/session` `{ idToken }` | exchange a Firebase sign-in for the session cookie → `{ user }` (201) |
| `GET /api/auth/me` · `DELETE /api/auth/session` | who am I (200 / 401) · sign out |
| `GET` / `POST /api/projects` | list `{ projects }` · create `{ name?, data?, source? }` → `{ project }` (201) |
| `GET` / `PUT` / `PATCH` / `DELETE /api/projects/:id` | open `{ project, data }` · save `{ rev, data }` → `{ rev, updatedAt }` or 409 · rename `{ name?, clientName? }` · delete |
| `POST /api/projects/:id/duplicate` | copy → `{ project }` (201) |
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
| "Sign-in isn't set up on this site yet" | `apps/web/shell-config.js` is still empty. Follow *Accounts & projects → One-time setup*. |
| Sign-in says the site isn't authorised (`auth/unauthorized-domain`) | Add the site's domain under Firebase → Authentication → Settings → Authorized domains. |
| Sign-in answers 503 "not configured" | `FIREBASE_PROJECT_ID` is missing from the Vercel environment variables. |
| Header says "Changed elsewhere" | The same project was saved from another tab or device. Choose **Reload their version** or **Keep mine** in the editor. |
| Header says "This project couldn't be opened by this version of the planner" | The prototype refused to restore it (an unknown product code or an overlap), so autosave is off to protect the saved copy. Duplicate it and try there, or report it. |
| Code box says "Codes need the MOZU server" | You opened `editor.html` by double-clicking it. Use the production address or `npm start`. |
| "Port 3000 is already in use" | `PORT=3100 npm start`, or stop the other server: `lsof -ti:3000 \| xargs kill` |
| Xcode: "Signing for MozuScanner requires a development team" | Install step 4: pick your Team. |
| Xcode: "Failed to register bundle identifier" | Choose a unique bundle identifier (install step 4). |
| App crashes the moment scanning starts (iOS 26) | Run the **MozuScanner** scheme generated by xcodegen; it turns off Metal API Validation, which causes this crash. |
| No room plan visible after loading | Click **Start Workflow Auto Design** in the Kitchen view; the room setup (with the plan) is the first screen. |
| No internet at the site | On the floorplan screen tap **Share scan**, AirDrop the file to the Mac, save it with a `.json` ending, and use **Load scan file**. |
