import { describe, it, expect } from "vitest";
import {
  parseRequestEvent,
  buildResponse,
  buildErrorResponse,
  actionTypeOf,
  NIP46_REQUEST_KIND
} from "../src/main/nip46.js";

const SIGNER_PUBKEY = "c".repeat(64);
const CLIENT_PUBKEY = "d".repeat(64);

function makeEvent(overrides: Partial<{
  kind: number;
  pubkey: string;
  content: string;
  tags: string[][];
}> = {}) {
  return {
    kind: overrides.kind ?? NIP46_REQUEST_KIND,
    pubkey: overrides.pubkey ?? CLIENT_PUBKEY,
    content: overrides.content ?? JSON.stringify({ id: "1", method: "ping", params: [] }),
    tags: overrides.tags ?? [["p", SIGNER_PUBKEY]]
  };
}

describe("nip46 parseRequestEvent", () => {
  it("parses a well-formed request event", () => {
    const parsed = parseRequestEvent(makeEvent(), SIGNER_PUBKEY);
    expect(parsed).not.toBeNull();
    expect(parsed?.clientPubkey).toBe(CLIENT_PUBKEY);
    expect(parsed?.request).toEqual({ id: "1", method: "ping", params: [] });
  });

  it("rejects events of the wrong kind", () => {
    expect(parseRequestEvent(makeEvent({ kind: 1 }), SIGNER_PUBKEY)).toBeNull();
  });

  it("rejects events not tagged to the signer pubkey", () => {
    const event = makeEvent({ tags: [["p", "e".repeat(64)]] });
    expect(parseRequestEvent(event, SIGNER_PUBKEY)).toBeNull();
  });

  it("rejects events with no p tag", () => {
    expect(parseRequestEvent(makeEvent({ tags: [] }), SIGNER_PUBKEY)).toBeNull();
  });

  it("rejects non-JSON content", () => {
    expect(parseRequestEvent(makeEvent({ content: "not json {" }), SIGNER_PUBKEY)).toBeNull();
  });

  it("rejects JSON without a string id", () => {
    const content = JSON.stringify({ method: "ping", params: [] });
    expect(parseRequestEvent(makeEvent({ content }), SIGNER_PUBKEY)).toBeNull();
  });

  it("rejects JSON without a string method", () => {
    const content = JSON.stringify({ id: "1", params: [] });
    expect(parseRequestEvent(makeEvent({ content }), SIGNER_PUBKEY)).toBeNull();
  });

  it("rejects non-string params entries", () => {
    const content = JSON.stringify({ id: "1", method: "ping", params: [42] });
    expect(parseRequestEvent(makeEvent({ content }), SIGNER_PUBKEY)).toBeNull();
  });

  it("tolerates missing params by treating them as empty", () => {
    const content = JSON.stringify({ id: "1", method: "ping" });
    const parsed = parseRequestEvent(makeEvent({ content }), SIGNER_PUBKEY);
    expect(parsed?.request.params).toEqual([]);
  });

  it("rejects malformed client pubkey", () => {
    expect(
      parseRequestEvent(makeEvent({ pubkey: "not-a-pubkey" }), SIGNER_PUBKEY)
    ).toBeNull();
  });
});

describe("nip46 buildResponse / buildErrorResponse", () => {
  it("builds a success response", () => {
    expect(buildResponse("1", "ok")).toEqual({ id: "1", result: "ok" });
  });

  it("builds an error response for unknown method", () => {
    expect(buildErrorResponse("1", "unsupported method")).toEqual({
      id: "1",
      error: "unsupported method"
    });
  });

  it("builds an error response for denial", () => {
    expect(buildErrorResponse("1", "denied by user")).toEqual({
      id: "1",
      error: "denied by user"
    });
  });
});

describe("nip46 actionTypeOf", () => {
  it("returns null for connection-level methods", () => {
    expect(actionTypeOf("connect", [])).toBeNull();
    expect(actionTypeOf("get_public_key", [])).toBeNull();
    expect(actionTypeOf("ping", [])).toBeNull();
  });

  it("refines sign_event by event kind", () => {
    const unsigned = JSON.stringify({
      kind: 1,
      created_at: 1,
      tags: [],
      content: "hello",
      pubkey: CLIENT_PUBKEY
    });
    expect(actionTypeOf("sign_event", [unsigned])).toBe("sign_event:kind-1");
  });

  it("accepts sign_event events without a pubkey field (NIP-46 clients omit it)", () => {
    const unsigned = JSON.stringify({ kind: 1, created_at: 1, tags: [], content: "hi" });
    expect(actionTypeOf("sign_event", [unsigned])).toBe("sign_event:kind-1");
  });

  it("returns null for sign_event with unparseable event (fail safe)", () => {
    expect(actionTypeOf("sign_event", ["not json"])).toBeNull();
    expect(actionTypeOf("sign_event", [])).toBeNull();
    expect(actionTypeOf("sign_event", [JSON.stringify({ content: "x" })])).toBeNull();
  });

  it("maps encrypt/decrypt methods to their own action types", () => {
    expect(actionTypeOf("nip04_decrypt", ["pk", "ct"])).toBe("nip04_decrypt");
    expect(actionTypeOf("nip44_decrypt", ["pk", "ct"])).toBe("nip44_decrypt");
    expect(actionTypeOf("nip04_encrypt", ["pk", "pt"])).toBe("nip04_encrypt");
    expect(actionTypeOf("nip44_encrypt", ["pk", "pt"])).toBe("nip44_encrypt");
  });
});
