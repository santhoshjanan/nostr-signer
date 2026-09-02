import { describe, it, expect, beforeEach } from "vitest";
import { KeyVault, type KeyVaultStorage } from "../src/main/keyvault.js";
import type { SafeStorageLike } from "../src/shared/types.js";
import { getPublicKey } from "nostr-tools/pure";

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

  it("rejects uppercase hex keys", () => {
    expect(() => vault.setKey("A".repeat(64))).toThrow(/invalid/i);
    expect(vault.hasKey()).toBe(false);
  });

  it("getPublicKeyHex returns the known public key for a secret key", () => {
    vault.setKey(NSEC_HEX);
    const expected = getPublicKey(Buffer.from(NSEC_HEX, "hex"));
    expect(vault.getPublicKeyHex()).toBe(expected);
    expect(vault.getPublicKeyHex()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails safe on a corrupt-but-decryptable blob (wrong length)", () => {
    // DPAPI "succeeds" but the payload is base64 of 16 bytes, not 32.
    const badPayload = Buffer.from("dpapi:" + Buffer.alloc(16).toString("base64"), "utf8");
    storage.blob = badPayload;
    const vault2 = new KeyVault(new FakeSafeStorage(), storage);
    expect(vault2.hasKey()).toBe(false);
    expect(() => vault2.getSecretKey()).toThrow(/no key/i);
    expect(storage.blob).toBeNull();
  });

  it("fails safe on a corrupt-but-decryptable blob (non-canonical base64)", () => {
    // DPAPI "succeeds" but the payload is not valid canonical base64 of 32 bytes.
    const badPayload = Buffer.from("dpapi:not!!base64!!", "utf8");
    storage.blob = badPayload;
    const vault2 = new KeyVault(new FakeSafeStorage(), storage);
    expect(vault2.hasKey()).toBe(false);
    expect(() => vault2.getSecretKey()).toThrow(/no key/i);
    expect(storage.blob).toBeNull();
  });
});