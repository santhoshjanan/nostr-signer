import { contextBridge, ipcRenderer } from "electron";
import { IPC, type SignerApi } from "../shared/ipc.js";
import type { LogEntry, PendingApproval, RelayStatus } from "../shared/types.js";

const api: SignerApi = {
  getStatus: () => ipcRenderer.invoke(IPC.GetStatus),
  getBunkerUri: () => ipcRenderer.invoke(IPC.GetBunkerUri),
  hasKey: () => ipcRenderer.invoke(IPC.HasKey),
  importKey: (nsec: string) => ipcRenderer.invoke(IPC.ImportKey, nsec),
  generateKey: () => ipcRenderer.invoke(IPC.GenerateKey),
  listClients: () => ipcRenderer.invoke(IPC.ListClients),
  renameClient: (pubkey: string, name: string) =>
    ipcRenderer.invoke(IPC.RenameClient, pubkey, name),
  revokeClient: (pubkey: string) => ipcRenderer.invoke(IPC.RevokeClient, pubkey),
  resetClientApprovals: (pubkey: string) =>
    ipcRenderer.invoke(IPC.ResetClientApprovals, pubkey),
  respondApproval: (id: string, choice: "allow-once" | "always-allow" | "deny") =>
    ipcRenderer.invoke(IPC.RespondApproval, id, choice),
  getActivityLog: () => ipcRenderer.invoke(IPC.GetActivityLog),
  getRelays: () => ipcRenderer.invoke(IPC.GetRelays),
  setRelays: (urls: string[]) => ipcRenderer.invoke(IPC.SetRelays, urls),
  factoryReset: () => ipcRenderer.invoke(IPC.FactoryReset),
  onApprovalRequested: (cb: (approval: PendingApproval) => void) => {
    ipcRenderer.on(IPC.ApprovalRequested, (_event, approval: PendingApproval) => cb(approval));
  },
  onActivity: (cb: (entry: LogEntry) => void) => {
    ipcRenderer.on(IPC.ActivityAppended, (_event, entry: LogEntry) => cb(entry));
  },
  onStatusChanged: (cb: (statuses: RelayStatus[]) => void) => {
    ipcRenderer.on(IPC.StatusChanged, (_event, statuses: RelayStatus[]) => cb(statuses));
  }
};

contextBridge.exposeInMainWorld("signerApi", api);
