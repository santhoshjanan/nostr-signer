---
version: 1
slug: "src-renderer-index-html"
primary_target: "src/renderer/index.html"
related_targets: []
---

## Scope

Main renderer screen: `src/renderer/index.html`, `src/renderer/styles.css`, and the DOM behavior in `src/renderer/app.ts` that toggles/populates it (onboarding, dashboard, approval modal). Mode: **Operate**. No comp-led round: no image-generation tool is available this session (no harness-native image tool, no `OPENAI_API_KEY`); this is a code-led build per new-work.md's Code-led path, so ambition lives in this contract's FIRST VIEWPORT block and is audited at finish.

Audience: a single technical operator (the developer/owner), comfortable with key material and Nostr concepts, monitoring the app in a corner of their screen for long stretches and glancing at it several times a day. Job: confirm the key is safe, see relay/client state at a glance, and resolve an approval prompt in seconds without ambiguity. Constraints: existing CSP (`default-src 'self'; style-src 'self'; img-src 'self' data:` — no remote fonts/scripts), `color-scheme: light dark` must keep working, all current element IDs/classes referenced by `app.ts` must keep working (`#app-error`, `#onboarding`, `#dashboard`, `#bunker-uri-section`, `#qr`, `#relay-list`, `.relay-dot`/`.connected`, `#client-list`, `#activity-log`, `#settings-section`, `#approval-modal`, `.modal-card`, `#approval-preview`), and the `[hidden]` `!important` guard must be preserved verbatim.

## Direction contract

**THESIS** — This is a vault antechamber, not a dashboard: every surface reads as physical security instrumentation guarding one key, not as an app.

**OWN-WORLD** — Gunmetal/steel grounds, one brass accent reserved for the single live/active thing (a lit dial, an armed stamp), muted vault-red for deny/error, muted signal-green for connected/approved. Never bright saturated color outside those two signal roles. Type: Big Shoulders (condensed industrial slab, stamped-plate character) for headers/labels/buttons; IBM Plex Mono for every data value (nsec, bunker URI, pubkeys, log rows) — a deliberate break from the generic warm-serif/near-black-neon AI defaults.

**STORY** — You open the antechamber onto one brass-ringed dial (the key's guarded state), a bank of numbered deposit-box rows below it (clients), and a ruled ledger at the foot of the page (activity log) stamped as each event lands.

**FIRST VIEWPORT** — Header reads as an engraved brass plate over gunmetal. The bunker-URI panel is the vault's one open dial: URI in mono inside an inset steel plate, QR as a stamped medallion, Copy as a brass lever-button. Relay dots become small pilot lamps (lit brass = connected, dim red = not) on a riveted steel strip.

**FORM** — Panels are riveted steel plates (double inset border, corner rivet marks via small radial-gradient dots), never flat cards. Buttons are stamped brass levers with a pressed-state inset shadow. The approval modal is a ledger entry sliding up from the foot of the page, requiring a stamp (Allow once/Always allow/Deny act as physical stamp buttons) before it closes.

**FINISH** — Signature motion: the live/connected pilot lamp gets a slow brass glow-pulse (steady, not blinking, respecting `prefers-reduced-motion`); the approval modal's stamp buttons give a quick mechanical press (scale+shadow collapse) on click before the modal slides away.

## Unresolved decisions

- Exact brass/steel/red/green hex values and spacing scale are the builder's to finalize within this contract, not re-litigated with the user.
- No new non-self font/image network requests: Big Shoulders and IBM Plex Mono ship as bundled `@font-face` files (or a system-stack fallback if bundling weight is a concern), never a Google Fonts network request, to respect the existing CSP.

Direction: pick card (Vault antechamber), seed key b28a2e65, catalog id vault-antechamber (Impeccable's Pick, presented against assigned index 7 / numbers-station-intercept-log).
