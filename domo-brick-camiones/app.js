var domo = window.domo;

// ============================================================
// AppDB: las 3 pestañas (Alta, Procesar Caja, Semáforo) viven en UN SOLO
// brick/app para compartir el mismo AppDB. AppDB en DOMO está aislado por
// app: si cada vista fuera un brick/app distinto, cada una tendría su
// propio almacén vacío aunque usen el mismo nombre de colección.
// ============================================================
var COLLECTION = 'camiones';
var DOCS_URL = '/domo/datastores/v1/collections/' + COLLECTION + '/documents';

var ESTATUS_LABELS = { 0: 'Pendiente', 1: 'Asignado', 2: 'Cerrado' };
var ESTATUS_PENDIENTE = 0;
var ESTATUS_ASIGNADO = 1;
var ESTATUS_CERRADO = 2;

// Umbrales del semáforo en minutos desde fechaHoraCreacion.
var AGING_AMARILLO_MIN = 30;
var AGING_ROJO_MIN = 45;

var AUTO_REFRESH_MS = 15000; // recarga AppDB cada 15s
var TIMER_TICK_MS = 1000;    // refresca los timers de las cards cada 1s

// ---------- DOM ----------
var tabBtnAlta = document.getElementById('tabBtnAlta');
var tabBtnCaja = document.getElementById('tabBtnCaja');
var tabBtnSemaforo = document.getElementById('tabBtnSemaforo');
var tabAlta = document.getElementById('tabAlta');
var tabCaja = document.getElementById('tabCaja');
var tabSemaforo = document.getElementById('tabSemaforo');

var statusMsg = document.getElementById('statusMsg');
var loadingEl = document.getElementById('loading');

var transportistaInput = document.getElementById('transportistaInput');
var placaInput = document.getElementById('placaInput');
var btnCrear = document.getElementById('btnCrear');
var btnRefrescarAlta = document.getElementById('btnRefrescarAlta');
var buscarAltaInput = document.getElementById('buscarAltaInput');
var mostrarCerradosAltaInput = document.getElementById('mostrarCerradosAltaInput');
var altaTbody = document.querySelector('#altaTable tbody');

var btnRefrescarCaja = document.getElementById('btnRefrescarCaja');
var buscarCajaInput = document.getElementById('buscarCajaInput');
var mostrarCerradosCajaInput = document.getElementById('mostrarCerradosCajaInput');
var cajaTbody = document.querySelector('#cajaTable tbody');

var buscarSemaforoInput = document.getElementById('buscarSemaforoInput');
var semaforoCardsEl = document.getElementById('semaforoCards');
var semaforoEmptyEl = document.getElementById('semaforoEmpty');

// ---------- Estado ----------
var allDocs = []; // última lista de camiones traída de AppDB: [{id, content: {...}}, ...]

// Fila donde se está capturando el valor de Rampa/Dock al Asignar.
var actionMode = null;

// doc.id -> elemento del timer dentro de su card, para refrescarlo cada
// segundo sin tener que reconstruir todas las cards.
var timerElements = {};

init();

function init() {
  tabBtnAlta.addEventListener('click', function () { switchTab('alta'); });
  tabBtnCaja.addEventListener('click', function () { switchTab('caja'); });
  tabBtnSemaforo.addEventListener('click', function () { switchTab('semaforo'); });

  btnCrear.addEventListener('click', crearCamion);
  btnRefrescarAlta.addEventListener('click', cargarCamiones);
  buscarAltaInput.addEventListener('input', renderAltaTable);
  mostrarCerradosAltaInput.addEventListener('change', renderAltaTable);

  btnRefrescarCaja.addEventListener('click', cargarCamiones);
  buscarCajaInput.addEventListener('input', renderCajaTable);
  mostrarCerradosCajaInput.addEventListener('change', renderCajaTable);

  buscarSemaforoInput.addEventListener('input', renderSemaforoCards);

  ensureCollection()
    .then(cargarCamiones)
    .catch(function (err) {
      showStatus('Error inicializando: ' + describeError(err));
    });

  setInterval(cargarCamiones, AUTO_REFRESH_MS);
  setInterval(tickTimers, TIMER_TICK_MS);
}

function switchTab(tab) {
  tabAlta.style.display = tab === 'alta' ? '' : 'none';
  tabCaja.style.display = tab === 'caja' ? '' : 'none';
  tabSemaforo.style.display = tab === 'semaforo' ? '' : 'none';
  tabBtnAlta.classList.toggle('active', tab === 'alta');
  tabBtnCaja.classList.toggle('active', tab === 'caja');
  tabBtnSemaforo.classList.toggle('active', tab === 'semaforo');
  if (tab === 'semaforo') renderSemaforoCards();
}

// ---------- Colección AppDB ----------
function ensureCollection() {
  return domo
    .post('/domo/datastores/v1/collections', {
      name: COLLECTION,
      schema: {
        columns: [
          { name: 'folio', type: 'LONG' },
          { name: 'transportista', type: 'STRING' },
          { name: 'placa', type: 'STRING' },
          { name: 'rampaDock', type: 'STRING' },
          { name: 'fechaHoraCreacion', type: 'DATETIME' },
          { name: 'estatus', type: 'LONG' },
          { name: 'fechaHoraCierre', type: 'DATETIME' }
        ]
      }
    })
    .catch(function () { return null; });
}

// ---------- ALTA ----------
function crearCamion() {
  var transportista = transportistaInput.value.trim();
  var placa = placaInput.value.trim();

  if (!transportista || !placa) {
    showStatus('Completa Nombre transportista y Placa / No. Económico.');
    return;
  }

  var content = {
    folio: nextFolio(),
    transportista: transportista,
    placa: placa,
    rampaDock: '',
    fechaHoraCreacion: new Date().toISOString(),
    estatus: ESTATUS_PENDIENTE
  };

  setLoading(true);
  showStatus('');
  domo
    .post(DOCS_URL, { content: content })
    .then(function () {
      transportistaInput.value = '';
      placaInput.value = '';
      return cargarCamiones();
    })
    .catch(function (err) {
      showStatus('No se pudo registrar el camión: ' + describeError(err));
    })
    .then(function () {
      setLoading(false);
    });
}

function nextFolio() {
  var max = 0;
  allDocs.forEach(function (doc) {
    var f = doc.content.folio;
    if (typeof f === 'number' && f > max) max = f;
  });
  return max + 1;
}

// ---------- CONSULTA ----------
function cargarCamiones() {
  setLoading(true);
  showStatus('');
  return domo
    .get(DOCS_URL + '?limit=1000&offset=0')
    .then(function (docs) {
      allDocs = (docs || []).slice().sort(function (a, b) {
        return new Date(b.content.fechaHoraCreacion) - new Date(a.content.fechaHoraCreacion);
      });
      renderAltaTable();
      renderCajaTable();
      renderSemaforoCards();
    })
    .catch(function (err) {
      showStatus('No se pudo cargar la lista: ' + describeError(err));
    })
    .then(function () {
      setLoading(false);
    });
}

// ---------- Tabla de Alta (solo lectura) ----------
function renderAltaTable() {
  var filtro = buscarAltaInput.value.trim().toLowerCase();
  var mostrarCerrados = mostrarCerradosAltaInput.checked;
  var rows = filtrarDocs(allDocs, filtro, mostrarCerrados);

  altaTbody.innerHTML = '';

  if (rows.length === 0) {
    altaTbody.appendChild(emptyRow(7));
    return;
  }

  rows.forEach(function (doc) {
    var c = doc.content;
    var tr = document.createElement('tr');
    tr.appendChild(cell(formatFolio(c.folio), 'numeric'));
    tr.appendChild(cell(c.transportista));
    tr.appendChild(cell(c.placa));
    tr.appendChild(cell(c.rampaDock));
    tr.appendChild(cell(formatDateTime(c.fechaHoraCreacion)));
    tr.appendChild(cell(estatusLabel(c.estatus)));
    tr.appendChild(cell(formatDateTime(c.fechaHoraCierre)));
    altaTbody.appendChild(tr);
  });
}

// ---------- Tabla de Procesar Caja (Asignar / Cerrar) ----------
function renderCajaTable() {
  var filtro = buscarCajaInput.value.trim().toLowerCase();
  var mostrarCerrados = mostrarCerradosCajaInput.checked;
  var rows = filtrarDocs(allDocs, filtro, mostrarCerrados);

  cajaTbody.innerHTML = '';

  if (rows.length === 0) {
    cajaTbody.appendChild(emptyRow(8));
    return;
  }

  rows.forEach(function (doc) {
    var c = doc.content;
    var tr = document.createElement('tr');
    tr.appendChild(cell(formatFolio(c.folio), 'numeric'));
    tr.appendChild(cell(c.transportista));
    tr.appendChild(cell(c.placa));
    tr.appendChild(cell(c.rampaDock));
    tr.appendChild(cell(formatDateTime(c.fechaHoraCreacion)));
    tr.appendChild(cell(estatusLabel(c.estatus)));
    tr.appendChild(cell(formatDateTime(c.fechaHoraCierre)));
    tr.appendChild(buildAccionCell(doc));
    cajaTbody.appendChild(tr);
  });
}

function filtrarDocs(docs, filtro, mostrarCerrados) {
  return docs.filter(function (doc) {
    var c = doc.content;
    if (!mostrarCerrados && c.estatus === ESTATUS_CERRADO) return false;
    if (!filtro) return true;
    return (
      (c.transportista || '').toLowerCase().indexOf(filtro) !== -1 ||
      (c.placa || '').toLowerCase().indexOf(filtro) !== -1
    );
  });
}

// Un solo botón visible a la vez: Asignar (estatus Pendiente), luego Cerrar
// (estatus Asignado); una vez Cerrado no queda ninguna acción.
function buildAccionCell(doc) {
  var c = doc.content;
  var td = document.createElement('td');

  if (actionMode && actionMode.id === doc.id) {
    td.appendChild(
      buildInlineCapture('Rampa / Dock', actionMode.valorInicial, function (valor) {
        confirmarAsignar(doc, valor);
      })
    );
    return td;
  }

  if (c.estatus === ESTATUS_PENDIENTE) {
    var btnAsignar = document.createElement('button');
    btnAsignar.className = 'small';
    btnAsignar.textContent = 'Asignar';
    btnAsignar.addEventListener('click', function () {
      actionMode = { id: doc.id, valorInicial: '' };
      renderCajaTable();
    });
    td.appendChild(btnAsignar);
    return td;
  }

  if (c.estatus === ESTATUS_ASIGNADO) {
    var btnCerrar = document.createElement('button');
    btnCerrar.className = 'small';
    btnCerrar.textContent = 'Cerrar';
    btnCerrar.addEventListener('click', function () {
      confirmarCerrar(doc);
    });
    td.appendChild(btnCerrar);
    return td;
  }

  return td;
}

function confirmarAsignar(doc, rampaDock) {
  if (!rampaDock) {
    showStatus('Ingresa la Rampa / Dock.');
    return;
  }
  var content = Object.assign({}, doc.content, {
    rampaDock: rampaDock,
    estatus: ESTATUS_ASIGNADO
  });
  guardarCambios(doc.id, content);
}

function confirmarCerrar(doc) {
  var content = Object.assign({}, doc.content, {
    fechaHoraCierre: new Date().toISOString(),
    estatus: ESTATUS_CERRADO
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
      return cargarCamiones();
    })
    .catch(function (err) {
      showStatus('No se pudo actualizar: ' + describeError(err));
    })
    .then(function () {
      setLoading(false);
    });
}

function buildInlineCapture(placeholder, valorInicial, onConfirm) {
  var wrapper = document.createElement('div');
  wrapper.className = 'inline-action';

  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.value = valorInicial || '';

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
    renderCajaTable();
  });

  wrapper.appendChild(input);
  wrapper.appendChild(btnConfirmar);
  wrapper.appendChild(btnCancelar);
  return wrapper;
}

// ---------- SEMÁFORO: un card por registro abierto, con timer ----------
function renderSemaforoCards() {
  var filtro = buscarSemaforoInput.value.trim().toLowerCase();

  var abiertos = allDocs
    .filter(function (doc) {
      var c = doc.content;
      if (c.estatus === ESTATUS_CERRADO) return false;
      if (!filtro) return true;
      return (
        (c.transportista || '').toLowerCase().indexOf(filtro) !== -1 ||
        (c.placa || '').toLowerCase().indexOf(filtro) !== -1
      );
    })
    .sort(function (a, b) {
      return new Date(a.content.fechaHoraCreacion) - new Date(b.content.fechaHoraCreacion);
    });

  semaforoCardsEl.innerHTML = '';
  timerElements = {};

  semaforoEmptyEl.style.display = abiertos.length === 0 ? '' : 'none';

  abiertos.forEach(function (doc) {
    semaforoCardsEl.appendChild(buildTruckCard(doc));
  });

  tickTimers();
}

function buildTruckCard(doc) {
  var c = doc.content;
  var card = document.createElement('div');
  card.className = 'truck-card truck-card-' + nivelSemaforo(c);

  var titulo = document.createElement('div');
  titulo.className = 'truck-card-title';
  titulo.textContent = 'DOCK - ' + (c.rampaDock || 'Sin asignar');
  card.appendChild(titulo);

  var folio = document.createElement('div');
  folio.className = 'truck-card-folio';
  folio.textContent = 'Folio ' + formatFolio(c.folio);
  card.appendChild(folio);

  var transportista = document.createElement('div');
  transportista.className = 'truck-card-row';
  transportista.textContent = c.transportista;
  card.appendChild(transportista);

  var placa = document.createElement('div');
  placa.className = 'truck-card-row';
  placa.textContent = c.placa;
  card.appendChild(placa);

  var estatus = document.createElement('div');
  estatus.className = 'truck-card-badge';
  estatus.textContent = estatusLabel(c.estatus);
  card.appendChild(estatus);

  var timer = document.createElement('div');
  timer.className = 'truck-card-timer';
  timer.textContent = formatElapsed(elapsedSeconds(c));
  card.appendChild(timer);

  timerElements[doc.id] = { el: timer, content: c };

  return card;
}

function tickTimers() {
  Object.keys(timerElements).forEach(function (id) {
    var entry = timerElements[id];
    entry.el.textContent = formatElapsed(elapsedSeconds(entry.content));
  });
}

function elapsedSeconds(c) {
  var seg = (Date.now() - new Date(c.fechaHoraCreacion).getTime()) / 1000;
  return seg < 0 ? 0 : seg;
}

function nivelSemaforo(c) {
  var minutos = elapsedSeconds(c) / 60;
  if (minutos < AGING_AMARILLO_MIN) return 'verde';
  if (minutos < AGING_ROJO_MIN) return 'amarillo';
  return 'rojo';
}

function formatElapsed(totalSeconds) {
  var total = Math.floor(totalSeconds);
  var hh = Math.floor(total / 3600);
  var mm = Math.floor((total % 3600) / 60);
  var ss = total % 60;
  return [hh, mm, ss].map(function (n) { return String(n).padStart(2, '0'); }).join(':');
}

// ---------- Helpers ----------
function cell(text, cls) {
  var td = document.createElement('td');
  if (cls) td.className = cls;
  td.textContent = text === undefined || text === null ? '' : text;
  return td;
}

function emptyRow(colSpan) {
  var tr = document.createElement('tr');
  var td = document.createElement('td');
  td.colSpan = colSpan;
  td.className = 'empty-cell';
  td.textContent = 'Sin camiones para mostrar.';
  tr.appendChild(td);
  return tr;
}

function estatusLabel(estatus) {
  return ESTATUS_LABELS[estatus] !== undefined ? ESTATUS_LABELS[estatus] : estatus;
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
