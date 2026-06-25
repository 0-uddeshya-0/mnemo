import { build } from "esbuild";

await build({
  entryPoints: ["src/background.ts", "src/options.ts"],
  outdir: "dist",
  bundle: true,
  format: "esm",
  target: "chrome110",
  minify: false,
  logLevel: "info",
});

console.log("✓ Extension built to apps/extension/dist (load apps/extension unpacked in chrome://extensions).");
