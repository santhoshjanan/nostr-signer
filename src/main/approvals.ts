import type { ApprovalChoice, PendingApproval } from "../shared/types.js";

interface PendingEntry {
  approval: PendingApproval;
  resolve(choice: ApprovalChoice): void;
}

export class ApprovalQueue {
  private pending = new Map<string, PendingEntry>();
  private listener: ((approval: PendingApproval) => void) | null = null;

  onRequest(cb: (approval: PendingApproval) => void): void {
    this.listener = cb;
  }

  request(approval: PendingApproval): Promise<ApprovalChoice> {
    return new Promise<ApprovalChoice>((resolve) => {
      this.pending.set(approval.id, { approval, resolve });
      this.listener?.(approval);
    });
  }

  respond(id: string, choice: ApprovalChoice): void {
    const entry = this.pending.get(id);
    if (!entry) {
      return;
    }
    this.pending.delete(id);
    entry.resolve(choice);
  }

  denyAll(): void {
    for (const entry of this.pending.values()) {
      entry.resolve("deny");
    }
    this.pending.clear();
  }

  pendingCount(): number {
    return this.pending.size;
  }
}
