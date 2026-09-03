import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

export function isValidPubkeyHex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function validatePubkeyHex(value: unknown): string {
  if (!isValidPubkeyHex(value)) {
    throw new Error("invalid pubkey: expected a string of exactly 64 lowercase hex characters");
  }
  return value;
}

export const MAX_CLIENT_NAME_LENGTH = 128;

export function validateClientName(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("invalid client name: expected a string");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("invalid client name: must not be empty");
  }
  if (trimmed.length > MAX_CLIENT_NAME_LENGTH) {
    throw new Error(`invalid client name: must be at most ${MAX_CLIENT_NAME_LENGTH} characters`);
  }
  return trimmed;
}

export function validateApprovalId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("invalid approval id: expected a non-empty string");
  }
  return value;
}

const APPROVAL_CHOICES = new Set(["allow-once", "always-allow", "deny"]);

export function validateApprovalChoice(value: unknown): "allow-once" | "always-allow" | "deny" {
  if (typeof value !== "string" || !APPROVAL_CHOICES.has(value)) {
    throw new Error('invalid approval choice: expected "allow-once" | "always-allow" | "deny"');
  }
  return value as "allow-once" | "always-allow" | "deny";
}

export function validateNsec(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("invalid nsec: expected a string");
  }
  return value;
}

export const MAX_RELAY_COUNT = 20;

export function validateRelayUrlsInput(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((v): v is string => typeof v === "string")) {
    throw new Error("invalid relays: expected an array of strings");
  }
  if (value.length > MAX_RELAY_COUNT) {
    throw new Error(`invalid relays: too many relays (max ${MAX_RELAY_COUNT})`);
  }
  return value;
}

export function ensureNonEmptyRelays(normalized: string[]): string[] {
  if (normalized.length === 0) {
    throw new Error(
      "invalid relays: none of the provided urls were valid wss:// relay urls; relay list left unchanged"
    );
  }
  return normalized;
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
      // sandbox MUST stay false: the preload script is compiled as ESM, and
      // Electron only supports an ESM preload when the sandbox is disabled.
      // Do not "fix" this without switching the preload build to CJS first.
      sandbox: false
    }
  });

  const indexPath = join(__dirname, "../renderer/index.html");
  const indexUrl = pathToFileURL(indexPath).href;

  // Never let the renderer navigate this window (or a window it opens) away
  // from the local app bundle to a remote URL.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== indexUrl) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error("Renderer failed to load:", errorCode, errorDescription, validatedURL);
      dialog.showErrorBox(
        "Nostr Signer failed to load",
        `The app window failed to load its interface.\n\nCode: ${errorCode}\n${errorDescription}\nURL: ${validatedURL}`
      );
    }
  );

  // NOTE: kept as an inline `join(__dirname, ...)` expression (matching
  // `indexPath` above) because tests/build-artifacts.test.ts locates this
  // literal via regex to verify the build output resolves correctly.
  mainWindow.loadFile(join(__dirname, "../renderer/index.html")).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Failed to load renderer:", message);
    dialog.showErrorBox(
      "Nostr Signer failed to load",
      `The app window failed to load its interface.\n\n${message}`
    );
  });

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

export async function startBunker(
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
  const candidateTransport = new SimplePoolTransport(relayUrls);
  candidateTransport.onStatusChange((statuses) => {
    sendToRenderer(IPC.StatusChanged, statuses);
  });
  const candidateBunker = new BunkerCore({
    signerPubkey: vault.getPublicKeyHex(),
    getSecretKey: () => vault.getSecretKey(),
    transport: candidateTransport,
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
            : describeAction(approval.actionType),
        ...(approval.actionType === "connect" ? { expectedSecret: pairingSecret } : {})
      };
      flashWindow();
      return approvals.request(described);
    },
    log: (entry) => {
      storage.appendLog(entry);
      sendToRenderer(IPC.ActivityAppended, entry);
    }
  });

  // Only publish `bunker`/`transport` to module state once start() has
  // actually succeeded. If we assigned them beforehand and start() threw,
  // the `if (bunker !== null) return;` guard above would wedge the signer
  // for the rest of the session with no way to retry short of a restart.
  try {
    await candidateBunker.start();
  } catch (err) {
    candidateTransport.destroy();
    throw err;
  }
  bunker = candidateBunker;
  transport = candidateTransport;
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
    if (!vault.hasKey()) {
      throw new Error("no key configured yet; complete onboarding first");
    }
    const relayUrls = transport
      ? transport.getStatuses().map((s) => s.url)
      : normalizeRelayUrls(relays);
    return buildBunkerUri(vault.getPublicKeyHex(), relayUrls, pairingSecret);
  });

  ipcMain.handle(IPC.HasKey, () => vault.hasKey());

  ipcMain.handle(IPC.ImportKey, async (_event, rawNsec: unknown) => {
    const nsec = validateNsec(rawNsec);
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

  ipcMain.handle(IPC.RenameClient, (_event, rawPubkey: unknown, rawName: unknown) => {
    const pubkey = validatePubkeyHex(rawPubkey);
    const name = validateClientName(rawName);
    clients.rename(pubkey, name);
  });

  ipcMain.handle(IPC.RevokeClient, (_event, rawPubkey: unknown) => {
    const pubkey = validatePubkeyHex(rawPubkey);
    clients.remove(pubkey);
    policy.forgetRulesFor(pubkey);
  });

  ipcMain.handle(IPC.ResetClientApprovals, (_event, rawPubkey: unknown) => {
    const pubkey = validatePubkeyHex(rawPubkey);
    policy.forgetRulesFor(pubkey);
  });

  ipcMain.handle(IPC.RespondApproval, (_event, rawId: unknown, rawChoice: unknown) => {
    const id = validateApprovalId(rawId);
    const choice = validateApprovalChoice(rawChoice);
    approvals.respond(id, choice);
  });

  ipcMain.handle(IPC.GetActivityLog, () => storage.loadLog());

  ipcMain.handle(IPC.GetRelays, () => storage.loadRelays() ?? DEFAULT_RELAYS);

  ipcMain.handle(IPC.SetRelays, async (_event, rawUrls: unknown) => {
    const urls = validateRelayUrlsInput(rawUrls);
    const normalized = ensureNonEmptyRelays(normalizeRelayUrls(urls));
    storage.saveRelays(normalized);
    if (transport) {
      await transport.setRelays(normalized);
    }
  });
}

const isElectronRuntime = process.versions.electron !== undefined && app !== undefined;

if (isElectronRuntime) {
  app.whenReady().then(async () => {
    try {
      await boot();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Failed to start signer:", message);
      dialog.showErrorBox(
        "Nostr Signer failed to start",
        `The app could not initialize.\n\n${message}`
      );
      app.quit();
      return;
    }
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

  app.on("before-quit", () => {
    transport?.destroy();
  });
}

