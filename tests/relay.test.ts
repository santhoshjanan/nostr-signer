import { describe, it, expect, vi, beforeEach } from "vitest";

interface FakeSubscribeManyCall {
  relays: string[];
  filter: unknown;
  close: ReturnType<typeof vi.fn>;
  onevent: ((event: { pubkey: string; content: string }) => void) | undefined;
}

class FakeSimplePool {
  static instances: FakeSimplePool[] = [];
  calls: FakeSubscribeManyCall[] = [];
  closeCalls: string[][] = [];

  constructor() {
    FakeSimplePool.instances.push(this);
  }

  subscribeMany(
    relays: string[],
    filter: unknown,
    params: { onevent?: (event: { pubkey: string; content: string }) => void }
  ): { close(): void } {
    const close = vi.fn();
    this.calls.push({ relays, filter, close, onevent: params.onevent });
    return { close };
  }

  async ensureRelay(): Promise<{ connected: boolean }> {
    return { connected: true };
  }

  publish(): Promise<string>[] {
    return [Promise.resolve("ok")];
  }

  close(relays: string[]): void {
    this.closeCalls.push(relays);
  }
}

vi.mock("nostr-tools/pool", () => ({
  SimplePool: FakeSimplePool
}));

const { normalizeRelayUrls, DEFAULT_RELAYS, SimplePoolTransport } = await import(
  "../src/main/relay.js"
);

beforeEach(() => {
  FakeSimplePool.instances = [];
});

describe("relay url helpers", () => {
  it("exposes the default relays from the spec", () => {
    expect(DEFAULT_RELAYS).toEqual([
      "wss://relay.damus.io",
      "wss://nos.lol",
      "wss://relay.nostr.band"
    ]);
  });

  it("keeps valid wss urls and trims whitespace", () => {
    expect(normalizeRelayUrls([" wss://relay.damus.io "])).toEqual([
      "wss://relay.damus.io"
    ]);
  });

  it("drops entries that are not wss:// urls", () => {
    expect(normalizeRelayUrls(["http://x", "wss://ok.example", ""])).toEqual([
      "wss://ok.example"
    ]);
  });

  it("dedupes urls", () => {
    expect(
      normalizeRelayUrls(["wss://a.example", "wss://a.example", "wss://b.example"])
    ).toEqual(["wss://a.example", "wss://b.example"]);
  });
});

describe("SimplePoolTransport subscription lifecycle", () => {
  const sub = {
    filters: [{ kinds: [24133], "#p": ["signer-pubkey"] }],
    onEvent: vi.fn()
  };

  beforeEach(() => {
    sub.onEvent = vi.fn();
  });

  it("re-subscribes against the new relay set when setRelays() is called, closing the old subscription", async () => {
    const transport = new SimplePoolTransport(["wss://old.example"]);
    const pool = FakeSimplePool.instances[0]!;

    transport.subscribe(sub);
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0]!.relays).toEqual(["wss://old.example"]);
    const oldClose = pool.calls[0]!.close;

    await transport.setRelays(["wss://new.example"]);

    expect(oldClose).toHaveBeenCalledTimes(1);
    expect(pool.calls).toHaveLength(2);
    expect(pool.calls[1]!.relays).toEqual(["wss://new.example"]);

    // An event arriving from the new relay's subscription must reach onEvent.
    pool.calls[1]!.onevent!({ pubkey: "abc", content: "hello" });
    expect(sub.onEvent).toHaveBeenCalledWith({ pubkey: "abc", content: "hello" });
  });

  it("closes both the old and new relay urls on destroy() after a setRelays()", async () => {
    const transport = new SimplePoolTransport(["wss://old.example"]);
    const pool = FakeSimplePool.instances[0]!;

    transport.subscribe(sub);
    await transport.setRelays(["wss://new.example"]);

    transport.destroy();

    const closedUrls = pool.closeCalls.flat();
    expect(closedUrls).toContain("wss://old.example");
    expect(closedUrls).toContain("wss://new.example");
  });

  it("does not throw when setRelays() is called before any subscribe()", async () => {
    const transport = new SimplePoolTransport(["wss://old.example"]);
    await expect(transport.setRelays(["wss://new.example"])).resolves.not.toThrow();
    const pool = FakeSimplePool.instances[0]!;
    expect(pool.calls).toHaveLength(0);
  });

  it("throws a clear error when subscribe() is given an empty filters array", () => {
    const transport = new SimplePoolTransport(["wss://old.example"]);
    expect(() =>
      transport.subscribe({ filters: [], onEvent: vi.fn() })
    ).toThrow(/filter/i);
  });
});
