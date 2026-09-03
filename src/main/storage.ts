import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  rmSync
} from "node:fs";
import { join } from "node:path";
import type { ApprovalRule, ClientRecord, LogEntry } from "../shared/types.js";

const MAX_LOG_ENTRIES = 1000;

export class Storage {
  constructor(private baseDir: string) {
    mkdirSync(baseDir, { recursive: true });
  }

  private file(name: string): string {
    return join(this.baseDir, name);
  }

  private readJson<T>(name: string, fallback: T): T {
    const path = this.file(name);
    if (!existsSync(path)) {
      return fallback;
    }
    try {
      return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch {
      return fallback;
    }
  }

  private writeJsonAtomic(name: string, value: unknown): void {
    const path = this.file(name);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
    renameSync(tmp, path);
  }

  loadClients(): ClientRecord[] {
    return this.readJson<ClientRecord[]>("clients.json", []);
  }

  saveClients(clients: ClientRecord[]): void {
    this.writeJsonAtomic("clients.json", clients);
  }

  loadRules(): ApprovalRule[] {
    return this.readJson<ApprovalRule[]>("rules.json", []);
  }

  saveRules(rules: ApprovalRule[]): void {
    this.writeJsonAtomic("rules.json", rules);
  }

  loadLog(): LogEntry[] {
    return this.readJson<LogEntry[]>("log.json", []);
  }

  appendLog(entry: LogEntry): void {
    const log = this.loadLog();
    log.push(entry);
    while (log.length > MAX_LOG_ENTRIES) {
      log.shift();
    }
    this.writeJsonAtomic("log.json", log);
  }

  loadRelays(): string[] | null {
    return this.readJson<string[] | null>("relays.json", null);
  }

  saveRelays(relays: string[]): void {
    this.writeJsonAtomic("relays.json", relays);
  }

  loadKeyBlob(): Uint8Array | null {
    const path = this.file("key");
    if (!existsSync(path)) {
      return null;
    }
    try {
      return Buffer.from(readFileSync(path, "utf8"), "base64");
    } catch {
      return null;
    }
  }

  saveKeyBlob(blob: Uint8Array): void {
    const path = this.file("key");
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, Buffer.from(blob).toString("base64"), "utf8");
    renameSync(tmp, path);
  }

  clearKeyBlob(): void {
    const path = this.file("key");
    if (existsSync(path)) {
      rmSync(path);
    }
  }
}
