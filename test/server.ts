import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const distDir = resolve(root, "test-dist");
const port = Number(process.env.PORT ?? 8890);
const upstream = (process.env.TTS_UPSTREAM ?? "http://localhost:8880").replace(
  /\/+$/,
  "",
);

await mkdir(distDir, { recursive: true });

const result = await Bun.build({
  entrypoints: [resolve(root, "test/harness.ts")],
  outdir: distDir,
  target: "browser",
  format: "iife",
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

const distAssets = new Set([
  "/controller.js",
  "/controller.css",
  "/icon-32.png",
  "/icon-48.png",
  "/offscreen.html",
]);

const pageHtml = `<!doctype html><html><body><p id="paragraph">The content script reads this paragraph aloud.</p></body></html>`;

function pageResponse(): Response {
  return new Response(pageHtml, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/harness.html") {
      return new Response(Bun.file(resolve(root, "test/harness.html")));
    }
    if (url.pathname === "/harness.js") {
      return new Response(Bun.file(resolve(distDir, "harness.js")));
    }
    if (url.pathname === "/page.html") {
      return pageResponse();
    }
    if (url.pathname === "/popup.html") {
      const html = await Bun.file(resolve(root, "dist/controller.html")).text();
      const injected = html.replace(
        '<script src="controller.js"></script>',
        '<script src="/chrome-shim.js"></script><script src="controller.js"></script>',
      );
      return new Response(injected, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/chrome-shim.js") {
      return new Response(Bun.file(resolve(root, "test/chrome-shim.js")));
    }
    if (distAssets.has(url.pathname)) {
      return new Response(Bun.file(resolve(root, "dist", url.pathname.slice(1))));
    }
    if (url.pathname.startsWith("/v1/")) {
      return proxy(request, url);
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`test server listening on http://localhost:${server.port}`);

async function proxy(request: Request, url: URL): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.delete("host");

  const init: RequestInit = { method: request.method, headers };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  const upstreamResponse = await fetch(`${upstream}${url.pathname}${url.search}`, init);
  const responseHeaders = new Headers();
  const contentType = upstreamResponse.headers.get("content-type");
  if (contentType) {
    responseHeaders.set("content-type", contentType);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}
