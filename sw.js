// HOGAR — Service Worker
// Mecanismo de auto-actualización: cuando se publica una versión nueva del SW
// (cambiando CACHE_VERSION), el SW antiguo se reemplaza inmediatamente vía
// skipWaiting + clients.claim, y el index.html dispara un reload al detectar
// el evento 'updatefound'.

const CACHE_VERSION = 'hogar-v2026-06-02-1';

self.addEventListener('install', (event) => {
  // Activar la versión nueva de inmediato sin esperar a que se cierren las pestañas
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      // Tomar control inmediato de todos los clientes (pestañas abiertas)
      .then(() => self.clients.claim())
  );
});

// Sin fetch handler: el SW solo sirve como mecanismo de versionado/auto-update.
// No interceptamos requests para no afectar el flujo de auth ni los videos.
