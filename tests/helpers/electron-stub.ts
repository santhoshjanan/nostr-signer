export const app = undefined;
export const BrowserWindow = undefined;
export const ipcMain = { handle: () => {} };
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Uint8Array) => Buffer.from(b).toString()
};
export const dialog = { showErrorBox: async () => {} };
