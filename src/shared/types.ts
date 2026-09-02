export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface UnsignedEvent extends EventTemplate {
  pubkey: string;
}

export interface SignedEvent extends UnsignedEvent {
  id: string;
  sig: string;
}

export const SUPPORTED_METHODS = [
  "connect",
  "sign_event",
  "get_public_key",
  "ping",
  "nip04_encrypt",
  "nip04_decrypt",
  "nip44_encrypt",
  "nip44_decrypt"
] as const;

export type Nip46Method = (typeof SUPPORTED_METHODS)[number];

export const CONNECTION_LEVEL_METHODS = [
  "connect",
  "get_public_key",
  "ping"
] as const;

export type ActionType =
  | `sign_event:kind-${number}`
  | "nip04_encrypt"
  | "nip04_decrypt"
  | "nip44_encrypt"
  | "nip44_decrypt";

export function actionTypeForSignEventKind(kind: number): ActionType {
  return `sign_event:kind-${kind}`;
}

export interface Nip46Request {
  id: string;
  method: string;
  params: string[];
}

export interface Nip46Response {
  id: string;
  result?: string;
  error?: string;
}

export type PolicyDecision = "allow" | "deny" | "ask";

export type ApprovalChoice = "allow-once" | "always-allow" | "deny";

export interface ApprovalRule {
  clientPubkey: string;
  actionType: ActionType;
  createdAt: number;
}

export interface ClientRecord {
  pubkey: string;
  name: string;
  connectedAt: number;
}

export type LogEntryType =
  | "client-connected"
  | "client-denied"
  | "request-approved"
  | "request-denied"
  | "event-signed"
  | "request-dropped"
  | "protocol-error"
  | "relay-status";

export interface LogEntry {
  timestamp: number;
  type: LogEntryType;
  clientPubkey?: string;
  actionType?: string;
  message: string;
  eventId?: string;
}

export interface RelayStatus {
  url: string;
  connected: boolean;
}

export interface PendingApproval {
  id: string;
  clientPubkey: string;
  clientName: string;
  actionType: string;
  description: string;
  eventPreview?: string;
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Uint8Array;
  decryptString(encrypted: Uint8Array): string;
}

export interface TransportSubscription {
  filters: Array<{ kinds: number[]; "#p": string[] }>;
  onEvent(event: { pubkey: string; content: string }): void;
}

export interface RelayTransport {
  connect(): Promise<void>;
  subscribe(sub: TransportSubscription): { close(): void };
  publish(event: SignedEvent): Promise<void>;
  onStatusChange(cb: (statuses: RelayStatus[]) => void): void;
  setRelays(urls: string[]): Promise<void>;
  getStatuses(): RelayStatus[];
}
