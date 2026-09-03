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
