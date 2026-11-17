importScripts('./db-helper.js');

var CACHE_STATIC_NAME = 'static-outbox-v2';
var ENDPOINT_API = 'https://jsonplaceholder.typicode.com/posts';
var TAG_SYNC = 'sync-reportes';

var STATIC_FILES = [
  './',
  './index.html',
  './styles.css',
  './db-helper.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  console.log('[SW] Instalando y precacheando App Shell...');
  event.waitUntil(
    caches
      .open(CACHE_STATIC_NAME)
      .then(function (cache) {
        return cache.addAll(STATIC_FILES);
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function (event) {
  console.log('[SW] Activando. Limpiando cachés antiguas...');
  event.waitUntil(
    caches
      .keys()
      .then(function (nombres) {
        var limpiezas = nombres.map(function (nombre) {
          if (nombre !== CACHE_STATIC_NAME) {
            console.log('[SW] Eliminando caché antigua:', nombre);
            return caches.delete(nombre);
          }
          return Promise.resolve(false);
        });
        return Promise.all(limpiezas);
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) {
        return cached;
      }

      return fetch(request)
        .then(function (response) {
          return response;
        })
        .catch(function () {
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return Promise.reject(new Error('Recurso no disponible offline'));
        });
    })
  );
});

function notificarClientesActualizacion() {
  return self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then(function (clientes) {
      clientes.forEach(function (cliente) {
        cliente.postMessage({
          tipo: 'OUTBOX_SINCRONIZADO',
          timestamp: Date.now()
        });
      });
    });
}

function sincronizarPendientesSW() {
  console.log('[SW-Sync] Barrido de transacciones pendientes...');

  return obtenerTodosLosRegistros().then(function (registros) {
    var pendientes = registros.filter(function (item) {
      return item.estado === 'pendiente';
    });

    if (pendientes.length === 0) {
      console.log('[SW-Sync] Cola limpia. Nada por sincronizar.');
      return;
    }

    console.log('[SW-Sync] Pendientes a reenviar:', pendientes.length);

    var envios = pendientes.map(function (item) {
      return fetch(ENDPOINT_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.titulo,
          body: item.descripcion
        })
      })
        .then(function (respuesta) {
          if (!respuesta.ok) {
            throw new Error(
              'Error HTTP ' + respuesta.status + ' al sincronizar ID ' + item.id
            );
          }
          return actualizarEstadoRegistro(item.id, 'sincronizado');
        })
        .then(function () {
          return { id: item.id, ok: true };
        })
        .catch(function (error) {
          console.error('[SW-Sync] Falló ID ' + item.id + ' (se conserva pendiente):', error);
          return { id: item.id, ok: false, error: error };
        });
    });

    return Promise.all(envios).then(function (resultados) {
      var exitos = resultados.filter(function (r) {
        return r.ok;
      });
      var fallos = resultados.filter(function (r) {
        return !r.ok;
      });

      console.log(
        '[SW-Sync] Resultado: ' + exitos.length + ' OK, ' + fallos.length + ' fallidos'
      );

      var aviso =
        exitos.length > 0
          ? notificarClientesActualizacion()
          : Promise.resolve();

      return aviso.then(function () {
        if (fallos.length > 0) {
          throw new Error(
            'Sincronización parcial: ' + fallos.length + ' pendiente(s) sin confirmar'
          );
        }
      });
    });
  });
}

self.addEventListener('sync', function (event) {
  console.log('[SW-Sync] Evento sync disparado con etiqueta:', event.tag);

  if (event.tag === TAG_SYNC) {
    event.waitUntil(
      sincronizarPendientesSW().catch(function (error) {
        console.error(
          '[SW-Sync] Falla en sincronización; el navegador puede reintentar:',
          error
        );
        throw error;
      })
    );
  }
});
