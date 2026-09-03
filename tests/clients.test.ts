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
