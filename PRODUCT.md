# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A single technical user (the developer/owner) running this on their own Windows machine for personal use. There is no multi-user, multi-tenant, or public-facing audience. The user is comfortable with cryptographic key material, Nostr protocol concepts (NIP-46, relays, kinds), and Windows-native security mechanisms (DPAPI). The "job" is: keep a Nostr private key (nsec) off every web client that wants to sign as them, while still being able to log into and use those web clients day to day.

## Product Purpose

A personal NIP-46 remote signer ("bunker") for Windows. It holds one Nostr private key, encrypted at rest via Windows DPAPI (Electron `safeStorage`), decrypted only in the main process's memory while running. Nostr web clients connect by pasting a `bunker://` URI shown in the app; from then on, signing requests arrive over relays, are matched against a per-client, per-action-type permission policy, and are either signed silently or surfaced for a one-time approval decision. Success = the user can use any NIP-46-capable Nostr client without that client, or the website hosting it, ever holding the nsec.

## Positioning

Not a hosted/multi-tenant signing service and not a browser extension — it is a self-hosted, single-key desktop bunker that a neighboring "cloud signer" product could not truthfully replicate, because the private key never leaves this one machine's main-process memory and is encrypted with a key tied to this Windows user account (DPAPI). The permission model ("approve a client once, approve an action type once, then automatic") is the specific mechanism that makes daily use frictionless without weakening that guarantee.

## Operating Context

- Runs as a normal windowed Electron desktop app on Windows (`npm run dev` / unpacked `dist\win-unpacked\Nostr Signer.exe`), not a background service or tray app.
- The user's daily workflow: leave the app running, use one or more NIP-46-capable Nostr web clients in a browser, occasionally respond to an approval popup that appears in this app's window (flashing the taskbar if unfocused).
- If the app isn't running, clients report the signer unresponsive — this is the intended fail-safe behavior, not a bug to hide from the user.
- Onboarding happens once: paste an existing nsec or generate a new one.
- Settings-level maintenance: edit the relay list, rename/revoke/reset-approvals per client, review the activity log.

## Capabilities and Constraints

- Supported NIP-46 methods: `connect`, `sign_event`, `get_public_key`, `ping`, `nip04_encrypt`, `nip04_decrypt`, `nip44_encrypt`, `nip44_decrypt`.
- `bunker://` pairing only — no `nostrconnect://` flow (explicit non-goal, possible future addition).
- Single key, single account, no multi-key/multi-account support (non-goal).
- No installer — `electron-builder --dir` (unpacked directory) only; no system tray, no start-with-Windows (explicit non-goals).
- Fail-safe security posture: any ambiguity, crash, malformed/undecryptable request, or bug must never result in a signature. Denied/unknown-method requests get an explicit NIP-46 protocol error, not silence.
- Renderer process is untrusted by design: the preload/contextBridge IPC surface never carries key material, only pubkeys and metadata.
- "Action type" granularity: `sign_event` is split per event kind (e.g. `sign_event:kind-1` vs `sign_event:kind-7` are separate approvals); every other method needs only connection-level approval.
- Terminology the UI must use consistently: nsec, bunker URI, relay, client (a connected Nostr app), action type, allow once / always allow / deny.

## Brand Commitments

Name: "Nostr Signer." No logo, illustration system, or marketing identity exists yet — the current UI is a functional, unstyled-by-design HTML/CSS shell (system font stack, `color-scheme: light dark`, no custom palette). Treat this as absence of a visual world, not a constraint to preserve verbatim.

## Evidence on Hand

- `docs/superpowers/specs/2026-09-02-windows-nostr-remote-signer-design.md` — the approved design spec; source of truth for architecture, data flow, and error-handling behavior above.
- `docs/superpowers/plans/2026-09-02-nostr-remote-signer.md` — implementation plan derived from that spec.
- `README.md` — developer-facing build/run/test/troubleshooting instructions and the manual smoke-test script (also a good source for real UI copy/flow, since it walks the exact on-screen states: onboarding → dashboard → approval popup → activity log).
- No testimonials, customer names, screenshots, or marketing copy exist; none should be fabricated. Data on disk (`%APPDATA%\nostr-signer\`: `key`, `clients.json`, `rules.json`, `log.json`, `relays.json`) is real structure, not sample content — the activity log and client list are the only "real data" this product ever shows, and both start empty.

## Product Principles

1. Never widen the trust boundary for the sake of convenience — the renderer stays untrusted, the key never crosses IPC, and every automatic approval traces back to an explicit earlier "always allow" decision from the user.
2. Fail closed, always visibly. An error state should look like an error, never like quiet success, because the alternative failure mode (signing something it shouldn't) is unacceptable.
3. Approval friction should trend to zero over time for a given (client, action type) pair, but never for a pair the user hasn't explicitly approved.
4. This is a single-operator security tool, not a multi-tenant product — clarity and auditability (the activity log, per-client state) matter more than breadth of features or onboarding for unfamiliar users.
5. The desktop chrome should read as calm, native-feeling instrumentation for a security-sensitive background process — not as a marketing surface, and not as a toy.

## Accessibility & Inclusion

No standard was specified as a requirement. `styles.css` already respects `color-scheme: light dark` and uses system UI colors (`Canvas`/`CanvasText`) in the approval modal; carry that light/dark awareness forward as a baseline rather than a stretch goal, since the app already depends on it.
