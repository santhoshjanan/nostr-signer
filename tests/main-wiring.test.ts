import { describe, it, expect } from "vitest";
import { describeAction } from "../src/main/index.js";

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
