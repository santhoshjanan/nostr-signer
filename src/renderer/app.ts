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

const api = typeof window !== "undefined" ? window.signerApi : (null as unknown as SignerApi);

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
const approvalQueue: PendingApproval[] = [];

// Malicious/oversized secrets must not be able to blow up the modal layout.
const MAX_PRESENTED_SECRET_LEN = 200;

// index.html does not (yet) ship an #approval-secret element. Create it
// lazily and attach it next to the action description so the pairing
// secret comparison works without requiring an index.html change.
function ensureSecretElement(): HTMLElement {
  const existing = document.getElementById("approval-secret");
  if (existing) {
    return existing as HTMLElement;
  }
  const node = document.createElement("p");
  node.id = "approval-secret";
  const anchor = el<HTMLElement>("approval-action");
  anchor.parentElement?.appendChild(node);
  return node;
}

function truncateSecret(value: string): string {
  return value.length > MAX_PRESENTED_SECRET_LEN
    ? `${value.slice(0, MAX_PRESENTED_SECRET_LEN)}…`
    : value;
}

// index.html does not ship an #approval-unpaired-warning element either;
// create it lazily next to the client line so it survives without an
// index.html change, matching the #approval-secret approach above.
function ensureUnpairedWarningElement(): HTMLElement {
  const existing = document.getElementById("approval-unpaired-warning");
  if (existing) {
    return existing as HTMLElement;
  }
  const node = document.createElement("p");
  node.id = "approval-unpaired-warning";
  const anchor = el<HTMLElement>("approval-client");
  anchor.parentElement?.appendChild(node);
  return node;
}

function renderUnpairedWarning(approval: PendingApproval): void {
  const node = ensureUnpairedWarningElement();
  // Only meaningful once a client is known one way or the other; a `connect`
  // approval is always from an as-yet-unpaired client, so showing this next
  // to it would just be noise -- it's covered by the approval itself.
  if (approval.actionType !== "connect" && approval.isPairedClient === false) {
    node.textContent = "⚠ Unpaired client — has not completed pairing";
    node.hidden = false;
  } else {
    node.textContent = "";
    node.hidden = true;
  }
}

// Only render the presented-vs-expected secret comparison for `connect`
// approvals where a secret is actually in play -- routine sign_event/nip04
// prompts have no secret and showing an empty comparison block there would
// just be clutter.
function renderPresentedSecret(approval: PendingApproval): void {
  const node = ensureSecretElement();
  const hasSecretContext =
    approval.actionType === "connect" &&
    (approval.presentedSecret !== undefined || approval.expectedSecret !== undefined);
  if (!hasSecretContext) {
    node.textContent = "";
    node.hidden = true;
    return;
  }

  const presentedText = approval.presentedSecret
    ? `Presented secret: ${truncateSecret(approval.presentedSecret)}`
    : "Presented secret: (none)";
  const expectedText = approval.expectedSecret
    ? `Expected secret: ${truncateSecret(approval.expectedSecret)}`
    : "Expected secret: (unknown)";
  let matchText: string;
  if (approval.presentedSecret !== undefined && approval.expectedSecret !== undefined) {
    matchText = approval.presentedSecret === approval.expectedSecret ? "✓ Secrets match" : "⚠ MISMATCH";
  } else {
    matchText = "Cannot compare: a secret is missing";
  }

  // A single textContent assignment (never innerHTML) keeps the untrusted
  // presentedSecret from ever being interpreted as markup.
  node.textContent = `${presentedText}\n${expectedText}\n${matchText}`;
  node.hidden = false;
}

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
  renderPresentedSecret(approval);
  renderUnpairedWarning(approval);
  show("approval-modal");
}

function showNextApproval(): void {
  if (currentApproval) {
    return;
  }
  const next = approvalQueue.shift();
  if (!next) {
    return;
  }
  showApproval(next);
}

/** Queue an incoming approval request; a second request while one is already
 * showing no longer overwrites it -- it waits its turn (FIFO). */
export function enqueueApproval(approval: PendingApproval): void {
  approvalQueue.push(approval);
  showNextApproval();
}

export function pendingApprovalCount(): number {
  return approvalQueue.length + (currentApproval ? 1 : 0);
}

export function peekCurrentApproval(): PendingApproval | null {
  return currentApproval;
}

export async function resolveApproval(choice: "allow-once" | "always-allow" | "deny"): Promise<void> {
  const approval = currentApproval;
  if (!approval) {
    return;
  }
  currentApproval = null;
  hide("approval-modal");
  await api.respondApproval(approval.id, choice);
  await renderClients();
  showNextApproval();
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
    enqueueApproval(approval);
  });
  api.onActivity((entry) => {
    appendActivity(entry);
  });
  api.onStatusChanged((statuses) => {
    void renderRelays(statuses);
  });
}

// A startup failure here (e.g. the preload script failed to expose
// `window.signerApi`, or any of the initial IPC calls in init() rejects)
// must never fail silently: an unhandled rejection leaves the page showing
// only the bare header, which is visually indistinguishable from the
// renderer-bundling regression this was written to catch. Surface it.
export function showFatalError(message: string): void {
  const node = el<HTMLElement>("app-error");
  node.textContent = `Failed to start: ${message}`;
  node.hidden = false;
}

if (typeof document !== "undefined") {
  void init().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    showFatalError(message);
  });
}
