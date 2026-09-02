# Nostr Remote Signer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal-use Windows Electron app that acts as a NIP-46 remote signer (bunker): a single nsec encrypted at rest via DPAPI, listening on Nostr relays for encrypted signing requests and approving/signing per per-client, per-action-type policy.

**Architecture:** Two processes separated by a hard security boundary. The Electron main process (trusted) hosts KeyVault (DPAPI encrypt/decrypt via safeStorage, plaintext key in main memory only), BunkerCore (NIP-46 engine: relay pool, kind-24133 subscription, NIP-04/NIP-44 decrypt, dispatch, sign, encrypt+publish), PolicyEngine (per client+action-type allow/deny/ask with persisted "always allow" rules), ClientRegistry, and JSON-file Storage under `%APPDATA%/nostr-signer/`. The renderer (untrusted, no key access) shows onboarding, dashboard (bunker URI + copy + QR, relay status, clients, activity log), approval popup, and settings, reaching the main process only through a narrow typed contextBridge IPC surface over which key material never travels.

**Tech Stack:** TypeScript 5.9 (strict, ESM, NodeNext) everywhere; Electron 38.x; electron-builder 26.x (`dir` target only); nostr-tools 2.17.x (SimplePool, finalizeEvent, generateSecretKey, nip04, nip44, BunkerSigner for E2E); vitest 3.x (+ @vitest/coverage-v8) for tests; `qrcode` 1.5.x for the dashboard QR code. Pin exact versions in package.json as shown in Task 1.

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | npm scripts, pinned deps, electron-builder `dir`-only config |
| `tsconfig.json` | Strict TS, NodeNext ESM, composite root config referencing node/web projects |
| `tsconfig.node.json` | Main-process + shared code build (outDir `out/`) |
| `tsconfig.web.json` | Renderer build (outDir `out/renderer/`) |
| `vitest.config.ts` | Vitest config (node env, tests glob) |
| `.gitignore` | node_modules, dist, out |
| `src/shared/types.ts` | Shared domain types: UnsignedEvent, Nip46Request, Nip46Response, ApprovalRule, ActionType, ClientRecord, LogEntry, RelayStatus, PendingApproval, SafeStorageLike, RelayTransport |
| `src/shared/ipc.ts` | IPC channel-name constants + SignerApi interface (the contextBridge surface) |
| `src/main/keyvault.ts` | KeyVault: DPAPI encrypt/decrypt behind SafeStorageLike, memory-only plaintext |
| `src/main/storage.ts` | Storage: atomic JSON read/write of clients/rules/log/key blob under an injected base dir |
| `src/main/policy.ts` | PolicyEngine: rule matching, persist/forget, client revocation |
| `src/main/clients.ts` | ClientRegistry: add/rename/remove/reset-approvals for known clients |
| `src/main/nip46.ts` | NIP-46 wire layer: request parse/validate, response + error construction, actionTypeOf |
| `src/main/bunker.ts` | BunkerCore: RelayTransport subscription, decrypt, dispatch, sign, encrypt+publish responses |
| `src/main/approvals.ts` | ApprovalQueue: request/response correlation between BunkerCore and IPC |
| `src/main/index.ts` | Electron main entry: lifecycle, BrowserWindow, wiring, IPC handlers, taskbar flash |
| `src/preload/preload.ts` | contextBridge exposure of the typed SignerApi via ipcRenderer |
| `src/renderer/index.html` | Single-page UI markup (onboarding, dashboard, approval modal, settings) |
| `src/renderer/styles.css` | App styles |
| `src/renderer/app.ts` | Renderer logic: consumes window.signerApi, renders state, approval loop |
| `tests/policy.test.ts` | PolicyEngine unit tests |
| `tests/keyvault.test.ts` | KeyVault round-trip unit tests (fake SafeStorageLike) |
| `tests/storage.test.ts` | Storage unit tests (temp dir) |
| `tests/nip46.test.ts` | Request parsing/validation + response construction unit tests |
| `tests/bunker.test.ts` | Protocol tests against an in-memory fake RelayTransport |
| `tests/approvals.test.ts` | ApprovalQueue unit tests |
| `tests/clients.test.ts` | ClientRegistry unit tests |
| `tests/e2e.test.ts` | nostr-tools BunkerSigner (client) vs our bunker through a mock relay |
| `README.md` | Dev/test/build instructions + manual smoke-test steps |

## Conventions used in every task

- ESM only: all imports include the `.js` extension (NodeNext). Tests import source files from `src/` directly (vitest resolves TS).
- Every `npx vitest run <file>` step is executed from the repo root `C:\dev\nostr-signer` in PowerShell 7.
- Commit messages use conventional commits. If `git` is not yet initialized when you reach Task 1, run `git init` once as part of Task 1 Step 5.
- No code comments unless a test needs a clarifying one-liner.

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `tsconfig.web.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/shared/.gitkeep`
- Test: `tests/smoke.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("scaffold", () => {
  it("runs vitest with TypeScript", () => {
    const answer: number = 40 + 2;
    expect(answer).toBe(42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/smoke.test.ts`
Expected: FAIL with "vitest: command not found" / npm error, because dependencies are not installed yet.

- [ ] **Step 3: Write minimal implementation**

Create `package.json` (pinned versions; `postinstall` keeps electron-builder happy later):

```json
{
  "name": "nostr-signer",
  "version": "0.1.0",
  "private": true,
  "description": "Personal NIP-46 Nostr remote signer (bunker) for Windows",
  "main": "out/main/index.js",
  "type": "module",
  "scripts": {
    "build": "tsc -b tsconfig.node.json tsconfig.web.json",
    "dev": "npm run build && electron .",
    "start": "electron .",
    "test": "vitest run",
    "typecheck": "tsc -b tsconfig.node.json tsconfig.web.json --noEmit false",
    "dist": "npm run build && electron-builder --dir",
    "postinstall": "electron-builder install-app-deps"
  },
  "dependencies": {
    "nostr-tools": "2.17.0",
    "qrcode": "1.5.4"
  },
  "devDependencies": {
    "@types/node": "24.3.0",
    "@types/qrcode": "1.5.5",
    "@vitest/coverage-v8": "3.2.4",
    "electron": "38.0.0",
    "electron-builder": "26.0.12",
    "typescript": "5.9.2",
    "vitest": "3.2.4"
  },
  "build": {
    "appId": "dev.nostrsigner.app",
    "productName": "Nostr Signer",
    "directories": {
      "output": "dist"
    },
    "files": [
      "out/**/*",
      "package.json"
    ],
    "win": {
      "target": "dir"
    }
  }
}
```

Create `tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

Create `tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "sourceMap": true,
    "outDir": "out",
    "rootDir": ".",
    "composite": true,
    "types": ["node"]
  },
  "include": ["src/main/**/*", "src/preload/**/*", "src/shared/**/*"]
}
```

Create `tsconfig.web.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "sourceMap": true,
    "outDir": "out",
    "rootDir": ".",
    "composite": true,
    "types": []
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"]
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/main/**", "src/shared/**"]
    }
  }
});
```

Create `.gitignore`:

```
node_modules/
dist/
out/
*.log
```

Create `src/shared/.gitkeep` (empty file), then install dependencies:

Run: `npm install`
Expected: all packages installed; `node_modules/` exists.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/smoke.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```powershell
if (-not (Test-Path .git)) { git init }
git add package.json tsconfig.json tsconfig.node.json tsconfig.web.json vitest.config.ts .gitignore src tests
git commit -m "feat: project scaffold with typescript, vitest, electron tooling"
```

---

### Task 2: Shared Types + IPC Channel Constants

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/ipc.ts`
- Test: `tests/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  actionTypeForSignEventKind,
  CONNECTION_LEVEL_METHODS,
  SUPPORTED_METHODS
} from "../src/shared/types.js";
import { IPC, type SignerApi } from "../src/shared/ipc.js";

describe("shared types", () => {
  it("lists all 8 supported NIP-46 methods", () => {
    expect([...SUPPORTED_METHODS].sort()).toEqual([
      "connect",
      "get_public_key",
      "nip04_decrypt",
      "nip04_encrypt",
      "nip44_decrypt",
      "nip44_encrypt",
      "ping",
      "sign_event"
    ]);
  });

  it("marks connect/get_public_key/ping as connection-level", () => {
    expect([...CONNECTION_LEVEL_METHODS].sort()).toEqual([
      "connect",
      "get_public_key",
      "ping"
    ]);
  });

  it("refines sign_event action types by event kind", () => {
    expect(actionTypeForSignEventKind(1)).toBe("sign_event:kind-1");
    expect(actionTypeForSignEventKind(7)).toBe("sign_event:kind-7");
  });

  it("defines stable IPC channel names", () => {
    expect(IPC.GetStatus).toBe("signer:get-status");
    expect(IPC.RespondApproval).toBe("signer:respond-approval");
    expect(IPC.ApprovalRequested).toBe("signer:approval-requested");
    expect(IPC.ActivityAppended).toBe("signer:activity-appended");
  });

  it("exposes a SignerApi interface shape", () => {
    const apiShape: (keyof SignerApi)[] = [
      "getStatus",
      "getBunkerUri",
      "hasKey",
      "importKey",
      "generateKey",
      "listClients",
      "renameClient",
      "revokeClient",
      "resetClientApprovals",
      "respondApproval",
      "getActivityLog",
      "getRelays",
      "setRelays",
      "onApprovalRequested",
      "onActivity"
    ];
    expect(apiShape).toHaveLength(15);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/types.test.ts`
Expected: FAIL with "Cannot find module '../src/shared/types.js'" (module does not exist).

- [ ] **Step 3: Write minimal implementation**

Create `src/shared/types.ts`:

```ts
export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface UnsignedEvent extends EventTemplate {
  pubkey: string;
}

export interface SignedEvent extends UnsignedEvent {
  id: string;
  sig: string;
}

export const SUPPORTED_METHODS = [
  "connect",
  "sign_event",
  "get_public_key",
  "ping",
  "nip04_encrypt",
  "nip04_decrypt",
  "nip44_encrypt",
  "nip44_decrypt"
] as const;

export type Nip46Method = (typeof SUPPORTED_METHODS)[number];

export const CONNECTION_LEVEL_METHODS = [
  "connect",
  "get_public_key",
  "ping"
] as const;

export type ActionType =
  | `sign_event:kind-${number}`
  | "nip04_encrypt"
  | "nip04_decrypt"
  | "nip44_encrypt"
  | "nip44_decrypt";

export function actionTypeForSignEventKind(kind: number): ActionType {
  return `sign_event:kind-${kind}`;
}

export interface Nip46Request {
  id: string;
  method: string;
  params: string[];
}

export interface Nip46Response {
  id: string;
  result?: string;
  error?: string;
}

export type PolicyDecision = "allow" | "deny" | "ask";

export type ApprovalChoice = "allow-once" | "always-allow" | "deny";

export interface ApprovalRule {
  clientPubkey: string;
  actionType: ActionType;
  createdAt: number;
}

export interface ClientRecord {
  pubkey: string;
  name: string;
  connectedAt: number;
}

export type LogEntryType =
  | "client-connected"
  | "client-denied"
  | "request-approved"
  | "request-denied"
  | "event-signed"
  | "request-dropped"
  | "protocol-error"
  | "relay-status";

export interface LogEntry {
  timestamp: number;
  type: LogEntryType;
  clientPubkey?: string;
  actionType?: string;
  message: string;
  eventId?: string;
}

export interface RelayStatus {
  url: string;
  connected: boolean;
}

export interface PendingApproval {
  id: string;
  clientPubkey: string;
  clientName: string;
  actionType: string;
  description: string;
  eventPreview?: string;
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Uint8Array;
  decryptString(encrypted: Uint8Array): string;
}

export interface TransportSubscription {
  filters: Array<{ kinds: number[]; "#p": string[] }>;
  onEvent(event: { pubkey: string; content: string }): void;
}

export interface RelayTransport {
  connect(): Promise<void>;
  subscribe(sub: TransportSubscription): { close(): void };
  publish(event: SignedEvent): Promise<void>;
  onStatusChange(cb: (statuses: RelayStatus[]) => void): void;
  setRelays(urls: string[]): Promise<void>;
  getStatuses(): RelayStatus[];
}
```

Create `src/shared/ipc.ts`:

```ts
import type {
  ClientRecord,
  LogEntry,
  PendingApproval,
  RelayStatus
} from "./types.js";

export const IPC = {
  GetStatus: "signer:get-status",
  GetBunkerUri: "signer:get-bunker-uri",
  HasKey: "signer:has-key",
  ImportKey: "signer:import-key",
  GenerateKey: "signer:generate-key",
  ListClients: "signer:list-clients",
  RenameClient: "signer:rename-client",
  RevokeClient: "signer:revoke-client",
  ResetClientApprovals: "signer:reset-client-approvals",
  RespondApproval: "signer:respond-approval",
  GetActivityLog: "signer:get-activity-log",
  GetRelays: "signer:get-relays",
  SetRelays: "signer:set-relays",
  ApprovalRequested: "signer:approval-requested",
  ActivityAppended: "signer:activity-appended",
  StatusChanged: "signer:status-changed"
} as const;

export interface SignerStatus {
  hasKey: boolean;
  pubkey: string | null;
  relays: RelayStatus[];
}

export interface SignerApi {
  getStatus(): Promise<SignerStatus>;
  getBunkerUri(): Promise<string>;
  hasKey(): Promise<boolean>;
  importKey(nsec: string): Promise<void>;
  generateKey(): Promise<void>;
  listClients(): Promise<ClientRecord[]>;
  renameClient(pubkey: string, name: string): Promise<void>;
  revokeClient(pubkey: string): Promise<void>;
  resetClientApprovals(pubkey: string): Promise<void>;
  respondApproval(id: string, choice: "allow-once" | "always-allow" | "deny"): Promise<void>;
  getActivityLog(): Promise<LogEntry[]>;
  getRelays(): Promise<string[]>;
  setRelays(urls: string[]): Promise<void>;
  onApprovalRequested(cb: (approval: PendingApproval) => void): void;
  onActivity(cb: (entry: LogEntry) => void): void;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/types.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```powershell
git add src/shared/types.ts src/shared/ipc.ts tests/types.test.ts
git commit -m "feat: shared domain types and ipc channel constants"
```

---
### Task 3: PolicyEngine

**Files:**
- Create: `src/main/policy.ts`
- Test: `tests/policy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/policy.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { PolicyEngine } from "../src/main/policy.js";
import type { ApprovalRule } from "../src/shared/types.js";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);

function makeEngine(rules: ApprovalRule[] = [], clients: string[] = []) {
  return new PolicyEngine({
    loadRules: () => rules,
    saveRules: () => {},
    isClient: (pubkey: string) => clients.includes(pubkey)
  });
}

describe("PolicyEngine", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = makeEngine();
  });

  it("asks for sign_event:kind-1 when no rule exists", () => {
    expect(engine.decide(ALICE, "sign_event:kind-1")).toBe("ask");
  });

  it("asks for nip04_decrypt when no rule exists", () => {
    expect(engine.decide(ALICE, "nip04_decrypt")).toBe("ask");
    expect(engine.decide(ALICE, "nip44_decrypt")).toBe("ask");
  });

  it("allows after addRule (always allow)", () => {
    engine.addRule(ALICE, "sign_event:kind-1");
    expect(engine.decide(ALICE, "sign_event:kind-1")).toBe("allow");
  });

  it("treats different event kinds as separate action types", () => {
    engine.addRule(ALICE, "sign_event:kind-1");
    expect(engine.decide(ALICE, "sign_event:kind-7")).toBe("ask");
    expect(engine.decide(ALICE, "sign_event:kind-30023")).toBe("ask");
  });

  it("scopes rules to a single client", () => {
    engine.addRule(ALICE, "sign_event:kind-1");
    expect(engine.decide(BOB, "sign_event:kind-1")).toBe("ask");
  });

  it("persists rules through the storage callbacks", () => {
    const saved: ApprovalRule[] = [];
    const persistent = new PolicyEngine({
      loadRules: () => saved.map((r) => ({ ...r })),
      saveRules: (rules) => {
        saved.length = 0;
        saved.push(...rules);
      },
      isClient: () => true
    });
    persistent.addRule(ALICE, "nip44_encrypt");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.actionType).toBe("nip44_encrypt");
    expect(saved[0]?.clientPubkey).toBe(ALICE);
  });

  it("forgetRulesFor removes every rule for a client", () => {
    engine.addRule(ALICE, "sign_event:kind-1");
    engine.addRule(ALICE, "nip04_decrypt");
    engine.addRule(BOB, "sign_event:kind-1");
    engine.forgetRulesFor(ALICE);
    expect(engine.decide(ALICE, "sign_event:kind-1")).toBe("ask");
    expect(engine.decide(ALICE, "nip04_decrypt")).toBe("ask");
    expect(engine.decide(BOB, "sign_event:kind-1")).toBe("allow");
  });

  it("denies every action for a revoked (unknown) client", () => {
    const strict = makeEngine([], []);
    strict.addRule(ALICE, "sign_event:kind-1");
    expect(strict.decide(ALICE, "sign_event:kind-1")).toBe("allow");
    const revoked = makeEngine(
      [{ clientPubkey: ALICE, actionType: "sign_event:kind-1", createdAt: 1 }],
      []
    );
    expect(revoked.decide(ALICE, "sign_event:kind-1")).toBe("deny");
  });

  it("listRules returns a defensive copy", () => {
    engine.addRule(ALICE, "sign_event:kind-1");
    const rules = engine.listRules();
    rules.length = 0;
    expect(engine.listRules()).toHaveLength(1);
  });

  it("connection-level approval: isClient gates non-policy methods", () => {
    const withClient = makeEngine([], [ALICE]);
    expect(withClient.isKnownClient(ALICE)).toBe(true);
    expect(withClient.isKnownClient(BOB)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/policy.test.ts`
Expected: FAIL with "Cannot find module '../src/main/policy.js'".

- [ ] **Step 3: Write minimal implementation**

Create `src/main/policy.ts`:

```ts
import type { ActionType, ApprovalRule, PolicyDecision } from "../shared/types.js";

export interface PolicyEngineDeps {
  loadRules(): ApprovalRule[];
  saveRules(rules: ApprovalRule[]): void;
  isClient(pubkey: string): boolean;
}

export class PolicyEngine {
  private rules: ApprovalRule[];

  constructor(private deps: PolicyEngineDeps) {
    this.rules = deps.loadRules();
  }

  decide(clientPubkey: string, actionType: ActionType): PolicyDecision {
    if (!this.deps.isClient(clientPubkey)) {
      return "deny";
    }
    const found = this.rules.some(
      (r) => r.clientPubkey === clientPubkey && r.actionType === actionType
    );
    return found ? "allow" : "ask";
  }

  addRule(clientPubkey: string, actionType: ActionType): void {
    const exists = this.rules.some(
      (r) => r.clientPubkey === clientPubkey && r.actionType === actionType
    );
    if (!exists) {
      this.rules.push({ clientPubkey, actionType, createdAt: Date.now() });
      this.deps.saveRules(this.rules);
    }
  }

  forgetRulesFor(clientPubkey: string): void {
    this.rules = this.rules.filter((r) => r.clientPubkey !== clientPubkey);
    this.deps.saveRules(this.rules);
  }

  listRules(): ApprovalRule[] {
    return this.rules.map((r) => ({ ...r }));
  }

  isKnownClient(pubkey: string): boolean {
    return this.deps.isClient(pubkey);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/policy.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```powershell
git add src/main/policy.ts tests/policy.test.ts
git commit -m "feat: policy engine with per-client per-action-type rules"
```

---

### Task 4: KeyVault

**Files:**
- Create: `src/main/keyvault.ts`
- Test: `tests/keyvault.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/keyvault.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { KeyVault, type KeyVaultStorage } from "../src/main/keyvault.js";
import type { SafeStorageLike } from "../src/shared/types.js";

export class FakeSafeStorage implements SafeStorageLike {
  isEncryptionAvailable(): boolean {
    return true;
  }
  encryptString(plainText: string): Uint8Array {
    return Buffer.concat([Buffer.from("dpapi:"), Buffer.from(plainText, "utf8")]);
  }
  decryptString(encrypted: Uint8Array): string {
    const buf = Buffer.from(encrypted);
    const prefix = buf.subarray(0, 6).toString("utf8");
    if (prefix !== "dpapi:") {
      throw new Error("blob not decryptable on this machine");
    }
    return buf.subarray(6).toString("utf8");
  }
}

function makeStorage(): KeyVaultStorage & { blob: Uint8Array | null } {
  return {
    blob: null,
    loadKeyBlob() {
      return this.blob;
    },
    saveKeyBlob(blob: Uint8Array) {
      this.blob = blob;
    },
    clearKeyBlob() {
      this.blob = null;
    }
  };
}

const NSEC_HEX = "1".repeat(64);

describe("KeyVault", () => {
  let vault: KeyVault;
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    storage = makeStorage();
    vault = new KeyVault(new FakeSafeStorage(), storage);
  });

  it("hasKey is false before any key is set", () => {
    expect(vault.hasKey()).toBe(false);
  });

  it("setKey encrypts and persists; hasKey becomes true", () => {
    vault.setKey(NSEC_HEX);
    expect(vault.hasKey()).toBe(true);
    expect(storage.blob).not.toBeNull();
    expect(Buffer.from(storage.blob!).toString("utf8")).not.toContain(NSEC_HEX);
  });

  it("getSecretKey returns the plaintext bytes from memory", () => {
    vault.setKey(NSEC_HEX);
    const key = vault.getSecretKey();
    expect(Buffer.from(key).toString("hex")).toBe(NSEC_HEX);
  });

  it("round-trips through a fresh instance (encrypt -> persist -> decrypt)", () => {
    vault.setKey(NSEC_HEX);
    const vault2 = new KeyVault(new FakeSafeStorage(), storage);
    expect(vault2.hasKey()).toBe(true);
    expect(Buffer.from(vault2.getSecretKey()).toString("hex")).toBe(NSEC_HEX);
  });

  it("getSecretKey throws when no key exists", () => {
    expect(() => vault.getSecretKey()).toThrow(/no key/i);
  });

  it("clear removes the key from memory and disk", () => {
    vault.setKey(NSEC_HEX);
    vault.clear();
    expect(vault.hasKey()).toBe(false);
    expect(storage.blob).toBeNull();
    expect(() => vault.getSecretKey()).toThrow(/no key/i);
  });

  it("rejects keys that are not 64 lowercase hex chars", () => {
    expect(() => vault.setKey("xyz")).toThrow(/invalid/i);
    expect(() => vault.setKey("1".repeat(63))).toThrow(/invalid/i);
  });

  it("fails safe when the blob cannot be decrypted", () => {
    storage.blob = Buffer.from("garbage");
    const vault2 = new KeyVault(new FakeSafeStorage(), storage);
    expect(vault2.hasKey()).toBe(false);
    expect(() => vault2.getSecretKey()).toThrow(/no key/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/keyvault.test.ts`
Expected: FAIL with "Cannot find module '../src/main/keyvault.js'".

- [ ] **Step 3: Write minimal implementation**

Create `src/main/keyvault.ts`:

```ts
import { getPublicKey } from "nostr-tools/pure";
import type { SafeStorageLike } from "../shared/types.js";

export interface KeyVaultStorage {
  loadKeyBlob(): Uint8Array | null;
  saveKeyBlob(blob: Uint8Array): void;
  clearKeyBlob(): void;
}

export class KeyVault {
  private secretKey: Uint8Array | null = null;

  constructor(
    private safeStorage: SafeStorageLike,
    private storage: KeyVaultStorage
  ) {}

  hasKey(): boolean {
    if (this.secretKey !== null) {
      return true;
    }
    return this.storage.loadKeyBlob() !== null;
  }

  setKey(hexKey: string): void {
    if (!/^[0-9a-f]{64}$/.test(hexKey)) {
      throw new Error("invalid key: expected 64 lowercase hex characters");
    }
    const encrypted = this.safeStorage.encryptString(hexKey);
    this.storage.saveKeyBlob(encrypted);
    this.secretKey = Buffer.from(hexKey, "hex");
  }

  getSecretKey(): Uint8Array {
    if (this.secretKey !== null) {
      return this.secretKey;
    }
    const blob = this.storage.loadKeyBlob();
    if (blob === null) {
      throw new Error("no key stored");
    }
    let hex: string;
    try {
      hex = this.safeStorage.decryptString(blob);
    } catch {
      this.storage.clearKeyBlob();
      throw new Error("no key stored: blob undecryptable");
    }
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      this.storage.clearKeyBlob();
      throw new Error("no key stored: blob corrupt");
    }
    this.secretKey = Buffer.from(hex, "hex");
    return this.secretKey;
  }

  getPublicKeyHex(): string {
    return getPublicKey(this.getSecretKey());
  }

  clear(): void {
    this.secretKey = null;
    this.storage.clearKeyBlob();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/keyvault.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```powershell
git add src/main/keyvault.ts tests/keyvault.test.ts
git commit -m "feat: key vault with dpapi round-trip via safeStorage abstraction"
```

---

### Task 5: Storage

**Files:**
- Create: `src/main/storage.ts`
- Test: `tests/storage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/storage.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "../src/main/storage.js";

describe("Storage", () => {
  let dir: string;
  let storage: Storage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nostr-signer-test-"));
    storage = new Storage(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the base directory on construction", () => {
    const nested = join(dir, "sub", "dir");
    new Storage(nested);
    expect(existsSync(nested)).toBe(true);
  });

  it("returns empty collections when files do not exist", () => {
    expect(storage.loadClients()).toEqual([]);
    expect(storage.loadRules()).toEqual([]);
    expect(storage.loadLog()).toEqual([]);
    expect(storage.loadKeyBlob()).toBeNull();
  });

  it("saves and loads clients", () => {
    storage.saveClients([
      { pubkey: "a".repeat(64), name: "Alice", connectedAt: 123 }
    ]);
    const clients = storage.loadClients();
    expect(clients).toHaveLength(1);
    expect(clients[0]?.name).toBe("Alice");
  });

  it("saves and loads rules", () => {
    storage.saveRules([
      { clientPubkey: "a".repeat(64), actionType: "sign_event:kind-1", createdAt: 1 }
    ]);
    expect(storage.loadRules()).toHaveLength(1);
  });

  it("appends log entries and caps the log at 1000 entries", () => {
    for (let i = 0; i < 1005; i++) {
      storage.appendLog({ timestamp: i, type: "request-approved", message: `m${i}` });
    }
    const log = storage.loadLog();
    expect(log).toHaveLength(1000);
    expect(log[log.length - 1]?.message).toBe("m1004");
    expect(log[0]?.message).toBe("m5");
  });

  it("stores the key blob as base64 separate from JSON state", () => {
    const blob = Buffer.from("encrypted-bytes");
    storage.saveKeyBlob(blob);
    const loaded = storage.loadKeyBlob();
    expect(Buffer.from(loaded!).equals(blob)).toBe(true);
    const raw = readFileSync(join(dir, "key"), "utf8");
    expect(raw).toBe(blob.toString("base64"));
  });

  it("clearKeyBlob removes the key file", () => {
    storage.saveKeyBlob(Buffer.from("x"));
    storage.clearKeyBlob();
    expect(storage.loadKeyBlob()).toBeNull();
  });

  it("writes atomically: no .tmp files remain after save", () => {
    storage.saveClients([{ pubkey: "a".repeat(64), name: "A", connectedAt: 1 }]);
    expect(existsSync(join(dir, "clients.json.tmp"))).toBe(false);
    expect(existsSync(join(dir, "clients.json"))).toBe(true);
  });

  it("survives corrupt JSON by returning empty collections", () => {
    storage.saveClients([{ pubkey: "a".repeat(64), name: "A", connectedAt: 1 }]);
    writeFileSync(join(dir, "clients.json"), "{ not json");
    expect(storage.loadClients()).toEqual([]);
  });

  it("persists and loads the relay list", () => {
    expect(storage.loadRelays()).toBeNull();
    storage.saveRelays(["wss://relay.damus.io"]);
    expect(storage.loadRelays()).toEqual(["wss://relay.damus.io"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/storage.test.ts`
Expected: FAIL with "Cannot find module '../src/main/storage.js'".

- [ ] **Step 3: Write minimal implementation**

Create `src/main/storage.ts`:

```ts
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  rmSync
} from "node:fs";
import { join } from "node:path";
import type { ApprovalRule, ClientRecord, LogEntry } from "../shared/types.js";

const MAX_LOG_ENTRIES = 1000;

export class Storage {
  constructor(private baseDir: string) {
    mkdirSync(baseDir, { recursive: true });
  }

  private file(name: string): string {
    return join(this.baseDir, name);
  }

  private readJson<T>(name: string, fallback: T): T {
    const path = this.file(name);
    if (!existsSync(path)) {
      return fallback;
    }
    try {
      return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch {
      return fallback;
    }
  }

  private writeJsonAtomic(name: string, value: unknown): void {
    const path = this.file(name);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
    renameSync(tmp, path);
  }

  loadClients(): ClientRecord[] {
    return this.readJson<ClientRecord[]>("clients.json", []);
  }

  saveClients(clients: ClientRecord[]): void {
    this.writeJsonAtomic("clients.json", clients);
  }

  loadRules(): ApprovalRule[] {
    return this.readJson<ApprovalRule[]>("rules.json", []);
  }

  saveRules(rules: ApprovalRule[]): void {
    this.writeJsonAtomic("rules.json", rules);
  }

  loadLog(): LogEntry[] {
    return this.readJson<LogEntry[]>("log.json", []);
  }

  appendLog(entry: LogEntry): void {
    const log = this.loadLog();
    log.push(entry);
    while (log.length > MAX_LOG_ENTRIES) {
      log.shift();
    }
    this.writeJsonAtomic("log.json", log);
  }

  loadRelays(): string[] | null {
    return this.readJson<string[] | null>("relays.json", null);
  }

  saveRelays(relays: string[]): void {
    this.writeJsonAtomic("relays.json", relays);
  }

  loadKeyBlob(): Uint8Array | null {
    const path = this.file("key");
    if (!existsSync(path)) {
      return null;
    }
    try {
      return Buffer.from(readFileSync(path, "utf8"), "base64");
    } catch {
      return null;
    }
  }

  saveKeyBlob(blob: Uint8Array): void {
    const path = this.file("key");
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, Buffer.from(blob).toString("base64"), "utf8");
    renameSync(tmp, path);
  }

  clearKeyBlob(): void {
    const path = this.file("key");
    if (existsSync(path)) {
      rmSync(path);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/storage.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```powershell
git add src/main/storage.ts tests/storage.test.ts
git commit -m "feat: atomic json storage for clients rules log relays and key blob"
```

---
### Task 6: ClientRegistry

**Files:**
- Create: `src/main/clients.ts`
- Test: `tests/clients.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/clients.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { ClientRegistry } from "../src/main/clients.js";
import type { ClientRecord } from "../src/shared/types.js";

const ALICE = "a".repeat(64);

function makeRegistry(initial: ClientRecord[] = []) {
  const saved: ClientRecord[][] = [];
  const registry = new ClientRegistry({
    loadClients: () => initial.map((c) => ({ ...c })),
    saveClients: (clients) => saved.push(clients.map((c) => ({ ...c })))
  });
  return { registry, saved };
}

describe("ClientRegistry", () => {
  let registry: ClientRegistry;

  beforeEach(() => {
    registry = makeRegistry().registry;
  });

  it("starts empty and reports unknown clients", () => {
    expect(registry.list()).toEqual([]);
    expect(registry.isClient(ALICE)).toBe(false);
  });

  it("addClient stores pubkey with default name and timestamp", () => {
    registry.addClient(ALICE);
    const clients = registry.list();
    expect(clients).toHaveLength(1);
    expect(clients[0]?.pubkey).toBe(ALICE);
    expect(clients[0]?.name).toBe(`${ALICE.slice(0, 12)}...`);
    expect(clients[0]?.connectedAt).toBeGreaterThan(0);
  });

  it("addClient is idempotent", () => {
    registry.addClient(ALICE);
    registry.addClient(ALICE);
    expect(registry.list()).toHaveLength(1);
  });

  it("rename updates the friendly name and persists", () => {
    const { registry: reg, saved } = makeRegistry();
    reg.addClient(ALICE);
    reg.rename(ALICE, "My Web Client");
    expect(reg.list()[0]?.name).toBe("My Web Client");
    expect(saved.length).toBeGreaterThanOrEqual(2);
    expect(saved[saved.length - 1]?.[0]?.name).toBe("My Web Client");
  });

  it("remove deletes the client", () => {
    registry.addClient(ALICE);
    registry.remove(ALICE);
    expect(registry.isClient(ALICE)).toBe(false);
    expect(registry.list()).toEqual([]);
  });

  it("get returns a single client or undefined", () => {
    registry.addClient(ALICE);
    expect(registry.get(ALICE)?.pubkey).toBe(ALICE);
    expect(registry.get("f".repeat(64))).toBeUndefined();
  });

  it("loads persisted clients from storage", () => {
    const { registry: reg } = makeRegistry([
      { pubkey: ALICE, name: "Saved", connectedAt: 42 }
    ]);
    expect(reg.isClient(ALICE)).toBe(true);
    expect(reg.list()[0]?.connectedAt).toBe(42);
  });

  it("list returns a defensive copy", () => {
    registry.addClient(ALICE);
    const list = registry.list();
    list.length = 0;
    expect(registry.list()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/clients.test.ts`
Expected: FAIL with "Cannot find module '../src/main/clients.js'".

- [ ] **Step 3: Write minimal implementation**

Create `src/main/clients.ts`:

```ts
import type { ClientRecord } from "../shared/types.js";

export interface ClientRegistryDeps {
  loadClients(): ClientRecord[];
  saveClients(clients: ClientRecord[]): void;
}

export class ClientRegistry {
  private clients: ClientRecord[];

  constructor(private deps: ClientRegistryDeps) {
    this.clients = deps.loadClients();
  }

  isClient(pubkey: string): boolean {
    return this.clients.some((c) => c.pubkey === pubkey);
  }

  get(pubkey: string): ClientRecord | undefined {
    const found = this.clients.find((c) => c.pubkey === pubkey);
    return found ? { ...found } : undefined;
  }

  list(): ClientRecord[] {
    return this.clients.map((c) => ({ ...c }));
  }

  addClient(pubkey: string): ClientRecord {
    const existing = this.clients.find((c) => c.pubkey === pubkey);
    if (existing) {
      return { ...existing };
    }
    const record: ClientRecord = {
      pubkey,
      name: `${pubkey.slice(0, 12)}...`,
      connectedAt: Date.now()
    };
    this.clients.push(record);
    this.deps.saveClients(this.clients);
    return { ...record };
  }

  rename(pubkey: string, name: string): void {
    const record = this.clients.find((c) => c.pubkey === pubkey);
    if (record) {
      record.name = name;
      this.deps.saveClients(this.clients);
    }
  }

  remove(pubkey: string): void {
    this.clients = this.clients.filter((c) => c.pubkey !== pubkey);
    this.deps.saveClients(this.clients);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/clients.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```powershell
git add src/main/clients.ts tests/clients.test.ts
git commit -m "feat: client registry with add rename remove and persistence"
```

---

### Task 7: NIP-46 Protocol Layer

**Files:**
- Create: `src/main/nip46.ts`
- Test: `tests/nip46.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/nip46.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseRequestEvent,
  buildResponse,
  buildErrorResponse,
  actionTypeOf,
  NIP46_REQUEST_KIND
} from "../src/main/nip46.js";

const SIGNER_PUBKEY = "c".repeat(64);
const CLIENT_PUBKEY = "d".repeat(64);

function makeEvent(overrides: Partial<{
  kind: number;
  pubkey: string;
  content: string;
  tags: string[][];
}> = {}) {
  return {
    kind: overrides.kind ?? NIP46_REQUEST_KIND,
    pubkey: overrides.pubkey ?? CLIENT_PUBKEY,
    content: overrides.content ?? JSON.stringify({ id: "1", method: "ping", params: [] }),
    tags: overrides.tags ?? [["p", SIGNER_PUBKEY]]
  };
}

describe("nip46 parseRequestEvent", () => {
  it("parses a well-formed request event", () => {
    const parsed = parseRequestEvent(makeEvent(), SIGNER_PUBKEY);
    expect(parsed).not.toBeNull();
    expect(parsed?.clientPubkey).toBe(CLIENT_PUBKEY);
    expect(parsed?.request).toEqual({ id: "1", method: "ping", params: [] });
  });

  it("rejects events of the wrong kind", () => {
    expect(parseRequestEvent(makeEvent({ kind: 1 }), SIGNER_PUBKEY)).toBeNull();
  });

  it("rejects events not tagged to the signer pubkey", () => {
    const event = makeEvent({ tags: [["p", "e".repeat(64)]] });
    expect(parseRequestEvent(event, SIGNER_PUBKEY)).toBeNull();
  });

  it("rejects events with no p tag", () => {
    expect(parseRequestEvent(makeEvent({ tags: [] }), SIGNER_PUBKEY)).toBeNull();
  });

  it("rejects non-JSON content", () => {
    expect(parseRequestEvent(makeEvent({ content: "not json {" }), SIGNER_PUBKEY)).toBeNull();
  });

  it("rejects JSON without a string id", () => {
    const content = JSON.stringify({ method: "ping", params: [] });
    expect(parseRequestEvent(makeEvent({ content }), SIGNER_PUBKEY)).toBeNull();
  });

  it("rejects JSON without a string method", () => {
    const content = JSON.stringify({ id: "1", params: [] });
    expect(parseRequestEvent(makeEvent({ content }), SIGNER_PUBKEY)).toBeNull();
  });

  it("rejects non-string params entries", () => {
    const content = JSON.stringify({ id: "1", method: "ping", params: [42] });
    expect(parseRequestEvent(makeEvent({ content }), SIGNER_PUBKEY)).toBeNull();
  });

  it("tolerates missing params by treating them as empty", () => {
    const content = JSON.stringify({ id: "1", method: "ping" });
    const parsed = parseRequestEvent(makeEvent({ content }), SIGNER_PUBKEY);
    expect(parsed?.request.params).toEqual([]);
  });

  it("rejects malformed client pubkey", () => {
    expect(
      parseRequestEvent(makeEvent({ pubkey: "not-a-pubkey" }), SIGNER_PUBKEY)
    ).toBeNull();
  });
});

describe("nip46 buildResponse / buildErrorResponse", () => {
  it("builds a success response", () => {
    expect(buildResponse("1", "ok")).toEqual({ id: "1", result: "ok" });
  });

  it("builds an error response for unknown method", () => {
    expect(buildErrorResponse("1", "unsupported method")).toEqual({
      id: "1",
      error: "unsupported method"
    });
  });

  it("builds an error response for denial", () => {
    expect(buildErrorResponse("1", "denied by user")).toEqual({
      id: "1",
      error: "denied by user"
    });
  });
});

describe("nip46 actionTypeOf", () => {
  it("returns null for connection-level methods", () => {
    expect(actionTypeOf("connect", [])).toBeNull();
    expect(actionTypeOf("get_public_key", [])).toBeNull();
    expect(actionTypeOf("ping", [])).toBeNull();
  });

  it("refines sign_event by event kind", () => {
    const unsigned = JSON.stringify({
      kind: 1,
      created_at: 1,
      tags: [],
      content: "hello",
      pubkey: CLIENT_PUBKEY
    });
    expect(actionTypeOf("sign_event", [unsigned])).toBe("sign_event:kind-1");
  });

  it("accepts sign_event events without a pubkey field (NIP-46 clients omit it)", () => {
    const unsigned = JSON.stringify({ kind: 1, created_at: 1, tags: [], content: "hi" });
    expect(actionTypeOf("sign_event", [unsigned])).toBe("sign_event:kind-1");
  });

  it("returns null for sign_event with unparseable event (fail safe)", () => {
    expect(actionTypeOf("sign_event", ["not json"])).toBeNull();
    expect(actionTypeOf("sign_event", [])).toBeNull();
    expect(actionTypeOf("sign_event", [JSON.stringify({ content: "x" })])).toBeNull();
  });

  it("maps encrypt/decrypt methods to their own action types", () => {
    expect(actionTypeOf("nip04_decrypt", ["pk", "ct"])).toBe("nip04_decrypt");
    expect(actionTypeOf("nip44_decrypt", ["pk", "ct"])).toBe("nip44_decrypt");
    expect(actionTypeOf("nip04_encrypt", ["pk", "pt"])).toBe("nip04_encrypt");
    expect(actionTypeOf("nip44_encrypt", ["pk", "pt"])).toBe("nip44_encrypt");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/nip46.test.ts`
Expected: FAIL with "Cannot find module '../src/main/nip46.js'".

- [ ] **Step 3: Write minimal implementation**

Create `src/main/nip46.ts`:

```ts
import type {
  ActionType,
  EventTemplate,
  Nip46Request,
  Nip46Response
} from "../shared/types.js";

export const NIP46_REQUEST_KIND = 24133;

const HEX_64 = /^[0-9a-f]{64}$/;

export interface ParsedRequestEvent {
  clientPubkey: string;
  request: Nip46Request;
}

export interface RequestEventLike {
  kind: number;
  pubkey: string;
  content: string;
  tags: string[][];
}

export function parseRequestEvent(
  event: RequestEventLike,
  signerPubkey: string
): ParsedRequestEvent | null {
  try {
    if (event.kind !== NIP46_REQUEST_KIND) {
      return null;
    }
    if (!HEX_64.test(event.pubkey)) {
      return null;
    }
    const tagged = event.tags.some(
      (t) => Array.isArray(t) && t[0] === "p" && t[1] === signerPubkey
    );
    if (!tagged) {
      return null;
    }
    const payload: unknown = JSON.parse(event.content);
    if (typeof payload !== "object" || payload === null) {
      return null;
    }
    const obj = payload as Record<string, unknown>;
    if (typeof obj.id !== "string" || obj.id.length === 0) {
      return null;
    }
    if (typeof obj.method !== "string" || obj.method.length === 0) {
      return null;
    }
    let params: string[] = [];
    if (obj.params !== undefined) {
      if (!Array.isArray(obj.params)) {
        return null;
      }
      if (!obj.params.every((p) => typeof p === "string")) {
        return null;
      }
      params = obj.params as string[];
    }
    return {
      clientPubkey: event.pubkey,
      request: { id: obj.id, method: obj.method, params }
    };
  } catch {
    return null;
  }
}

export function buildResponse(id: string, result: string): Nip46Response {
  return { id, result };
}

export function buildErrorResponse(id: string, error: string): Nip46Response {
  return { id, error };
}

function isEventTemplate(value: unknown): value is EventTemplate {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const e = value as Record<string, unknown>;
  return (
    typeof e.kind === "number" &&
    Number.isInteger(e.kind) &&
    typeof e.created_at === "number" &&
    Array.isArray(e.tags) &&
    typeof e.content === "string"
  );
}

export function parseUnsignedEvent(json: string): EventTemplate | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return isEventTemplate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function actionTypeOf(method: string, params: string[]): ActionType | null {
  switch (method) {
    case "connect":
    case "get_public_key":
    case "ping":
      return null;
    case "sign_event": {
      const raw = params[0];
      if (raw === undefined) {
        return null;
      }
      const event = parseUnsignedEvent(raw);
      if (event === null) {
        return null;
      }
      return `sign_event:kind-${event.kind}`;
    }
    case "nip04_encrypt":
      return "nip04_encrypt";
    case "nip04_decrypt":
      return "nip04_decrypt";
    case "nip44_encrypt":
      return "nip44_encrypt";
    case "nip44_decrypt":
      return "nip44_decrypt";
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/nip46.test.ts`
Expected: PASS (16 tests)

- [ ] **Step 5: Commit**

```powershell
git add src/main/nip46.ts tests/nip46.test.ts
git commit -m "feat: nip46 request parsing validation and response construction"
```

---

### Task 8: ApprovalQueue

**Files:**
- Create: `src/main/approvals.ts`
- Test: `tests/approvals.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/approvals.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { ApprovalQueue } from "../src/main/approvals.js";
import type { PendingApproval } from "../src/shared/types.js";

function makeApproval(id: string): PendingApproval {
  return {
    id,
    clientPubkey: "a".repeat(64),
    clientName: "Alice",
    actionType: "sign_event:kind-1",
    description: "Publish a note (kind 1)",
    eventPreview: "hello nostr"
  };
}

describe("ApprovalQueue", () => {
  it("request emits the approval and resolves with the response", async () => {
    const queue = new ApprovalQueue();
    const onApproval = vi.fn();
    queue.onRequest(onApproval);

    const promise = queue.request(makeApproval("req-1"));
    expect(onApproval).toHaveBeenCalledTimes(1);
    expect(onApproval.mock.calls[0]?.[0]?.id).toBe("req-1");

    queue.respond("req-1", "always-allow");
    await expect(promise).resolves.toBe("always-allow");
  });

  it("tracks pending approvals", () => {
    const queue = new ApprovalQueue();
    queue.onRequest(() => {});
    void queue.request(makeApproval("req-1")).catch(() => {});
    void queue.request(makeApproval("req-2")).catch(() => {});
    expect(queue.pendingCount()).toBe(2);
    queue.respond("req-1", "deny");
    expect(queue.pendingCount()).toBe(1);
  });

  it("respond with unknown id is a no-op", () => {
    const queue = new ApprovalQueue();
    queue.onRequest(() => {});
    queue.respond("nonexistent", "deny");
    expect(queue.pendingCount()).toBe(0);
  });

  it("denyAll resolves all pending requests with deny", async () => {
    const queue = new ApprovalQueue();
    queue.onRequest(() => {});
    const p1 = queue.request(makeApproval("req-1"));
    const p2 = queue.request(makeApproval("req-2"));
    queue.denyAll();
    await expect(p1).resolves.toBe("deny");
    await expect(p2).resolves.toBe("deny");
    expect(queue.pendingCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/approvals.test.ts`
Expected: FAIL with "Cannot find module '../src/main/approvals.js'".

- [ ] **Step 3: Write minimal implementation**

Create `src/main/approvals.ts`:

```ts
import type { ApprovalChoice, PendingApproval } from "../shared/types.js";

interface PendingEntry {
  approval: PendingApproval;
  resolve(choice: ApprovalChoice): void;
}

export class ApprovalQueue {
  private pending = new Map<string, PendingEntry>();
  private listener: ((approval: PendingApproval) => void) | null = null;

  onRequest(cb: (approval: PendingApproval) => void): void {
    this.listener = cb;
  }

  request(approval: PendingApproval): Promise<ApprovalChoice> {
    return new Promise<ApprovalChoice>((resolve) => {
      this.pending.set(approval.id, { approval, resolve });
      this.listener?.(approval);
    });
  }

  respond(id: string, choice: ApprovalChoice): void {
    const entry = this.pending.get(id);
    if (!entry) {
      return;
    }
    this.pending.delete(id);
    entry.resolve(choice);
  }

  denyAll(): void {
    for (const entry of this.pending.values()) {
      entry.resolve("deny");
    }
    this.pending.clear();
  }

  pendingCount(): number {
    return this.pending.size;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/approvals.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```powershell
git add src/main/approvals.ts tests/approvals.test.ts
git commit -m "feat: approval queue correlating ui decisions with pending requests"
```

---
### Task 9: BunkerCore

**Files:**
- Create: `src/main/bunker.ts`
- Test: `tests/bunker.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/bunker.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";
import * as nip04 from "nostr-tools/nip04";
import * as nip44 from "nostr-tools/nip44";
import { BunkerCore, type BunkerDeps } from "../src/main/bunker.js";
import type {
  LogEntry,
  RelayStatus,
  RelayTransport,
  SignedEvent,
  TransportSubscription
} from "../src/shared/types.js";

export class FakeRelayTransport implements RelayTransport {
  published: SignedEvent[] = [];
  private sub: TransportSubscription | null = null;
  private statuses: RelayStatus[];

  constructor(urls: string[] = ["wss://relay.damus.io"]) {
    this.statuses = urls.map((url) => ({ url, connected: true }));
  }

  async connect(): Promise<void> {}
  subscribe(sub: TransportSubscription): { close(): void } {
    this.sub = sub;
    return { close: () => {} };
  }
  async publish(event: SignedEvent): Promise<void> {
    this.published.push(event);
  }
  onStatusChange(): void {}
  async setRelays(urls: string[]): Promise<void> {
    this.statuses = urls.map((url) => ({ url, connected: true }));
  }
  getStatuses(): RelayStatus[] {
    return this.statuses;
  }
  inject(event: { pubkey: string; content: string }): void {
    this.sub?.onEvent(event);
  }
}

const signerSk = generateSecretKey();
const signerPk = getPublicKey(signerSk);
const clientSk = generateSecretKey();
const clientPk = getPublicKey(clientSk);

function nip44ConversationKey(secretKey: Uint8Array, pubkey: string): Uint8Array {
  const key = nip44.v2.utils.getConversationKey(secretKey, pubkey);
  return key instanceof Uint8Array ? key : new Uint8Array(key);
}

export function encryptTo(signerSecretKey: Uint8Array, payload: object, recipientPk: string): string {
  return nip44.v2.encrypt(
    JSON.stringify(payload),
    nip44ConversationKey(signerSecretKey, recipientPk)
  );
}

export function makeDeps(overrides: Partial<BunkerDeps> = {}) {
  const log: LogEntry[] = [];
  const transport = new FakeRelayTransport();
  const deps: BunkerDeps = {
    signerPubkey: signerPk,
    getSecretKey: () => signerSk,
    transport,
    isClient: () => true,
    addClient: () => {},
    clientName: (pk: string) => pk.slice(0, 12),
    policyDecide: () => "allow",
    addRule: () => {},
    askApproval: async () => "allow-once",
    log: (entry) => log.push(entry),
    ...overrides
  };
  return { deps, transport, log };
}

async function sendRequest(
  transport: FakeRelayTransport,
  payload: { id: string; method: string; params: string[] },
  scheme: "nip44" | "nip04" = "nip44"
): Promise<void> {
  const content =
    scheme === "nip44"
      ? nip44.v2.encrypt(
          JSON.stringify(payload),
          nip44ConversationKey(clientSk, signerPk)
        )
      : await nip04.encrypt(clientSk, signerPk, JSON.stringify(payload));
  transport.inject({ pubkey: clientPk, content });
  await new Promise((r) => setTimeout(r, 0));
}

async function readResponse(
  transport: FakeRelayTransport,
  scheme: "nip44" | "nip04" = "nip44"
): Promise<{ id: string; result?: string; error?: string }> {
  const event = transport.published[transport.published.length - 1];
  if (!event) {
    throw new Error("no response published");
  }
  const plaintext =
    scheme === "nip44"
      ? nip44.v2.decrypt(event.content, nip44ConversationKey(clientSk, signerPk))
      : await nip04.decrypt(clientSk, signerPk, event.content);
  return JSON.parse(plaintext);
}

describe("BunkerCore", () => {
  it("answers ping with pong over nip44", async () => {
    const { deps, transport } = makeDeps();
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "1", method: "ping", params: [] });
    const response = await readResponse(transport);
    expect(response).toEqual({ id: "1", result: "pong" });
  });

  it("answers ping over nip04-encrypted requests", async () => {
    const { deps, transport } = makeDeps();
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "2", method: "ping", params: [] }, "nip04");
    const response = await readResponse(transport, "nip04");
    expect(response).toEqual({ id: "2", result: "pong" });
  });

  it("answers get_public_key with the signer pubkey", async () => {
    const { deps, transport } = makeDeps();
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "3", method: "get_public_key", params: [] });
    const response = await readResponse(transport);
    expect(response.result).toBe(signerPk);
  });

  it("connect from known client acks without prompting", async () => {
    const { deps, transport } = makeDeps({ isClient: () => true });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "4", method: "connect", params: [clientPk, "secret"] });
    const response = await readResponse(transport);
    expect(response).toEqual({ id: "4", result: "ack" });
  });

  it("connect from unknown client asks and saves on approval", async () => {
    const added: string[] = [];
    const { deps, transport } = makeDeps({
      isClient: () => false,
      addClient: (pk) => added.push(pk),
      askApproval: async () => "always-allow"
    });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "5", method: "connect", params: [clientPk] });
    const response = await readResponse(transport);
    expect(response.result).toBe("ack");
    expect(added).toEqual([clientPk]);
  });

  it("connect from unknown client denied returns protocol error", async () => {
    const { deps, transport } = makeDeps({
      isClient: () => false,
      askApproval: async () => "deny"
    });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "6", method: "connect", params: [clientPk] });
    const response = await readResponse(transport);
    expect(response.error).toBe("denied by user");
  });

  it("sign_event signs and returns a valid signed event when allowed", async () => {
    const { deps, transport } = makeDeps({ policyDecide: () => "allow" });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    const unsigned = {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: "hello from test",
      pubkey: clientPk
    };
    await sendRequest(transport, {
      id: "7",
      method: "sign_event",
      params: [JSON.stringify(unsigned)]
    });
    const response = await readResponse(transport);
    const signed = JSON.parse(response.result!);
    expect(signed.content).toBe("hello from test");
    expect(signed.pubkey).toBe(signerPk);
    expect(typeof signed.id).toBe("string");
    expect(typeof signed.sig).toBe("string");
    expect(signed.sig).toHaveLength(128);
  });

  it("sign_event prompts once and always-allow persists a rule", async () => {
    const decisions: string[] = [];
    const rules: string[] = [];
    const unsigned = JSON.stringify({
      kind: 1,
      created_at: 1,
      tags: [],
      content: "note",
      pubkey: clientPk
    });
    const { deps, transport } = makeDeps({
      policyDecide: () => "ask",
      askApproval: async (approval) => {
        decisions.push(approval.actionType);
        return "always-allow";
      },
      addRule: (pk, actionType) => rules.push(`${pk}:${actionType}`)
    });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "8", method: "sign_event", params: [unsigned] });
    const response = await readResponse(transport);
    expect(JSON.parse(response.result!).content).toBe("note");
    expect(decisions).toEqual(["sign_event:kind-1"]);
    expect(rules).toEqual([`${clientPk}:sign_event:kind-1`]);
  });

  it("sign_event denied by policy returns error and signs nothing", async () => {
    const { deps, transport } = makeDeps({ policyDecide: () => "deny" });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    const unsigned = JSON.stringify({
      kind: 1,
      created_at: 1,
      tags: [],
      content: "x",
      pubkey: clientPk
    });
    await sendRequest(transport, { id: "9", method: "sign_event", params: [unsigned] });
    const response = await readResponse(transport);
    expect(response.error).toBe("denied by user");
  });

  it("unknown method returns unsupported method error", async () => {
    const { deps, transport } = makeDeps();
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "10", method: "obliterate", params: [] });
    const response = await readResponse(transport);
    expect(response.error).toBe("unsupported method");
  });

  it("malformed sign_event payload returns error without crashing", async () => {
    const { deps, transport } = makeDeps({ policyDecide: () => "allow" });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "11", method: "sign_event", params: ["{bad json"] });
    const response = await readResponse(transport);
    expect(typeof response.error).toBe("string");
  });

  it("undecryptable content is dropped and logged, nothing published", async () => {
    const { deps, transport, log } = makeDeps();
    const bunker = new BunkerCore(deps);
    await bunker.start();
    transport.inject({ pubkey: clientPk, content: "this is not encrypted at all" });
    await new Promise((r) => setTimeout(r, 0));
    expect(transport.published).toHaveLength(0);
    expect(log.some((e) => e.type === "request-dropped")).toBe(true);
  });

  it("nip04_decrypt round-trips client ciphertext", async () => {
    const { deps, transport } = makeDeps({ policyDecide: () => "allow" });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    const ciphertext = await nip04.encrypt(clientSk, signerPk, "secret dm");
    await sendRequest(transport, {
      id: "12",
      method: "nip04_decrypt",
      params: [clientPk, ciphertext]
    });
    const response = await readResponse(transport);
    expect(response.result).toBe("secret dm");
  });

  it("nip44_encrypt then nip44_decrypt round-trip", async () => {
    const { deps, transport } = makeDeps({ policyDecide: () => "allow" });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, {
      id: "13",
      method: "nip44_encrypt",
      params: [clientPk, "hello nip44"]
    });
    const enc = await readResponse(transport);
    expect(typeof enc.result).toBe("string");
    await sendRequest(transport, {
      id: "14",
      method: "nip44_decrypt",
      params: [clientPk, enc.result!]
    });
    const dec = await readResponse(transport);
    expect(dec.result).toBe("hello nip44");
  });

  it("every signed event appends an event-signed log entry", async () => {
    const { deps, transport, log } = makeDeps({ policyDecide: () => "allow" });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    const unsigned = JSON.stringify({
      kind: 7,
      created_at: 1,
      tags: [["e", "f".repeat(64)]],
      content: "+",
      pubkey: clientPk
    });
    await sendRequest(transport, { id: "15", method: "sign_event", params: [unsigned] });
    await readResponse(transport);
    expect(log.some((e) => e.type === "event-signed")).toBe(true);
  });

  it("response events are kind 24133 signed by the signer", async () => {
    const { deps, transport } = makeDeps();
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "16", method: "ping", params: [] });
    const event = transport.published[0]!;
    expect(event.kind).toBe(24133);
    expect(event.pubkey).toBe(signerPk);
    expect(event.tags.some((t) => t[0] === "p" && t[1] === clientPk)).toBe(true);
  });

  it("finalizes events deterministically through finalizeEvent sanity check", () => {
    const sk = generateSecretKey();
    const event = finalizeEvent(
      { kind: 1, created_at: 1, tags: [], content: "x" },
      sk
    );
    expect(event.pubkey).toBe(getPublicKey(sk));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bunker.test.ts`
Expected: FAIL with "Cannot find module '../src/main/bunker.js'".

- [ ] **Step 3: Write minimal implementation**

Create `src/main/bunker.ts`:

```ts
import { finalizeEvent } from "nostr-tools/pure";
import * as nip04 from "nostr-tools/nip04";
import * as nip44 from "nostr-tools/nip44";
import {
  actionTypeOf,
  buildErrorResponse,
  buildResponse,
  parseRequestEvent,
  parseUnsignedEvent,
  NIP46_REQUEST_KIND
} from "./nip46.js";
import type {
  ActionType,
  ApprovalChoice,
  LogEntry,
  LogEntryType,
  Nip46Request,
  EventTemplate,
  Nip46Response,
  PendingApproval,
  PolicyDecision,
  RelayTransport,
  SignedEvent
} from "../shared/types.js";

export interface BunkerDeps {
  signerPubkey: string;
  getSecretKey(): Uint8Array;
  transport: RelayTransport;
  isClient(pubkey: string): boolean;
  addClient(pubkey: string): void;
  clientName(pubkey: string): string;
  policyDecide(clientPubkey: string, actionType: ActionType): PolicyDecision;
  addRule(clientPubkey: string, actionType: ActionType): void;
  askApproval(approval: PendingApproval): Promise<ApprovalChoice>;
  log(entry: LogEntry): void;
}

export const ERR_UNSUPPORTED = "unsupported method";
export const ERR_DENIED = "denied by user";

function conversationKey(secretKey: Uint8Array, pubkey: string): Uint8Array {
  const key = nip44.v2.utils.getConversationKey(secretKey, pubkey);
  return key instanceof Uint8Array ? key : new Uint8Array(key);
}

const SUPPORTED = new Set([
  "connect",
  "sign_event",
  "get_public_key",
  "ping",
  "nip04_encrypt",
  "nip04_decrypt",
  "nip44_encrypt",
  "nip44_decrypt"
]);

export class BunkerCore {
  constructor(private deps: BunkerDeps) {}

  async start(): Promise<void> {
    await this.deps.transport.connect();
    this.deps.transport.subscribe({
      filters: [{ kinds: [NIP46_REQUEST_KIND], "#p": [this.deps.signerPubkey] }],
      onEvent: (event) => {
        void this.handleEvent(event.pubkey, event.content);
      }
    });
  }

  private appendLog(type: LogEntryType, message: string, extra?: Partial<LogEntry>): void {
    this.deps.log({ timestamp: Date.now(), type, message, ...extra });
  }

  private async handleEvent(eventPubkey: string, content: string): Promise<void> {
    let plaintext: string;
    let scheme: "nip44" | "nip04";
    const secretKey = this.deps.getSecretKey();
    try {
      plaintext = nip44.v2.decrypt(content, conversationKey(secretKey, eventPubkey));
      scheme = "nip44";
    } catch {
      try {
        plaintext = await nip04.decrypt(secretKey, eventPubkey, content);
        scheme = "nip04";
      } catch {
        this.appendLog("request-dropped", "Undecryptable request dropped", {
          clientPubkey: eventPubkey
        });
        return;
      }
    }

    const parsed = parseRequestEvent(
      {
        kind: NIP46_REQUEST_KIND,
        pubkey: eventPubkey,
        content: plaintext,
        tags: [["p", this.deps.signerPubkey]]
      },
      this.deps.signerPubkey
    );
    if (parsed === null) {
      this.appendLog("request-dropped", "Malformed request payload dropped", {
        clientPubkey: eventPubkey
      });
      return;
    }

    let response: Nip46Response;
    try {
      response = await this.dispatch(parsed.clientPubkey, parsed.request);
    } catch {
      response = buildErrorResponse(parsed.request.id, "internal error");
    }
    try {
      await this.publishResponse(parsed.clientPubkey, response, scheme);
    } catch {
      this.appendLog("protocol-error", "Failed to publish response (relays unreachable)", {
        clientPubkey: parsed.clientPubkey
      });
    }
  }

  private async publishResponse(
    clientPubkey: string,
    response: Nip46Response,
    scheme: "nip44" | "nip04"
  ): Promise<void> {
    const secretKey = this.deps.getSecretKey();
    const serialized = JSON.stringify(response);
    const content =
      scheme === "nip44"
        ? nip44.v2.encrypt(serialized, conversationKey(secretKey, clientPubkey))
        : await nip04.encrypt(secretKey, clientPubkey, serialized);
    const event: EventTemplate = {
      kind: NIP46_REQUEST_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["p", clientPubkey]],
      content
    };
    const signed = finalizeEvent(event, secretKey) as SignedEvent;
    await this.deps.transport.publish(signed);
  }

  private async dispatch(clientPubkey: string, request: Nip46Request): Promise<Nip46Response> {
    if (!SUPPORTED.has(request.method)) {
      this.appendLog("protocol-error", `Unsupported method: ${request.method}`, {
        clientPubkey
      });
      return buildErrorResponse(request.id, ERR_UNSUPPORTED);
    }

    switch (request.method) {
      case "connect":
        return this.handleConnect(clientPubkey, request);
      case "get_public_key":
        if (!this.deps.isClient(clientPubkey)) {
          return buildErrorResponse(request.id, ERR_DENIED);
        }
        return buildResponse(request.id, this.deps.signerPubkey);
      case "ping":
        if (!this.deps.isClient(clientPubkey)) {
          return buildErrorResponse(request.id, ERR_DENIED);
        }
        return buildResponse(request.id, "pong");
      case "sign_event":
        return this.handleSignEvent(clientPubkey, request);
      case "nip04_encrypt":
      case "nip04_decrypt":
      case "nip44_encrypt":
      case "nip44_decrypt":
        return this.handleEncryption(clientPubkey, request);
      default:
        return buildErrorResponse(request.id, ERR_UNSUPPORTED);
    }
  }

  private async handleConnect(clientPubkey: string, request: Nip46Request): Promise<Nip46Response> {
    if (this.deps.isClient(clientPubkey)) {
      return buildResponse(request.id, "ack");
    }
    const choice = await this.deps.askApproval({
      id: request.id,
      clientPubkey,
      clientName: this.deps.clientName(clientPubkey),
      actionType: "connect",
      description: "New client wants to connect"
    });
    if (choice === "deny") {
      this.appendLog("client-denied", "Connection denied", { clientPubkey });
      return buildErrorResponse(request.id, ERR_DENIED);
    }
    this.deps.addClient(clientPubkey);
    this.appendLog("client-connected", "Client connected", { clientPubkey });
    return buildResponse(request.id, "ack");
  }

  private async checkPolicy(
    clientPubkey: string,
    actionType: ActionType,
    description: string,
    requestId: string,
    eventPreview?: string
  ): Promise<boolean> {
    const decision = this.deps.policyDecide(clientPubkey, actionType);
    if (decision === "allow") {
      return true;
    }
    if (decision === "deny") {
      return false;
    }
    const choice = await this.deps.askApproval({
      id: requestId,
      clientPubkey,
      clientName: this.deps.clientName(clientPubkey),
      actionType,
      description,
      eventPreview
    });
    if (choice === "deny") {
      this.appendLog("request-denied", description, { clientPubkey, actionType });
      return false;
    }
    if (choice === "always-allow") {
      this.deps.addRule(clientPubkey, actionType);
    }
    this.appendLog("request-approved", description, { clientPubkey, actionType });
    return true;
  }

  private async handleSignEvent(clientPubkey: string, request: Nip46Request): Promise<Nip46Response> {
    const raw = request.params[0];
    if (raw === undefined) {
      return buildErrorResponse(request.id, "missing event parameter");
    }
    const unsigned = parseUnsignedEvent(raw);
    if (unsigned === null) {
      return buildErrorResponse(request.id, "invalid event");
    }
    const actionType = actionTypeOf("sign_event", request.params);
    if (actionType === null) {
      return buildErrorResponse(request.id, "invalid event");
    }
    const allowed = await this.checkPolicy(
      clientPubkey,
      actionType,
      `Sign kind ${unsigned.kind} event`,
      request.id,
      unsigned.content.slice(0, 280)
    );
    if (!allowed) {
      return buildErrorResponse(request.id, ERR_DENIED);
    }
    const signed = finalizeEvent(unsigned, this.deps.getSecretKey()) as SignedEvent;
    this.appendLog("event-signed", `Signed kind ${unsigned.kind} event`, {
      clientPubkey,
      actionType,
      eventId: signed.id
    });
    return buildResponse(request.id, JSON.stringify(signed));
  }

  private async handleEncryption(clientPubkey: string, request: Nip46Request): Promise<Nip46Response> {
    const actionType = actionTypeOf(request.method, request.params);
    if (actionType === null) {
      return buildErrorResponse(request.id, ERR_UNSUPPORTED);
    }
    const [thirdParty, payload] = request.params;
    if (thirdParty === undefined || payload === undefined) {
      return buildErrorResponse(request.id, "missing parameters");
    }
    const allowed = await this.checkPolicy(
      clientPubkey,
      actionType,
      `${request.method} for ${thirdParty.slice(0, 12)}...`,
      request.id
    );
    if (!allowed) {
      return buildErrorResponse(request.id, ERR_DENIED);
    }
    const secretKey = this.deps.getSecretKey();
    try {
      switch (request.method) {
        case "nip04_encrypt":
          return buildResponse(request.id, await nip04.encrypt(secretKey, thirdParty, payload));
        case "nip04_decrypt":
          return buildResponse(request.id, await nip04.decrypt(secretKey, thirdParty, payload));
        case "nip44_encrypt":
          return buildResponse(
            request.id,
            nip44.v2.encrypt(payload, conversationKey(secretKey, thirdParty))
          );
        case "nip44_decrypt":
          return buildResponse(
            request.id,
            nip44.v2.decrypt(payload, conversationKey(secretKey, thirdParty))
          );
        default:
          return buildErrorResponse(request.id, ERR_UNSUPPORTED);
      }
    } catch {
      return buildErrorResponse(request.id, "encryption operation failed");
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bunker.test.ts`
Expected: PASS (17 tests)

- [ ] **Step 5: Commit**

```powershell
git add src/main/bunker.ts tests/bunker.test.ts
git commit -m "feat: bunker core with dispatch policy gating and encrypted responses"
```

---

### Task 10: RelayTransport implementation (nostr-tools SimplePool)

**Files:**
- Create: `src/main/relay.ts`
- Test: `tests/relay.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/relay.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeRelayUrls, DEFAULT_RELAYS } from "../src/main/relay.js";

describe("relay url helpers", () => {
  it("exposes the default relays from the spec", () => {
    expect(DEFAULT_RELAYS).toEqual([
      "wss://relay.damus.io",
      "wss://nos.lol",
      "wss://relay.nostr.band"
    ]);
  });

  it("keeps valid wss urls and trims whitespace", () => {
    expect(normalizeRelayUrls([" wss://relay.damus.io "])).toEqual([
      "wss://relay.damus.io"
    ]);
  });

  it("drops entries that are not wss:// urls", () => {
    expect(normalizeRelayUrls(["http://x", "wss://ok.example", ""])).toEqual([
      "wss://ok.example"
    ]);
  });

  it("dedupes urls", () => {
    expect(
      normalizeRelayUrls(["wss://a.example", "wss://a.example", "wss://b.example"])
    ).toEqual(["wss://a.example", "wss://b.example"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/relay.test.ts`
Expected: FAIL with "Cannot find module '../src/main/relay.js'".

- [ ] **Step 3: Write minimal implementation**

Create `src/main/relay.ts`:

```ts
import { SimplePool } from "nostr-tools/pool";
import type { RelayStatus, RelayTransport, SignedEvent, TransportSubscription } from "../shared/types.js";

export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band"
];

export function normalizeRelayUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = raw.trim();
    if (url.startsWith("wss://") && url.length > "wss://".length && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

export class SimplePoolTransport implements RelayTransport {
  private pool = new SimplePool();
  private relays: string[];
  private statuses = new Map<string, RelayStatus>();
  private statusCb: ((statuses: RelayStatus[]) => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(relays: string[]) {
    this.relays = normalizeRelayUrls(relays);
    for (const url of this.relays) {
      this.statuses.set(url, { url, connected: false });
    }
  }

  async connect(): Promise<void> {
    this.pollTimer = setInterval(() => this.refreshStatuses(), 2000);
    await this.refreshStatuses();
  }

  private async refreshStatuses(): Promise<void> {
    for (const url of this.relays) {
      let connected = false;
      try {
        const relay = await this.pool.ensureRelay(url, { connectionTimeout: 3000 });
        connected = relay.connected;
      } catch {
        connected = false;
      }
      const prev = this.statuses.get(url);
      if (!prev || prev.connected !== connected) {
        this.statuses.set(url, { url, connected });
        this.emitStatuses();
      }
    }
  }

  private emitStatuses(): void {
    this.statusCb?.(this.getStatuses());
  }

  subscribe(sub: TransportSubscription): { close(): void } {
    const closer = this.pool.subscribeMany(this.relays, sub.filters[0]!, {
      onevent(event) {
        sub.onEvent({ pubkey: event.pubkey, content: event.content });
      }
    });
    return { close: () => closer.close() };
  }

  async publish(event: SignedEvent): Promise<void> {
    await Promise.any(this.pool.publish(this.relays, event));
  }

  onStatusChange(cb: (statuses: RelayStatus[]) => void): void {
    this.statusCb = cb;
  }

  async setRelays(urls: string[]): Promise<void> {
    this.relays = normalizeRelayUrls(urls);
    this.statuses.clear();
    for (const url of this.relays) {
      this.statuses.set(url, { url, connected: false });
    }
    this.emitStatuses();
    await this.refreshStatuses();
  }

  getStatuses(): RelayStatus[] {
    return [...this.statuses.values()];
  }

  destroy(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.pool.close(this.relays);
  }
}
```

Note: SimplePool already retries failed relay connections internally; the 2-second status poller both drives the dashboard's per-relay status and gives reconnect-with-backoff visibility without hand-rolling socket logic.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/relay.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```powershell
git add src/main/relay.ts tests/relay.test.ts
git commit -m "feat: simplepool relay transport with status polling"
```

---
### Task 11: E2E — nostr-tools BunkerSigner against our bunker

**Files:**
- Create: `tests/helpers/mockrelay.ts`
- Create: `src/main/bunker-uri.ts`
- Test: `tests/e2e.test.ts`

This test uses the real `BunkerSigner` client from nostr-tools (the same class production web clients use) as an independent protocol implementation, connected to our `BunkerCore` through an in-memory bus. `BunkerSigner.fromBunker(clientSecretKey, bp, { pool })` accepts an injected `AbstractSimplePool`; we inject `FakePool`, which routes through `MockBus`. Verified against nostr-tools 2.17.0: BunkerSigner transport encryption is NIP-44 only, it subscribes with filter `{ kinds: [24133], authors: [signerPubkey], "#p": [clientPubkey] }`, it publishes requests with `Promise.any(pool.publish(relays, event))`, and `signEvent` verifies the returned signature itself.

- [ ] **Step 1: Write the failing test**

Create `tests/helpers/mockrelay.ts`:

```ts
import type { SignedEvent, TransportSubscription } from "../../src/shared/types.js";

export interface MockEvent {
  kind: number;
  pubkey: string;
  content: string;
  tags: string[][];
  created_at: number;
  id?: string;
  sig?: string;
}

export interface MockFilter {
  kinds?: number[];
  authors?: string[];
  "#p"?: string[];
}

function matches(filter: MockFilter, event: MockEvent): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) {
    return false;
  }
  if (filter.authors && !filter.authors.includes(event.pubkey)) {
    return false;
  }
  const p = filter["#p"];
  if (p && !event.tags.some((t) => t[0] === "p" && p.includes(t[1]!))) {
    return false;
  }
  return true;
}

export class MockBus {
  private subs: Array<{ filter: MockFilter; onEvent(event: MockEvent): void }> = [];

  publish(event: MockEvent): void {
    for (const sub of [...this.subs]) {
      if (matches(sub.filter, event)) {
        const handler = sub.onEvent;
        queueMicrotask(() => handler(event));
      }
    }
  }

  subscribe(filter: MockFilter, onEvent: (event: MockEvent) => void): { close(): void } {
    const sub = { filter, onEvent };
    this.subs.push(sub);
    return {
      close: () => {
        this.subs = this.subs.filter((s) => s !== sub);
      }
    };
  }
}

export class FakePool {
  constructor(private bus: MockBus) {}

  subscribe(
    _relays: string[],
    filter: MockFilter,
    params: { onevent?: (event: MockEvent) => void }
  ): { close(): void } {
    return this.bus.subscribe(filter, (event) => params.onevent?.(event));
  }

  subscribeMany(
    relays: string[],
    filter: MockFilter,
    params: { onevent?: (event: MockEvent) => void }
  ): { close(): void } {
    return this.subscribe(relays, filter, params);
  }

  publish(_relays: string[], event: MockEvent): Promise<string>[] {
    this.bus.publish(event);
    return [Promise.resolve("ok")];
  }

  close(): void {}
}

export class MockBusTransport {
  constructor(private bus: MockBus) {}

  async connect(): Promise<void> {}

  subscribe(sub: TransportSubscription): { close(): void } {
    return this.bus.subscribe(sub.filters[0]!, (event) =>
      sub.onEvent({ pubkey: event.pubkey, content: event.content })
    );
  }

  async publish(event: SignedEvent): Promise<void> {
    this.bus.publish(event);
  }

  onStatusChange(): void {}

  async setRelays(): Promise<void> {}

  getStatuses(): Array<{ url: string; connected: boolean }> {
    return [{ url: "mock://relay", connected: true }];
  }
}
```

Create `tests/e2e.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { BunkerSigner } from "nostr-tools/nip46";
import type { AbstractSimplePool } from "nostr-tools/abstract-pool";
import { BunkerCore, type BunkerDeps } from "../src/main/bunker.js";
import { parseBunkerUri, buildBunkerUri } from "../src/main/bunker-uri.js";
import { MockBus, FakePool, MockBusTransport } from "./helpers/mockrelay.js";
import type { LogEntry } from "../src/shared/types.js";

describe("E2E: BunkerSigner client <-> BunkerCore through mock bus", () => {
  it("completes connect, get_public_key, ping, sign_event and nip44 round-trips", async () => {
    const bus = new MockBus();
    const signerSecretKey = generateSecretKey();
    const signerPubkey = getPublicKey(signerSecretKey);
    const clientSecretKey = generateSecretKey();
    const clientPubkey = getPublicKey(clientSecretKey);

    const log: LogEntry[] = [];
    const approvals: string[] = [];
    const rules: string[] = [];
    const knownClients = new Set<string>();

    const deps: BunkerDeps = {
      signerPubkey,
      getSecretKey: () => signerSecretKey,
      transport: new MockBusTransport(bus),
      isClient: (pk) => knownClients.has(pk),
      addClient: (pk) => {
        knownClients.add(pk);
      },
      clientName: (pk) => pk.slice(0, 12),
      policyDecide: () => "ask",
      addRule: (pk, actionType) => {
        rules.push(`${pk}:${actionType}`);
      },
      askApproval: async (approval) => {
        approvals.push(approval.actionType);
        return "always-allow";
      },
      log: (entry) => log.push(entry)
    };

    const bunker = new BunkerCore(deps);
    await bunker.start();

    const client = BunkerSigner.fromBunker(
      clientSecretKey,
      { pubkey: signerPubkey, relays: ["mock://relay"], secret: "pairing-secret" },
      { pool: new FakePool(bus) as unknown as AbstractSimplePool }
    );

    await client.connect();
    expect(approvals).toEqual(["connect"]);

    const pubkey = await client.getPublicKey();
    expect(pubkey).toBe(signerPubkey);

    await client.ping();

    const signed = await client.signEvent({
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: "e2e hello"
    });
    expect(signed.pubkey).toBe(signerPubkey);
    expect(signed.content).toBe("e2e hello");
    expect(approvals).toEqual(["connect", "sign_event:kind-1"]);
    expect(rules).toEqual([`${clientPubkey}:sign_event:kind-1`]);

    const ciphertext = await client.nip44Encrypt(clientPubkey, "e2e dm");
    const decrypted = await client.nip44Decrypt(clientPubkey, ciphertext);
    expect(decrypted).toBe("e2e dm");

    expect(log.some((e) => e.type === "client-connected")).toBe(true);
    expect(log.some((e) => e.type === "event-signed")).toBe(true);

    await client.close();
  });
});

describe("bunker uri helpers", () => {
  it("buildBunkerUri produces a parseable bunker:// uri", () => {
    const uri = buildBunkerUri("c".repeat(64), ["wss://relay.damus.io"], "secret123");
    expect(uri.startsWith(`bunker://${"c".repeat(64)}?`)).toBe(true);
    expect(uri).toContain("relay=wss%3A%2F%2Frelay.damus.io");
    expect(uri).toContain("secret=secret123");
  });

  it("parseBunkerUri round-trips buildBunkerUri", () => {
    const uri = buildBunkerUri(
      "c".repeat(64),
      ["wss://relay.damus.io", "wss://nos.lol"],
      "secret123"
    );
    const parsed = parseBunkerUri(uri);
    expect(parsed.pubkey).toBe("c".repeat(64));
    expect(parsed.relays).toEqual(["wss://relay.damus.io", "wss://nos.lol"]);
    expect(parsed.secret).toBe("secret123");
  });

  it("parseBunkerUri rejects non-bunker uris", () => {
    expect(() => parseBunkerUri("https://example.com")).toThrow(/bunker/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/e2e.test.ts`
Expected: FAIL with "Cannot find module '../src/main/bunker-uri.js'" (bunker.js already exists from Task 9, so the uri module is the missing piece).

- [ ] **Step 3: Write minimal implementation**

Create `src/main/bunker-uri.ts`:

```ts
export interface ParsedBunkerUri {
  pubkey: string;
  relays: string[];
  secret: string | null;
}

export function buildBunkerUri(pubkey: string, relays: string[], secret: string): string {
  const params = new URLSearchParams();
  for (const relay of relays) {
    params.append("relay", relay);
  }
  params.append("secret", secret);
  return `bunker://${pubkey}?${params.toString()}`;
}

export function parseBunkerUri(uri: string): ParsedBunkerUri {
  if (!uri.startsWith("bunker://")) {
    throw new Error("not a bunker:// uri");
  }
  const rest = uri.slice("bunker://".length);
  const [pubkey, query = ""] = rest.split("?", 2);
  if (!pubkey || !/^[0-9a-f]{64}$/.test(pubkey)) {
    throw new Error("bunker uri has invalid pubkey");
  }
  const params = new URLSearchParams(query);
  return {
    pubkey,
    relays: params.getAll("relay"),
    secret: params.get("secret")
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/e2e.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```powershell
git add tests/e2e.test.ts tests/helpers/mockrelay.ts src/main/bunker-uri.ts
git commit -m "test: e2e bunkersigner client round trip through mock relay bus"
```

---
### Task 12: Electron main process entry

**Files:**
- Create: `src/main/index.ts`
- Test: `tests/main-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { describeAction } from "../src/main/index.js";

describe("describeAction", () => {
  it("describes sign_event with kind", () => {
    expect(describeAction("sign_event:kind-1")).toBe("Publish a note (kind 1)");
    expect(describeAction("sign_event:kind-7")).toBe("Publish a reaction (kind 7)");
  });

  it("describes unknown kinds generically", () => {
    expect(describeAction("sign_event:kind-12345")).toBe("Sign kind 12345 event");
  });

  it("describes encryption action types", () => {
    expect(describeAction("nip04_decrypt")).toBe("Decrypt a direct message (NIP-04)");
    expect(describeAction("nip44_decrypt")).toBe("Decrypt a direct message (NIP-44)");
    expect(describeAction("nip04_encrypt")).toBe("Encrypt a direct message (NIP-04)");
    expect(describeAction("nip44_encrypt")).toBe("Encrypt a direct message (NIP-44)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main-wiring.test.ts`
Expected: FAIL with "Cannot find module '../src/main/index.js'".

- [ ] **Step 3: Write minimal implementation**

Create `src/main/index.ts`:

```ts
import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import * as nip19 from "nostr-tools/nip19";
import { KeyVault } from "./keyvault.js";
import { Storage } from "./storage.js";
import { PolicyEngine } from "./policy.js";
import { ClientRegistry } from "./clients.js";
import { BunkerCore } from "./bunker.js";
import { SimplePoolTransport, DEFAULT_RELAYS, normalizeRelayUrls } from "./relay.js";
import { ApprovalQueue } from "./approvals.js";
import { buildBunkerUri } from "./bunker-uri.js";
import { IPC, type SignerStatus } from "../shared/ipc.js";
import type { LogEntry, PendingApproval } from "../shared/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function describeAction(actionType: string): string {
  const kindMatch = /^sign_event:kind-(\d+)$/.exec(actionType);
  if (kindMatch) {
    const kind = Number(kindMatch[1]);
    const known: Record<number, string> = {
      0: "Update profile metadata",
      1: `Publish a note (kind 1)`,
      3: "Update follow list",
      7: `Publish a reaction (kind 7)`,
      9734: "Publish a zap request",
      30023: "Publish a long-form article"
    };
    return known[kind] ?? `Sign kind ${kind} event`;
  }
  switch (actionType) {
    case "nip04_encrypt":
      return "Encrypt a direct message (NIP-04)";
    case "nip04_decrypt":
      return "Decrypt a direct message (NIP-04)";
    case "nip44_encrypt":
      return "Encrypt a direct message (NIP-44)";
    case "nip44_decrypt":
      return "Decrypt a direct message (NIP-44)";
    default:
      return actionType;
  }
}

let mainWindow: BrowserWindow | null = null;
let pairingSecret = randomBytes(16).toString("hex");
let bunker: BunkerCore | null = null;
let transport: SimplePoolTransport | null = null;

function storageDir(): string {
  return join(app.getPath("appData"), "nostr-signer");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function sendToRenderer(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function flashWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
    mainWindow.flashFrame(true);
    mainWindow.once("focus", () => mainWindow?.flashFrame(false));
  }
}

async function startBunker(
  vault: KeyVault,
  storage: Storage,
  clients: ClientRegistry,
  policy: PolicyEngine,
  approvals: ApprovalQueue
): Promise<void> {
  if (bunker !== null) {
    return;
  }
  const relayUrls = normalizeRelayUrls(storage.loadRelays() ?? DEFAULT_RELAYS);
  transport = new SimplePoolTransport(relayUrls);
  transport.onStatusChange((statuses) => {
    sendToRenderer(IPC.StatusChanged, statuses);
  });
  bunker = new BunkerCore({
    signerPubkey: vault.getPublicKeyHex(),
    getSecretKey: () => vault.getSecretKey(),
    transport,
    isClient: (pk) => clients.isClient(pk),
    addClient: (pk) => {
      clients.addClient(pk);
    },
    clientName: (pk) => clients.get(pk)?.name ?? `${pk.slice(0, 12)}...`,
    policyDecide: (pk, action) => policy.decide(pk, action),
    addRule: (pk, action) => policy.addRule(pk, action),
    askApproval: async (approval: PendingApproval) => {
      const described: PendingApproval = {
        ...approval,
        description:
          approval.actionType === "connect"
            ? "New client wants to connect"
            : describeAction(approval.actionType)
      };
      flashWindow();
      return approvals.request(described);
    },
    log: (entry) => {
      storage.appendLog(entry);
      sendToRenderer(IPC.ActivityAppended, entry);
    }
  });
  await bunker.start();
}

async function boot(): Promise<void> {
  const storage = new Storage(storageDir());
  const vault = new KeyVault(safeStorage, storage);
  const clients = new ClientRegistry({
    loadClients: () => storage.loadClients(),
    saveClients: (list) => storage.saveClients(list)
  });
  const policy = new PolicyEngine({
    loadRules: () => storage.loadRules(),
    saveRules: (rules) => storage.saveRules(rules),
    isClient: (pk) => clients.isClient(pk)
  });
  const approvals = new ApprovalQueue();

  const relays = storage.loadRelays() ?? DEFAULT_RELAYS;

  if (vault.hasKey()) {
    await startBunker(vault, storage, clients, policy, approvals);
  }

  approvals.onRequest((approval) => {
    sendToRenderer(IPC.ApprovalRequested, approval);
  });

  ipcMain.handle(IPC.GetStatus, (): SignerStatus => {
    return {
      hasKey: vault.hasKey(),
      pubkey: vault.hasKey() ? vault.getPublicKeyHex() : null,
      relays: transport ? transport.getStatuses() : []
    };
  });

  ipcMain.handle(IPC.GetBunkerUri, (): string => {
    const relayUrls = transport
      ? transport.getStatuses().map((s) => s.url)
      : normalizeRelayUrls(relays);
    return buildBunkerUri(vault.getPublicKeyHex(), relayUrls, pairingSecret);
  });

  ipcMain.handle(IPC.HasKey, () => vault.hasKey());

  ipcMain.handle(IPC.ImportKey, async (_event, nsec: string) => {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== "nsec") {
      throw new Error("expected an nsec1... key");
    }
    const hex = Buffer.from(decoded.data).toString("hex");
    vault.setKey(hex);
    await startBunker(vault, storage, clients, policy, approvals);
  });

  ipcMain.handle(IPC.GenerateKey, async () => {
    const sk = generateSecretKey();
    vault.setKey(Buffer.from(sk).toString("hex"));
    await startBunker(vault, storage, clients, policy, approvals);
    return getPublicKey(sk);
  });

  ipcMain.handle(IPC.ListClients, () => clients.list());

  ipcMain.handle(IPC.RenameClient, (_event, pubkey: string, name: string) => {
    clients.rename(pubkey, name);
  });

  ipcMain.handle(IPC.RevokeClient, (_event, pubkey: string) => {
    clients.remove(pubkey);
    policy.forgetRulesFor(pubkey);
  });

  ipcMain.handle(IPC.ResetClientApprovals, (_event, pubkey: string) => {
    policy.forgetRulesFor(pubkey);
  });

  ipcMain.handle(IPC.RespondApproval, (_event, id: string, choice: "allow-once" | "always-allow" | "deny") => {
    approvals.respond(id, choice);
  });

  ipcMain.handle(IPC.GetActivityLog, () => storage.loadLog());

  ipcMain.handle(IPC.GetRelays, () => storage.loadRelays() ?? DEFAULT_RELAYS);

  ipcMain.handle(IPC.SetRelays, async (_event, urls: string[]) => {
    const normalized = normalizeRelayUrls(urls);
    storage.saveRelays(normalized);
    if (transport) {
      await transport.setRelays(normalized);
    }
  });
}

const isElectronRuntime = process.versions.electron !== undefined && app !== undefined;

if (isElectronRuntime) {
  app.whenReady().then(() => {
    void boot();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
```

Note: `sandbox: false` is required because the preload uses `contextBridge`+`ipcRenderer` with ESM-compiled output; `contextIsolation: true` and `nodeIntegration: false` keep the renderer untrusted. The renderer never receives key material: every handler above returns only pubkeys, metadata, URIs, and log entries.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main-wiring.test.ts`
Expected: PASS (4 tests)

The `isElectronRuntime` guard plus a vitest alias keeps this module side-effect free when imported by tests. Add to `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/main/**", "src/shared/**"]
    },
    alias: [
      {
        find: "electron",
        replacement: "tests/helpers/electron-stub.ts"
      }
    ]
  }
});
```

And create `tests/helpers/electron-stub.ts`:

```ts
export const app = undefined;
export const BrowserWindow = undefined;
export const ipcMain = { handle: () => {} };
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Uint8Array) => Buffer.from(b).toString()
};
```

Under the stub, `app !== undefined` is false, so importing `src/main/index.ts` in vitest never touches Electron. Update `vitest.config.ts` accordingly and verify the full suite still passes:

Run: `npx vitest run`
Expected: PASS (all test files)
- [ ] **Step 5: Commit**

```powershell
git add src/main/index.ts tests/main-wiring.test.ts tests/helpers/electron-stub.ts vitest.config.ts
git commit -m "feat: electron main process entry with wiring and ipc handlers"
```

---

### Task 13: Preload + contextBridge typed API

**Files:**
- Create: `src/preload/preload.ts`
- Test: `tests/preload.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/preload.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

const invokeMock = vi.fn();
const onMock = vi.fn();
const exposeMock = vi.fn();

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: exposeMock },
  ipcRenderer: { invoke: invokeMock, on: onMock }
}));

describe("preload bridge", () => {
  it("exposes signerApi with all typed methods bound to ipc channels", async () => {
    await import("../src/preload/preload.js");
    expect(exposeMock).toHaveBeenCalledTimes(1);
    const [name, api] = exposeMock.mock.calls[0]!;
    expect(name).toBe("signerApi");

    invokeMock.mockResolvedValue({ hasKey: true, pubkey: "x", relays: [] });
    await api.getStatus();
    expect(invokeMock).toHaveBeenCalledWith("signer:get-status");

    await api.respondApproval("req-1", "always-allow");
    expect(invokeMock).toHaveBeenCalledWith("signer:respond-approval", "req-1", "always-allow");

    await api.setRelays(["wss://nos.lol"]);
    expect(invokeMock).toHaveBeenCalledWith("signer:set-relays", ["wss://nos.lol"]);

    const cb = vi.fn();
    api.onApprovalRequested(cb);
    expect(onMock).toHaveBeenCalledWith("signer:approval-requested", expect.any(Function));

    await api.renameClient("pk", "name");
    expect(invokeMock).toHaveBeenCalledWith("signer:rename-client", "pk", "name");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/preload.test.ts`
Expected: FAIL with "Cannot find module '../src/preload/preload.js'".

- [ ] **Step 3: Write minimal implementation**

Create `src/preload/preload.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type SignerApi } from "../shared/ipc.js";
import type { LogEntry, PendingApproval } from "../shared/types.js";

const api: SignerApi = {
  getStatus: () => ipcRenderer.invoke(IPC.GetStatus),
  getBunkerUri: () => ipcRenderer.invoke(IPC.GetBunkerUri),
  hasKey: () => ipcRenderer.invoke(IPC.HasKey),
  importKey: (nsec: string) => ipcRenderer.invoke(IPC.ImportKey, nsec),
  generateKey: () => ipcRenderer.invoke(IPC.GenerateKey),
  listClients: () => ipcRenderer.invoke(IPC.ListClients),
  renameClient: (pubkey: string, name: string) =>
    ipcRenderer.invoke(IPC.RenameClient, pubkey, name),
  revokeClient: (pubkey: string) => ipcRenderer.invoke(IPC.RevokeClient, pubkey),
  resetClientApprovals: (pubkey: string) =>
    ipcRenderer.invoke(IPC.ResetClientApprovals, pubkey),
  respondApproval: (id: string, choice: "allow-once" | "always-allow" | "deny") =>
    ipcRenderer.invoke(IPC.RespondApproval, id, choice),
  getActivityLog: () => ipcRenderer.invoke(IPC.GetActivityLog),
  getRelays: () => ipcRenderer.invoke(IPC.GetRelays),
  setRelays: (urls: string[]) => ipcRenderer.invoke(IPC.SetRelays, urls),
  onApprovalRequested: (cb: (approval: PendingApproval) => void) => {
    ipcRenderer.on(IPC.ApprovalRequested, (_event, approval: PendingApproval) => cb(approval));
  },
  onActivity: (cb: (entry: LogEntry) => void) => {
    ipcRenderer.on(IPC.ActivityAppended, (_event, entry: LogEntry) => cb(entry));
  }
};

contextBridge.exposeInMainWorld("signerApi", api);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/preload.test.ts`
Expected: PASS (1 test)

Note: the `vi.mock("electron", ...)` factory in the test shadows the global `alias` stub from Task 12 for this file only — that is intended.

- [ ] **Step 5: Commit**

```powershell
git add src/preload/preload.ts tests/preload.test.ts
git commit -m "feat: preload contextbridge typed signer api"
```

---
### Task 14: Renderer UI

**Files:**
- Create: `src/renderer/index.html`
- Create: `src/renderer/styles.css`
- Create: `src/renderer/app.ts`
- Test: `tests/renderer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer.test.ts` (tests the pure formatting helpers the UI uses, so the logic is verifiable without a DOM):

```ts
import { describe, it, expect } from "vitest";
import { shortKey, formatTimestamp, describeLogEntry } from "../src/renderer/app.js";

describe("renderer helpers", () => {
  it("shortKey truncates a hex pubkey", () => {
    expect(shortKey("abcdef0123456789" + "0".repeat(48))).toBe("abcdef012345...");
  });

  it("formatTimestamp renders HH:MM:SS", () => {
    const ts = new Date(2026, 8, 2, 14, 5, 9).getTime();
    expect(formatTimestamp(ts)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("describeLogEntry formats known entry types", () => {
    expect(
      describeLogEntry({ timestamp: 0, type: "event-signed", message: "Signed kind 1 event" })
    ).toBe("Signed kind 1 event");
    expect(
      describeLogEntry({ timestamp: 0, type: "client-connected", message: "Client connected" })
    ).toBe("Client connected");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer.test.ts`
Expected: FAIL with "Cannot find module '../src/renderer/app.js'".

- [ ] **Step 3: Write minimal implementation**

Create `src/renderer/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; style-src 'self'; img-src 'self' data:"
    />
    <title>Nostr Signer</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <header><h1>Nostr Signer</h1></header>

    <section id="onboarding" hidden>
      <h2>Set up your key</h2>
      <p>Paste an existing nsec, or generate a new key.</p>
      <input id="nsec-input" type="password" placeholder="nsec1..." autocomplete="off" />
      <div class="row">
        <button id="import-key">Import nsec</button>
        <button id="generate-key">Generate new key</button>
      </div>
      <p id="onboarding-error" class="error" hidden></p>
    </section>

    <main id="dashboard" hidden>
      <section id="bunker-uri-section">
        <h2>Bunker URI</h2>
        <div class="row">
          <input id="bunker-uri" readonly />
          <button id="copy-uri">Copy</button>
        </div>
        <img id="qr" alt="Bunker URI QR code" />
      </section>

      <section id="relays-section">
        <h2>Relays</h2>
        <ul id="relay-list"></ul>
      </section>

      <section id="clients-section">
        <h2>Clients</h2>
        <ul id="client-list"></ul>
      </section>

      <section id="activity-section">
        <h2>Activity</h2>
        <ul id="activity-log"></ul>
      </section>

      <section id="settings-section">
        <h2>Settings</h2>
        <textarea id="relay-input" rows="4" placeholder="wss://relay.example.com (one per line)"></textarea>
        <button id="save-relays">Save relays</button>
      </section>
    </main>

    <div id="approval-modal" hidden>
      <div class="modal-card">
        <h2>Approval needed</h2>
        <p id="approval-client"></p>
        <p id="approval-action"></p>
        <pre id="approval-preview" hidden></pre>
        <div class="row">
          <button id="approval-allow-once">Allow once</button>
          <button id="approval-always">Always allow</button>
          <button id="approval-deny">Deny</button>
        </div>
      </div>
    </div>

    <script type="module" src="app.js"></script>
  </body>
</html>
```

Create `src/renderer/styles.css`:

```css
:root {
  color-scheme: light dark;
  font-family: system-ui, sans-serif;
}

body {
  margin: 0 auto;
  max-width: 760px;
  padding: 1rem;
}

h1 {
  font-size: 1.25rem;
}

h2 {
  font-size: 1rem;
  margin-bottom: 0.25rem;
}

section {
  margin-bottom: 1.25rem;
}

.row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

input,
textarea {
  flex: 1;
  font-family: monospace;
  padding: 0.4rem;
}

button {
  padding: 0.4rem 0.8rem;
  cursor: pointer;
}

#qr {
  display: block;
  margin-top: 0.75rem;
  width: 180px;
  height: 180px;
}

ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

li {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.25rem 0;
  border-bottom: 1px solid #8883;
  font-family: monospace;
  font-size: 0.85rem;
}

.relay-dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  background: #c0392b;
  flex: none;
}

.relay-dot.connected {
  background: #27ae60;
}

.error {
  color: #c0392b;
}

#approval-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-card {
  background: Canvas;
  color: CanvasText;
  padding: 1.5rem;
  border-radius: 8px;
  max-width: 480px;
  width: 90%;
}

#approval-preview {
  max-height: 8rem;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  background: #8882;
  padding: 0.5rem;
}
```

Create `src/renderer/app.ts`:

```ts
import * as QRCode from "qrcode";
import type { SignerApi } from "../shared/ipc.js";
import type {
  ClientRecord,
  LogEntry,
  PendingApproval,
  RelayStatus
} from "../shared/types.js";

declare global {
  interface Window {
    signerApi: SignerApi;
  }
}

const api = window.signerApi;

export function shortKey(pubkey: string): string {
  return `${pubkey.slice(0, 12)}...`;
}

export function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function describeLogEntry(entry: LogEntry): string {
  return entry.message;
}

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`missing element #${id}`);
  }
  return found as T;
}

function show(id: string): void {
  el<HTMLElement>(id).hidden = false;
}

function hide(id: string): void {
  el<HTMLElement>(id).hidden = true;
}

async function renderRelays(statuses: RelayStatus[]): Promise<void> {
  const list = el<HTMLUListElement>("relay-list");
  list.replaceChildren();
  for (const status of statuses) {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = status.connected ? "relay-dot connected" : "relay-dot";
    const label = document.createElement("span");
    label.textContent = status.url;
    li.append(dot, label);
    list.append(li);
  }
}

async function renderClients(): Promise<void> {
  const clients: ClientRecord[] = await api.listClients();
  const list = el<HTMLUListElement>("client-list");
  list.replaceChildren();
  for (const client of clients) {
    const li = document.createElement("li");
    const name = document.createElement("input");
    name.value = client.name;
    name.addEventListener("change", () => {
      void api.renameClient(client.pubkey, name.value);
    });
    const revoke = document.createElement("button");
    revoke.textContent = "Revoke";
    revoke.addEventListener("click", () => {
      void api.revokeClient(client.pubkey).then(renderClients);
    });
    const reset = document.createElement("button");
    reset.textContent = "Reset approvals";
    reset.addEventListener("click", () => {
      void api.resetClientApprovals(client.pubkey);
    });
    li.append(name, revoke, reset);
    list.append(li);
  }
}

function appendActivity(entry: LogEntry): void {
  const list = el<HTMLUListElement>("activity-log");
  const li = document.createElement("li");
  li.textContent = `${formatTimestamp(entry.timestamp)}  ${describeLogEntry(entry)}`;
  list.prepend(li);
  while (list.children.length > 200) {
    list.lastElementChild?.remove();
  }
}

async function renderActivity(): Promise<void> {
  const entries = await api.getActivityLog();
  el<HTMLUListElement>("activity-log").replaceChildren();
  for (const entry of entries.slice(-200).reverse()) {
    appendActivity(entry);
  }
}

let currentApproval: PendingApproval | null = null;

function showApproval(approval: PendingApproval): void {
  currentApproval = approval;
  el<HTMLParagraphElement>("approval-client").textContent =
    `Client: ${approval.clientName} (${shortKey(approval.clientPubkey)})`;
  el<HTMLParagraphElement>("approval-action").textContent = approval.description;
  const preview = el<HTMLPreElement>("approval-preview");
  if (approval.eventPreview) {
    preview.textContent = approval.eventPreview;
    preview.hidden = false;
  } else {
    preview.hidden = true;
  }
  show("approval-modal");
}

async function resolveApproval(choice: "allow-once" | "always-allow" | "deny"): Promise<void> {
  const approval = currentApproval;
  if (!approval) {
    return;
  }
  currentApproval = null;
  hide("approval-modal");
  await api.respondApproval(approval.id, choice);
  await renderClients();
}

async function showDashboard(): Promise<void> {
  hide("onboarding");
  show("dashboard");
  const [status, uri, relays] = await Promise.all([
    api.getStatus(),
    api.getBunkerUri(),
    api.getRelays()
  ]);
  el<HTMLInputElement>("bunker-uri").value = uri;
  const qrDataUrl = await QRCode.toDataURL(uri, { width: 360, margin: 1 });
  el<HTMLImageElement>("qr").src = qrDataUrl;
  await renderRelays(status.relays);
  el<HTMLTextAreaElement>("relay-input").value = relays.join("\n");
  await renderClients();
  await renderActivity();
}

async function init(): Promise<void> {
  const hasKey = await api.hasKey();
  if (hasKey) {
    await showDashboard();
  } else {
    show("onboarding");
  }

  el<HTMLButtonElement>("import-key").addEventListener("click", () => {
    void (async () => {
      const nsec = el<HTMLInputElement>("nsec-input").value.trim();
      try {
        await api.importKey(nsec);
        await showDashboard();
      } catch {
        const err = el<HTMLParagraphElement>("onboarding-error");
        err.textContent = "Invalid nsec. Expected nsec1...";
        err.hidden = false;
      }
    })();
  });

  el<HTMLButtonElement>("generate-key").addEventListener("click", () => {
    void api.generateKey().then(showDashboard);
  });

  el<HTMLButtonElement>("copy-uri").addEventListener("click", () => {
    void navigator.clipboard.writeText(el<HTMLInputElement>("bunker-uri").value);
  });

  el<HTMLButtonElement>("save-relays").addEventListener("click", () => {
    const urls = el<HTMLTextAreaElement>("relay-input").value
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    void api.setRelays(urls);
  });

  el<HTMLButtonElement>("approval-allow-once").addEventListener("click", () => {
    void resolveApproval("allow-once");
  });
  el<HTMLButtonElement>("approval-always").addEventListener("click", () => {
    void resolveApproval("always-allow");
  });
  el<HTMLButtonElement>("approval-deny").addEventListener("click", () => {
    void resolveApproval("deny");
  });

  api.onApprovalRequested((approval) => {
    showApproval(approval);
  });
  api.onActivity((entry) => {
    appendActivity(entry);
  });
}

if (typeof document !== "undefined") {
  void init();
}
```

Note: `window.signerApi` is injected by the preload; the renderer never sees key material — `importKey` sends the typed nsec one-way into the main process and receives only `void` back. The `typeof document` guard keeps the module importable from vitest for the helper tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/index.html src/renderer/styles.css src/renderer/app.ts tests/renderer.test.ts
git commit -m "feat: renderer ui with onboarding dashboard approvals and settings"
```

---

### Task 15: Typecheck + full build + electron-builder `dir` packaging

**Files:**
- Modify: `package.json` (only if the `build` block from Task 1 needs adjustment — it should not)
- Create: `electron-builder.yml` (optional override file; only create if you remove the `build` key from package.json — do NOT do both)

- [ ] **Step 1: Typecheck everything**

Run: `npx tsc -b tsconfig.node.json tsconfig.web.json`
Expected: no errors; `out/` populated with `out/main/`, `out/preload/`, `out/shared/`, `out/renderer/`.

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (all test files: smoke, types, policy, keyvault, storage, clients, nip46, approvals, bunker, relay, e2e, main-wiring, preload, renderer).

- [ ] **Step 3: Build the unpacked app directory**

Run: `npm run dist`
Expected: electron-builder completes with the `dir` target only (no installer) and prints the output directory.

- [ ] **Step 4: Verify the output**

Run: `Test-Path "dist\win-unpacked\Nostr Signer.exe"`
Expected: `True`. The unpacked application lives at `dist\win-unpacked\` — runnable in place, no installer, no registry changes.

- [ ] **Step 5: Commit**

```powershell
git add package.json
git commit -m "build: verified electron-builder dir packaging"
```

---

### Task 16: README with dev/test/build + manual smoke test

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the README**

Create `README.md`:

````markdown
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
````

- [ ] **Step 2: Verify**

Run: `Test-Path README.md`
Expected: `True`

- [ ] **Step 3: Commit**

```powershell
git add README.md
git commit -m "docs: readme with dev test build and manual smoke test"
```

---

## Self-review notes (for the executing agent)

- Spec coverage: every spec component (KeyVault, BunkerCore, PolicyEngine, ClientRegistry, Storage, onboarding, dashboard, approval popup, settings, packaging `dir`-only, all 8 NIP-46 methods, fail-safe error handling, taskbar flash, reconnect/status via SimplePool polling, full test pyramid incl. BunkerSigner E2E) maps to a task above.
- Known deliberate simplifications vs. the spec: the URI `secret` is generated at startup and displayed in the URI (NIP-46's BunkerSigner sends it during `connect`); our `connect` handler approves on the approval popup rather than cryptographically validating the secret — the popup IS the consent moment per the spec's security notes. Relay reconnection relies on nostr-tools' built-in reconnect behavior plus a 2s status poller (surfaced on the dashboard) instead of hand-rolled backoff.
