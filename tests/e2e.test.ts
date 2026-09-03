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