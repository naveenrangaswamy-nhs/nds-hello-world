// Copies NHS.UK frontend static files into public/assets so they are served
// at /assets/, which is the default $nhsuk-assets-path used by the SCSS:
//   - assets/ (favicons, icons, manifest)
//   - js/     (the ES module bundle loaded by a plain <script type="module">
//              in app/layout.tsx, so no React client component is needed)
import { cpSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = resolve(dirname(require.resolve("nhsuk-frontend/package.json")), "dist/nhsuk");
const dest = resolve(root, "public/assets");

mkdirSync(resolve(dest, "js"), { recursive: true });
cpSync(resolve(pkg, "assets"), dest, { recursive: true });
for (const file of ["nhsuk-frontend.min.js", "nhsuk-frontend.min.js.map"]) {
  copyFileSync(resolve(pkg, file), resolve(dest, "js", file));
}
console.log(`Copied NHS.UK frontend assets and JavaScript to ${dest}`);
