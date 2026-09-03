import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SignerApi } from "../src/shared/ipc.js";

// Minimal fake DOM, mirroring the approach in
// tests/renderer-approval-queue.test.ts, but scoped to just what init() and
// the fatal-error banner touch.

class FakeElement {
  id = "";
  hidden = false;
  textContent = "";
  value = "";
  parentElement: FakeElement | null = null;
  children: FakeElement[] = [];
  tagName: string;

  constructor(tagName = "DIV") {
    this.tagName = tagName.toUpperCase();
  }

  appendChild(node: FakeElement): FakeElement {
    node.parentElement = this;
    this.children.push(node);
    return node;
  }

  append(...nodes: FakeElement[]): void {
    for (const n of nodes) this.appendChild(n);
  }

  replaceChildren(): void {
    this.children = [];
  }

  addEventListener(): void {}
}

class FakeDocument {
  private roots: FakeElement[] = [];

  register(id: string, tagName = "DIV"): FakeElement {
    const el = new FakeElement(tagName);
    el.id = id;
    this.roots.push(el);
    return el;
  }

  getElementById(id: string): FakeElement | null {
    const search = (node: FakeElement): FakeElement | null => {
      if (node.id === id) return node;
      for (const child of node.children) {
        const found = search(child);
        if (found) return found;
      }
      return null;
    };
    for (const root of this.roots) {
      const found = search(root);
      if (found) return found;
    }
    return null;
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }
}

function buildFakeDocument(): FakeDocument {
  const doc = new FakeDocument();
  doc.register("app-error", "P");
  // Elements touched only if init() gets far enough to succeed / attach
  // onboarding listeners -- present so a non-throwing path wouldn't crash
  // the test harness itself, though the failing-init tests below never
  // reach them.
  doc.register("onboarding");
  doc.register("dashboard");
  doc.register("import-key", "BUTTON");
  doc.register("generate-key", "BUTTON");
  doc.register("copy-uri", "BUTTON");
  doc.register("save-relays", "BUTTON");
  doc.register("approval-allow-once", "BUTTON");
  doc.register("approval-always", "BUTTON");
  doc.register("approval-deny", "BUTTON");
  return doc;
}

describe("renderer fatal startup error surface", () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as unknown as { document: unknown }).document = undefined;
    (globalThis as unknown as { window: unknown }).window = undefined;
  });

  it("renders a visible error banner when window.signerApi is missing entirely", async () => {
    const doc = buildFakeDocument();
    (globalThis as unknown as { window: unknown }).window = {};
    (globalThis as unknown as { document: unknown }).document = doc;

    await import("../src/renderer/app.js");
    // Let the rejected init() promise's .catch() handler run.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const banner = doc.getElementById("app-error")!;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent.length).toBeGreaterThan(0);
  });

  it("renders a visible error banner with the rejection message when a startup api call rejects", async () => {
    const doc = buildFakeDocument();
    const api: Partial<SignerApi> = {
      hasKey: async () => {
        throw new Error("boom from hasKey");
      }
    };
    (globalThis as unknown as { window: unknown }).window = { signerApi: api };
    (globalThis as unknown as { document: unknown }).document = doc;

    await import("../src/renderer/app.js");
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const banner = doc.getElementById("app-error")!;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain("boom from hasKey");
  });

  it("showFatalError sets textContent (not innerHTML) and unhides the banner", async () => {
    const doc = buildFakeDocument();
    (globalThis as unknown as { window: unknown }).window = { signerApi: {} };
    (globalThis as unknown as { document: unknown }).document = doc;

    const mod = await import("../src/renderer/app.js");
    mod.showFatalError("<script>evil()</script>");

    const banner = doc.getElementById("app-error")!;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain("<script>evil()</script>");
  });
});
