import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
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
  app.whenReady().then(async () => {
    try {
      await boot();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Failed to start signer:", message);
      await dialog.showErrorBox(
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

