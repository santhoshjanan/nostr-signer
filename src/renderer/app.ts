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
  api.onStatusChanged((statuses) => {
    void renderRelays(statuses);
  });
}

if (typeof document !== "undefined") {
  void init();
}
