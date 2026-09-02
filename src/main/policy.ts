import type { ActionType, ApprovalRule, PolicyDecision } from "../shared/types.js";

export interface PolicyEngineDeps {
  loadRules(): ApprovalRule[];
  saveRules(rules: ApprovalRule[]): void;
  isClient(pubkey: string): boolean;
}

export class PolicyEngine {
  private rules: ApprovalRule[];
  // Snapshot of pubkeys with rules at load time; intentionally NOT mutated by
  // addRule/forgetRulesFor so a mid-session revocation still denies.
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
}
