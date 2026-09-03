import { describe, it, expect } from "vitest";
import { shortKey, formatTimestamp, describeLogEntry } from "../src/renderer/app.js";

describe("renderer helpers", () => {
  it("shortKey truncates a hex pubkey", () => {
    expect(shortKey("abcdef0123456789" + "0".repeat(48))).toBe("abcdef012345...");
  });

  it("formatTimestamp renders HH:MM:SS", () => {
    const ts = new Date(2026, 8, 2, 14, 5, 9).getTime();
    expect(formatTimestamp(ts)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("describeLogEntry formats known entry types", () => {
    expect(
      describeLogEntry({ timestamp: 0, type: "event-signed", message: "Signed kind 1 event" })
    ).toBe("Signed kind 1 event");
    expect(
      describeLogEntry({ timestamp: 0, type: "client-connected", message: "Client connected" })
    ).toBe("Client connected");
  });
});
