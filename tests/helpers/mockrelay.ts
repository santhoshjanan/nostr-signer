import type { SignedEvent, TransportSubscription } from "../../src/shared/types.js";

export interface MockEvent {
  kind: number;
  pubkey: string;
  content: string;
  tags: string[][];
  created_at: number;
  id?: string;
  sig?: string;
}

export interface MockFilter {
  kinds?: number[];
  authors?: string[];
  "#p"?: string[];
}

function matches(filter: MockFilter, event: MockEvent): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) {
    return false;
  }
  if (filter.authors && !filter.authors.includes(event.pubkey)) {
    return false;
  }
  const p = filter["#p"];
  if (p && !event.tags.some((t) => t[0] === "p" && p.includes(t[1]!))) {
    return false;
  }
  return true;
}

export class MockBus {
  private subs: Array<{ filter: MockFilter; onEvent(event: MockEvent): void }> = [];

  publish(event: MockEvent): void {
    for (const sub of [...this.subs]) {
      if (matches(sub.filter, event)) {
        const handler = sub.onEvent;
        queueMicrotask(() => handler(event));
      }
    }
  }

  subscribe(filter: MockFilter, onEvent: (event: MockEvent) => void): { close(): void } {
    const sub = { filter, onEvent };
    this.subs.push(sub);
    return {
      close: () => {
        this.subs = this.subs.filter((s) => s !== sub);
      }
    };
  }
}

export class FakePool {
  constructor(private bus: MockBus) {}

  subscribe(
    _relays: string[],
    filter: MockFilter,
    params: { onevent?: (event: MockEvent) => void }
  ): { close(): void } {
    return this.bus.subscribe(filter, (event) => params.onevent?.(event));
  }

  subscribeMany(
    relays: string[],
    filter: MockFilter,
    params: { onevent?: (event: MockEvent) => void }
  ): { close(): void } {
    return this.subscribe(relays, filter, params);
  }

  publish(_relays: string[], event: MockEvent): Promise<string>[] {
    this.bus.publish(event);
    return [Promise.resolve("ok")];
  }

  close(): void {}
}

export class MockBusTransport {
  constructor(private bus: MockBus) {}

  async connect(): Promise<void> {}

  subscribe(sub: TransportSubscription): { close(): void } {
    return this.bus.subscribe(sub.filters[0]!, (event) =>
      sub.onEvent({ pubkey: event.pubkey, content: event.content })
    );
  }

  async publish(event: SignedEvent): Promise<void> {
    this.bus.publish(event);
  }

  onStatusChange(): void {}

  async setRelays(): Promise<void> {}

  getStatuses(): Array<{ url: string; connected: boolean }> {
    return [{ url: "mock://relay", connected: true }];
  }
}