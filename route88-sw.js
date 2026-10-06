"use strict";
// Compiled runtime only. All payload requests stay under this worker's own scope.
const BUILD_ID = "6a882a26b623a90e33a7e5f0c16ed3d3bb27f53e6c41052deb65eb4b98260c16";
const DATA_SHA256 = "a7a2ddbd4c3cded8ee3c5e70b1d7e43c0dd6bd59b053ae2d2245e5edc2483802";
const DATA_BYTES = 194841512;
const PARTS = [{"relative":"Build/Route88-WebGL.data-a7a2ddbd4c3cded8.part01.bin","bytes":47185920,"sha256":"02c3756554a4c4b5df2825886b818f346cb3a5bfd176b6f9f99a4304e6fe63c3"},{"relative":"Build/Route88-WebGL.data-a7a2ddbd4c3cded8.part02.bin","bytes":47185920,"sha256":"d9c88504df316151f6e5c54756e906f04582ec3e349d97d05231ca08d56c5745"},{"relative":"Build/Route88-WebGL.data-a7a2ddbd4c3cded8.part03.bin","bytes":47185920,"sha256":"3656eea2d56c0d9651e0a21d8f887f2c01f7de7f941bb6e5134e510229d87c17"},{"relative":"Build/Route88-WebGL.data-a7a2ddbd4c3cded8.part04.bin","bytes":47185920,"sha256":"27e1869a5aae589fe7975c2933757777544f90c862238de0760bb9b2771ece96"},{"relative":"Build/Route88-WebGL.data-a7a2ddbd4c3cded8.part05.bin","bytes":6097832,"sha256":"34fbd95b39c845b0c796e00f58c7b963a0ccd2cccabd8679c082dbab7733b697"}];
const DATA_URL = new URL("Build/Route88-WebGL.data", self.registration.scope);
const IDENTITY = {type:"ROUTE88_RUNTIME",buildId:BUILD_ID,dataSha256:DATA_SHA256,dataBytes:DATA_BYTES};

self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("message", event => {
  if (event.data && event.data.type === "ROUTE88_RUNTIME_IDENTITY" && event.ports[0]) {
    event.ports[0].postMessage(IDENTITY);
  }
});

function dataHeaders() {
  return {
    "Content-Type":"application/octet-stream",
    "Content-Length":String(DATA_BYTES),
    "Cache-Control":"no-store",
    "X-Route88-Build":BUILD_ID,
    "X-Route88-Data-SHA256":DATA_SHA256
  };
}

function streamData(request) {
  const aborter = new AbortController();
  let reader = null, partIndex = 0, partRead = 0, totalRead = 0, cancelled = false;
  const abortFromRequest = () => aborter.abort();
  const cleanup = () => request.signal.removeEventListener("abort", abortFromRequest);
  request.signal.addEventListener("abort", abortFromRequest, {once:true});
  if (request.signal.aborted) aborter.abort();
  // Backpressure permits only one reader read per pull; never buffer whole parts,
  // concatenate ArrayBuffers, tee/cache the data response, or construct a Blob.
  const body = new ReadableStream({
    async pull(controller) {
      try {
        while (!cancelled) {
          if (!reader) {
            if (partIndex === PARTS.length) {
              if (totalRead !== DATA_BYTES) throw new Error("Route 88 runtime length mismatch.");
              cleanup(); controller.close(); return;
            }
            const part = PARTS[partIndex];
            const partUrl = new URL(part.relative, self.registration.scope);
            if (partUrl.origin !== DATA_URL.origin || !partUrl.href.startsWith(self.registration.scope)) {
              throw new Error("Route 88 runtime part is outside this site.");
            }
            const response = await fetch(partUrl.href, {
              method:"GET", mode:"same-origin", credentials:"same-origin",
              cache:"default", redirect:"error", signal:aborter.signal
            });
            if (!response.ok || !response.body) {
              throw new Error("Route 88 runtime part " + (partIndex + 1) + " is unavailable (HTTP " + response.status + ").");
            }
            reader = response.body.getReader(); partRead = 0;
          }
          const result = await reader.read();
          if (cancelled) return;
          if (result.done) {
            if (partRead !== PARTS[partIndex].bytes) {
              throw new Error("Route 88 runtime part " + (partIndex + 1) + " is incomplete.");
            }
            reader.releaseLock(); reader = null; partIndex += 1; continue;
          }
          partRead += result.value.byteLength;
          totalRead += result.value.byteLength;
          if (partRead > PARTS[partIndex].bytes || totalRead > DATA_BYTES) {
            throw new Error("Route 88 runtime part length exceeded its manifest.");
          }
          controller.enqueue(result.value); return;
        }
      } catch (error) {
        cleanup(); aborter.abort();
        if (reader) { reader.cancel(error).catch(() => {}); reader = null; }
        if (!cancelled) controller.error(error);
      }
    },
    async cancel(reason) {
      cancelled = true; cleanup(); aborter.abort();
      if (reader) { await reader.cancel(reason).catch(() => {}); reader = null; }
    }
  }, {highWaterMark:64 * 1024, size:chunk => chunk.byteLength});
  return new Response(body, {status:200, headers:dataHeaders()});
}

self.addEventListener("fetch", event => {
  const request = event.request, url = new URL(request.url);
  if (url.origin !== DATA_URL.origin || url.pathname !== DATA_URL.pathname) return;
  if (url.searchParams.get("v") !== DATA_SHA256) {
    event.respondWith(new Response("Route 88 runtime version mismatch. Reload this page.", {status:409, headers:{"Cache-Control":"no-store"}}));
    return;
  }
  if (request.headers.has("Range")) {
    event.respondWith(new Response(null, {status:416, headers:{"Content-Range":"bytes */" + DATA_BYTES,"Cache-Control":"no-store"}}));
    return;
  }
  if (request.method === "HEAD") {
    event.respondWith(new Response(null, {status:200, headers:dataHeaders()}));
  } else if (request.method === "GET") {
    event.respondWith(streamData(request));
  } else {
    event.respondWith(new Response("Method not allowed.", {status:405, headers:{"Allow":"GET, HEAD"}}));
  }
});
