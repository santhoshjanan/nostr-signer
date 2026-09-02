import { describe, it, expect, beforeEach } from "vitest";
import { KeyVault, type KeyVaultStorage } from "../src/main/keyvault.js";
import type { SafeStorageLike } from "../src/shared/types.js";

export class FakeSafeStorage implements SafeStorageLike {
  isEncryptionAvailable(): boolean {
    return true;
  }
  encryptString(plainText: string): Uint8Array {
    return Buffer.concat([Buffer.from("dpapi:"), Buffer.from(plainText, "utf8")]);
  }
  decryptString(encrypted: Uint8Array): string {
    const buf = Buffer.from(encrypted);
    const prefix = buf.subarray(0, 6).toString("utf8");
    if (prefix !== "dpapi:") {
      throw new Error("blob not decryptable on this machine");
    }
    return buf.subarray(6).toString("utf8");
  }
}

function makeStorage(): KeyVaultStorage & { blob: Uint8Array | null } {
  return {
    blob: null,
    loadKeyBlob() {
      return this.blob;
    },
    saveKeyBlob(blob: Uint8Array) {
      this.blob = blob;
    },
    clearKeyBlob() {
      this.blob = null;
    }
  };
}

const NSEC_HEX = "1".repeat(64);

describe("KeyVault", () => {
  let vault: KeyVault;
  let storage: ReturnType<typeof makeStorage>;

  beforeEach(() => {
    storage = makeStorage();
    vault = new KeyVault(new FakeSafeStorage(), storage);
  });

  it("hasKey is false before any key is set", () => {
    expect(vault.hasKey()).toBe(false);
  });

  it("setKey encrypts and persists; hasKey becomes true", () => {
    vault.setKey(NSEC_HEX);
    expect(vault.hasKey()).toBe(true);
    expect(storage.blob).not.toBeNull();
    expect(Buffer.from(storage.blob!).toString("utf8")).not.toContain(NSEC_HEX);
  });

  it("getSecretKey returns the plaintext bytes from memory", () => {
    vault.setKey(NSEC_HEX);
    const key = vault.getSecretKey();
    expect(Buffer.from(key).toString("hex")).toBe(NSEC_HEX);
  });

  it("round-trips through a fresh instance (encrypt -> persist -> decrypt)", () => {
    vault.setKey(NSEC_HEX);
    const vault2 = new KeyVault(new FakeSafeStorage(), storage);
    expect(vault2.hasKey()).toBe(true);
    expect(Buffer.from(vault2.getSecretKey()).toString("hex")).toBe(NSEC_HEX);
  });

  it("getSecretKey throws when no key exists", () => {
    expect(() => vault.getSecretKey()).toThrow(/no key/i);
  });

  it("clear removes the key from memory and disk", () => {
    vault.setKey(NSEC_HEX);
    vault.clear();
    expect(vault.hasKey()).toBe(false);
    expect(storage.blob).toBeNull();
    expect(() => vault.getSecretKey()).toThrow(/no key/i);
  });

  it("rejects keys that are not 64 lowercase hex chars", () => {
    expect(() => vault.setKey("xyz")).toThrow(/invalid/i);
    expect(() => vault.setKey("1".repeat(63))).toThrow(/invalid/i);
  });

  it("fails safe when the blob cannot be decrypted", () => {
    storage.blob = Buffer.from("garbage");
    const vault2 = new KeyVault(new FakeSafeStorage(), storage);
    expect(vault2.hasKey()).toBe(false);
    expect(() => vault2.getSecretKey()).toThrow(/no key/i);
  });
});
