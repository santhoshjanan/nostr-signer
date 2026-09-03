import { describe, it, expect } from "vitest";
import { normalizeRelayUrls, DEFAULT_RELAYS } from "../src/main/relay.js";

describe("relay url helpers", () => {
  it("exposes the default relays from the spec", () => {
    expect(DEFAULT_RELAYS).toEqual([
      "wss://relay.damus.io",
      "wss://nos.lol",
      "wss://relay.nostr.band"
    ]);
  });

  it("keeps valid wss urls and trims whitespace", () => {
    expect(normalizeRelayUrls([" wss://relay.damus.io "])).toEqual([
      "wss://relay.damus.io"
    ]);
  });

  it("drops entries that are not wss:// urls", () => {
    expect(normalizeRelayUrls(["http://x", "wss://ok.example", ""])).toEqual([
      "wss://ok.example"
    ]);
  });

  it("dedupes urls", () => {
    expect(
      normalizeRelayUrls(["wss://a.example", "wss://a.example", "wss://b.example"])
    ).toEqual(["wss://a.example", "wss://b.example"]);
  });
});
