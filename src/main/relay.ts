import { SimplePool } from "nostr-tools/pool";
import type { RelayStatus, RelayTransport, SignedEvent, TransportSubscription } from "../shared/types.js";

export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band"
];

export function normalizeRelayUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const url = raw.trim();
    if (url.startsWith("wss://") && url.length > "wss://".length && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

export class SimplePoolTransport implements RelayTransport {
  private pool = new SimplePool();
  private relays: string[];
  private statuses = new Map<string, RelayStatus>();
  private statusCb: ((statuses: RelayStatus[]) => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(relays: string[]) {
    this.relays = normalizeRelayUrls(relays);
    for (const url of this.relays) {
      this.statuses.set(url, { url, connected: false });
    }
  }

  async connect(): Promise<void> {
    this.pollTimer = setInterval(() => this.refreshStatuses(), 2000);
    await this.refreshStatuses();
  }

  private async refreshStatuses(): Promise<void> {
    for (const url of this.relays) {
      let connected = false;
      try {
        const relay = await this.pool.ensureRelay(url, { connectionTimeout: 3000 });
        connected = relay.connected;
      } catch {
        connected = false;
      }
      const prev = this.statuses.get(url);
      if (!prev || prev.connected !== connected) {
        this.statuses.set(url, { url, connected });
        this.emitStatuses();
      }
    }
  }

  private emitStatuses(): void {
    this.statusCb?.(this.getStatuses());
  }

  subscribe(sub: TransportSubscription): { close(): void } {
    const closer = this.pool.subscribeMany(this.relays, sub.filters[0]!, {
      onevent(event) {
        sub.onEvent({ pubkey: event.pubkey, content: event.content });
      }
    });
    return { close: () => closer.close() };
  }

  async publish(event: SignedEvent): Promise<void> {
    await Promise.any(this.pool.publish(this.relays, event));
  }

  onStatusChange(cb: (statuses: RelayStatus[]) => void): void {
    this.statusCb = cb;
  }

  async setRelays(urls: string[]): Promise<void> {
    this.relays = normalizeRelayUrls(urls);
    this.statuses.clear();
    for (const url of this.relays) {
      this.statuses.set(url, { url, connected: false });
    }
    this.emitStatuses();
    await this.refreshStatuses();
  }

  getStatuses(): RelayStatus[] {
    return [...this.statuses.values()];
  }

  destroy(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.pool.close(this.relays);
  }
}
