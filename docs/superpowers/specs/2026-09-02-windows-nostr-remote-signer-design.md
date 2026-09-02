# Windows Nostr Remote Signer (NIP-46 Bunker) — Design Spec

Date: 2026-09-02
Status: Approved

## Summary

A personal-use Windows desktop application that acts as a NIP-46 remote signer ("bunker"). It holds a single Nostr private key (nsec) encrypted at rest with Windows DPAPI, listens on Nostr relays for encrypted signing requests from client applications, and signs on the user's behalf according to a per-client, per-action-type permission policy. Clients connect by pasting a `bunker://` URI shown in the app.

## Goals

- Keep the nsec off websites/clients entirely; the key never leaves the app.
- Approve each client once, and each action type per client once ("fully automatic after first approval").
- Audit trail: every signing decision and signed event is logged and visible.
- Personal use, single key, windowed app.
- Learning-friendly: the entire codebase is TypeScript.

## Non-goals (YAGNI)

- No installer — electron-builder `dir` target only (unpacked application directory).
- No system tray, no start-with-Windows.
- No multi-key/multi-account support.
- No `nostrconnect://` flow (bunker:// only). Possible future addition.
- No public/multi-tenant signing service features (rate limiting, admin tokens, etc.).

## Technology choices

| Area | Choice | Rationale |
|---|---|---|
| Language | TypeScript everywhere | User's comfort; learning focus stays on Nostr, not language interop |
| Framework | Electron | One language; mature Windows support; `safeStorage` = DPAPI; chosen over Tauri (would add Rust) and plain Node+localhost UI (not a real Windows app) |
| Nostr library | nostr-tools | Relay pooling, event signing, NIP-04/NIP-44 encryption; BunkerSigner (client side) doubles as our end-to-end test partner |
| Key protection | Windows DPAPI via Electron `safeStorage` | Key encrypted at rest tied to Windows user account; no password prompt at startup |
| Testing | vitest | Fast, TS-native |
| Packaging | electron-builder, `dir` target only | User explicitly declined an installer |

## Architecture

Two halves separated by a hard security boundary:

### Main process (Node.js — trusted)

- **KeyVault** — encrypts/decrypts the nsec via DPAPI (`safeStorage`); holds the decrypted key in memory only while running; plaintext never touches disk. The only component that touches key material.
- **BunkerCore** — the NIP-46 engine: maintains the relay pool, subscribes to kind-24133 events tagged with the signer's pubkey, decrypts requests (NIP-04 or NIP-44), dispatches methods, signs, encrypts and publishes responses.
- **PolicyEngine** — answers: "client X wants action Y → allow, deny, or ask?" Persists "always allow" rules per (client pubkey, action type).
- **ClientRegistry** — known clients: pubkey, user-assigned friendly name, connected timestamp, saved permissions. Supports rename, revoke, reset approvals.
- **Storage** — JSON files under `%APPDATA%/nostr-signer/`. The key itself is stored as a DPAPI-encrypted blob, separate from plaintext JSON state.

### Renderer process (UI — untrusted)

- First-run onboarding: paste existing nsec or generate a new key
- Dashboard: bunker URI with copy button + QR code; per-relay status; connected clients list; activity log
- Approval popup (modal in the main window) when a decision is needed
- Settings: editable relay list

### Preload / contextBridge

A narrow, typed IPC surface: e.g. `getStatus()`, `getBunkerUri()`, `listClients()`, `renameClient()`, `revokeClient()`, `resetClientApprovals()`, `respondApproval(id, decision)`, `getActivityLog()`, `getRelays()/setRelays()`, onboarding calls. **Key material never crosses IPC** — only pubkeys and metadata.

## Data flow

### Setup (once)

1. First run → onboarding → paste nsec or generate → DPAPI-encrypt → save to disk.
2. App connects to configured relays (defaults: `wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.nostr.band`; editable in Settings).
3. Dashboard displays `bunker://<signer-pubkey>?relay=wss://...&secret=<random>` with copy + QR.

### Connecting a client

4. User pastes the URI into a web client.
5. Client sends encrypted `connect` request (kind 24133) addressed to the signer's pubkey.
6. App decrypts → unknown client → approval popup: "New client wants to connect" (pubkey shown; the URI `secret` validates the pairing). Allow → client saved, success response returned.

### Signing (daily loop)

7. Client sends encrypted `sign_event` with the unsigned event.
8. PolicyEngine checks: has this client been approved for this action type? An "action type" is the NIP-46 method, refined by event kind for `sign_event` — e.g. `sign_event:kind-1` (publish note) and `sign_event:kind-7` (reaction) are separate action types; `nip04_decrypt` and `nip44_decrypt` are each their own action type. Every other method (`connect`, `get_public_key`, `ping`) requires only connection-level approval and never prompts per-request.
   - **No** → popup shows client name, action description, and, for `sign_event`, a content preview of the event. Buttons: **Allow once** / **Always allow** / **Deny**. "Always allow" persists a rule; that action type from that client is automatic thereafter.
   - **Yes** → sign immediately, no popup.
9. Response (kind 24133) encrypted to the client's pubkey and published to relays.
10. Every decision and signed event is appended to the activity log (visible in the dashboard).

### Supported NIP-46 methods

`connect`, `sign_event`, `get_public_key`, `ping`, `nip04_encrypt`, `nip04_decrypt`, `nip44_encrypt`, `nip44_decrypt`. Covers login, posting, reacting, zapping, and DM-capable clients.

## Error handling

Fail safe, never fail open. Any ambiguity, crash, or bug → don't sign. Signing requires an explicit successful path through PolicyEngine.

- **Relays down/flaky** → reconnect with backoff; per-relay status on dashboard. Works with ≥1 relay. All down → requests wait; nothing signed, nothing lost.
- **Malformed/undecryptable/hostile requests** → log and drop; must never crash the app or cause a signature.
- **Unknown NIP-46 method** → respond with protocol error ("unsupported method").
- **Denied request** → respond with protocol error ("denied by user").
- **Approval popup while unfocused** → flash taskbar button, bring window forward.
- **App not running** → requests sit on relays; clients report signer unresponsive. Correct failure mode.

## Testing

- **Unit tests (vitest)**: PolicyEngine rule matching (allow/deny/ask per client per kind), KeyVault encrypt→decrypt round-trip, request parsing/validation against malformed inputs.
- **Protocol tests**: NIP-46 handler against a fake in-memory relay — connect handshake, sign_event round-trip, error responses for unknown methods and denials.
- **End-to-end test**: nostr-tools `BunkerSigner` (the client side) talks to our bunker through a mock relay — proves protocol correctness against an independent implementation.
- **Manual smoke test**: connect a real NIP-46 web client using a throwaway test key; post a note; verify it appears in the activity log.

## Packaging

electron-builder, `dir` target only → an unpacked application directory containing the `.exe` and resources. Run in place or copy the folder anywhere. No installer, no registry changes.

## Security notes

- Plaintext key exists only in main-process memory while running.
- Renderer cannot access key material over IPC.
- DPAPI ties the encrypted key blob to the Windows user account — the file is useless if copied elsewhere.
- The approval policy boundary is the security boundary: connection approval + first-approval-per-action-type are the moments of explicit user consent.