import { describe, it, expect, vi } from "vitest";

const invokeMock = vi.fn();
const onMock = vi.fn();
const exposeMock = vi.fn();

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: exposeMock },
  ipcRenderer: { invoke: invokeMock, on: onMock }
}));

describe("preload bridge", () => {
  it("exposes signerApi with all typed methods bound to ipc channels", async () => {
    await import("../src/preload/preload.js");
    expect(exposeMock).toHaveBeenCalledTimes(1);
    const [name, api] = exposeMock.mock.calls[0]!;
    expect(name).toBe("signerApi");

    invokeMock.mockResolvedValue({ hasKey: true, pubkey: "x", relays: [] });
    await api.getStatus();
    expect(invokeMock).toHaveBeenCalledWith("signer:get-status");

    await api.respondApproval("req-1", "always-allow");
    expect(invokeMock).toHaveBeenCalledWith("signer:respond-approval", "req-1", "always-allow");

    await api.setRelays(["wss://nos.lol"]);
    expect(invokeMock).toHaveBeenCalledWith("signer:set-relays", ["wss://nos.lol"]);

    const cb = vi.fn();
    api.onApprovalRequested(cb);
    expect(onMock).toHaveBeenCalledWith("signer:approval-requested", expect.any(Function));

    const statusCb = vi.fn();
    api.onStatusChanged(statusCb);
    expect(onMock).toHaveBeenCalledWith("signer:status-changed", expect.any(Function));

    await api.renameClient("pk", "name");
    expect(invokeMock).toHaveBeenCalledWith("signer:rename-client", "pk", "name");
  });
});
