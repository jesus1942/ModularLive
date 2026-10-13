const CACHE_NAME = "modular-live-v16";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./calculator.js",
  "./manifest.webmanifest",
  "./assets/favicon-32.png",
  "./assets/favicon.png",
  "./assets/apple-touch-icon.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-512.png",
  "./assets/logo-isotipo.png",
  "./assets/logo-completo-oscuro.png",
  "./footer.css",
  "./cad.html",
  "./cad/cad.css",
  "./cad/app.js",
  "./cad/store.js",
  "./cad/model.js",
  "./cad/geometry.js",
  "./cad/catalog.js",
  "./cad/generator.js",
  "./cad/bom.js",
  "./cad/plan-editor.js",
  "./cad/viewer3d.js",
  "./cad/stairs.js",
  "./cad/stair-build.js",
  "./cad/data/stair-rules.js",
  "./cad/engineering/units.js",
  "./cad/engineering/data/materials.js",
  "./cad/engineering/data/locations.js",
  "./cad/engineering/data/reglamentos.js",
  "./cad/engineering/load-geometry.js",
  "./cad/engineering/wind.js",
  "./cad/engineering/snow.js",
  "./cad/engineering/seismic.js",
  "./cad/engineering/combinations.js",
  "./cad/engineering/settings.js",
  "./cad/engineering/keys.js",
  "./cad/engineering/loads.js",
  "./cad/engineering/engine.js",
  "./cad/engineering/panel.js",
  "./vendor/three/three.module.min.js",
  "./vendor/three/OrbitControls.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return networkResponse;
      });
    })
  );
});
