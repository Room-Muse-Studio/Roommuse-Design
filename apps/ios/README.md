# MOZU Room Scanner — iOS app (Apple RoomPlan)

The native, most-accurate **scan → floorplan**: walk the room with a LiDAR
iPhone/iPad, RoomPlan measures it in 3D (cm-level), and the app generates a
dimensioned floorplan you can open straight in the MOZU configurator.

This is the "1 Scan → 2 Floorplan" flow from the product spec, on-device.

```
RoomPlan scan ─▶ CapturedRoom ─▶ FloorplanBuilder ─▶ RoomScan ─▶ Floorplan
                                                          │            │
                                            Handoff /scan ◀┘   FloorplanCanvas
```

> ⚠️ **Build in Xcode on a Mac.** RoomPlan is iOS-only and needs a LiDAR device;
> it does not run in the Simulator. On a phone without LiDAR the app opens with a
> sample room so the floorplan and send flow can still be tried.

## Requirements

- Xcode 15+, **iOS 17+** deployment target.
- A **LiDAR** device: iPhone 12 Pro or later Pro, or iPad Pro.

## Set up the Xcode project

The project file is generated from [`project.yml`](./project.yml) by XcodeGen
(`brew install xcodegen`), so it is not committed:

```bash
cd apps/ios
xcodegen generate
open MozuScanner.xcodeproj
```

Re-run `xcodegen generate` whenever Swift files are added or removed. Pick your
Team under **Signing & Capabilities** and run the **MozuScanner** scheme on a
device. The full install walkthrough (Developer Mode, trusting the profile) is in
the [root README](../../README.md).

Two targets come out of the spec:

| Target | Scheme | What it is |
| --- | --- | --- |
| `MozuScanner` | MozuScanner | The full app: scan → floorplan → send, plus the 3D design room (`Design/`, USDZ models, HDR). |
| `MozuScannerClip` | MozuScannerClip | The **App Clip**: the same scan → floorplan → send flow, launched from a link or QR code with nothing to install. See [App Clip](#app-clip) below. |

## Socket detection (on device)

Sockets are found **during the room scan**, not in a separate pass. RoomPlan
already has the camera open, so `FixtureCapture` samples frames from its
ARSession, `SocketDetector` looks for a socket's giveaway cluster of dark pin
slots, and `FixtureProjector` casts each sighting through the camera intrinsics
onto the finished walls to get {which wall, how far along, how high}.

- `Scan/SocketDetector.swift` — the detector. A faithful Swift port of
  `src/systems/scan/fixtureDetector.ts`, so the iPad finds what the web app
  finds: same thresholds, same solidity and compactness rules, same scoring.
- `Scan/FixtureCapture.swift` — samples the live ARSession (throttled; reads the
  Y plane straight out of ARKit's YCbCr buffer, so there is no colour conversion).
- `Scan/FixtureProjector.swift` — ray-casts sightings onto the room polygon and
  merges repeats. A socket must be seen from **two or more poses** to be kept, so
  a one-frame trick of the light never reaches the plan.

Detected sockets ride the `/scan` handoff to the web configurator as
`RoomScan.fixtures`, where they are drawn on the floorplan and the layout engine
refuses to seal them behind a cabinet.

## Flow

1. **Scan** — tap Start, walk the room; tap Finish. RoomPlan builds a 3D model.
   Sockets are detected as you walk — the hint line shows a running count.
2. **Floorplan** — `FloorplanBuilder` orders the walls into a floor polygon,
   maps doors/windows onto the right walls, and lists detected objects; the app
   draws the dimensioned plan with each wall's measured length, area and ceiling.
3. **Open in MOZU** — opens `‹web host›/scan?poly=…&h=…&scan=…` and the
   configurator loads on your real room (full polygon + openings, not just a
   bounding box). Set the host in the field on the floorplan screen.

## The contract

The app speaks the exact same JSON as [`@mozu/scan-sdk`](../../packages/scan-sdk)
(`mozu.roomscan/1`) — see [`Models/RoomScan.swift`](./MozuScanner/Models/RoomScan.swift)
and [`Export/Handoff.swift`](./MozuScanner/Export/Handoff.swift). That's why the
web app, the browser extensions, and this app all produce an identical floorplan.

## Source layout

| File | Role |
| --- | --- |
| `App/MozuScannerApp.swift` | `@main` app entry |
| `Models/RoomScan.swift` | the `mozu.roomscan/1` contract (Codable) |
| `Scan/RoomCaptureController.swift` | drives `RoomCaptureSession` + `RoomBuilder` |
| `Scan/FloorplanBuilder.swift` | `CapturedRoom` → ordered polygon + openings + objects |
| `Floorplan/Floorplan.swift` | pure dimensioning engine (Swift twin of the SDK) |
| `Floorplan/FloorplanCanvas.swift` | SwiftUI plan renderer (the "2 Floorplan" view) |
| `Views/*` | scan / result / app flow (shared with the clip; `#if APPCLIP` hides what the clip can't do) |
| `Export/Handoff.swift` | `/scan` deep link, `ScanHandoff.send` upload → 6-character code |
| `Export/ClipInvocation.swift` | parses the App Clip's invocation URL (`/clip?s=…`) |
| `Design/**` | 3D design room, AR placement, pricing, photoreal render — full app only |
| `Resources/**` | USDZ furniture models + `Studio.skybox` HDR — full app only |
| `MozuScannerClip/` | the clip's `@main`, `Info.plist`, entitlements and icon |
| `Shared/Assets.xcassets` | the full app's icon (placeholder artwork) |

## App Clip

An App Clip is a small slice of the app that iOS runs **without installing anything
from the App Store**: a person scans a QR code or taps a link, a card slides up,
they tap **Open**, and MOZU Scan starts. The website's `/clip` page is that link
(`apps/web/clip/index.html`).

**What the clip contains.** Only the scan path: `Models`, `Scan`, `Floorplan`,
`Export/Handoff.swift`, `Export/ClipInvocation.swift` and `Views`, compiled with
the `APPCLIP` flag (`SWIFT_ACTIVE_COMPILATION_CONDITIONS` in `project.yml`).
Under that flag `FloorplanResultView` and `HouseResultView` replace the
"Design room" button with a "Get the full MOZU app" overlay (`SKOverlay`), and
hide the share sheet and the Advanced server-address field (clips can't use the
local network; they always talk to production). Nothing in `Design/` or
`Resources/` is compiled or bundled, which keeps the clip far under Apple's
15 MB limit (a debug build is about 2.3 MB).

**How it launches.** The invocation URL is `https://<domain>/clip?s=<session>`.
`ClipApp.swift` receives it through `onContinueUserActivity` and
`ClipInvocation.parse` reads the optional session id; `ScanHandoff.send` echoes
it in the upload as `"session"` so a laptop page that showed the QR code can load
the room by itself (server support for that lookup is a follow-up; today the
6-character code still works exactly as in the full app). After a send, the clip
also stores the ticket in the shared app group `group.com.averyhsu.roommuse`, so
the full app can show "your last scan code" after an upgrade.

**Building.** Both targets compile on any Mac with Xcode:

```bash
cd apps/ios && xcodegen generate
xcodebuild -project MozuScanner.xcodeproj -scheme MozuScannerClip \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

The `MozuScannerClip` scheme sets `_XCAppClipURL` so running it from Xcode on a
device exercises the invocation parsing without a QR code.

**What only the account owner can do.** None of this can ship on a free Apple ID:

1. **Join the Apple Developer Program** ($99/year). App Clips and Associated
   Domains aren't available to a free Personal Team, so the clip can't even be
   signed for a device until then. Put the paid team's ID in `DEVELOPMENT_TEAM`.
2. **Domain.** The clip's `associated-domains` entitlement and the website's
   `.well-known/apple-app-site-association` file must name the same domain,
   and the file must list the Team ID (see `apps/web/.well-known/README.md`).
   Apple bakes the domain into the reviewed build, so pick the final one first
   (a custom domain is recommended over `roommuse-design.vercel.app`).
3. **A LiDAR device** to test scanning inside the clip. Apple documents ARKit in
   clips; RoomPlan specifically should be confirmed on a device before App
   Store work starts. Test without publishing via Xcode, then on the device:
   **Settings → Developer → Local Experiences → Register Local Experience**,
   URL prefix `https://<domain>/clip`, bundle id `com.averyhsu.roommuse.Clip`;
   scan a QR code of that URL with the Camera app and the debug clip launches.
4. **App Store Connect.** The clip ships inside the full app and only launches
   from links once the app is on the App Store: create the app record, set the
   default App Clip experience (header image 1800×1200, title, subtitle,
   "Open"), an advanced experience for the `/clip` URL prefix, put the app's
   numeric id into the Smart App Banner tag in `apps/web/clip/index.html`, and
   submit both for review. Replace the placeholder icons in `Shared/Assets.xcassets`
   and `MozuScannerClip/Assets.xcassets` first.
5. **Size check.** Product → Archive → Distribute → App Thinning Size Report;
   Xcode refuses to archive a clip over the limit.

## Why native on iPhone

iOS Safari ships no WebXR, so true in-browser room scanning isn't possible on
iPhone. RoomPlan is the accurate path (≈25–50 mm, detects walls + openings).
On Android the web app's WebXR `AR measure` is the no-install equivalent.
