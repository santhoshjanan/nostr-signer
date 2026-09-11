# Nostr Signer

[![CI](https://github.com/santhoshjanan/nostr-signer/actions/workflows/ci.yml/badge.svg)](https://github.com/santhoshjanan/nostr-signer/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/santhoshjanan/nostr-signer?label=release)](https://github.com/santhoshjanan/nostr-signer/releases/latest)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-blue)](https://github.com/santhoshjanan/nostr-signer/releases/latest)

Your own personal Nostr "bunker" — keep your nsec on your own machine, and let web clients sign in and post without ever seeing your private key.

Nostr Signer is a friendly little desktop app that speaks [NIP-46](https://github.com/nostrasp/nips/blob/master/46.md) (remote signing). Generate or import a key once, keep the app running, and any NIP-46-capable web client can connect with a `bunker://` URI and ask you to approve each action — no copying your nsec into random websites ever again.

Your key is encrypted at rest via Electron `safeStorage` (Windows DPAPI, macOS Keychain, or the Linux Secret Service/libsecret keyring) and only ever exists unencrypted in the app's own memory while it's running.

> **Linux users:** you'll need a running Secret Service provider (GNOME Keyring, KWallet, etc.) — `safeStorage` needs somewhere to keep the encryption key. Headless/no-keyring setups won't be able to encrypt.

## Download

Grab the latest build for your OS from the **[Releases page](https://github.com/santhoshjanan/nostr-signer/releases/latest)** — no build tools required:

| Platform | What to grab |
| --- | --- |
| 🪟 Windows | `nostr-signer-vX.Y.Z-win.zip` — unzip, then run `Nostr Signer.exe` |
| 🍎 macOS | `nostr-signer-vX.Y.Z-mac.zip` — unzip, then open `Nostr Signer.app` |
| 🐧 Linux | `nostr-signer-vX.Y.Z-linux.zip` — unzip, then run `nostr-signer` |

These are unpacked app folders, not installers — just extract the zip and run the executable inside. Releases are versioned with [semver](https://semver.org/), so `vX.Y.Z` tells you exactly what changed (see each release's notes for details).

Prefer to build it yourself instead? Keep reading.

## Develop

```powershell
npm install
npm run dev        # builds TypeScript and launches Electron
```

## Test

```powershell
npm test           # vitest: unit + protocol + e2e (BunkerSigner through a mock relay bus)
```

## Build (unpacked directory, no installer)

```powershell
npm run dist       # electron-builder --dir
```

Output (unpacked, no installer, on every platform): `dist\win-unpacked\` (`Nostr Signer.exe`), `dist/mac/` (`Nostr Signer.app`), or `dist/linux-unpacked/` (`nostr-signer`) depending on the OS you build on — electron-builder does not cross-compile the `dir` target, so build on the platform you're packaging for. Run in place or copy the folder anywhere.

`npm run build` (which `dist`/`dev` both run first) does two steps, in order:

1. `tsc -b tsconfig.node.json tsconfig.web.json` — type-checks and compiles everything, including a plain, unbundled `out/renderer/app.js`.
2. `node scripts/build-renderer.mjs` — re-bundles `src/renderer/app.ts` with esbuild and overwrites that same `out/renderer/app.js`, then copies `index.html`/`styles.css` into `out/renderer/`.

Step 2 is required, not optional: `app.ts` does a bare `import * as QRCode from "qrcode"`, and Chromium's ES-module loader (which loads the renderer's `<script type="module">` directly, with no bundler in front of it) cannot resolve a bare specifier like `"qrcode"` — only relative/absolute URLs. `tsc`'s own output leaves that `import` untouched and would throw at runtime; esbuild bundles `qrcode` into the emitted file so the renderer loads without a module resolution error.

### Renderer smoke test

```powershell
npm run smoke:renderer
```

Launches a real (hidden) Electron `BrowserWindow` with the same `webPreferences` as the app, loads `out/renderer/index.html`, and asserts: the page didn't fail to load, the renderer process didn't crash, `document.getElementById('onboarding')` exists, `window.signerApi` was exposed by the preload bridge, and no console errors were logged. It stubs only the `hasKey` IPC channel (returning `false`) so `app.ts`'s unconditional startup call succeeds — it does not touch the keyvault or open any relay connections. This is the check that would have caught the `qrcode` bundling issue above: a plain `tsc`-only build fails this smoke test with a console error from the failed module resolution, even though `npm run typecheck` passes cleanly.

Run it with `ELECTRON_RUN_AS_NODE` unset (see Troubleshooting below) — it needs a real Electron GUI process, not the Node CLI mode.

## Data location

`app.getPath("appData")/nostr-signer/` — `%APPDATA%\nostr-signer\` on Windows, `~/Library/Application Support/nostr-signer/` on macOS, `~/.config/nostr-signer/` on Linux:

- `key` — encrypted nsec (base64), via `safeStorage`. Useless if copied to another user account/machine/OS — the encryption key never leaves the OS keychain it was created under.
- `clients.json` — known client pubkeys, friendly names, connected-at.
- `rules.json` — persisted "always allow" rules (client pubkey + action type).
- `log.json` — activity log (capped at 1000 entries).
- `relays.json` — relay list (defaults: relay.damus.io, nos.lol, relay.nostr.band).

## Manual smoke test (throwaway key!)

1. `npm run dev` → onboarding → **Generate new key** (use a throwaway key, not your real nsec).
2. Copy the bunker URI from the dashboard.
3. Open a NIP-46-capable web client (e.g. any client with a "login with bunker" option), paste the URI.
4. In the app: approve the **New client wants to connect** popup → client appears in the Clients list.
5. Post a short note from the web client → approve **Allow once** in the popup → note is signed and published by the client.
6. Post another note → approve **Always allow** → subsequent kind-1 notes sign silently.
7. Verify each decision and signed event appears in the dashboard activity log.
8. Close the app and post from the web client → the client should report the signer unresponsive (requests wait on relays; nothing is signed while the app is off).

## Troubleshooting

**`out/` looks stale (edits don't seem to take effect, or deleted files still show up compiled).**
`tsc -b` is incremental and trusts the root `tsconfig.node.tsbuildinfo` / `tsconfig.web.tsbuildinfo` cache files. If one of those gets out of sync with the actual `src/` tree, `tsc -b` can silently no-op instead of recompiling. Delete `out/` and the root `*.tsbuildinfo` files, then rebuild:

```powershell
Remove-Item -Recurse -Force out, tsconfig.node.tsbuildinfo, tsconfig.web.tsbuildinfo, tsconfig.shared.tsbuildinfo -ErrorAction SilentlyContinue
npm run build
```

**Electron fails to start with a cryptic `Cannot read properties of undefined` error.**
This is almost always the `ELECTRON_RUN_AS_NODE` environment variable being set in your shell (some tools/agents set it globally to run Node scripts through the `electron` binary). With it set, `electron .`/`npm start`/`npm run dev`/`npm run smoke:renderer` all launch Electron in plain-Node mode instead of the real app/GUI mode, so `app`, `BrowserWindow`, etc. are `undefined` and the failure looks unrelated to the actual cause. Unset it before running the app:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```
