# Nostr Signer

A personal NIP-46 remote signer ("bunker") for Windows. Your nsec is encrypted at rest with Windows DPAPI (via Electron `safeStorage`) and only ever exists in the main process's memory. Web clients connect by pasting the `bunker://` URI shown in the app.

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

Output: `dist\win-unpacked\` containing `Nostr Signer.exe` and resources. Run in place or copy the folder anywhere.

## Data location

`%APPDATA%\nostr-signer\`:

- `key` — DPAPI-encrypted nsec (base64). Useless if copied to another Windows account/machine.
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
