// Bundles and copies the renderer assets into out/renderer/.
//
// This MUST run AFTER `tsc -b` in the build pipeline. tsc -b also emits its
// own out/renderer/app.js (a plain, unbundled compile of app.ts with the
// bare "qrcode" import specifier left untouched — that specifier cannot be
// resolved by Chromium's ES-module loader and throws at runtime). Running
// esbuild afterwards overwrites that file with a bundled, browser-ready
// version so the bundle wins.
import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const rendererSrc = join(rootDir, "src", "renderer");
const rendererOut = join(rootDir, "out", "renderer");

async function main() {
  await mkdir(rendererOut, { recursive: true });

  await build({
    entryPoints: [join(rendererSrc, "app.ts")],
    outfile: join(rendererOut, "app.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome120",
    sourcemap: true
  });

  await copyFile(join(rendererSrc, "index.html"), join(rendererOut, "index.html"));
  await copyFile(join(rendererSrc, "styles.css"), join(rendererOut, "styles.css"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
