# apple-app-site-association

Apple reads `https://<domain>/.well-known/apple-app-site-association` to confirm
this website owns the MOZU Scan App Clip. Apple's rules for the file:

- served over HTTPS with a valid certificate, with **no redirect**
- body is JSON (no file extension); `vercel.json` sets `Content-Type: application/json`
- at most 128 KB

Before the clip can launch from this domain, replace `TEAMID` with the Apple
Developer **Team ID** (developer.apple.com → Membership details; 10 characters).
The bundle id `com.averyhsu.roommuse.Clip` must match `PRODUCT_BUNDLE_IDENTIFIER`
of the `MozuScannerClip` target in `apps/ios/project.yml`, and the domain must match
that target's `associated-domains` entitlement (`appclips:<domain>`).

Check after deploying (the device never reads the file directly; Apple's CDN does):

```bash
curl -sI https://roommuse-design.vercel.app/.well-known/apple-app-site-association
curl -s https://app-site-association.cdn-apple.com/a/v1/roommuse-design.vercel.app
```
