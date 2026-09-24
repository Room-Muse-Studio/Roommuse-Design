# MOZU Design

Scan a room with the iPad, then open it in the MOZU Kitchen Workflow prototype on your laptop.

```
iPad app ──scan──▶ this server ──6-character code──▶ you type it on the laptop ──▶ room appears in the prototype
```

## What's in this folder

| Folder / file | What it is |
|---|---|
| `apps/ios/` | The iPad scanning app (Swift), copied unchanged from mozu-configurator |
| `apps/web/index.html` | Your prototype, still one file. The only addition is the scan import section at the very end (a button, a code box, and a script tag). |
| `apps/web/scan-import.js` | Translator that turns a room scan into the prototype's room format |
| `packages/scan-sdk/` | The scan SDK, copied unchanged |
| `server/server.js` | Small web server: serves the page and handles the 6-character codes |
| `server/handoff-store.js` | Creates the codes and keeps each one for 24 hours |
| `samples/kitchen.roomscan.json` | A sample 4 m × 3 m kitchen with a door and two sockets, for testing |

You only need Node.js (already installed). There is nothing to `npm install`.

---

## Quick test on the laptop (no iPad)

1. Start the server:
   ```bash
   cd ~/Projects/mozu-design
   npm start
   ```
   It prints `serving apps/web at http://localhost:3000/`. Leave this window open.

   > **"Port 3000 is already in use"?** The mozu-configurator dev server is probably running.
   > Stop it (Ctrl+C in its window), or use another port: `PORT=3100 npm start`, then use `3100`
   > everywhere below instead of `3000`.

2. In a **second** Terminal window, pretend to be the iPad:
   ```bash
   BASE=http://localhost:3000
   CODE=$(curl -s -X POST $BASE/api/scan-handoff \
     -H 'content-type: application/json' \
     --data-binary @$HOME/Projects/mozu-design/samples/kitchen.roomscan.json \
     | sed 's/.*"code":"\([^"]*\)".*/\1/')
   echo "Your code is: $CODE"
   ```

3. Open **http://localhost:3000**, type the code in the box at the top, click **Load code**, then **OK**.
   The page reloads with a 4 × 3 m room. In the 3D view the door shows as a green frame on the back wall
   and the two sockets as small yellow squares at their scanned heights (1.1 m on the back wall, 0.3 m on
   the right wall). The Kitchen Workflow panel's room plan shows the same door (green line) and sockets
   (yellow dots) from above.

You can also skip the code: click **Load scan file** and pick `samples/kitchen.roomscan.json`.

---

## Using a real iPad

You do **Part A** once. After that, each session is Parts C and D.

### What you need

- A Mac with **Xcode** (free from the App Store)
- An **iPad with LiDAR**: iPad Pro 2020 or newer (the 11" and 12.9" Pro models), running iPadOS 17 or later
- A USB cable for the iPad
- An **Apple ID** (a free one works)

### Part A — Install the tools (once)

1. **Install Xcode** from the Mac App Store (it's large, allow 30–60 minutes). Open it once and accept
   the licence; let it install any extra components it asks for.
2. Point the command-line tools at Xcode:
   ```bash
   sudo xcode-select -s /Applications/Xcode.app
   ```
3. Install the two helper tools with Homebrew:
   ```bash
   brew install xcodegen cloudflared
   ```
   - **xcodegen** builds the Xcode project file from `apps/ios/project.yml`
   - **cloudflared** gives your laptop a temporary public `https://` address the iPad can reach
4. Add your Apple ID to Xcode: **Xcode → Settings → Accounts → +** → Apple ID → sign in.

### Part B — Build the iPad app

1. Create the Xcode project:
   ```bash
   cd ~/Projects/mozu-design/apps/ios
   xcodegen generate
   open MozuScanner.xcodeproj
   ```
   (Re-run `xcodegen generate` only if Swift files are added or removed.)

2. Set up signing (Xcode needs to know who's installing the app):
   - In the left sidebar click the blue **MozuScanner** project icon, then the **MozuScanner** target.
   - Open the **Signing & Capabilities** tab.
   - Tick **Automatically manage signing** and pick your name under **Team**.
   - If Xcode says the bundle identifier is taken, change `com.mozu.scanner` to something unique,
     e.g. `com.yourname.mozuscanner`.

3. Prepare the iPad:
   - Plug it into the Mac and tap **Trust** on the iPad.
   - Turn on **Developer Mode**: iPad **Settings → Privacy & Security → Developer Mode → On**, then
     restart the iPad when asked. (The option appears after the iPad has been connected to Xcode once.)

4. Run it: at the top of the Xcode window pick your iPad as the destination, then press **⌘R**.
   - The first time, the iPad may block the app. Go to **Settings → General → VPN & Device Management**,
     tap your Apple ID, and tap **Trust**. Then press ⌘R again.
   - With a free Apple ID, the app stops opening after 7 days. Plug in and press ⌘R again to refresh it.

### Part C — Start the server and the tunnel (each session)

The iPad can't reach `localhost` on your laptop, so Cloudflare gives the laptop a temporary public address.

1. **Terminal window 1**, the server:
   ```bash
   cd ~/Projects/mozu-design
   npm start
   ```
2. **Terminal window 2**, the tunnel:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
   After a few seconds it prints an address like `https://laid-asking-utah-cabinets.trycloudflare.com`.
   Copy it. **It changes each time you restart the tunnel.** Keep both windows open.

3. Check the tunnel works before picking up the iPad (Terminal window 3; replace the address with yours):
   ```bash
   TUNNEL=https://laid-asking-utah-cabinets.trycloudflare.com
   curl -s -X POST $TUNNEL/api/scan-handoff -H 'content-type: application/json' \
     --data-binary @$HOME/Projects/mozu-design/samples/kitchen.roomscan.json; echo
   ```
   You should see something like `{"code":"B7K4M2","url":"https://…/scan/B7K4M2",…}`.
   If a new tunnel says it can't be found, wait 30 seconds and try again.

### Part D — Send a real scan to your page

On the **iPad**:

1. Open **MOZU Scanner**, tap **Start scan**, allow camera access, and walk slowly around the room, pointing
   at every wall, the floor edges, doors, windows and sockets. Tap **Finish room**, then **Use this room**.
   (Send one room at a time: the multi-room "Build house" screen has no send button.)
2. On the **Floorplan** screen, find the **MOZU web address** box near the bottom and paste your tunnel
   address (e.g. `https://laid-asking-utah-cabinets.trycloudflare.com`). The iPad remembers it until the address
   changes.
3. Tap **Send to MOZU web**. A 6-character code appears in large letters, e.g. `B7K4M2`.

On the **laptop**:

4. Open **http://localhost:3000** (or the tunnel address; both work).
5. Type the code in the box at the top (upper or lower case, dashes and spaces are fine) and click
   **Load code**, then **OK** to replace the current kitchen.
6. The page reloads with your room: width, depth and ceiling height filled in, and the doors, windows and
   sockets drawn on the Kitchen Workflow room plan. Choose each door's opening direction there (the scan
   can't tell which side the hinges are on).

The **Open in MOZU on this iPad** button also works: it opens your page on the iPad with the room loaded.

---

## How the pieces fit together

- **The iPad** sends the scan (`mozu.roomscan/1` JSON) to `POST /api/scan-handoff` and shows the `code` it
  gets back. The request and reply match `apps/ios/MozuScanner/Export/Handoff.swift`, so the Swift is unchanged.
- **The server** keeps each scan in memory under a random 6-character code for **24 hours**. Codes use
  `23456789ABCDEFGHJKMNPQRSTVWXYZ` (no 0/O, 1/I/L or U, so they're easy to read out).
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
  itself is not patched.
- **3D markers**: the prototype's 3D room only draws walls, so `scan-import.js` also adds its own markers
  to the 3D scene for every door, window and service point in the room setup (green door frames, blue
  window frames, small coloured squares for sockets and other service points). It reaches the scene through
  the page's React internals rather than a change to the prototype, so if a future export of the prototype
  renames those internals the markers simply stop appearing; the 2D room plan is unaffected. The previous saved project is kept as a backup under
  `mozu.prototype.kitchenWorkflow.project.v2.before-scan` in the browser's storage.
- The SDK's built file (`packages/scan-sdk/dist`) drops `fixtures` when it parses a scan, so both the page
  and the server read the sockets from the raw JSON instead.

| Address | What it does |
|---|---|
| `/` | the prototype |
| `/?code=B7K4M2` or `/scan/B7K4M2` | opens the prototype and loads that code |
| `/scan?poly=…&h=…&scan=…` | the iPad's "Open in MOZU on this iPad" link |
| `POST /api/scan-handoff` | upload a scan → `{ code, url, expiresAt }` (201) or `{ error }` |
| `GET /api/scan-handoff?code=…` | fetch it → `{ code, scan, expiresAt }` (200), 400 bad code, 404 unknown/expired |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Port 3000 is already in use" | Another server is running (often the mozu-configurator one). Stop it, or `PORT=3100 npm start` and use `cloudflared tunnel --url http://localhost:3100`. To force-stop whatever is on 3000: `lsof -ti:3000 \| xargs kill` |
| iPad says "Could not reach MOZU" | The tunnel or server window was closed, or the address on the iPad is old. Restart both, paste the **new** tunnel address into the iPad, and send again. |
| "That code was not found or has expired" | Codes live in the server's memory: restarting `npm start` forgets them, and they expire after 24 hours. Tap **Send to MOZU web** again; you don't need to rescan. |
| Code box says "Codes need the MOZU server" | You opened `index.html` by double-clicking it. Open **http://localhost:3000** instead. |
| Xcode: "Signing for MozuScanner requires a development team" | Part B step 2: pick your Team. |
| Xcode: "Failed to register bundle identifier" | Change the bundle identifier to something unique (Part B step 2). |
| App crashes the moment scanning starts (iPadOS 26) | Make sure you're running the **MozuScanner** scheme generated by xcodegen. It already turns off Metal API Validation, which causes this crash. Re-run `xcodegen generate` if you changed it. |
| The Swift doesn't compile | It hasn't been compiled on this Mac yet. Copy the first error from Xcode's Issue navigator and ask for a fix. |
| No Wi-Fi or tunnel available | On the iPad Floorplan screen tap **Share scan**, AirDrop the file to the Mac, save it with a `.json` ending, and use **Load scan file** on the page. |
| No room plan visible after loading | Click **Start Workflow Auto Design** in the Kitchen view; the room setup (with the plan at the bottom) is the first screen. |

**Privacy note:** while the tunnel runs, anyone with its address can reach the server. Codes are random
and expire, but stop the tunnel (Ctrl+C) when you're done.
