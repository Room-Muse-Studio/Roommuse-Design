// The `RoomScan` contract — the Swift mirror of @mozu/scan-sdk's `mozu.roomscan/1`.
// A scan serializes to the exact same JSON the web app and extensions speak, so
// the iOS RoomPlan scan drops straight into the MOZU configurator via /scan.
//
// Units: millimetres. Floor plane is X (right) / Z (forward); Y is up.

import Foundation

/// A point on the top-down floor plane (millimetres).
struct Vec2: Codable, Hashable {
    var x: Double
    var z: Double
}

enum ScanSource: String, Codable {
    case roomplan, webxr, camera, manual
}

/// A door / window / opening detected on a wall.
struct ScanOpening: Codable, Equatable {
    enum Kind: String, Codable { case door, window, archway }
    var type: Kind
    /// Index of the wall (edge i → i+1) this opening sits on.
    var wall: Int
    /// Distance from the wall's start vertex to the opening's LEADING edge
    /// (millimetres) — the opening spans [offset, offset + width]. This matches
    /// @mozu/scan-sdk exactly; emitting the centre here shifts everything by
    /// half a width on the web side.
    var offset: Double
    var width: Double
    var height: Double
    /// Bottom of the opening above the floor (0 for doors).
    var sill: Double?
    /// RoomPlan's identifier for this door/window/opening (UUID string).
    var id: String? = nil
}

/// A detected object (furniture / appliance) from the scan.
struct ScanObject: Codable, Equatable {
    var category: String
    var center: Vec2
    var width: Double
    var depth: Double
    /// Y rotation, radians.
    var rotation: Double
    /// Height (millimetres), when RoomPlan reports it — drives the box massing.
    var height: Double? = nil
    /// Bottom of the object above the floor (millimetres): 0 for a floor unit,
    /// well above it for a wall cabinet or shelf.
    var elevation: Double? = nil
    /// RoomPlan's identifier for this object (UUID string).
    var id: String? = nil
}

/// A mechanical/electrical/plumbing point found on a wall — a socket, a switch,
/// or exposed pipework. Mirrors `ScanFixture` in @mozu/scan-sdk, so a fixture
/// detected on the iPad arrives in the web configurator unchanged.
struct ScanFixture: Codable, Equatable {
    enum Kind: String, Codable { case socket, `switch`, water, waste, gas, vent, radiator }
    /// How it got onto the plan. Detection is the default path; `manual` is the
    /// optional correction.
    enum Source: String, Codable { case detected, manual }

    var type: Kind
    /// Index of the wall (edge i → i+1) this fixture sits on.
    var wall: Int
    /// Distance along the wall from its start vertex (millimetres).
    var offset: Double
    /// Height of the fixture centre above the floor (millimetres).
    var height: Double
    var source: Source
    /// Detector confidence 0…1 (1 for a user-asserted fixture).
    var confidence: Double
    /// Measured outside diameter for pipework (millimetres), when sized.
    var diameterMm: Double? = nil
    /// Stable identifier (UUID string). RoomPlan has no fixtures, so the app
    /// assigns one when the fixture is created; moving a fixture keeps it.
    var id: String? = UUID().uuidString
}

/// The normalized capture, identical in shape to the SDK's `RoomScan`.
struct RoomScan: Codable, Equatable {
    var schema: String = "mozu.roomscan/1"
    /// Stable room identifier. Connections between rooms in a HomeScan refer to it.
    var id: String?
    /// Display name, e.g. "Room 2".
    var name: String?
    /// Room kind when known, e.g. "kitchen".
    var type: String?
    /// Ordered, closed floor polygon (millimetres). 3+ vertices.
    var polygon: [Vec2]
    /// RoomPlan's identifier for each wall, parallel to `polygon`: `wallIds[i]`
    /// is edge i → i+1. `nil` for an edge no single scanned wall matches.
    var wallIds: [String?]?
    /// Ceiling height (millimetres).
    var height: Double
    var openings: [ScanOpening]
    var objects: [ScanObject]
    /// Sockets and pipework found on the walls during this scan.
    var fixtures: [ScanFixture]
    var source: ScanSource
    var unitSystem: String
    var confidence: Double
    var capturedAt: String

    init(
        polygon: [Vec2],
        wallIds: [String?]? = nil,
        height: Double,
        openings: [ScanOpening] = [],
        objects: [ScanObject] = [],
        fixtures: [ScanFixture] = [],
        source: ScanSource = .roomplan,
        unitSystem: String = "metric",
        confidence: Double = 0.92,
        capturedAt: String = ISO8601DateFormatter().string(from: Date())
    ) {
        self.polygon = polygon
        self.wallIds = wallIds
        self.height = height
        self.openings = openings
        self.objects = objects
        self.fixtures = fixtures
        self.source = source
        self.unitSystem = unitSystem
        self.confidence = confidence
        self.capturedAt = capturedAt
    }

    /// Compact JSON (matches `serializeScan` in the SDK).
    func jsonData() -> Data? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        return try? encoder.encode(self)
    }
}

/// Several rooms scanned in one session — the Swift mirror of @mozu/scan-sdk's
/// `mozu.homescan/1`. Every room is a complete `RoomScan`, and because the AR
/// session stays alive between rooms, all their polygons share one coordinate
/// space: the rooms land at their real positions relative to each other.
///
/// Which doors and walls two rooms share (`connections` in the SDK) isn't sent:
/// the web side works that out from the geometry (`findConnections`).
struct HomeScan: Codable, Equatable {
    var schema: String = "mozu.homescan/1"
    var rooms: [RoomScan]
    var capturedAt: String

    /// Wrap the rooms of one session. A room without an id or name gets one here
    /// ("room-2", "Room 2") so the web side can tell the rooms apart; the numbering
    /// matches the house plan, which labels rooms in scan order.
    init(rooms: [RoomScan], capturedAt: String = ISO8601DateFormatter().string(from: Date())) {
        self.rooms = rooms.enumerated().map { index, room in
            var room = room
            if room.id?.isEmpty ?? true { room.id = "room-\(index + 1)" }
            if room.name?.isEmpty ?? true { room.name = "Room \(index + 1)" }
            return room
        }
        self.capturedAt = capturedAt
    }

    /// Compact JSON, the same shape the SDK's `serializeHomeScan` produces.
    func jsonData() -> Data? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        return try? encoder.encode(self)
    }
}
