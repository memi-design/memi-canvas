# macOS release and download contract

Memi Canvas ships macOS downloads through GitHub Releases. The public landing page should link to the stable asset URL rather than a build-run artifact:

```text
https://github.com/memi-design/memi-canvas/releases/latest/download/Memi.Canvas-latest-arm64.dmg
```

## Release flow

1. Merge the release-ready branch after Gate A and release review are green.
2. Configure a protected `macos-release` environment and protect release tags such as `v*.*.*`.
3. Create a protected tag, for example `v0.1.0`.
4. The `macOS release` workflow checks out the explicit tag ref, proves that the checked-out commit is the tag target, and runs dependency installation and release verification without Apple credentials in scope.
5. The workflow builds both Tauri production bundles, verifies the DMG, creates the versioned `.app.zip`, and writes `release-manifest.json` and `SHA256SUMS.txt`. It then extracts the exact versioned app archive and mounts the exact versioned DMG, running the packaged native smoke proof against both upload candidates before publishing the six expected assets.
6. Add the stable DMG URL to the landing page’s download button and record the release tag in the screen recording description.

The workflow also supports a manual run for an existing tag. It never packages an untagged working tree.

The first public WIP release should use a normal tag such as `v0.1.0` so GitHub's `releases/latest` URL resolves for the landing page. Use a hyphenated tag such as `v0.1.0-preview.1` when you intentionally want a prerelease; prereleases do not become the `latest` release.

## Signing states

The workflow is safe without Apple credentials. In that mode the manifest reports `signed: false` and `notarized: false`; the release is an unsigned development preview and macOS Gatekeeper may require the user to approve it in System Settings.

For a public release, configure the repository’s protected environment with Apple Developer ID certificate and notarization secrets (`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, optional `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID`) plus a temporary `KEYCHAIN_PASSWORD`. The workflow imports the base64 `.p12` into an ephemeral CI keychain, builds with Tauri signing/notarization enabled, verifies the resulting app, and records the signed/notarized state in the manifest. A configured signing run fails closed unless both Developer ID signing and notarization verification succeed. Apple values are scoped only to the certificate-import and signed-build steps; they are not available to dependency lifecycle scripts, verification tests, packaging, smoke, or upload. Secrets and the temporary keychain are never written to the repository or release assets.

## Artifact verification

Download `SHA256SUMS.txt` from the same release and verify the DMG before opening it:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

The versioned asset remains available for reproducibility; the `latest` aliases exist only to give the landing page a stable download button.

`release-manifest.json` uses the `memi.macos-release.v2` schema. It records the exact source commit SHA, GitHub repository, workflow ref, run ID and attempt, and an immutable run URL alongside the projected signing state and per-artifact SHA-256 digests. Treat the source SHA and run URL as the authority for tracing a download back to its build.
