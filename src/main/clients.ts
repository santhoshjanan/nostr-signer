import type { ClientRecord } from "../shared/types.js";

export interface ClientRegistryDeps {
  loadClients(): ClientRecord[];
  saveClients(clients: ClientRecord[]): void;
}

export class ClientRegistry {
  private clients: ClientRecord[];

  constructor(private deps: ClientRegistryDeps) {
    this.clients = deps.loadClients();
  }

  isClient(pubkey: string): boolean {
    return this.clients.some((c) => c.pubkey === pubkey);
  }

  get(pubkey: string): ClientRecord | undefined {
    const found = this.clients.find((c) => c.pubkey === pubkey);
    return found ? { ...found } : undefined;
  }

  list(): ClientRecord[] {
    return this.clients.map((c) => ({ ...c }));
  }

  addClient(pubkey: string): ClientRecord {
    const existing = this.clients.find((c) => c.pubkey === pubkey);
    if (existing) {
      return { ...existing };
    }
    const record: ClientRecord = {
      pubkey,
      name: `${pubkey.slice(0, 12)}...`,
      connectedAt: Date.now()
    };
    this.clients.push(record);
    this.deps.saveClients(this.clients);
    return { ...record };
  }

  rename(pubkey: string, name: string): void {
    const record = this.clients.find((c) => c.pubkey === pubkey);
    if (record) {
      record.name = name;
      this.deps.saveClients(this.clients);
    }
  }

  remove(pubkey: string): void {
    this.clients = this.clients.filter((c) => c.pubkey !== pubkey);
    this.deps.saveClients(this.clients);
  }

  clear(): void {
    this.clients = [];
    this.deps.saveClients(this.clients);
  }
}
