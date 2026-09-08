var domo = window.domo;

// Colección de AppDB donde se guarda cada solicitud (una fila = un documento).
// AppDB asigna un "id" único e inmutable a cada documento: ese es nuestro ID de fila.
var COLLECTION = 'solicitudes';
var DOCS_URL = '/domo/datastores/v1/collections/' + COLLECTION + '/documents';

// Estatus: 0 = Pendiente (valor automático al crear, nunca lo captura el usuario).
var ESTATUS_LABELS = { 0: 'Pendiente', 1: 'En proceso', 2: 'Completado' };
var ESTATUS_INICIAL = 0;

var solicitanteInput = document.getElementById('solicitanteInput');
var itemInput = document.getElementById('itemInput');
var cantidadInput = document.getElementById('cantidadInput');
var btnCrear = document.getElementById('btnCrear');
var btnRefrescar = document.getElementById('btnRefrescar');
var buscarInput = document.getElementById('buscarInput');
var statusMsg = document.getElementById('statusMsg');
var loadingEl = document.getElementById('loading');
var tbody = document.querySelector('#solicitudesTable tbody');

var allDocs = []; // última lista traída de AppDB, formato [{id, content: {...}}, ...]
var editingId = null; // id de la fila actualmente en modo edición (Actualización)

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
          { name: 'cantidad', type: 'DOUBLE' },
          { name: 'fechaHoraInsert', type: 'DATETIME' },
          { name: 'estatus', type: 'LONG' },
          { name: 'fechaHoraActualizacion', type: 'DATETIME' },
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
  var cantidadRaw = cantidadInput.value.trim();

  if (!solicitante || !item || cantidadRaw === '') {
    showStatus('Completa Quien solicita, Item y Cantidad.');
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
    cantidad: cantidad,
    fechaHoraInsert: new Date().toISOString(), // fecha y hora del insert, automática
    estatus: ESTATUS_INICIAL // automático, el usuario nunca lo captura
  };

  setLoading(true);
  showStatus('');
  domo
    .post(DOCS_URL, { content: content })
    .then(function () {
      solicitanteInput.value = '';
      itemInput.value = '';
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
    emptyTd.colSpan = 8;
    emptyTd.className = 'empty-cell';
    emptyTd.textContent = 'Sin solicitudes registradas.';
    emptyTr.appendChild(emptyTd);
    tbody.appendChild(emptyTr);
    return;
  }

  rows.forEach(function (doc) {
    tbody.appendChild(doc.id === editingId ? buildEditRow(doc) : buildReadRow(doc));
  });
}

function buildReadRow(doc) {
  var c = doc.content;
  var tr = document.createElement('tr');

  tr.appendChild(cell(doc.id));
  tr.appendChild(cell(c.solicitante));
  tr.appendChild(cell(c.item));
  tr.appendChild(cell(formatNumber(c.cantidad), 'numeric'));
  tr.appendChild(cell(formatDateTime(c.fechaHoraInsert)));
  tr.appendChild(cell(ESTATUS_LABELS[c.estatus] !== undefined ? ESTATUS_LABELS[c.estatus] : c.estatus));
  tr.appendChild(cell(formatTiempoRespuesta(c)));

  var accionesTd = document.createElement('td');
  var btnEditar = document.createElement('button');
  btnEditar.className = 'secondary small';
  btnEditar.textContent = 'Actualizar';
  btnEditar.addEventListener('click', function () {
    editingId = doc.id;
    renderTable();
  });
  accionesTd.appendChild(btnEditar);
  tr.appendChild(accionesTd);

  return tr;
}

// ---------- ACTUALIZACIÓN ----------
function buildEditRow(doc) {
  var c = doc.content;
  var tr = document.createElement('tr');

  tr.appendChild(cell(doc.id));

  var solicitanteTd = document.createElement('td');
  var solicitanteEdit = document.createElement('input');
  solicitanteEdit.type = 'text';
  solicitanteEdit.value = c.solicitante;
  solicitanteTd.appendChild(solicitanteEdit);
  tr.appendChild(solicitanteTd);

  var itemTd = document.createElement('td');
  var itemEdit = document.createElement('input');
  itemEdit.type = 'text';
  itemEdit.value = c.item;
  itemTd.appendChild(itemEdit);
  tr.appendChild(itemTd);

  var cantidadTd = document.createElement('td');
  var cantidadEdit = document.createElement('input');
  cantidadEdit.type = 'number';
  cantidadEdit.step = 'any';
  cantidadEdit.value = c.cantidad;
  cantidadTd.appendChild(cantidadEdit);
  tr.appendChild(cantidadTd);

  tr.appendChild(cell(formatDateTime(c.fechaHoraInsert)));

  var estatusTd = document.createElement('td');
  var estatusSelect = document.createElement('select');
  Object.keys(ESTATUS_LABELS).forEach(function (key) {
    var opt = document.createElement('option');
    opt.value = key;
    opt.textContent = ESTATUS_LABELS[key];
    if (Number(key) === c.estatus) opt.selected = true;
    estatusSelect.appendChild(opt);
  });
  estatusTd.appendChild(estatusSelect);
  tr.appendChild(estatusTd);

  tr.appendChild(cell(formatTiempoRespuesta(c)));

  var accionesTd = document.createElement('td');
  var btnGuardar = document.createElement('button');
  btnGuardar.className = 'small';
  btnGuardar.textContent = 'Guardar';
  btnGuardar.addEventListener('click', function () {
    guardarActualizacion(doc, {
      solicitante: solicitanteEdit.value.trim(),
      item: itemEdit.value.trim(),
      cantidad: Number(cantidadEdit.value),
      estatus: Number(estatusSelect.value)
    });
  });
  var btnCancelar = document.createElement('button');
  btnCancelar.className = 'secondary small';
  btnCancelar.textContent = 'Cancelar';
  btnCancelar.addEventListener('click', function () {
    editingId = null;
    renderTable();
  });
  accionesTd.appendChild(btnGuardar);
  accionesTd.appendChild(btnCancelar);
  tr.appendChild(accionesTd);

  return tr;
}

function guardarActualizacion(doc, cambios) {
  if (!cambios.solicitante || !cambios.item || isNaN(cambios.cantidad)) {
    showStatus('Revisa Quien solicita, Item y Cantidad.');
    return;
  }

  var ahora = new Date();
  var tiempoRespuestaSegundos = (ahora.getTime() - new Date(doc.content.fechaHoraInsert).getTime()) / 1000;

  var content = Object.assign({}, doc.content, cambios, {
    fechaHoraActualizacion: ahora.toISOString(),
    tiempoRespuestaSegundos: tiempoRespuestaSegundos
  });

  setLoading(true);
  showStatus('');
  domo
    .put(DOCS_URL + '/' + doc.id, { content: content })
    .then(function () {
      editingId = null;
      return cargarSolicitudes();
    })
    .catch(function (err) {
      showStatus('No se pudo actualizar: ' + describeError(err));
    })
    .then(function () {
      setLoading(false);
    });
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

// Si ya se actualizó, muestra el tiempo de respuesta guardado (fijo).
// Si sigue Pendiente, muestra el tiempo transcurrido desde el insert hasta ahora.
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
