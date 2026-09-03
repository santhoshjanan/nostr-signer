import { describe, it, expect, vi } from "vitest";
import { ApprovalQueue } from "../src/main/approvals.js";
import type { PendingApproval } from "../src/shared/types.js";

function makeApproval(id: string): PendingApproval {
  return {
    id,
    clientPubkey: "a".repeat(64),
    clientName: "Alice",
    actionType: "sign_event:kind-1",
    description: "Publish a note (kind 1)",
    eventPreview: "hello nostr"
  };
}

describe("ApprovalQueue", () => {
  it("request emits the approval and resolves with the response", async () => {
    const queue = new ApprovalQueue();
    const onApproval = vi.fn();
    queue.onRequest(onApproval);

    const promise = queue.request(makeApproval("req-1"));
    expect(onApproval).toHaveBeenCalledTimes(1);
    expect(onApproval.mock.calls[0]?.[0]?.id).toBe("req-1");

    queue.respond("req-1", "always-allow");
    await expect(promise).resolves.toBe("always-allow");
  });

  it("tracks pending approvals", () => {
    const queue = new ApprovalQueue();
    queue.onRequest(() => {});
    void queue.request(makeApproval("req-1")).catch(() => {});
    void queue.request(makeApproval("req-2")).catch(() => {});
    expect(queue.pendingCount()).toBe(2);
    queue.respond("req-1", "deny");
    expect(queue.pendingCount()).toBe(1);
  });

  it("respond with unknown id is a no-op", () => {
    const queue = new ApprovalQueue();
    queue.onRequest(() => {});
    queue.respond("nonexistent", "deny");
    expect(queue.pendingCount()).toBe(0);
  });

  it("denyAll resolves all pending requests with deny", async () => {
    const queue = new ApprovalQueue();
    queue.onRequest(() => {});
    const p1 = queue.request(makeApproval("req-1"));
    const p2 = queue.request(makeApproval("req-2"));
    queue.denyAll();
    await expect(p1).resolves.toBe("deny");
    await expect(p2).resolves.toBe("deny");
    expect(queue.pendingCount()).toBe(0);
  });
});
