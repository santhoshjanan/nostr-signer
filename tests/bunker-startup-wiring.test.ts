import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BunkerDeps } from "../src/main/bunker.js";

const startMock = vi.fn();
const mockBunkerCore = vi.fn().mockImplementation(() => ({
  start: startMock
}));

vi.mock("../src/main/bunker.js", () => ({
  BunkerCore: mockBunkerCore
}));

const { startBunker } = await import("../src/main/index.js");
const { Storage } = await import("../src/main/storage.js");
const { KeyVault } = await import("../src/main/keyvault.js");
const { ClientRegistry } = await import("../src/main/clients.js");
const { PolicyEngine } = await import("../src/main/policy.js");
const { ApprovalQueue } = await import("../src/main/approvals.js");
const { safeStorage } = await import("electron");

describe("startBunker askApproval wiring", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nostr-signer-bunker-startup-wiring-"));
    startMock.mockReset();
    mockBunkerCore.mockClear();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("wires askApproval to attach the expected pairing secret for connect approvals only", async () => {
    const storage = new Storage(dir);
    const vault = new KeyVault(safeStorage, storage);
    vault.setKey("a".repeat(64));
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
    // Resolve immediately so askApproval's promise settles without needing a
    // renderer response.
    vi.spyOn(approvals, "request").mockResolvedValue("allow-once");

    startMock.mockResolvedValueOnce(undefined);
    await startBunker(vault, storage, clients, policy, approvals);

    const deps = mockBunkerCore.mock.calls[0]?.[0] as BunkerDeps;
    expect(deps).toBeDefined();

    await deps.askApproval({
      id: "connect-1",
      clientPubkey: "b".repeat(64),
      clientName: "Client",
      actionType: "connect",
      description: "irrelevant"
    });
    const connectApproval = (approvals.request as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(typeof connectApproval.expectedSecret).toBe("string");
    expect(connectApproval.expectedSecret.length).toBeGreaterThan(0);

    await deps.askApproval({
      id: "sign-1",
      clientPubkey: "b".repeat(64),
      clientName: "Client",
      actionType: "sign_event:kind-1",
      description: "irrelevant"
    });
    const signApproval = (approvals.request as ReturnType<typeof vi.fn>).mock.calls[1]?.[0];
    expect(signApproval.expectedSecret).toBeUndefined();
  });
});
