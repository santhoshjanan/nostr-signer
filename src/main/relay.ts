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
  private everRelays = new Set<string>();
  private statuses = new Map<string, RelayStatus>();
  private statusCb: ((statuses: RelayStatus[]) => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private refreshing = false;
  private activeSub: { spec: TransportSubscription; closer: { close(): void }; id: number } | null =
    null;
  private subCounter = 0;

  constructor(relays: string[]) {
    this.relays = normalizeRelayUrls(relays);
    for (const url of this.relays) {
      this.statuses.set(url, { url, connected: false });
      this.everRelays.add(url);
    }
  }

  async connect(): Promise<void> {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollTimer = setInterval(() => this.refreshStatuses(), 2000);
    await this.refreshStatuses();
  }

  private async refreshStatuses(): Promise<void> {
    if (this.refreshing) {
      return;
    }
    this.refreshing = true;
    try {
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
    } finally {
      this.refreshing = false;
    }
  }

  private emitStatuses(): void {
    this.statusCb?.(this.getStatuses());
  }

  subscribe(sub: TransportSubscription): { close(): void } {
    const filter = sub.filters[0];
    if (!filter) {
      throw new Error("subscribe() requires at least one filter, but received an empty filters array");
    }

    // Replace semantics: a new subscribe() call supersedes any previous one,
    // so BunkerCore's single startup subscription is always the source of truth.
    if (this.activeSub) {
      this.activeSub.closer.close();
      this.activeSub = null;
    }

    const id = ++this.subCounter;
    const closer = this.openSubscription(sub, filter);
    this.activeSub = { spec: sub, closer, id };

    return {
      close: () => {
        // Only close/clear if this subscription is still the active one -
        // it may already have been replaced by a later subscribe() or
        // re-pointed at new relays by setRelays().
        if (this.activeSub?.id === id) {
          this.activeSub.closer.close();
          this.activeSub = null;
        }
      }
    };
  }

  private openSubscription(
    sub: TransportSubscription,
    filter: TransportSubscription["filters"][number]
  ): { close(): void } {
    for (const url of this.relays) {
      this.everRelays.add(url);
    }
    return this.pool.subscribeMany(this.relays, filter, {
      onevent(event) {
        sub.onEvent({ pubkey: event.pubkey, content: event.content });
      }
    });
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
      this.everRelays.add(url);
    }
    this.emitStatuses();

    // Re-point any active subscription at the new relay set so incoming
    // NIP-46 requests keep arriving after relays are changed at runtime.
    if (this.activeSub) {
      const { spec, id } = this.activeSub;
      this.activeSub.closer.close();
      const filter = spec.filters[0]!;
      const closer = this.openSubscription(spec, filter);
      this.activeSub = { spec, closer, id };
    }

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
    if (this.activeSub) {
      this.activeSub.closer.close();
      this.activeSub = null;
    }
    this.pool.close([...this.everRelays]);
  }
}
