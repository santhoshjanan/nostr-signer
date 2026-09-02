import { describe, it, expect, beforeEach } from "vitest";
import { PolicyEngine } from "../src/main/policy.js";
import type { ApprovalRule } from "../src/shared/types.js";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);

function makeEngine(rules: ApprovalRule[] = [], clients: string[] = []) {
  return new PolicyEngine({
    loadRules: () => rules,
    saveRules: () => {},
    isClient: (pubkey: string) => clients.includes(pubkey)
  });
}

describe("PolicyEngine", () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = makeEngine();
  });

  it("asks for sign_event:kind-1 when no rule exists", () => {
    expect(engine.decide(ALICE, "sign_event:kind-1")).toBe("ask");
  });

  it("asks for nip04_decrypt when no rule exists", () => {
    expect(engine.decide(ALICE, "nip04_decrypt")).toBe("ask");
    expect(engine.decide(ALICE, "nip44_decrypt")).toBe("ask");
  });

  it("allows after addRule (always allow)", () => {
    engine.addRule(ALICE, "sign_event:kind-1");
    expect(engine.decide(ALICE, "sign_event:kind-1")).toBe("allow");
  });

  it("treats different event kinds as separate action types", () => {
    engine.addRule(ALICE, "sign_event:kind-1");
    expect(engine.decide(ALICE, "sign_event:kind-7")).toBe("ask");
    expect(engine.decide(ALICE, "sign_event:kind-30023")).toBe("ask");
  });

  it("scopes rules to a single client", () => {
    engine.addRule(ALICE, "sign_event:kind-1");
    expect(engine.decide(BOB, "sign_event:kind-1")).toBe("ask");
  });

  it("persists rules through the storage callbacks", () => {
    const saved: ApprovalRule[] = [];
    const persistent = new PolicyEngine({
      loadRules: () => saved.map((r) => ({ ...r })),
      saveRules: (rules) => {
        saved.length = 0;
        saved.push(...rules);
      },
      isClient: () => true
    });
    persistent.addRule(ALICE, "nip44_encrypt");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.actionType).toBe("nip44_encrypt");
    expect(saved[0]?.clientPubkey).toBe(ALICE);
  });

  it("forgetRulesFor removes every rule for a client", () => {
    engine.addRule(ALICE, "sign_event:kind-1");
    engine.addRule(ALICE, "nip04_decrypt");
    engine.addRule(BOB, "sign_event:kind-1");
    engine.forgetRulesFor(ALICE);
    expect(engine.decide(ALICE, "sign_event:kind-1")).toBe("ask");
    expect(engine.decide(ALICE, "nip04_decrypt")).toBe("ask");
    expect(engine.decide(BOB, "sign_event:kind-1")).toBe("allow");
  });

  it("denies every action for a revoked (unknown) client", () => {
    const strict = makeEngine([], []);
    strict.addRule(ALICE, "sign_event:kind-1");
    expect(strict.decide(ALICE, "sign_event:kind-1")).toBe("allow");
    const revoked = makeEngine(
      [{ clientPubkey: ALICE, actionType: "sign_event:kind-1", createdAt: 1 }],
      []
    );
    expect(revoked.decide(ALICE, "sign_event:kind-1")).toBe("deny");
  });

  it("listRules returns a defensive copy", () => {
    engine.addRule(ALICE, "sign_event:kind-1");
    const rules = engine.listRules();
    rules.length = 0;
    expect(engine.listRules()).toHaveLength(1);
  });

  it("connection-level approval: isClient gates non-policy methods", () => {
    const withClient = makeEngine([], [ALICE]);
    expect(withClient.isKnownClient(ALICE)).toBe(true);
    expect(withClient.isKnownClient(BOB)).toBe(false);
  });

  it("still denies after a mid-session revocation (snapshot invariant)", () => {
    let clientKnown = true;
    const engine = new PolicyEngine({
      loadRules: () => [
        { clientPubkey: ALICE, actionType: "sign_event:kind-1", createdAt: 1 }
      ],
      saveRules: () => {},
      isClient: () => clientKnown
    });
    expect(engine.decide(ALICE, "sign_event:kind-1")).toBe("allow");
    clientKnown = false;
    expect(engine.decide(ALICE, "sign_event:kind-1")).toBe("deny");
  });

  it("addRule for a revoked client does not resurrect access", () => {
    const revoked = makeEngine(
      [{ clientPubkey: ALICE, actionType: "sign_event:kind-1", createdAt: 1 }],
      []
    );
    expect(revoked.decide(ALICE, "sign_event:kind-1")).toBe("deny");
    revoked.addRule(ALICE, "sign_event:kind-1");
    expect(revoked.decide(ALICE, "sign_event:kind-1")).toBe("deny");
  });
});
