// MOZU Scan — the App Clip entry point.
//
// Same scan → floorplan → "Send to MOZU web" flow as the full app, minus the
// 3D design room (kept out of the clip to stay under Apple's size limit). The
// clip is opened from a QR code or link such as
//     https://roommuse-design.vercel.app/clip?s=<session>
// and passes that session on with the scan so the laptop page loads the room
// by itself. Everything else lives in the shared sources under ../MozuScanner.

import SwiftUI

@main
struct MozuScanClipApp: App {
    @State private var invocation = ClipInvocation(session: nil)

    var body: some Scene {
        WindowGroup {
            ContentView(invocation: invocation)
                // The system hands the clip its invocation URL as a browsing activity.
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    invocation = ClipInvocation.parse(activity.webpageURL)
                }
                // Links opened while the clip is already running.
                .onOpenURL { url in
                    let parsed = ClipInvocation.parse(url)
                    if parsed.session != nil { invocation = parsed }
                }
        }
    }
}
