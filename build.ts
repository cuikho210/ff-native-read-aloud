import { rmdir, exists, cp } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "bun";

const distDir = resolve(__dirname, "./dist");
const publicDir = resolve(__dirname, "./public");
const srcDir = resolve(__dirname, "./src");
const entrypoints: string[] = [
  resolve(srcDir, "controller.tsx"),
  resolve(srcDir, "content_script.ts"),
  resolve(srcDir, "background.ts"),
  resolve(srcDir, "offscreen.ts"),
];

main();

async function main() {
  await createCleanDist();
  await buildToDist();
  await buildStyles();
  console.info("Built extension to", distDir);
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
    target: "browser",
    format: "iife",
    minify: false,
  });

  if (!res.success) {
    for (const log of res.logs) {
      console.error(log);
    }
    throw new Error("JavaScript build failed");
  }
}

async function buildStyles() {
  console.info("Building Tailwind styles");
  await Bun.$`bunx @tailwindcss/cli -i ${resolve(srcDir, "styles.css")} -o ${resolve(distDir, "controller.css")} --minify`;
}
