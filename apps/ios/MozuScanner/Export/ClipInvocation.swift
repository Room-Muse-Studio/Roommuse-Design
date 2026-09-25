// How the App Clip was opened. The website's "Scan with your iPhone" panel
// shows a QR code for `https://<host>/clip?s=<session>`; when the clip sends the
// scan it echoes that session id, so the laptop page can pick the room up
// without anyone typing the 6-character code. The full app is launched from
// the home screen and never has one, so everything here is optional.

import Foundation

struct ClipInvocation: Equatable {
    /// Session id from the invocation URL's `s` query item, or nil.
    var session: String?

    /// Session ids are opaque, short and alphanumeric; anything else is ignored
    /// rather than sent on to the server.
    static func isValidSession(_ value: String) -> Bool {
        (8...32).contains(value.count) && value.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) }
    }

    /// Parse an invocation URL such as `https://roommuse-design.vercel.app/clip?s=K7Q2M9XZ4P`.
    static func parse(_ url: URL?) -> ClipInvocation {
        guard let url,
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let raw = items.first(where: { $0.name == "s" })?.value?.trimmingCharacters(in: .whitespaces),
              isValidSession(raw) else {
            return ClipInvocation(session: nil)
        }
        return ClipInvocation(session: raw)
    }
}
