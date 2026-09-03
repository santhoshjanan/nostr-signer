// Standalone Electron main script that verifies the renderer actually
// paints. It creates a hidden BrowserWindow with the same webPreferences as
// src/main/index.ts, loads out/renderer/index.html, and asserts the page
// booted correctly. It deliberately does NOT run the real app's boot() —
// no key access, no relay network connections — this only checks that the
// DOM and preload bridge came up.
import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { IPC } from "../out/shared/ipc.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const preloadPath = join(rootDir, "out", "preload", "preload.js");
const indexHtmlPath = join(rootDir, "out", "renderer", "index.html");

// app.ts unconditionally calls window.signerApi.hasKey() the moment the
// module loads (see src/renderer/app.ts init(), invoked at import time).
// This smoke test intentionally does NOT wire up the real backend (no
// keyvault, no relay connections) — it only stubs the one IPC channel
// app.ts calls unconditionally on load, returning `false` so the page
// renders the onboarding view without throwing. No key material is
// touched and no network calls are made.
ipcMain.handle(IPC.HasKey, () => false);

let didFailLoad = null;
let renderProcessGone = null;
const consoleErrors = [];

function fail(message) {
  console.error(`FAIL: ${message}`);
  app.exit(1);
}

function pass(message) {
  console.log(`PASS: ${message}`);
  app.exit(0);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    didFailLoad = { errorCode, errorDescription, validatedURL };
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    renderProcessGone = details;
  });

  win.webContents.on("console-message", (event) => {
    const level = event.level ?? event[0];
    if (level === "error" || level === 2) {
      const message = event.message ?? event[1];
      consoleErrors.push(message);
    }
  });

  try {
    await win.loadFile(indexHtmlPath);
  } catch (err) {
    fail(`loadFile threw: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (didFailLoad) {
    fail(`did-fail-load fired: ${JSON.stringify(didFailLoad)}`);
    return;
  }

  if (renderProcessGone) {
    fail(`render-process-gone fired: ${JSON.stringify(renderProcessGone)}`);
    return;
  }

  let result;
  try {
    result = await win.webContents.executeJavaScript(
      `({
        hasOnboarding: document.getElementById('onboarding') !== null,
        signerApiType: typeof window.signerApi,
        // The [hidden] attribute hides an element only via the UA
        // stylesheet's [hidden]{display:none}, which ANY author 'display'
        // rule outranks -- an id selector especially. When that happens the
        // element is painted despite being logically hidden, and every
        // el.hidden = true in app.ts silently becomes a no-op. Assert the
        // invariant across the whole document so this can't regress on some
        // other element later.
        visibleDespiteHidden: Array.from(document.querySelectorAll('[hidden]'))
          .filter((node) => getComputedStyle(node).display !== 'none')
          .map((node) => node.id || node.tagName.toLowerCase())
      })`
    );
  } catch (err) {
    fail(`executeJavaScript threw: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (!result.hasOnboarding) {
    fail("document.getElementById('onboarding') was null");
    return;
  }

  if (result.signerApiType !== "object") {
    fail(`typeof window.signerApi was "${result.signerApiType}", expected "object"`);
    return;
  }

  if (result.visibleDespiteHidden.length > 0) {
    fail(
      `elements carry the [hidden] attribute but still compute to a visible ` +
        `display, so el.hidden cannot hide them: ` +
        `${JSON.stringify(result.visibleDespiteHidden)}`
    );
    return;
  }

  if (consoleErrors.length > 0) {
    fail(`uncaught renderer console errors: ${JSON.stringify(consoleErrors)}`);
    return;
  }

  pass(
    "renderer loaded, onboarding element present, signerApi bridge attached, " +
      "[hidden] elements actually hidden, no console errors"
  );
});

app.on("window-all-closed", () => {
  // Keep process alive until pass()/fail() explicitly exits.
});
