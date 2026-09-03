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

  // --- Step 1: correlation id must never be silently clobbered ---

  it("request() throws instead of silently clobbering a duplicate pending id", async () => {
    const queue = new ApprovalQueue();
    queue.onRequest(() => {});
    const first = queue.request(makeApproval("dup-id")).catch(() => {});
    expect(() => queue.request(makeApproval("dup-id"))).toThrow();
    // The first entry must still be resolvable -- it was not clobbered.
    queue.respond("dup-id", "allow-once");
    await first;
    expect(queue.pendingCount()).toBe(0);
  });

  it("two concurrent approvals with identical client-chosen ids both stay pending and resolve independently", async () => {
    const queue = new ApprovalQueue();
    queue.onRequest(() => {});
    // Simulate the bug scenario: two different clients whose NIP-46 request
    // ids collide (e.g. both "1"). The signer must generate distinct
    // correlation ids, so this queue-level id is already unique -- but we
    // verify that two genuinely distinct entries never collide and each
    // resolves with its own choice.
    const p1 = queue.request(makeApproval("correlation-a"));
    const p2 = queue.request(makeApproval("correlation-b"));
    expect(queue.pendingCount()).toBe(2);
    queue.respond("correlation-b", "always-allow");
    queue.respond("correlation-a", "deny");
    await expect(p1).resolves.toBe("deny");
    await expect(p2).resolves.toBe("always-allow");
  });

  // --- Step 2: respond() must fail closed against malformed choices ---

  it("respond() ignores undefined/null/bogus/object choices, leaving the entry pending", () => {
    const queue = new ApprovalQueue();
    queue.onRequest(() => {});
    const resolved: unknown[] = [];
    void queue.request(makeApproval("req-1")).then((c) => resolved.push(c));

    queue.respond("req-1", undefined as never);
    queue.respond("req-1", null as never);
    queue.respond("req-1", "bogus" as never);
    queue.respond("req-1", { allow: true } as never);

    expect(resolved).toEqual([]);
    expect(queue.pendingCount()).toBe(1);

    queue.respond("req-1", "deny");
    expect(queue.pendingCount()).toBe(0);
  });
});
