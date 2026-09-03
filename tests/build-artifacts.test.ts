import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// These tests assert against the real build output on disk (out/). They
// assume `npm run build` has already been run; running a full build here
// would be slow and would duplicate what `npm run build` already verifies.
// If out/ is missing, fail with a clear message rather than silently
// skipping, so a missing build doesn't masquerade as a pass.

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const outDir = join(rootDir, "out");

function requireBuildOutput(): void {
  if (!existsSync(outDir)) {
    throw new Error(
      "out/ does not exist. Run `npm run build` before running tests/build-artifacts.test.ts."
    );
  }
}

beforeAll(() => {
  requireBuildOutput();
});

describe("renderer build artifacts", () => {
  it("copies index.html and styles.css into out/renderer", () => {
    expect(existsSync(join(outDir, "renderer", "index.html"))).toBe(true);
    expect(existsSync(join(outDir, "renderer", "styles.css"))).toBe(true);
  });

  it("bundles out/renderer/app.js with no bare-specifier imports", () => {
    const appJsPath = join(outDir, "renderer", "app.js");
    expect(existsSync(appJsPath)).toBe(true);

    const source = readFileSync(appJsPath, "utf8");
    const importRegex = /import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;

    const bareSpecifiers: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(source)) !== null) {
      const specifier = match[1];
      if (
        specifier !== undefined &&
        !specifier.startsWith("./") &&
        !specifier.startsWith("../") &&
        !specifier.startsWith("/")
      ) {
        bareSpecifiers.push(specifier);
      }
    }

    expect(bareSpecifiers).toEqual([]);
  });

  it("resolves the path main.ts passes to loadFile to an existing file", () => {
    // Derive the loadFile target the same way src/main/index.ts does,
    // instead of hardcoding a duplicate string, so this test breaks if
    // either side moves.
    const mainSource = readFileSync(join(rootDir, "src", "main", "index.ts"), "utf8");
    const loadFileMatch = /loadFile\(\s*join\(__dirname,\s*["']([^"']+)["']\s*\)\s*\)/.exec(
      mainSource
    );

    expect(loadFileMatch).not.toBeNull();
    const relativeFromMainOut = loadFileMatch![1];

    // src/main/index.ts compiles to out/main/index.js, so __dirname at
    // runtime is out/main.
    const resolvedPath = join(outDir, "main", relativeFromMainOut!);

    expect(existsSync(resolvedPath)).toBe(true);
  });
});
