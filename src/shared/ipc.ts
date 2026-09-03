import type {
  ClientRecord,
  LogEntry,
  PendingApproval,
  RelayStatus
} from "./types.js";

export const IPC = {
  GetStatus: "signer:get-status",
  GetBunkerUri: "signer:get-bunker-uri",
  HasKey: "signer:has-key",
  ImportKey: "signer:import-key",
  GenerateKey: "signer:generate-key",
  ListClients: "signer:list-clients",
  RenameClient: "signer:rename-client",
  RevokeClient: "signer:revoke-client",
  ResetClientApprovals: "signer:reset-client-approvals",
  RespondApproval: "signer:respond-approval",
  GetActivityLog: "signer:get-activity-log",
  GetRelays: "signer:get-relays",
  SetRelays: "signer:set-relays",
  FactoryReset: "signer:factory-reset",
  ApprovalRequested: "signer:approval-requested",
  ActivityAppended: "signer:activity-appended",
  StatusChanged: "signer:status-changed"
} as const;

export interface SignerStatus {
  hasKey: boolean;
  pubkey: string | null;
  relays: RelayStatus[];
}

export interface SignerApi {
  getStatus(): Promise<SignerStatus>;
  getBunkerUri(): Promise<string>;
  hasKey(): Promise<boolean>;
  importKey(nsec: string): Promise<void>;
  generateKey(): Promise<void>;
  listClients(): Promise<ClientRecord[]>;
  renameClient(pubkey: string, name: string): Promise<void>;
  revokeClient(pubkey: string): Promise<void>;
  resetClientApprovals(pubkey: string): Promise<void>;
  respondApproval(id: string, choice: "allow-once" | "always-allow" | "deny"): Promise<void>;
  getActivityLog(): Promise<LogEntry[]>;
  getRelays(): Promise<string[]>;
  setRelays(urls: string[]): Promise<void>;
  /** Irreversibly clears the signing key, paired clients, activity log, and
   * saved relays, returning the app to the onboarding (nsec) screen. */
  factoryReset(): Promise<void>;
  onApprovalRequested(cb: (approval: PendingApproval) => void): void;
  onActivity(cb: (entry: LogEntry) => void): void;
  onStatusChanged(cb: (statuses: RelayStatus[]) => void): void;
}
