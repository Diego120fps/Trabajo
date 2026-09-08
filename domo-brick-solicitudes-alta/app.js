var domo = window.domo;

// Este brick SOLO crea solicitudes y muestra su estatus de solo lectura.
// No tiene botones de Asignar/Release: esa capacidad vive en el brick
// "domo-brick-solicitudes-almacen", publicado en otra página de DOMO
// compartida únicamente al grupo de almacén. La separación real de
// responsabilidades la da el permiso de página de DOMO, no el código.

var COLLECTION = 'solicitudes';
var DOCS_URL = '/domo/datastores/v1/collections/' + COLLECTION + '/documents';

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

init();

function init() {
  btnCrear.addEventListener('click', crearSolicitud);
  btnRefrescar.addEventListener('click', cargarSolicitudes);
  buscarInput.addEventListener('input', renderTable);

  ensureCollection()
    .then(cargarSolicitudes)
    .catch(function () {
      // La colección probablemente ya existe (409); igual intenta cargar.
      cargarSolicitudes();
    });
}

// Crea la colección de AppDB la primera vez que corre algún brick de esta
// familia. Si ya existe, DOMO responde con error; lo ignoramos.
function ensureCollection() {
  return domo
    .post('/domo/datastores/v1/collections', {
      name: COLLECTION,
      schema: {
        columns: [
          { name: 'folio', type: 'LONG' },
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
    folio: nextFolio(), // consecutivo visible al usuario en vez del id interno de AppDB
    solicitante: solicitante,
    item: item,
    linea: linea,
    cantidad: cantidad,
    fechaHoraInsert: new Date().toISOString(), // fecha y hora del insert, automática
    estatus: ESTATUS_INICIAL // automático, el usuario nunca lo captura
    // userPicking/fechaHoraPicking/userRelease/fechaHoraRelease los llena solo almacén, desde el otro brick
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

// Siguiente folio consecutivo, calculado a partir de la última lista cargada.
// Nota: si dos personas registran una solicitud al mismo tiempo antes de
// refrescar, podrían competir por el mismo folio; para el volumen de esta
// app es aceptable.
function nextFolio() {
  var max = 0;
  allDocs.forEach(function (doc) {
    var f = doc.content.folio;
    if (typeof f === 'number' && f > max) max = f;
  });
  return max + 1;
}

// ---------- CONSULTA (solo lectura, sin botones de acción) ----------
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
    emptyTd.colSpan = 7;
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

  tr.appendChild(cell(formatFolio(c.folio), 'numeric'));
  tr.appendChild(cell(c.solicitante));
  tr.appendChild(cell(c.item));
  tr.appendChild(cell(c.linea));
  tr.appendChild(cell(formatNumber(c.cantidad), 'numeric'));
  tr.appendChild(cell(formatDateTime(c.fechaHoraInsert)));
  tr.appendChild(cell(ESTATUS_LABELS[c.estatus] !== undefined ? ESTATUS_LABELS[c.estatus] : c.estatus));

  return tr;
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

function formatFolio(folio) {
  return typeof folio === 'number' ? String(folio).padStart(4, '0') : '';
}

function formatDateTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return d.toLocaleString('es-MX');
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
