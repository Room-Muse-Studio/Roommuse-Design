// The whole-house result: every scanned room drawn on ONE combined floorplan
// (the rooms share a world origin because the AR session stayed alive between
// scans), summary stats, and the door into the 3D design experience with all
// rooms present. The largest room becomes the "primary" design room (its
// finishes are editable; the others render as context shells you can walk into).

import SwiftUI

struct HouseResultView: View {
    /// Every room of the session, wrapped as one home (see `RoomCaptureController.buildHouse`).
    let home: HomeScan
    var onRescan: () -> Void

    @State private var showDesign = false
    @AppStorage("mozuWebBase") private var webBase = ScanHandoff.defaultWebBase
    @State private var sending = false
    @State private var ticket: ScanHandoff.Ticket?
    @State private var sendError: String?

    private var scans: [RoomScan] { home.rooms }

    /// Largest room = the primary design room.
    private var primaryIndex: Int {
        scans.indices.max(by: { Geo.area(scans[$0].polygon) < Geo.area(scans[$1].polygon) }) ?? 0
    }

    private var totalAreaMm2: Double {
        scans.reduce(0) { $0 + Geo.area($1.polygon) }
    }

    var body: some View {
        VStack(spacing: 0) {
            HousePlanCanvas(scans: scans)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .padding(16)

            stats
                .padding(.horizontal, 16)

            VStack(spacing: 10) {
                // The whole house goes up as one mozu.homescan/1, so every room
                // arrives on the laptop under a single code, in place.
                Button {
                    Task { await sendToWeb() }
                } label: {
                    Label(
                        sending ? "Sending…" : "Send house to MOZU web",
                        systemImage: "arrow.up.forward.app"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(sending)

                if let ticket {
                    HandoffTicketView(ticket: ticket)
                }
                if let sendError {
                    Text(sendError)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button {
                    showDesign = true
                } label: {
                    Label("Design house", systemImage: "house.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)

                HStack(spacing: 10) {
                    ShareLink(
                        item: Handoff.prettyJSON(home),
                        preview: SharePreview("MOZU home scan")
                    ) {
                        Label("Share house", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)

                    Button(action: onRescan) {
                        Label("Rescan", systemImage: "arrow.clockwise").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
                .controlSize(.large)

                // Same address as the single-room screen (they share the stored value).
                DisclosureGroup("Advanced") {
                    HStack(spacing: 8) {
                        TextField("MOZU web address", text: $webBase)
                            .textFieldStyle(.roundedBorder)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                        if webBase != ScanHandoff.defaultWebBase {
                            Button("Reset") { webBase = ScanHandoff.defaultWebBase }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                        }
                    }
                    .padding(.top, 6)
                }
                .font(.footnote)
            }
            .padding(16)
        }
        .fullScreenCover(isPresented: $showDesign) {
            let primary = scans[primaryIndex]
            let extras = scans.indices.filter { $0 != primaryIndex }.map { scans[$0] }
            DesignContainerView(scan: primary, extraScans: extras)
        }
    }

    private func sendToWeb() async {
        sending = true
        sendError = nil
        defer { sending = false }
        do {
            ticket = try await ScanHandoff.send(home, webBase: webBase)
        } catch {
            ticket = nil
            sendError = error.localizedDescription
        }
    }

    private var stats: some View {
        HStack(spacing: 8) {
            stat("Rooms", "\(scans.count)")
            stat("Total area", Units.area(totalAreaMm2, scans[0].unitSystem))
            stat("Ceiling", Units.length(scans.map(\.height).max() ?? 0, scans[0].unitSystem))
            stat("Openings", "\(scans.reduce(0) { $0 + $1.openings.count })")
        }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(.subheadline.weight(.semibold)).monospacedDigit()
            Text(label.uppercased()).font(.system(size: 9)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - Handoff code

/// The six-character code to type on the laptop, after a room or a house is sent.
/// Shared by the single-room and whole-house screens.
struct HandoffTicketView: View {
    let ticket: ScanHandoff.Ticket

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("On your computer, go to \(URL(string: ticket.url)?.host ?? "MOZU") and enter")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(ticket.code)
                .font(.system(size: 40, weight: .bold, design: .monospaced))
                .kerning(6)
                .textSelection(.enabled)
            Text(ticket.url)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - Combined plan canvas

/// Draws every room polygon at a shared scale — the rooms are already in one
/// coordinate space, so this is a direct overlay, like an architect's plan.
private struct HousePlanCanvas: View {
    let scans: [RoomScan]

    private let floorTones: [Color] = [
        Color(red: 0.957, green: 0.949, blue: 0.933),
        Color(red: 0.936, green: 0.945, blue: 0.952),
        Color(red: 0.952, green: 0.938, blue: 0.946),
        Color(red: 0.938, green: 0.952, blue: 0.938),
    ]
    private let wallColor = Color(red: 0.12, green: 0.16, blue: 0.22)
    private let dimColor = Color(red: 0.42, green: 0.45, blue: 0.50)

    var body: some View {
        Canvas { context, size in draw(in: &context, size: size) }
            .background(Color.white)
    }

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        // Pair each scan with its cleaned polygon BEFORE filtering degenerate rooms,
        // so indices into scans and polys can never drift apart.
        let rooms = scans.map { (scan: $0, poly: Geo.ensureCCW(Geo.simplify($0.polygon))) }
            .filter { $0.poly.count >= 3 }
        let polys = rooms.map(\.poly)
        guard !polys.isEmpty else { return }

        // Shared bounds over every room (millimetres).
        let all = polys.flatMap { $0 }
        let minX = all.map(\.x).min() ?? 0, maxX = all.map(\.x).max() ?? 1
        let minZ = all.map(\.z).min() ?? 0, maxZ = all.map(\.z).max() ?? 1
        let span = max(maxX - minX, maxZ - minZ, 1)
        let pad = max(span * 0.12, 600)
        let scale = min(size.width / (maxX - minX + pad * 2),
                        size.height / (maxZ - minZ + pad * 2))
        let offX = (size.width - (maxX - minX + pad * 2) * scale) / 2
        let offY = (size.height - (maxZ - minZ + pad * 2) * scale) / 2

        func p(_ v: Vec2) -> CGPoint {
            CGPoint(x: offX + (v.x - minX + pad) * scale,
                    y: offY + (v.z - minZ + pad) * scale)
        }

        let wallPx = min(max(span / 55, 50), 120) * scale
        let fontPx = min(max(span / 22, 130), 340) * scale

        for (i, poly) in polys.enumerated() {
            var path = Path()
            path.addLines(poly.map(p))
            path.closeSubpath()
            context.fill(path, with: .color(floorTones[i % floorTones.count]))
            context.stroke(path, with: .color(wallColor),
                           style: StrokeStyle(lineWidth: wallPx, lineJoin: .miter))
        }

        // Openings cut through the shared walls so doorways read as connections.
        for (i, room) in rooms.enumerated() {
            let fp = Floorplan.build(from: room.scan)
            for op in fp.openings where op.wall < fp.walls.count {
                let wall = fp.walls[op.wall]
                let dir = Geo.normalize(Geo.sub(wall.end, wall.start))
                let total = Geo.distance(wall.start, wall.end)
                let o = min(max(op.offset - op.width / 2, 0), max(0, total - op.width))
                let a = Vec2(x: wall.start.x + dir.x * o, z: wall.start.z + dir.z * o)
                let b = Vec2(x: wall.start.x + dir.x * (o + op.width),
                             z: wall.start.z + dir.z * (o + op.width))
                var cut = Path()
                cut.move(to: p(a))
                cut.addLine(to: p(b))
                let tone = floorTones[i % floorTones.count]
                context.stroke(cut, with: .color(op.type == .window ? .white : tone),
                               lineWidth: wallPx * 1.3)
            }
        }

        // Room labels: number + area at each centroid.
        for (i, room) in rooms.enumerated() {
            let c = p(Geo.centroid(room.poly))
            context.draw(
                Text("Room \(i + 1)")
                    .font(.system(size: fontPx * 0.75, weight: .semibold))
                    .foregroundColor(wallColor),
                at: c
            )
            context.draw(
                Text(Units.area(Geo.area(room.poly), room.scan.unitSystem))
                    .font(.system(size: fontPx * 0.6))
                    .foregroundColor(dimColor),
                at: CGPoint(x: c.x, y: c.y + fontPx * 0.95)
            )
        }
    }
}
