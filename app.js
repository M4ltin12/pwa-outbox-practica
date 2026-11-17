var ENDPOINT_API = 'https://jsonplaceholder.typicode.com/posts';
var TAG_SYNC = 'sync-reportes';
var syncFallbackEnCurso = false;
var forzarFallbackOutbox = false;
var formIncidencia = document.getElementById('form-incidencia');
var inputTitulo = document.getElementById('titulo');
var inputDescripcion = document.getElementById('descripcion');
var badgeRed = document.getElementById('badge-red');
var listaOutbox = document.getElementById('lista-outbox');
var btnPurgar = document.getElementById('btn-purgar');
var btnEnviar = document.getElementById('btn-enviar');
var mensajeEstado = document.getElementById('mensaje-estado');

function soportaBackgroundSync() {
  return 'serviceWorker' in navigator && 'SyncManager' in window;
}

function debeUsarFallbackUI() {
  if (forzarFallbackOutbox) {
    return true;
  }
  return !soportaBackgroundSync();
}

function mostrarMensaje(texto, tipo) {
  if (!mensajeEstado) {
    return;
  }
  mensajeEstado.hidden = !texto;
  mensajeEstado.textContent = texto || '';
  mensajeEstado.classList.remove('error', 'aviso');
  if (tipo === 'error') {
    mensajeEstado.classList.add('error');
  } else if (tipo === 'aviso') {
    mensajeEstado.classList.add('aviso');
  }
}

function actualizarIndicadorRed() {
  var enLinea = navigator.onLine;
  badgeRed.textContent = enLinea ? 'Conectado' : 'Sin conexión';
  badgeRed.classList.toggle('online', enLinea);
  badgeRed.classList.toggle('offline', !enLinea);
}

function etiquetaEstado(estado) {
  if (estado === 'pendiente') {
    return 'Pendiente';
  }
  if (estado === 'sincronizado') {
    return 'Sincronizado';
  }
  return estado || '';
}

function formatearFecha(epochMs) {
  if (!epochMs) {
    return 'Sin fecha';
  }
  try {
    return new Date(epochMs).toLocaleString('es-MX', {
      dateStyle: 'short',
      timeStyle: 'medium'
    });
  } catch (e) {
    return String(epochMs);
  }
}

function renderizarColaOutbox() {
  return obtenerTodosLosRegistros()
    .then(function (registros) {
      while (listaOutbox.firstChild) {
        listaOutbox.removeChild(listaOutbox.firstChild);
      }

      if (!registros || registros.length === 0) {
        var vacio = document.createElement('li');
        vacio.className = 'lista-vacia';
        vacio.textContent = 'Todavía no hay reportes.';
        listaOutbox.appendChild(vacio);
        return;
      }

      registros
        .slice()
        .sort(function (a, b) {
          return (b.fechaCreacion || 0) - (a.fechaCreacion || 0);
        })
        .forEach(function (item) {
          var li = document.createElement('li');

          var titulo = document.createElement('p');
          titulo.className = 'item-titulo';
          titulo.textContent = item.titulo || '(Sin título)';

          var meta = document.createElement('p');
          meta.className = 'item-meta';

          var estado = document.createElement('span');
          estado.className = 'estado ' + (item.estado || '');
          estado.textContent = etiquetaEstado(item.estado);

          var fecha = document.createElement('span');
          fecha.textContent = formatearFecha(item.fechaCreacion);

          meta.appendChild(estado);
          meta.appendChild(fecha);

          li.appendChild(titulo);
          li.appendChild(meta);
          listaOutbox.appendChild(li);
        });
    })
    .catch(function (error) {
      console.error('[UI] Error al leer IndexedDB:', error);
      mostrarMensaje('No se pudieron cargar los reportes.', 'error');
    });
}

function registrarSyncReportes() {
  if (!soportaBackgroundSync()) {
    forzarFallbackOutbox = true;
    console.log(
      '[Outbox] Sin SyncManager. El pendiente quedará para fallback online/reapertura.'
    );
    return Promise.resolve(false);
  }

  return navigator.serviceWorker.ready
    .then(function (registration) {
      if (!registration.sync) {
        forzarFallbackOutbox = true;
        console.warn('[Outbox] registration.sync no disponible. Activando fallback.');
        return false;
      }
      console.log('[Outbox] Registrando etiqueta sync-reportes...');
      return registration.sync.register(TAG_SYNC).then(function () {
        forzarFallbackOutbox = false;
        console.log('[Outbox] Etiqueta sync-reportes registrada.');
        return true;
      });
    })
    .catch(function (error) {
      forzarFallbackOutbox = true;
      console.warn(
        '[Outbox] No se pudo registrar Background Sync. Pendiente conservado; fallback activo.',
        error
      );
      return false;
    });
}

function procesarEnvioReporte(titulo, descripcion) {
  var cuerpoApi = {
    title: titulo,
    body: descripcion
  };

  return fetch(ENDPOINT_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpoApi)
  })
    .then(function (respuesta) {
      if (!respuesta.ok) {
        return {
          exitoHttp: false,
          motivo: 'HTTP ' + respuesta.status
        };
      }
      return respuesta.json().then(
        function () {
          return { exitoHttp: true };
        },
        function () {
          return { exitoHttp: true };
        }
      );
    })
    .then(
      function (resultado) {
        return resultado;
      },
      function (errorRed) {
        return {
          exitoHttp: false,
          motivo: errorRed && errorRed.message ? errorRed.message : 'red'
        };
      }
    )
    .then(function (resultadoHttp) {
      var registro = {
        titulo: titulo,
        descripcion: descripcion,
        estado: resultadoHttp.exitoHttp ? 'sincronizado' : 'pendiente',
        fechaCreacion: Date.now()
      };

      if (resultadoHttp.exitoHttp) {
        registro.fechaSincronizacion = Date.now();
      }

      return guardarRegistro(registro)
        .then(function (id) {
          if (resultadoHttp.exitoHttp) {
            mostrarMensaje('Reporte guardado.', 'ok');
            return id;
          }

          console.warn(
            '[Outbox] Envío fallido (' +
              resultadoHttp.motivo +
              '). Encolado como pendiente ID ' +
              id
          );
          mostrarMensaje(
            'Sin conexión. El reporte quedó guardado en este dispositivo.',
            'aviso'
          );

          return registrarSyncReportes().then(function (syncOk) {
            if (!syncOk && navigator.onLine) {
              return sincronizarPendientesFallback().then(function () {
                return id;
              });
            }
            return id;
          });
        })
        .catch(function (errorBd) {
          console.error('[Outbox] Error de IndexedDB (no es fallo de red):', errorBd);
          mostrarMensaje('No se pudo guardar el reporte.', 'error');
          throw errorBd;
        });
    })
    .then(function () {
      return renderizarColaOutbox();
    });
}

function sincronizarPendientesFallback() {
  if (!debeUsarFallbackUI()) {
    console.log(
      '[Outbox] SyncManager operativo: el reenvío lo hace el Service Worker.'
    );
    return Promise.resolve();
  }

  if (syncFallbackEnCurso) {
    console.log('[Outbox] Fallback ya en curso; se omite reentrada.');
    return Promise.resolve();
  }

  syncFallbackEnCurso = true;
  console.log('[Outbox] Fallback: buscando pendientes...');

  return obtenerTodosLosRegistros()
    .then(function (registros) {
      var pendientes = registros.filter(function (item) {
        return item.estado === 'pendiente';
      });

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay pendientes.');
        return { ok: 0, fail: 0 };
      }

      mostrarMensaje('Enviando reportes pendientes...', 'ok');

      var envios = pendientes.map(function (item) {
        return fetch(ENDPOINT_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: item.titulo,
            body: item.descripcion
          })
        })
          .then(function (res) {
            if (!res.ok) {
              throw new Error(
                'Falla al reintentar envío ID ' + item.id + ' (HTTP ' + res.status + ')'
              );
            }
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          })
          .then(function () {
            return { id: item.id, ok: true };
          })
          .catch(function (error) {
            console.error('[Outbox] Pendiente ID ' + item.id + ' no sincronizado:', error);
            return { id: item.id, ok: false, error: error };
          });
      });

      return Promise.all(envios).then(function (resultados) {
        var ok = 0;
        var fail = 0;
        resultados.forEach(function (r) {
          if (r.ok) {
            ok += 1;
          } else {
            fail += 1;
          }
        });
        return { ok: ok, fail: fail };
      });
    })
    .then(function (resumen) {
      if (resumen && resumen.fail > 0) {
        mostrarMensaje(
          'No se pudo enviar el reporte. Se intentará de nuevo.',
          'aviso'
        );
      } else if (resumen && resumen.ok > 0) {
        mostrarMensaje('Los reportes se enviaron correctamente.', 'ok');
      }
      return renderizarColaOutbox();
    })
    .catch(function (error) {
      console.error('[Outbox] Error en sincronización fallback:', error);
      mostrarMensaje(
        'No se pudo enviar el reporte. Se intentará de nuevo.',
        'aviso'
      );
      return renderizarColaOutbox();
    })
    .then(
      function () {
        syncFallbackEnCurso = false;
      },
      function (err) {
        syncFallbackEnCurso = false;
        throw err;
      }
    );
}

function purgarSincronizados() {
  return obtenerTodosLosRegistros()
    .then(function (registros) {
      var sincronizados = registros.filter(function (item) {
        return item.estado === 'sincronizado';
      });

      if (sincronizados.length === 0) {
        mostrarMensaje('No hay enviados para eliminar.', 'aviso');
        return;
      }

      var borrados = sincronizados.map(function (item) {
        return eliminarRegistro(item.id);
      });

      return Promise.all(borrados).then(function () {
        mostrarMensaje('Enviados eliminados.', 'ok');
      });
    })
    .then(function () {
      return renderizarColaOutbox();
    })
    .catch(function (error) {
      console.error('[UI] Error al purgar:', error);
      mostrarMensaje('No se pudo eliminar.', 'error');
    });
}

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[UI] Este navegador no soporta Service Worker.');
    return Promise.resolve(null);
  }

  return navigator.serviceWorker
    .register('./sw.js')
    .then(function (registration) {
      console.log('[UI] Service Worker registrado. Scope:', registration.scope);
      return registration;
    })
    .catch(function (error) {
      console.error('[UI] Falló el registro del Service Worker:', error);
      return null;
    });
}

function inicializarEscuchaMensajesSW() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  navigator.serviceWorker.addEventListener('message', function (event) {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log(
        '[UI] Confirmación del SW (OUTBOX_SINCRONIZADO). Actualizando bandeja...'
      );
      mostrarMensaje('Los reportes se enviaron correctamente.', 'ok');
      renderizarColaOutbox();
    }
  });
}

formIncidencia.addEventListener('submit', function (event) {
  event.preventDefault();

  var titulo = (inputTitulo.value || '').trim();
  var descripcion = (inputDescripcion.value || '').trim();

  if (!titulo || !descripcion) {
    mostrarMensaje('Escribe un título y una descripción.', 'aviso');
    return;
  }

  btnEnviar.disabled = true;

  procesarEnvioReporte(titulo, descripcion)
    .then(function () {
      formIncidencia.reset();
      inputTitulo.focus();
    })
    .catch(function () {
    })
    .then(function () {
      btnEnviar.disabled = false;
    });
});

btnPurgar.addEventListener('click', function () {
  btnPurgar.disabled = true;
  purgarSincronizados().then(function () {
    btnPurgar.disabled = false;
  });
});

window.addEventListener('online', function () {
  actualizarIndicadorRed();
  if (debeUsarFallbackUI()) {
    console.log(
      '[Outbox] Fallback por evento online (sin SyncManager o register fallido)...'
    );
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', function () {
  actualizarIndicadorRed();
});

actualizarIndicadorRed();
inicializarEscuchaMensajesSW();

function recuperarPendientesAlIniciar() {
  if (!navigator.onLine) {
    return Promise.resolve();
  }

  return obtenerTodosLosRegistros().then(function (registros) {
    var pendientes = registros.filter(function (item) {
      return item.estado === 'pendiente';
    });

    if (pendientes.length === 0) {
      return;
    }

    if (soportaBackgroundSync() && !forzarFallbackOutbox) {
      console.log(
        '[Outbox] Hay pendientes al iniciar. Re-registrando sync-reportes...'
      );
      return registrarSyncReportes().then(function (syncOk) {
        if (!syncOk) {
          console.log('[Outbox] Register falló al iniciar. Ejecutando fallback...');
          return sincronizarPendientesFallback();
        }
      });
    }

    console.log('[Outbox] Hay pendientes al iniciar. Ejecutando fallback...');
    return sincronizarPendientesFallback();
  });
}

registrarServiceWorker()
  .then(function () {
    return renderizarColaOutbox();
  })
  .then(function () {
    return recuperarPendientesAlIniciar();
  })
  .catch(function (error) {
    console.error('[UI] Error en arranque:', error);
  });
