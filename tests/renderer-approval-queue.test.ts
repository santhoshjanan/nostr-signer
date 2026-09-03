import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  ClientRecord,
  LogEntry,
  PendingApproval,
  RelayStatus
} from "../src/shared/types.js";
import type { SignerApi } from "../src/shared/ipc.js";

// --- Minimal fake DOM -------------------------------------------------
// vitest's environment is "node" (no jsdom dependency in this project), so
// app.ts's DOM calls are exercised against a tiny hand-rolled stand-in that
// implements just the subset used: getElementById/createElement, hidden,
// textContent, parentElement/appendChild.

class FakeElement {
  id = "";
  hidden = false;
  textContent = "";
  value = "";
  parentElement: FakeElement | null = null;
  children: FakeElement[] = [];
  tagName: string;

  constructor(tagName = "DIV") {
    this.tagName = tagName.toUpperCase();
  }

  appendChild(node: FakeElement): FakeElement {
    node.parentElement = this;
    this.children.push(node);
    return node;
  }

  append(...nodes: FakeElement[]): void {
    for (const n of nodes) this.appendChild(n);
  }

  replaceChildren(): void {
    this.children = [];
  }
}

class FakeDocument {
  // Roots registered up front (mirrors index.html). getElementById walks the
  // live tree (not a flat map) so elements created and appended later by
  // app.ts -- e.g. the lazily-created #approval-secret node -- are found
  // too, just like a real DOM.
  private roots: FakeElement[] = [];

  register(id: string, tagName = "DIV"): FakeElement {
    const el = new FakeElement(tagName);
    el.id = id;
    this.roots.push(el);
    return el;
  }

  getElementById(id: string): FakeElement | null {
    const search = (node: FakeElement): FakeElement | null => {
      if (node.id === id) {
        return node;
      }
      for (const child of node.children) {
        const found = search(child);
        if (found) {
          return found;
        }
      }
      return null;
    };
    for (const root of this.roots) {
      const found = search(root);
      if (found) {
        return found;
      }
    }
    return null;
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }
}

function makeApproval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: "approval-1",
    clientPubkey: "a".repeat(64),
    clientName: "Alice",
    actionType: "sign_event:kind-1",
    description: "Publish a note (kind 1)",
    ...overrides
  };
}

function makeFakeApi(overrides: Partial<SignerApi> = {}): SignerApi {
  return {
    getStatus: async () => ({ hasKey: true, pubkey: "x", relays: [] }),
    getBunkerUri: async () => "bunker://x",
    hasKey: async () => true,
    importKey: async () => {},
    generateKey: async () => {},
    listClients: async () => [] as ClientRecord[],
    renameClient: async () => {},
    revokeClient: async () => {},
    resetClientApprovals: async () => {},
    respondApproval: vi.fn(async () => {}),
    getActivityLog: async () => [] as LogEntry[],
    getRelays: async () => [],
    setRelays: async () => {},
    factoryReset: vi.fn(async () => {}),
    onApprovalRequested: () => {},
    onActivity: () => {},
    onStatusChanged: () => {},
    ...overrides
  };
}

function buildFakeDocument(): FakeDocument {
  const doc = new FakeDocument();
  // Approval modal structure mirroring src/renderer/index.html.
  const modal = doc.register("approval-modal");
  const card = new FakeElement("DIV");
  modal.appendChild(card);
  const client = doc.register("approval-client", "P");
  const action = doc.register("approval-action", "P");
  const preview = doc.register("approval-preview", "PRE");
  card.append(client, action, preview);
  // Dashboard bits touched by resolveApproval() -> renderClients().
  doc.register("client-list", "UL");
  return doc;
}

describe("renderer approval queue (Step 3)", () => {
  beforeEach(() => {
    vi.resetModules();
    // globalThis.document/window persist across tests (they are real Node
    // globals, unaffected by vi.resetModules), so clear them explicitly or a
    // previous test's fake document would leak into this test's module
    // evaluation and trigger the auto-init guard against the wrong stub.
    (globalThis as unknown as { document: unknown }).document = undefined;
    (globalThis as unknown as { window: unknown }).window = undefined;
  });

  async function loadApp(api: SignerApi) {
    // `api` is captured from `window` at module-import time, but the bottom
    // `init()` auto-run guard checks `document` -- keep document unset until
    // after import so init() does not run against our minimal stub.
    (globalThis as unknown as { window: unknown }).window = { signerApi: api };
    const mod = await import("../src/renderer/app.js");
    const doc = buildFakeDocument();
    (globalThis as unknown as { document: unknown }).document = doc;
    return { mod, doc };
  }

  it("shows the first approval immediately and queues a second one instead of overwriting it", async () => {
    const api = makeFakeApi();
    const { mod, doc } = await loadApp(api);

    mod.enqueueApproval(makeApproval({ id: "first", description: "First action" }));
    expect(mod.peekCurrentApproval()?.id).toBe("first");
    expect(doc.getElementById("approval-action")!.textContent).toBe("First action");

    mod.enqueueApproval(makeApproval({ id: "second", description: "Second action" }));
    // Still showing the first -- the second must not have clobbered it.
    expect(mod.peekCurrentApproval()?.id).toBe("first");
    expect(doc.getElementById("approval-action")!.textContent).toBe("First action");
    expect(mod.pendingApprovalCount()).toBe(2);
  });

  it("shows the next queued approval after the current one is resolved", async () => {
    const api = makeFakeApi();
    const { mod, doc } = await loadApp(api);

    mod.enqueueApproval(makeApproval({ id: "first", description: "First action" }));
    mod.enqueueApproval(makeApproval({ id: "second", description: "Second action" }));

    await mod.resolveApproval("allow-once");

    expect(api.respondApproval).toHaveBeenCalledWith("first", "allow-once");
    expect(mod.peekCurrentApproval()?.id).toBe("second");
    expect(doc.getElementById("approval-action")!.textContent).toBe("Second action");
    expect(mod.pendingApprovalCount()).toBe(1);

    await mod.resolveApproval("deny");
    expect(api.respondApproval).toHaveBeenCalledWith("second", "deny");
    expect(mod.peekCurrentApproval()).toBeNull();
    expect(mod.pendingApprovalCount()).toBe(0);
  });

  it("renders the presented pairing secret next to the action so it can be compared", async () => {
    const api = makeFakeApi();
    const { mod, doc } = await loadApp(api);

    mod.enqueueApproval(
      makeApproval({ id: "with-secret", actionType: "connect", presentedSecret: "abc123" })
    );

    const secretNode = doc.getElementById("approval-secret");
    expect(secretNode).not.toBeNull();
    expect(secretNode!.hidden).toBe(false);
    expect(secretNode!.textContent).toContain("abc123");
  });

  it("truncates an oversized presented secret instead of rendering it whole", async () => {
    const api = makeFakeApi();
    const { mod, doc } = await loadApp(api);

    const huge = "x".repeat(5000);
    mod.enqueueApproval(
      makeApproval({ id: "huge-secret", actionType: "connect", presentedSecret: huge })
    );

    const secretNode = doc.getElementById("approval-secret")!;
    expect(secretNode.hidden).toBe(false);
    expect(secretNode.textContent!.length).toBeLessThan(huge.length);
  });

  it("hides the secret element when no secret was presented (non-connect approval)", async () => {
    const api = makeFakeApi();
    const { mod, doc } = await loadApp(api);

    mod.enqueueApproval(makeApproval({ id: "no-secret" }));

    const secretNode = doc.getElementById("approval-secret")!;
    expect(secretNode.hidden).toBe(true);
  });

  it("hides the secret element for a connect approval that presented no secret and has none expected", async () => {
    const api = makeFakeApi();
    const { mod, doc } = await loadApp(api);

    mod.enqueueApproval(makeApproval({ id: "connect-no-secret", actionType: "connect" }));

    const secretNode = doc.getElementById("approval-secret")!;
    expect(secretNode.hidden).toBe(true);
  });

  it("shows a match indicator when the presented and expected secrets are identical", async () => {
    const api = makeFakeApi();
    const { mod, doc } = await loadApp(api);

    mod.enqueueApproval(
      makeApproval({
        id: "match",
        actionType: "connect",
        presentedSecret: "shared-secret",
        expectedSecret: "shared-secret"
      })
    );

    const secretNode = doc.getElementById("approval-secret")!;
    expect(secretNode.hidden).toBe(false);
    expect(secretNode.textContent).toContain("shared-secret");
    expect(secretNode.textContent).toMatch(/match/i);
    expect(secretNode.textContent).not.toMatch(/mismatch/i);
  });

  it("shows a MISMATCH indicator when the presented and expected secrets differ", async () => {
    const api = makeFakeApi();
    const { mod, doc } = await loadApp(api);

    mod.enqueueApproval(
      makeApproval({
        id: "mismatch",
        actionType: "connect",
        presentedSecret: "attacker-value",
        expectedSecret: "real-secret"
      })
    );

    const secretNode = doc.getElementById("approval-secret")!;
    expect(secretNode.hidden).toBe(false);
    expect(secretNode.textContent).toMatch(/MISMATCH/);
  });

  it("does not show the secret comparison block for a routine sign_event approval, even with an expectedSecret set", async () => {
    const api = makeFakeApi();
    const { mod, doc } = await loadApp(api);

    mod.enqueueApproval(
      makeApproval({
        id: "sign-event-with-secret-field",
        actionType: "sign_event:kind-1",
        expectedSecret: "should-not-show"
      })
    );

    const secretNode = doc.getElementById("approval-secret")!;
    expect(secretNode.hidden).toBe(true);
  });

  it("warns when a sign_event request comes from an unpaired client", async () => {
    const api = makeFakeApi();
    const { mod, doc } = await loadApp(api);

    mod.enqueueApproval(
      makeApproval({ id: "unpaired", actionType: "sign_event:kind-1", isPairedClient: false })
    );

    const warningNode = doc.getElementById("approval-unpaired-warning");
    expect(warningNode).not.toBeNull();
    expect(warningNode!.hidden).toBe(false);
    expect(warningNode!.textContent).toMatch(/unpaired/i);
  });

  it("shows no unpaired warning for a paired client's sign_event request", async () => {
    const api = makeFakeApi();
    const { mod, doc } = await loadApp(api);

    mod.enqueueApproval(
      makeApproval({ id: "paired", actionType: "sign_event:kind-1", isPairedClient: true })
    );

    const warningNode = doc.getElementById("approval-unpaired-warning")!;
    expect(warningNode.hidden).toBe(true);
  });
});
