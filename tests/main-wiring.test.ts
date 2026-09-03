import { describe, it, expect } from "vitest";
import {
  describeAction,
  isValidPubkeyHex,
  validatePubkeyHex,
  validateClientName,
  MAX_CLIENT_NAME_LENGTH,
  validateApprovalId,
  validateApprovalChoice,
  validateNsec,
  validateRelayUrlsInput,
  ensureNonEmptyRelays,
  MAX_RELAY_COUNT
} from "../src/main/index.js";

const VALID_HEX = "a".repeat(64);

describe("describeAction", () => {
  it("describes sign_event with kind", () => {
    expect(describeAction("sign_event:kind-1")).toBe("Publish a note (kind 1)");
    expect(describeAction("sign_event:kind-7")).toBe("Publish a reaction (kind 7)");
  });

  it("describes unknown kinds generically", () => {
    expect(describeAction("sign_event:kind-12345")).toBe("Sign kind 12345 event");
  });

  it("describes encryption action types", () => {
    expect(describeAction("nip04_decrypt")).toBe("Decrypt a direct message (NIP-04)");
    expect(describeAction("nip44_decrypt")).toBe("Decrypt a direct message (NIP-44)");
    expect(describeAction("nip04_encrypt")).toBe("Encrypt a direct message (NIP-04)");
    expect(describeAction("nip44_encrypt")).toBe("Encrypt a direct message (NIP-44)");
  });
});

describe("isValidPubkeyHex / validatePubkeyHex", () => {
  it("accepts a 64-char lowercase hex string", () => {
    expect(isValidPubkeyHex(VALID_HEX)).toBe(true);
    expect(validatePubkeyHex(VALID_HEX)).toBe(VALID_HEX);
  });

  it("rejects non-string, wrong length, and uppercase input", () => {
    expect(isValidPubkeyHex(123)).toBe(false);
    expect(isValidPubkeyHex("a".repeat(63))).toBe(false);
    expect(isValidPubkeyHex("A".repeat(64))).toBe(false);
    expect(isValidPubkeyHex(undefined)).toBe(false);
    expect(() => validatePubkeyHex("not-hex")).toThrow();
    expect(() => validatePubkeyHex(null)).toThrow();
  });
});

describe("validateClientName", () => {
  it("accepts a non-empty string and trims it", () => {
    expect(validateClientName("  Alice's phone  ")).toBe("Alice's phone");
  });

  it("rejects non-strings, empty/whitespace-only strings, and over-length strings", () => {
    expect(() => validateClientName(42)).toThrow();
    expect(() => validateClientName("")).toThrow();
    expect(() => validateClientName("   ")).toThrow();
    expect(() => validateClientName("x".repeat(MAX_CLIENT_NAME_LENGTH + 1))).toThrow();
    expect(validateClientName("x".repeat(MAX_CLIENT_NAME_LENGTH))).toHaveLength(
      MAX_CLIENT_NAME_LENGTH
    );
  });
});

describe("validateApprovalId", () => {
  it("accepts a non-empty string", () => {
    expect(validateApprovalId("abc")).toBe("abc");
  });

  it("rejects non-strings and empty strings", () => {
    expect(() => validateApprovalId("")).toThrow();
    expect(() => validateApprovalId(123)).toThrow();
    expect(() => validateApprovalId(undefined)).toThrow();
  });
});

describe("validateApprovalChoice", () => {
  it("accepts the three known choices", () => {
    expect(validateApprovalChoice("allow-once")).toBe("allow-once");
    expect(validateApprovalChoice("always-allow")).toBe("always-allow");
    expect(validateApprovalChoice("deny")).toBe("deny");
  });

  it("rejects anything else", () => {
    expect(() => validateApprovalChoice("allow")).toThrow();
    expect(() => validateApprovalChoice(1)).toThrow();
    expect(() => validateApprovalChoice(undefined)).toThrow();
  });
});

describe("validateNsec", () => {
  it("accepts a string", () => {
    expect(validateNsec("nsec1whatever")).toBe("nsec1whatever");
  });

  it("rejects non-strings", () => {
    expect(() => validateNsec(123)).toThrow();
    expect(() => validateNsec(null)).toThrow();
    expect(() => validateNsec(undefined)).toThrow();
  });
});

describe("validateRelayUrlsInput", () => {
  it("accepts an array of strings within the cap", () => {
    expect(validateRelayUrlsInput(["wss://a", "wss://b"])).toEqual(["wss://a", "wss://b"]);
  });

  it("rejects non-arrays, arrays with non-string entries, and over-cap arrays", () => {
    expect(() => validateRelayUrlsInput("wss://a")).toThrow();
    expect(() => validateRelayUrlsInput(["wss://a", 5])).toThrow();
    expect(() =>
      validateRelayUrlsInput(Array.from({ length: MAX_RELAY_COUNT + 1 }, (_, i) => `wss://r${i}`))
    ).toThrow();
    expect(
      validateRelayUrlsInput(Array.from({ length: MAX_RELAY_COUNT }, (_, i) => `wss://r${i}`))
    ).toHaveLength(MAX_RELAY_COUNT);
  });
});

describe("ensureNonEmptyRelays", () => {
  it("returns the list unchanged when non-empty", () => {
    expect(ensureNonEmptyRelays(["wss://a"])).toEqual(["wss://a"]);
  });

  it("throws when the list is empty", () => {
    expect(() => ensureNonEmptyRelays([])).toThrow();
  });
});
