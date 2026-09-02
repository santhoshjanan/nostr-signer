import { getPublicKey } from "nostr-tools/pure";
import type { SafeStorageLike } from "../shared/types.js";

export interface KeyVaultStorage {
  loadKeyBlob(): Uint8Array | null;
  saveKeyBlob(blob: Uint8Array): void;
  clearKeyBlob(): void;
}

export class KeyVault {
  private secretKey: Uint8Array | null = null;

  constructor(
    private safeStorage: SafeStorageLike,
    private storage: KeyVaultStorage
  ) {}

  hasKey(): boolean {
    if (this.secretKey !== null) {
      return true;
    }
    try {
      this.getSecretKey();
      return true;
    } catch {
      return false;
    }
  }

  setKey(hexKey: string): void {
    if (!/^[0-9a-f]{64}$/.test(hexKey)) {
      throw new Error("invalid key: expected 64 lowercase hex characters");
    }
    const keyBytes = Buffer.from(hexKey, "hex");
    const encrypted = this.safeStorage.encryptString(keyBytes.toString("base64"));
    this.storage.saveKeyBlob(encrypted);
    this.secretKey = keyBytes;
  }

  getSecretKey(): Uint8Array {
    if (this.secretKey !== null) {
      return this.secretKey;
    }
    const blob = this.storage.loadKeyBlob();
    if (blob === null) {
      throw new Error("no key stored");
    }
    let b64: string;
    try {
      b64 = this.safeStorage.decryptString(blob);
    } catch {
      this.storage.clearKeyBlob();
      throw new Error("no key stored: blob undecryptable");
    }
    const keyBytes = Buffer.from(b64, "base64");
    const hex =
      keyBytes.length === 32 && keyBytes.toString("base64") === b64
        ? keyBytes.toString("hex")
        : "";
    if (!/^[0-9a-f]{64}$/.test(hex)) {
      this.storage.clearKeyBlob();
      throw new Error("no key stored: blob corrupt");
    }
    this.secretKey = keyBytes;
    return this.secretKey;
  }

  getPublicKeyHex(): string {
    return getPublicKey(this.getSecretKey());
  }

  clear(): void {
    this.secretKey = null;
    this.storage.clearKeyBlob();
  }
}
