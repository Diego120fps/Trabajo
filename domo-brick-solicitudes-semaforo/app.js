var domo = window.domo;

// Este brick es de SOLO LECTURA: mide el aging (tiempo que llevan abiertas)
// de las solicitudes y lo pinta como semáforo. No crea ni modifica nada.

var COLLECTION = 'solicitudes';
var DOCS_URL = '/domo/datastores/v1/collections/' + COLLECTION + '/documents';

var ESTATUS_LABELS = { 0: 'Pendiente', 1: 'En proceso', 2: 'Completado' };

// Umbrales del semáforo en minutos desde fechaHoraInsert (o el tiempo de
// respuesta ya congelado si la solicitud fue liberada). Ajusta según tu SLA.
var AGING_AMARILLO_MIN = 30;
var AGING_ROJO_MIN = 60;

// Refresco automático para que el aging se mantenga al día si el brick
// se deja abierto en un monitor/wallboard.
var AUTO_REFRESH_MS = 60000;

var btnRefrescar = document.getElementById('btnRefrescar');
var buscarInput = document.getElementById('buscarInput');
var mostrarCompletadasInput = document.getElementById('mostrarCompletadasInput');
var statusMsg = document.getElementById('statusMsg');
var loadingEl = document.getElementById('loading');
var tbody = document.querySelector('#solicitudesTable tbody');

var allDocs = [];

init();

function init() {
  btnRefrescar.addEventListener('click', cargarSolicitudes);
  buscarInput.addEventListener('input', renderTable);
  mostrarCompletadasInput.addEventListener('change', renderTable);
  cargarSolicitudes();
  setInterval(cargarSolicitudes, AUTO_REFRESH_MS);
}

function cargarSolicitudes() {
  setLoading(true);
  showStatus('');
  return domo
    .get(DOCS_URL + '?limit=1000&offset=0')
    .then(function (docs) {
      // Más urgente (más tiempo abierto) primero; ya liberadas al final si se muestran.
      allDocs = (docs || []).slice().sort(function (a, b) {
        var aCerrada = a.content.estatus === 2;
        var bCerrada = b.content.estatus === 2;
        if (aCerrada !== bCerrada) return aCerrada ? 1 : -1;
        return aging(b.content) - aging(a.content);
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
  var mostrarCompletadas = mostrarCompletadasInput.checked;

  var rows = allDocs.filter(function (doc) {
    var c = doc.content;
    if (!mostrarCompletadas && c.estatus === 2) return false;
    if (!filtro) return true;
    return (
      (c.solicitante || '').toLowerCase().indexOf(filtro) !== -1 ||
      (c.item || '').toLowerCase().indexOf(filtro) !== -1
    );
  });

  tbody.innerHTML = '';

  if (rows.length === 0) {
    var emptyTr = document.createElement('tr');
    var emptyTd = document.createElement('td');
    emptyTd.colSpan = 10;
    emptyTd.className = 'empty-cell';
    emptyTd.textContent = 'Sin solicitudes para mostrar.';
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

  tr.appendChild(buildSemaforoCell(c));
  tr.appendChild(cell(formatFolio(c.folio), 'numeric'));
  tr.appendChild(cell(c.solicitante));
  tr.appendChild(cell(c.item));
  tr.appendChild(cell(c.linea));
  tr.appendChild(cell(formatNumber(c.cantidad), 'numeric'));
  tr.appendChild(cell(ESTATUS_LABELS[c.estatus] !== undefined ? ESTATUS_LABELS[c.estatus] : c.estatus));
  tr.appendChild(cell(c.userPicking));
  tr.appendChild(cell(c.userRelease));
  tr.appendChild(cell(formatTiempo(c)));

  return tr;
}

// Segundos transcurridos: si ya se liberó, el tiempo de respuesta congelado;
// si sigue abierta, lo que lleva desde el insert hasta ahora.
function aging(c) {
  if (typeof c.tiempoRespuestaSegundos === 'number') return c.tiempoRespuestaSegundos;
  return (Date.now() - new Date(c.fechaHoraInsert).getTime()) / 1000;
}

function nivelSemaforo(c) {
  var minutos = aging(c) / 60;
  if (minutos < AGING_AMARILLO_MIN) return 'verde';
  if (minutos < AGING_ROJO_MIN) return 'amarillo';
  return 'rojo';
}

function buildSemaforoCell(c) {
  var td = document.createElement('td');
  var dot = document.createElement('span');
  dot.className = 'semaforo-dot semaforo-' + nivelSemaforo(c);
  td.appendChild(dot);
  return td;
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

function formatTiempo(c) {
  var segundos = aging(c);
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
