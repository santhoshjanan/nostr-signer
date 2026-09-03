import type { ActionType, ApprovalRule, PolicyDecision } from "../shared/types.js";

export interface PolicyEngineDeps {
  loadRules(): ApprovalRule[];
  saveRules(rules: ApprovalRule[]): void;
  isClient(pubkey: string): boolean;
}

export class PolicyEngine {
  private rules: ApprovalRule[];
  // Every pubkey that has ever had a rule persisted for it: seeded from
  // loadRules() at construction time and grown by addRule() as new rules are
  // added during the session. Deliberately NOT shrunk by forgetRulesFor() --
  // that's what makes revocation a hard deny (see decide()) rather than
  // merely falling back to "ask": a client who once had standing access and
  // is now unknown must never be treated the same as a stranger who has
  // never been granted anything.
  private readonly persistedPubkeys: Set<string>;

  constructor(private deps: PolicyEngineDeps) {
    this.rules = deps.loadRules();
    this.persistedPubkeys = new Set(this.rules.map((r) => r.clientPubkey));
  }

  decide(clientPubkey: string, actionType: ActionType): PolicyDecision {
    if (!this.deps.isClient(clientPubkey) && this.persistedPubkeys.has(clientPubkey)) {
      return "deny";
    }
    const found = this.rules.some(
      (r) => r.clientPubkey === clientPubkey && r.actionType === actionType
    );
    return found ? "allow" : "ask";
  }

  addRule(clientPubkey: string, actionType: ActionType): void {
    const exists = this.rules.some(
      (r) => r.clientPubkey === clientPubkey && r.actionType === actionType
    );
    if (!exists) {
      this.rules.push({ clientPubkey, actionType, createdAt: Date.now() });
      this.deps.saveRules(this.rules);
    }
    // Only track it as "has had standing access" if it was a genuinely
    // known/paired client at the moment the rule was granted -- a client
    // that connects mid-session and is granted an always-allow rule was
    // never in the constructor's snapshot, so without this a later
    // revocation of it would only fall back to "ask" instead of the hard
    // "deny" decide() is supposed to give it. Gating on isClient() here
    // keeps this from firing for synthetic/administrative addRule() calls
    // made against a pubkey that was never actually a live client.
    if (this.deps.isClient(clientPubkey)) {
      this.persistedPubkeys.add(clientPubkey);
    }
  }

  forgetRulesFor(clientPubkey: string): void {
    this.rules = this.rules.filter((r) => r.clientPubkey !== clientPubkey);
    this.deps.saveRules(this.rules);
  }

  listRules(): ApprovalRule[] {
    return this.rules.map((r) => ({ ...r }));
  }

  isKnownClient(pubkey: string): boolean {
    return this.deps.isClient(pubkey);
  }

  clear(): void {
    this.rules = [];
    this.persistedPubkeys.clear();
    this.deps.saveRules(this.rules);
  }
}
