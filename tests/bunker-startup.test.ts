import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const startMock = vi.fn();

vi.mock("../src/main/bunker.js", () => ({
  BunkerCore: vi.fn().mockImplementation(() => ({
    start: startMock
  }))
}));

const { startBunker } = await import("../src/main/index.js");
const { Storage } = await import("../src/main/storage.js");
const { KeyVault } = await import("../src/main/keyvault.js");
const { ClientRegistry } = await import("../src/main/clients.js");
const { PolicyEngine } = await import("../src/main/policy.js");
const { ApprovalQueue } = await import("../src/main/approvals.js");
const { safeStorage } = await import("electron");

describe("startBunker retry after a failed start()", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nostr-signer-bunker-startup-"));
    startMock.mockReset();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("leaves the signer retryable after start() rejects, and a later call can succeed", async () => {
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

    startMock.mockRejectedValueOnce(new Error("boom"));
    await expect(startBunker(vault, storage, clients, policy, approvals)).rejects.toThrow("boom");

    // A second call must not silently no-op (which is what happens if the
    // failed attempt left module state permanently marked as "started").
    startMock.mockResolvedValueOnce(undefined);
    await expect(
      startBunker(vault, storage, clients, policy, approvals)
    ).resolves.toBeUndefined();

    expect(startMock).toHaveBeenCalledTimes(2);
  });
});
