import { expect, test } from "bun:test";

test("builds a Chromium MV3 extension", async () => {
  const manifest = await Bun.file("dist/manifest.json").json();
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.name).toBe("simple-readaloud");
  expect(manifest.version).toBe("2.0.0");
  expect(manifest.minimum_chrome_version).toBe("116");
  expect(manifest.permissions).toEqual(["storage", "offscreen"]);
  expect(manifest.host_permissions).toEqual(["*://*/*"]);
  expect(manifest.background.service_worker).toBe("background.js");
  expect(manifest.action.default_popup).toBe("controller.html");
  expect(manifest.browser_action).toBeUndefined();

  for (const file of [
    "background.js",
    "content_script.js",
    "offscreen.js",
    "controller.js",
    "controller.css",
  ]) {
    expect(await Bun.file(`dist/${file}`).exists()).toBe(true);
  }
});
