import { describe, it, expect } from "vitest";
import {
  actionTypeForSignEventKind,
  CONNECTION_LEVEL_METHODS,
  SUPPORTED_METHODS
} from "../src/shared/types.js";
import { IPC, type SignerApi } from "../src/shared/ipc.js";

describe("shared types", () => {
  it("lists all 8 supported NIP-46 methods", () => {
    expect([...SUPPORTED_METHODS].sort()).toEqual([
      "connect",
      "get_public_key",
      "nip04_decrypt",
      "nip04_encrypt",
      "nip44_decrypt",
      "nip44_encrypt",
      "ping",
      "sign_event"
    ]);
  });

  it("marks connect/get_public_key/ping as connection-level", () => {
    expect([...CONNECTION_LEVEL_METHODS].sort()).toEqual([
      "connect",
      "get_public_key",
      "ping"
    ]);
  });

  it("refines sign_event action types by event kind", () => {
    expect(actionTypeForSignEventKind(1)).toBe("sign_event:kind-1");
    expect(actionTypeForSignEventKind(7)).toBe("sign_event:kind-7");
  });

  it("defines stable IPC channel names", () => {
    expect(IPC.GetStatus).toBe("signer:get-status");
    expect(IPC.RespondApproval).toBe("signer:respond-approval");
    expect(IPC.ApprovalRequested).toBe("signer:approval-requested");
    expect(IPC.ActivityAppended).toBe("signer:activity-appended");
  });

  it("exposes a SignerApi interface shape", () => {
    const apiShape: (keyof SignerApi)[] = [
      "getStatus",
      "getBunkerUri",
      "hasKey",
      "importKey",
      "generateKey",
      "listClients",
      "renameClient",
      "revokeClient",
      "resetClientApprovals",
      "respondApproval",
      "getActivityLog",
      "getRelays",
      "setRelays",
      "onApprovalRequested",
      "onActivity",
      "onStatusChanged"
    ];
    expect(apiShape).toHaveLength(16);
  });
});
