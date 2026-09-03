import { describe, it, expect, beforeEach } from "vitest";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools/pure";
import * as nip04 from "nostr-tools/nip04";
import * as nip44 from "nostr-tools/nip44";
import { BunkerCore, type BunkerDeps } from "../src/main/bunker.js";
import type {
  ApprovalChoice,
  LogEntry,
  PendingApproval,
  RelayStatus,
  RelayTransport,
  SignedEvent,
  TransportSubscription
} from "../src/shared/types.js";

export class FakeRelayTransport implements RelayTransport {
  published: SignedEvent[] = [];
  private sub: TransportSubscription | null = null;
  private statuses: RelayStatus[];

  constructor(urls: string[] = ["wss://relay.damus.io"]) {
    this.statuses = urls.map((url) => ({ url, connected: true }));
  }

  async connect(): Promise<void> {}
  subscribe(sub: TransportSubscription): { close(): void } {
    this.sub = sub;
    return { close: () => {} };
  }
  async publish(event: SignedEvent): Promise<void> {
    this.published.push(event);
  }
  onStatusChange(): void {}
  async setRelays(urls: string[]): Promise<void> {
    this.statuses = urls.map((url) => ({ url, connected: true }));
  }
  getStatuses(): RelayStatus[] {
    return this.statuses;
  }
  inject(event: { pubkey: string; content: string }): void {
    this.sub?.onEvent(event);
  }
}

const signerSk = generateSecretKey();
const signerPk = getPublicKey(signerSk);
const clientSk = generateSecretKey();
const clientPk = getPublicKey(clientSk);

function nip44ConversationKey(secretKey: Uint8Array, pubkey: string): Uint8Array {
  const key = nip44.v2.utils.getConversationKey(secretKey, pubkey);
  return key instanceof Uint8Array ? key : new Uint8Array(key);
}

export function encryptTo(signerSecretKey: Uint8Array, payload: object, recipientPk: string): string {
  return nip44.v2.encrypt(
    JSON.stringify(payload),
    nip44ConversationKey(signerSecretKey, recipientPk)
  );
}

export function makeDeps(overrides: Partial<BunkerDeps> = {}) {
  const log: LogEntry[] = [];
  const transport = new FakeRelayTransport();
  const deps: BunkerDeps = {
    signerPubkey: signerPk,
    getSecretKey: () => signerSk,
    transport,
    isClient: () => true,
    addClient: () => {},
    clientName: (pk: string) => pk.slice(0, 12),
    policyDecide: () => "allow",
    addRule: () => {},
    askApproval: async () => "allow-once",
    log: (entry) => log.push(entry),
    ...overrides
  };
  return { deps, transport, log };
}

async function sendRequest(
  transport: FakeRelayTransport,
  payload: { id: string; method: string; params: string[] },
  scheme: "nip44" | "nip04" = "nip44"
): Promise<void> {
  const content =
    scheme === "nip44"
      ? nip44.v2.encrypt(
          JSON.stringify(payload),
          nip44ConversationKey(clientSk, signerPk)
        )
      : await nip04.encrypt(clientSk, signerPk, JSON.stringify(payload));
  transport.inject({ pubkey: clientPk, content });
  await new Promise((r) => setTimeout(r, 0));
}

async function readResponse(
  transport: FakeRelayTransport,
  scheme: "nip44" | "nip04" = "nip44"
): Promise<{ id: string; result?: string; error?: string }> {
  const event = transport.published[transport.published.length - 1];
  if (!event) {
    throw new Error("no response published");
  }
  const plaintext =
    scheme === "nip44"
      ? nip44.v2.decrypt(event.content, nip44ConversationKey(clientSk, signerPk))
      : await nip04.decrypt(clientSk, signerPk, event.content);
  return JSON.parse(plaintext);
}

describe("BunkerCore", () => {
  it("answers ping with pong over nip44", async () => {
    const { deps, transport } = makeDeps();
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "1", method: "ping", params: [] });
    const response = await readResponse(transport);
    expect(response).toEqual({ id: "1", result: "pong" });
  });

  it("answers ping over nip04-encrypted requests", async () => {
    const { deps, transport } = makeDeps();
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "2", method: "ping", params: [] }, "nip04");
    const response = await readResponse(transport, "nip04");
    expect(response).toEqual({ id: "2", result: "pong" });
  });

  it("answers get_public_key with the signer pubkey", async () => {
    const { deps, transport } = makeDeps();
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "3", method: "get_public_key", params: [] });
    const response = await readResponse(transport);
    expect(response.result).toBe(signerPk);
  });

  it("connect from known client acks without prompting", async () => {
    const { deps, transport } = makeDeps({ isClient: () => true });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "4", method: "connect", params: [clientPk, "secret"] });
    const response = await readResponse(transport);
    expect(response).toEqual({ id: "4", result: "ack" });
  });

  it("connect from unknown client asks and saves on approval", async () => {
    const added: string[] = [];
    const { deps, transport } = makeDeps({
      isClient: () => false,
      addClient: (pk) => added.push(pk),
      askApproval: async () => "always-allow"
    });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "5", method: "connect", params: [clientPk] });
    const response = await readResponse(transport);
    expect(response.result).toBe("ack");
    expect(added).toEqual([clientPk]);
  });

  it("connect from unknown client denied returns protocol error", async () => {
    const { deps, transport } = makeDeps({
      isClient: () => false,
      askApproval: async () => "deny"
    });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "6", method: "connect", params: [clientPk] });
    const response = await readResponse(transport);
    expect(response.error).toBe("denied by user");
  });

  it("sign_event signs and returns a valid signed event when allowed", async () => {
    const { deps, transport } = makeDeps({ policyDecide: () => "allow" });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    const unsigned = {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: "hello from test",
      pubkey: clientPk
    };
    await sendRequest(transport, {
      id: "7",
      method: "sign_event",
      params: [JSON.stringify(unsigned)]
    });
    const response = await readResponse(transport);
    const signed = JSON.parse(response.result!);
    expect(signed.content).toBe("hello from test");
    expect(signed.pubkey).toBe(signerPk);
    expect(typeof signed.id).toBe("string");
    expect(typeof signed.sig).toBe("string");
    expect(signed.sig).toHaveLength(128);
  });

  it("sign_event prompts once and always-allow persists a rule", async () => {
    const decisions: string[] = [];
    const rules: string[] = [];
    const unsigned = JSON.stringify({
      kind: 1,
      created_at: 1,
      tags: [],
      content: "note",
      pubkey: clientPk
    });
    const { deps, transport } = makeDeps({
      policyDecide: () => "ask",
      askApproval: async (approval) => {
        decisions.push(approval.actionType);
        return "always-allow";
      },
      addRule: (pk, actionType) => rules.push(`${pk}:${actionType}`)
    });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "8", method: "sign_event", params: [unsigned] });
    const response = await readResponse(transport);
    expect(JSON.parse(response.result!).content).toBe("note");
    expect(decisions).toEqual(["sign_event:kind-1"]);
    expect(rules).toEqual([`${clientPk}:sign_event:kind-1`]);
  });

  it("sign_event denied by policy returns error and signs nothing", async () => {
    const { deps, transport } = makeDeps({ policyDecide: () => "deny" });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    const unsigned = JSON.stringify({
      kind: 1,
      created_at: 1,
      tags: [],
      content: "x",
      pubkey: clientPk
    });
    await sendRequest(transport, { id: "9", method: "sign_event", params: [unsigned] });
    const response = await readResponse(transport);
    expect(response.error).toBe("denied by user");
  });

  it("unknown method returns unsupported method error", async () => {
    const { deps, transport } = makeDeps();
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "10", method: "obliterate", params: [] });
    const response = await readResponse(transport);
    expect(response.error).toBe("unsupported method");
  });

  it("malformed sign_event payload returns error without crashing", async () => {
    const { deps, transport } = makeDeps({ policyDecide: () => "allow" });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "11", method: "sign_event", params: ["{bad json"] });
    const response = await readResponse(transport);
    expect(typeof response.error).toBe("string");
  });

  it("undecryptable content is dropped and logged, nothing published", async () => {
    const { deps, transport, log } = makeDeps();
    const bunker = new BunkerCore(deps);
    await bunker.start();
    transport.inject({ pubkey: clientPk, content: "this is not encrypted at all" });
    await new Promise((r) => setTimeout(r, 0));
    expect(transport.published).toHaveLength(0);
    expect(log.some((e) => e.type === "request-dropped")).toBe(true);
  });

  it("nip04_decrypt round-trips client ciphertext", async () => {
    const { deps, transport } = makeDeps({ policyDecide: () => "allow" });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    const ciphertext = await nip04.encrypt(clientSk, signerPk, "secret dm");
    await sendRequest(transport, {
      id: "12",
      method: "nip04_decrypt",
      params: [clientPk, ciphertext]
    });
    const response = await readResponse(transport);
    expect(response.result).toBe("secret dm");
  });

  it("nip44_encrypt then nip44_decrypt round-trip", async () => {
    const { deps, transport } = makeDeps({ policyDecide: () => "allow" });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, {
      id: "13",
      method: "nip44_encrypt",
      params: [clientPk, "hello nip44"]
    });
    const enc = await readResponse(transport);
    expect(typeof enc.result).toBe("string");
    await sendRequest(transport, {
      id: "14",
      method: "nip44_decrypt",
      params: [clientPk, enc.result!]
    });
    const dec = await readResponse(transport);
    expect(dec.result).toBe("hello nip44");
  });

  it("every signed event appends an event-signed log entry", async () => {
    const { deps, transport, log } = makeDeps({ policyDecide: () => "allow" });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    const unsigned = JSON.stringify({
      kind: 7,
      created_at: 1,
      tags: [["e", "f".repeat(64)]],
      content: "+",
      pubkey: clientPk
    });
    await sendRequest(transport, { id: "15", method: "sign_event", params: [unsigned] });
    await readResponse(transport);
    expect(log.some((e) => e.type === "event-signed")).toBe(true);
  });

  it("response events are kind 24133 signed by the signer", async () => {
    const { deps, transport } = makeDeps();
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "16", method: "ping", params: [] });
    const event = transport.published[0]!;
    expect(event.kind).toBe(24133);
    expect(event.pubkey).toBe(signerPk);
    expect(event.tags.some((t) => t[0] === "p" && t[1] === clientPk)).toBe(true);
  });

  it("survives getSecretKey throwing without an unhandled rejection", async () => {
    const { deps, transport, log } = makeDeps({
      getSecretKey: () => {
        throw new Error("key not loaded");
      }
    });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    // Inject an event; handleEvent is fire-and-forget. If getSecretKey throws
    // outside a try, this would produce an unhandled rejection. Flush microtasks.
    transport.inject({ pubkey: clientPk, content: "anything" });
    await new Promise((r) => setTimeout(r, 10));
    // Nothing published, error logged, no crash.
    expect(transport.published).toHaveLength(0);
    expect(log.some((e) => e.type === "request-dropped")).toBe(true);
  });

  it("finalizes events deterministically through finalizeEvent sanity check", () => {
    const sk = generateSecretKey();
    const event = finalizeEvent(
      { kind: 1, created_at: 1, tags: [], content: "x" },
      sk
    );
    expect(event.pubkey).toBe(getPublicKey(sk));
  });

  // --- Step 1: approval correlation must not use the client-controlled NIP-46 request id ---

  it("two concurrent connect requests with colliding client-chosen ids never cross-resolve or hang", async () => {
    const clientSk2 = generateSecretKey();
    const clientPk2 = getPublicKey(clientSk2);

    const resolvers = new Map<string, (choice: ApprovalChoice) => void>();
    const seenApprovalIds: string[] = [];
    const addedClients: string[] = [];

    const { deps, transport } = makeDeps({
      isClient: () => false,
      addClient: (pk) => addedClients.push(pk),
      askApproval: (approval) => {
        seenApprovalIds.push(approval.id);
        return new Promise<ApprovalChoice>((resolve) => {
          resolvers.set(approval.clientPubkey, resolve);
        });
      }
    });
    const bunker = new BunkerCore(deps);
    await bunker.start();

    function encryptFrom(sk: Uint8Array, pk: string, payload: object): string {
      return nip44.v2.encrypt(JSON.stringify(payload), nip44ConversationKey(sk, pk));
    }

    // Two different clients, same NIP-46 request id "1" -- this is the exact
    // collision scenario that used to overwrite the first pending entry.
    transport.inject({
      pubkey: clientPk,
      content: encryptFrom(clientSk, signerPk, {
        id: "1",
        method: "connect",
        params: [clientPk, "secret-a"]
      })
    });
    transport.inject({
      pubkey: clientPk2,
      content: encryptFrom(clientSk2, signerPk, {
        id: "1",
        method: "connect",
        params: [clientPk2, "secret-b"]
      })
    });
    await new Promise((r) => setTimeout(r, 0));

    // Both requests must still be pending -- neither was clobbered, and each
    // got a distinct signer-generated correlation id despite sharing the
    // same client-chosen NIP-46 request id.
    expect(resolvers.size).toBe(2);
    expect(seenApprovalIds).toHaveLength(2);
    expect(seenApprovalIds[0]).not.toBe(seenApprovalIds[1]);

    // Resolve out of order to prove there is no cross-resolution.
    resolvers.get(clientPk2)!("always-allow");
    resolvers.get(clientPk)!("deny");
    await new Promise((r) => setTimeout(r, 0));

    expect(addedClients).toEqual([clientPk2]);

    function decryptResponseFor(
      pk: string,
      sk: Uint8Array
    ): { id: string; result?: string; error?: string } {
      const event = transport.published.find((e) => e.tags.some((t) => t[0] === "p" && t[1] === pk));
      if (!event) {
        throw new Error(`no response published for ${pk}`);
      }
      const plaintext = nip44.v2.decrypt(event.content, nip44ConversationKey(sk, signerPk));
      return JSON.parse(plaintext);
    }

    // Each NIP-46 response must carry back its own original request id, "1".
    const respA = decryptResponseFor(clientPk, clientSk);
    const respB = decryptResponseFor(clientPk2, clientSk2);
    expect(respA).toEqual({ id: "1", error: "denied by user" });
    expect(respB).toEqual({ id: "1", result: "ack" });
  });

  // --- Step 2: approval responses must fail closed ---

  const malformedChoices: unknown[] = [undefined, null, "bogus", { allow: true }];

  for (const bad of malformedChoices) {
    it(`sign_event denies and signs nothing when askApproval resolves with ${JSON.stringify(bad)}`, async () => {
      const { deps, transport } = makeDeps({
        policyDecide: () => "ask",
        askApproval: async () => bad as unknown as ApprovalChoice
      });
      const bunker = new BunkerCore(deps);
      await bunker.start();
      const unsigned = JSON.stringify({
        kind: 1,
        created_at: 1,
        tags: [],
        content: "should not be signed",
        pubkey: clientPk
      });
      await sendRequest(transport, { id: "20", method: "sign_event", params: [unsigned] });
      const response = await readResponse(transport);
      expect(response.error).toBe("denied by user");
      expect(response.result).toBeUndefined();
      // The only thing published is the denial response -- nothing was signed.
      expect(transport.published).toHaveLength(1);
    });

    it(`connect denies and does not add the client when askApproval resolves with ${JSON.stringify(bad)}`, async () => {
      const added: string[] = [];
      const { deps, transport } = makeDeps({
        isClient: () => false,
        addClient: (pk) => added.push(pk),
        askApproval: async () => bad as unknown as ApprovalChoice
      });
      const bunker = new BunkerCore(deps);
      await bunker.start();
      await sendRequest(transport, { id: "21", method: "connect", params: [clientPk, "s"] });
      const response = await readResponse(transport);
      expect(response.error).toBe("denied by user");
      expect(added).toEqual([]);
    });
  }

  // --- Step 3: the client-presented pairing secret must be surfaced to the human ---

  it("passes the NIP-46 connect secret through to askApproval as presentedSecret", async () => {
    let captured: PendingApproval | undefined;
    const { deps, transport } = makeDeps({
      isClient: () => false,
      askApproval: async (approval) => {
        captured = approval;
        return "allow-once";
      }
    });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "30", method: "connect", params: [clientPk, "sekrit-value"] });
    await readResponse(transport);
    expect(captured?.presentedSecret).toBe("sekrit-value");
  });

  it("leaves presentedSecret undefined when the connect request omits it", async () => {
    let captured: PendingApproval | undefined;
    const { deps, transport } = makeDeps({
      isClient: () => false,
      askApproval: async (approval) => {
        captured = approval;
        return "allow-once";
      }
    });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "31", method: "connect", params: [clientPk] });
    await readResponse(transport);
    expect(captured?.presentedSecret).toBeUndefined();
  });

  // --- Step 3b: distinguish paired vs unpaired requesters in approval prompts ---

  it("flags isPairedClient: true when a known/paired client's sign_event needs a prompt", async () => {
    let captured: PendingApproval | undefined;
    const unsigned = JSON.stringify({
      kind: 1,
      created_at: 1,
      tags: [],
      content: "note",
      pubkey: clientPk
    });
    const { deps, transport } = makeDeps({
      isClient: () => true,
      policyDecide: () => "ask",
      askApproval: async (approval) => {
        captured = approval;
        return "allow-once";
      }
    });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "32", method: "sign_event", params: [unsigned] });
    await readResponse(transport);
    expect(captured?.isPairedClient).toBe(true);
  });

  it("flags isPairedClient: false when an unpaired stranger's sign_event needs a prompt", async () => {
    let captured: PendingApproval | undefined;
    const unsigned = JSON.stringify({
      kind: 1,
      created_at: 1,
      tags: [],
      content: "note",
      pubkey: clientPk
    });
    const { deps, transport } = makeDeps({
      isClient: () => false,
      policyDecide: () => "ask",
      askApproval: async (approval) => {
        captured = approval;
        return "allow-once";
      }
    });
    const bunker = new BunkerCore(deps);
    await bunker.start();
    await sendRequest(transport, { id: "33", method: "sign_event", params: [unsigned] });
    await readResponse(transport);
    expect(captured?.isPairedClient).toBe(false);
  });
});
