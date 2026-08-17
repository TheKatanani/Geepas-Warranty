import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "dist");

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

console.log("1. Bundling TypeScript with esbuild...");
const bundleJsPath = path.join(distDir, "index.js");
execSync(
  `npx esbuild src/index.ts --bundle --target=es2020 --format=iife --outfile="${bundleJsPath}"`,
  { stdio: "inherit", cwd: __dirname }
);

console.log("2. Compiling JavaScript to Wasm with Javy...");
const wasmPath = path.join(distDir, "function.wasm");
const javyPath = path.resolve(__dirname, "../../node_modules/.bin/javy.cmd");

const javyCmd = fs.existsSync(javyPath) ? `"${javyPath}"` : "npx javy-cli";

execSync(
  `${javyCmd} compile -d "${bundleJsPath}" -o "${wasmPath}"`,
  { stdio: "inherit", cwd: __dirname }
);

const stats = fs.statSync(wasmPath);
console.log(`\n✅ Function Wasm compiled successfully: ${stats.size} bytes at ${wasmPath}`);
