import { rmdir, exists, cp } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "bun";

const distDir = resolve(__dirname, "./dist");
const publicDir = resolve(__dirname, "./public");
const srcDir = resolve(__dirname, "./src");
const entrypoints: string[] = [
  resolve(srcDir, "controller.ts"),
  resolve(srcDir, "content_script.ts"),
];

main();

async function main() {
  await createCleanDist();
  await buildToDist();
}

async function createCleanDist() {
  if (await exists(distDir)) {
    console.info("Starting to remove old dist", distDir);
    await rmdir(distDir, { recursive: true });
  }

  console.info("Creating new dist directory from public directory");
  await cp(publicDir, distDir, { recursive: true });
}

async function buildToDist() {
  console.info("Starting to build to dist");

  const res = await build({
    entrypoints,
    outdir: distDir,
    minify: false,
  });

  console.info("Building to dist: ", res);
}
