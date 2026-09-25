// App flow, mirroring the product's two steps: "1 Scan" (RoomPlan) → "2
// Floorplan" (auto-generated plan + hand-off). RoomPlan needs a LiDAR device;
// unsupported devices get a clear message.

import RoomPlan
import SwiftUI

struct ContentView: View {
    @StateObject private var controller = RoomCaptureController()
    /// On a device without LiDAR: the sample room opened from the unsupported screen.
    @State private var sampleRoom: RoomScan?

    var body: some View {
        NavigationStack {
            Group {
                if !RoomCaptureSession.isSupported {
                    if let sampleRoom {
                        FloorplanResultView(scan: sampleRoom) { self.sampleRoom = nil }
                    } else {
                        UnsupportedView { sampleRoom = .sampleKitchen() }
                    }
                } else {
                    switch controller.phase {
                    case .done(let scans) where scans.count == 1:
                        FloorplanResultView(scan: scans[0]) { controller.reset() }
                    case .done(let scans) where scans.count > 1:
                        HouseResultView(scans: scans) { controller.reset() }
                    case .done:
                        // Zero rooms captured (shouldn't happen) — back to scanning.
                        ScanView(controller: controller)
                    case .failed(let message):
                        FailureView(message: message) { controller.reset() }
                    default:
                        ScanView(controller: controller)
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var title: String {
        if sampleRoom != nil { return "2 · Floorplan (sample)" }
        switch controller.phase {
        case .done: return "2 · Floorplan"
        default: return "1 · Scan"
        }
    }
}

private struct UnsupportedView: View {
    var onTrySample: () -> Void
    var body: some View {
        ContentUnavailableView {
            Label("LiDAR required", systemImage: "ruler")
        } description: {
            Text("Scanning needs a LiDAR device (iPhone 12 Pro or later Pro model, or iPad Pro). You can still try the rest of the app with a sample room.")
        } actions: {
            Button("Try with a sample room", action: onTrySample)
                .buttonStyle(.borderedProminent)
        }
    }
}

extension RoomScan {
    /// The 4 m × 3 m kitchen from samples/kitchen.roomscan.json: one door, two
    /// sockets. Lets a device without LiDAR walk through the floorplan and send flow.
    static func sampleKitchen() -> RoomScan {
        RoomScan(
            polygon: [Vec2(x: 0, z: 0), Vec2(x: 4000, z: 0), Vec2(x: 4000, z: 3000), Vec2(x: 0, z: 3000)],
            height: 2500,
            openings: [ScanOpening(type: .door, wall: 0, offset: 800, width: 900, height: 2050, sill: nil)],
            fixtures: [
                ScanFixture(type: .socket, wall: 0, offset: 2400, height: 1100, source: .detected, confidence: 0.9),
                ScanFixture(type: .socket, wall: 1, offset: 1500, height: 300, source: .detected, confidence: 0.8),
            ],
            source: .manual,
            confidence: 1
        )
    }
}

private struct FailureView: View {
    let message: String
    var onRetry: () -> Void
    var body: some View {
        ContentUnavailableView {
            Label("Scan failed", systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button("Try again", action: onRetry).buttonStyle(.borderedProminent)
        }
    }
}
