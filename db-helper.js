var DB_NAME = 'pwa-outbox-db';
var DB_VERSION = 1;
var STORE_NAME = 'transacciones_pendientes';

function abrirDB() {
  return new Promise(function (resolve, reject) {
    var request = indexedDB.open(DB_NAME, DB_VERSION);
    var settled = false;

    request.onupgradeneeded = function (event) {
      var db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true
        });
      }
    };

    request.onsuccess = function (event) {
      if (settled) {
        return;
      }
      settled = true;
      resolve(event.target.result);
    };

    request.onerror = function (event) {
      if (settled) {
        return;
      }
      settled = true;
      reject(event.target.error);
    };

    request.onblocked = function () {
      console.warn('[IndexedDB] Apertura bloqueada. Cierra otras pestañas de la app.');
    };
  });
}

function guardarRegistro(datos) {
  return abrirDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var tx = db.transaction([STORE_NAME], 'readwrite');
      var store = tx.objectStore(STORE_NAME);
      var idGenerado;

      var req = store.add(datos);

      req.onsuccess = function (event) {
        idGenerado = event.target.result;
      };

      req.onerror = function (event) {
        if (settled) {
          return;
        }
        settled = true;
        reject(event.target.error);
      };

      tx.oncomplete = function () {
        if (settled) {
          return;
        }
        settled = true;
        db.close();
        resolve(idGenerado);
      };

      tx.onabort = function (event) {
        if (settled) {
          return;
        }
        settled = true;
        db.close();
        reject(event.target.error || new Error('Transacción abortada al guardar'));
      };

      tx.onerror = function (event) {
        if (settled) {
          return;
        }
        settled = true;
        db.close();
        reject(event.target.error);
      };
    });
  });
}

function obtenerTodosLosRegistros() {
  return abrirDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var tx = db.transaction([STORE_NAME], 'readonly');
      var store = tx.objectStore(STORE_NAME);
      var req = store.getAll();
      var resultado;

      req.onsuccess = function (event) {
        resultado = event.target.result;
      };

      req.onerror = function (event) {
        if (settled) {
          return;
        }
        settled = true;
        reject(event.target.error);
      };

      tx.oncomplete = function () {
        if (settled) {
          return;
        }
        settled = true;
        db.close();
        resolve(resultado || []);
      };

      tx.onabort = function (event) {
        if (settled) {
          return;
        }
        settled = true;
        db.close();
        reject(event.target.error || new Error('Transacción abortada al leer'));
      };

      tx.onerror = function (event) {
        if (settled) {
          return;
        }
        settled = true;
        db.close();
        reject(event.target.error);
      };
    });
  });
}

function eliminarRegistro(id) {
  return abrirDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var tx = db.transaction([STORE_NAME], 'readwrite');
      var store = tx.objectStore(STORE_NAME);

      store.delete(id);

      tx.oncomplete = function () {
        if (settled) {
          return;
        }
        settled = true;
        db.close();
        resolve(true);
      };

      tx.onabort = function (event) {
        if (settled) {
          return;
        }
        settled = true;
        db.close();
        reject(event.target.error || new Error('Transacción abortada al eliminar'));
      };

      tx.onerror = function (event) {
        if (settled) {
          return;
        }
        settled = true;
        db.close();
        reject(event.target.error);
      };
    });
  });
}

function actualizarEstadoRegistro(id, nuevoEstado) {
  return abrirDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var tx = db.transaction([STORE_NAME], 'readwrite');
      var store = tx.objectStore(STORE_NAME);
      var reqGet = store.get(id);

      reqGet.onsuccess = function (event) {
        var registro = event.target.result;
        if (!registro) {
          if (!settled) {
            settled = true;
            reject(new Error('No se encontró el registro con ID: ' + id));
          }
          try {
            tx.abort();
          } catch (e) {
          }
          return;
        }

        registro.estado = nuevoEstado;
        if (nuevoEstado === 'sincronizado') {
          registro.fechaSincronizacion = Date.now();
        }
        store.put(registro);
      };

      reqGet.onerror = function (event) {
        if (settled) {
          return;
        }
        settled = true;
        reject(event.target.error);
      };

      tx.oncomplete = function () {
        if (settled) {
          return;
        }
        settled = true;
        db.close();
        resolve(true);
      };

      tx.onabort = function (event) {
        if (settled) {
          return;
        }
        settled = true;
        db.close();
        reject(event.target.error || new Error('Transacción abortada al actualizar'));
      };

      tx.onerror = function (event) {
        if (settled) {
          return;
        }
        settled = true;
        db.close();
        reject(event.target.error);
      };
    });
  });
}
