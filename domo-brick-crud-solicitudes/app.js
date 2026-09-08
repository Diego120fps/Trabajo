var domo = window.domo;

// Colección de AppDB donde se guarda cada solicitud (una fila = un documento).
// AppDB asigna un "id" único e inmutable a cada documento: ese es nuestro ID de fila.
var COLLECTION = 'solicitudes';
var DOCS_URL = '/domo/datastores/v1/collections/' + COLLECTION + '/documents';

// Estatus: 0 Pendiente (automático al crear) -> 1 En proceso (al Asignar) -> 2 Completado (al Release).
var ESTATUS_LABELS = { 0: 'Pendiente', 1: 'En proceso', 2: 'Completado' };
var ESTATUS_INICIAL = 0;

var solicitanteInput = document.getElementById('solicitanteInput');
var itemInput = document.getElementById('itemInput');
var lineaInput = document.getElementById('lineaInput');
var cantidadInput = document.getElementById('cantidadInput');
var btnCrear = document.getElementById('btnCrear');
var btnRefrescar = document.getElementById('btnRefrescar');
var buscarInput = document.getElementById('buscarInput');
var statusMsg = document.getElementById('statusMsg');
var loadingEl = document.getElementById('loading');
var tbody = document.querySelector('#solicitudesTable tbody');

var allDocs = []; // última lista traída de AppDB, formato [{id, content: {...}}, ...]

// Fila donde se está capturando el usuario de Asignar o de Release ahora mismo.
// { id: <doc.id>, type: 'picking' | 'release' } o null si ninguna fila está en captura.
var actionMode = null;

init();

function init() {
  btnCrear.addEventListener('click', crearSolicitud);
  btnRefrescar.addEventListener('click', cargarSolicitudes);
  buscarInput.addEventListener('input', renderTable);

  ensureCollection()
    .then(cargarSolicitudes)
    .catch(function () {
      // La colección probablemente ya existe (409 en el primer arranque de otra sesión); igual intenta cargar.
      cargarSolicitudes();
    });
}

// Crea la colección de AppDB la primera vez que corre el brick. Si ya existe,
// DOMO responde con error (p.ej. 409); lo ignoramos porque el objetivo ya se cumplió.
function ensureCollection() {
  return domo
    .post('/domo/datastores/v1/collections', {
      name: COLLECTION,
      schema: {
        columns: [
          { name: 'solicitante', type: 'STRING' },
          { name: 'item', type: 'STRING' },
          { name: 'linea', type: 'STRING' },
          { name: 'cantidad', type: 'DOUBLE' },
          { name: 'fechaHoraInsert', type: 'DATETIME' },
          { name: 'estatus', type: 'LONG' },
          { name: 'userPicking', type: 'STRING' },
          { name: 'fechaHoraPicking', type: 'DATETIME' },
          { name: 'userRelease', type: 'STRING' },
          { name: 'fechaHoraRelease', type: 'DATETIME' },
          { name: 'tiempoRespuestaSegundos', type: 'DOUBLE' }
        ]
      }
    })
    .catch(function () {
      return null;
    });
}

// ---------- ALTA ----------
function crearSolicitud() {
  var solicitante = solicitanteInput.value.trim();
  var item = itemInput.value.trim();
  var linea = lineaInput.value.trim();
  var cantidadRaw = cantidadInput.value.trim();

  if (!solicitante || !item || !linea || cantidadRaw === '') {
    showStatus('Completa Quien solicita, Item, Línea y Cantidad.');
    return;
  }
  var cantidad = Number(cantidadRaw);
  if (isNaN(cantidad)) {
    showStatus('Cantidad debe ser numérica.');
    return;
  }

  var content = {
    solicitante: solicitante,
    item: item,
    linea: linea,
    cantidad: cantidad,
    fechaHoraInsert: new Date().toISOString(), // fecha y hora del insert, automática
    estatus: ESTATUS_INICIAL // automático, el usuario nunca lo captura
    // userPicking/fechaHoraPicking/userRelease/fechaHoraRelease se llenan con los botones Asignar/Release
  };

  setLoading(true);
  showStatus('');
  domo
    .post(DOCS_URL, { content: content })
    .then(function () {
      solicitanteInput.value = '';
      itemInput.value = '';
      lineaInput.value = '';
      cantidadInput.value = '';
      return cargarSolicitudes();
    })
    .catch(function (err) {
      showStatus('No se pudo crear la solicitud: ' + describeError(err));
    })
    .then(function () {
      setLoading(false);
    });
}

// ---------- CONSULTA ----------
function cargarSolicitudes() {
  setLoading(true);
  showStatus('');
  return domo
    .get(DOCS_URL + '?limit=1000&offset=0')
    .then(function (docs) {
      allDocs = (docs || []).slice().sort(function (a, b) {
        return new Date(b.content.fechaHoraInsert) - new Date(a.content.fechaHoraInsert);
      });
      renderTable();
    })
    .catch(function (err) {
      showStatus('No se pudo cargar la lista: ' + describeError(err));
    })
    .then(function () {
      setLoading(false);
    });
}

function renderTable() {
  var filtro = buscarInput.value.trim().toLowerCase();
  var rows = allDocs.filter(function (doc) {
    if (!filtro) return true;
    var c = doc.content;
    return (
      (c.solicitante || '').toLowerCase().indexOf(filtro) !== -1 ||
      (c.item || '').toLowerCase().indexOf(filtro) !== -1
    );
  });

  tbody.innerHTML = '';

  if (rows.length === 0) {
    var emptyTr = document.createElement('tr');
    var emptyTd = document.createElement('td');
    emptyTd.colSpan = 12;
    emptyTd.className = 'empty-cell';
    emptyTd.textContent = 'Sin solicitudes registradas.';
    emptyTr.appendChild(emptyTd);
    tbody.appendChild(emptyTr);
    return;
  }

  rows.forEach(function (doc) {
    tbody.appendChild(buildRow(doc));
  });
}

function buildRow(doc) {
  var c = doc.content;
  var tr = document.createElement('tr');

  tr.appendChild(cell(doc.id));
  tr.appendChild(cell(c.solicitante));
  tr.appendChild(cell(c.item));
  tr.appendChild(cell(c.linea));
  tr.appendChild(cell(formatNumber(c.cantidad), 'numeric'));
  tr.appendChild(cell(formatDateTime(c.fechaHoraInsert)));
  tr.appendChild(cell(ESTATUS_LABELS[c.estatus] !== undefined ? ESTATUS_LABELS[c.estatus] : c.estatus));
  tr.appendChild(buildPickingCell(doc));
  tr.appendChild(cell(formatDateTime(c.fechaHoraPicking)));
  tr.appendChild(buildReleaseCell(doc));
  tr.appendChild(cell(formatDateTime(c.fechaHoraRelease)));
  tr.appendChild(cell(formatTiempoRespuesta(c)));

  return tr;
}

// ---------- ACTUALIZACIÓN: Asignar (Picking) ----------
function buildPickingCell(doc) {
  var c = doc.content;
  var td = document.createElement('td');

  if (actionMode && actionMode.id === doc.id && actionMode.type === 'picking') {
    td.appendChild(buildInlineCapture('Usuario que asigna', function (valor) {
      confirmarPicking(doc, valor);
    }));
    return td;
  }

  if (c.userPicking) {
    td.textContent = c.userPicking;
    return td;
  }

  // Solo Pendiente (sin picking todavía) muestra el botón Asignar.
  if (c.estatus === 0) {
    var btnAsignar = document.createElement('button');
    btnAsignar.className = 'small';
    btnAsignar.textContent = 'Asignar';
    btnAsignar.addEventListener('click', function () {
      actionMode = { id: doc.id, type: 'picking' };
      renderTable();
    });
    td.appendChild(btnAsignar);
  }

  return td;
}

function confirmarPicking(doc, userPicking) {
  if (!userPicking) {
    showStatus('Ingresa el usuario que asigna.');
    return;
  }
  var content = Object.assign({}, doc.content, {
    userPicking: userPicking,
    fechaHoraPicking: new Date().toISOString(),
    estatus: 1
  });
  guardarCambios(doc.id, content);
}

// ---------- ACTUALIZACIÓN: Release ----------
function buildReleaseCell(doc) {
  var c = doc.content;
  var td = document.createElement('td');

  if (actionMode && actionMode.id === doc.id && actionMode.type === 'release') {
    td.appendChild(buildInlineCapture('Usuario que libera', function (valor) {
      confirmarRelease(doc, valor);
    }));
    return td;
  }

  if (c.userRelease) {
    td.textContent = c.userRelease;
    return td;
  }

  // El botón Release solo aparece una vez que ya se asignó el Picking (estatus En proceso).
  if (c.estatus === 1) {
    var btnRelease = document.createElement('button');
    btnRelease.className = 'small';
    btnRelease.textContent = 'Release';
    btnRelease.addEventListener('click', function () {
      actionMode = { id: doc.id, type: 'release' };
      renderTable();
    });
    td.appendChild(btnRelease);
  }

  return td;
}

function confirmarRelease(doc, userRelease) {
  if (!userRelease) {
    showStatus('Ingresa el usuario que libera.');
    return;
  }
  var ahora = new Date();
  var tiempoRespuestaSegundos = (ahora.getTime() - new Date(doc.content.fechaHoraInsert).getTime()) / 1000;
  var content = Object.assign({}, doc.content, {
    userRelease: userRelease,
    fechaHoraRelease: ahora.toISOString(),
    estatus: 2,
    tiempoRespuestaSegundos: tiempoRespuestaSegundos
  });
  guardarCambios(doc.id, content);
}

function guardarCambios(docId, content) {
  setLoading(true);
  showStatus('');
  domo
    .put(DOCS_URL + '/' + docId, { content: content })
    .then(function () {
      actionMode = null;
      return cargarSolicitudes();
    })
    .catch(function (err) {
      showStatus('No se pudo actualizar: ' + describeError(err));
    })
    .then(function () {
      setLoading(false);
    });
}

// Input + Confirmar/Cancelar en línea, usado tanto para Asignar como para Release.
function buildInlineCapture(placeholder, onConfirm) {
  var wrapper = document.createElement('div');
  wrapper.className = 'inline-action';

  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;

  var btnConfirmar = document.createElement('button');
  btnConfirmar.className = 'small';
  btnConfirmar.textContent = 'Confirmar';
  btnConfirmar.addEventListener('click', function () {
    onConfirm(input.value.trim());
  });

  var btnCancelar = document.createElement('button');
  btnCancelar.className = 'secondary small';
  btnCancelar.textContent = 'Cancelar';
  btnCancelar.addEventListener('click', function () {
    actionMode = null;
    renderTable();
  });

  wrapper.appendChild(input);
  wrapper.appendChild(btnConfirmar);
  wrapper.appendChild(btnCancelar);
  return wrapper;
}

// ---------- Helpers ----------
function cell(text, cls) {
  var td = document.createElement('td');
  if (cls) td.className = cls;
  td.textContent = text === undefined || text === null ? '' : text;
  return td;
}

function formatNumber(n) {
  return typeof n === 'number' ? n.toLocaleString('es-MX') : n;
}

function formatDateTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return d.toLocaleString('es-MX');
}

// Si ya se hizo Release, muestra el tiempo de respuesta guardado (fijo, insert -> release).
// Si aún no, muestra el tiempo transcurrido desde el insert hasta ahora.
function formatTiempoRespuesta(c) {
  var segundos;
  if (typeof c.tiempoRespuestaSegundos === 'number') {
    segundos = c.tiempoRespuestaSegundos;
  } else {
    segundos = (Date.now() - new Date(c.fechaHoraInsert).getTime()) / 1000;
  }
  if (segundos < 0) segundos = 0;

  var minutos = Math.floor(segundos / 60);
  var restoSeg = Math.round(segundos % 60);
  var etiqueta = minutos > 0 ? minutos + 'm ' + restoSeg + 's' : restoSeg + 's';
  return typeof c.tiempoRespuestaSegundos === 'number' ? etiqueta : etiqueta + ' (en curso)';
}

function describeError(err) {
  if (!err) return 'Error desconocido';
  if (typeof err === 'string') return err;
  return err.message || JSON.stringify(err);
}

function showStatus(msg) {
  statusMsg.textContent = msg || '';
}

function setLoading(isLoading) {
  loadingEl.style.display = isLoading ? 'block' : 'none';
}
