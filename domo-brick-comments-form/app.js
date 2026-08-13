var domo = window.domo;
var datasets = window.datasets;

// Dataset asignado en el botón de la esquina inferior izquierda del brick.
// Debe ser el dataset YA UNIDO (resultado del ETL que hace join entre el
// dataset de datos primarios y el dataset/colección de comentarios), para
// que la tabla muestre SKU + Categoría + último comentario guardado.
var datasetId = datasets[0];

// ---------- Configuración: ajusta estos nombres a los de tu dataset unido ----------

var FIELD_SKU = 'sku';
var FIELD_CATEGORIA = 'categoria';
var FIELD_ISSUE = 'issue';               // último issue guardado (viene del ETL)
var FIELD_COMENTARIO = 'comentarios';    // último comentario guardado (viene del ETL)
var FIELD_FECHA = 'fecha_guardado';      // fecha del último comentario (viene del ETL)

// Columnas extra de "datos primarios" que quieras mostrar en la tabla
// además de SKU/Categoría/Issue/Comentario/Fecha. Ejemplo:
// var EXTRA_COLUMNS = [{ field: 'descripcion', label: 'Descripción' }];
var EXTRA_COLUMNS = [];

// Opciones del desplegable de Issue. Ajusta esta lista a tu catálogo real.
var ISSUE_OPTIONS = [
  'Calidad',
  'Cantidad / Faltante',
  'Empaque dañado',
  'Etiquetado incorrecto',
  'Precio incorrecto',
  'Disponibilidad',
  'Otro'
];

// ---------- Configuración de AppDB (colección de comentarios) ----------

// Nombre de la colección AppDB. Si no existe, la app la crea sola la
// primera vez que corre (ver ensureCollection). Cada documento guardado
// es un COMENTARIO NUEVO (no se sobreescribe el anterior), así se guarda
// un historial completo por SKU.
var COLLECTION_NAME = 'comentarios_sku';
var COLLECTION_BASE = '/domo/datastores/v1/collections/' + COLLECTION_NAME;
var COLLECTION_DOCS = COLLECTION_BASE + '/documents';

var PAGE_SIZE = 5000;
var MAX_PAGES = 200;

var searchInput = document.getElementById('searchInput');
var btnRefrescar = document.getElementById('btnRefrescar');
var statusMsg = document.getElementById('statusMsg');
var loadingEl = document.getElementById('loading');
var dataTable = document.getElementById('dataTable');
var rowCountHint = document.getElementById('rowCountHint');

var sidePanel = document.getElementById('sidePanel');
var panelEmpty = document.getElementById('panelEmpty');
var panelContent = document.getElementById('panelContent');
var btnCerrarPanel = document.getElementById('btnCerrarPanel');
var formSku = document.getElementById('formSku');
var formCategoria = document.getElementById('formCategoria');
var formIssue = document.getElementById('formIssue');
var formComentario = document.getElementById('formComentario');
var formStatus = document.getElementById('formStatus');
var btnGuardar = document.getElementById('btnGuardar');
var historyList = document.getElementById('historyList');

var lastAllRows = [];      // filas tal como vienen del dataset unido
var currentSelectedSku = null;
var collectionReady = false;

// Comentarios guardados en esta sesión que aún no se reflejan en el
// dataset unido (el ETL corre en un horario, no al instante). Se usan
// para que la tabla se vea actualizada de inmediato tras guardar.
// Forma: { sku: { issue, comentario, fecha (Date) } }
var commentOverrides = {};

init();

function init() {
  renderIssueOptions();
  btnRefrescar.addEventListener('click', loadData);
  searchInput.addEventListener('input', renderTable);
  btnCerrarPanel.addEventListener('click', closePanel);
  btnGuardar.addEventListener('click', onGuardarClick);

  ensureCollection(function () {
    collectionReady = true;
  });

  loadData();
}

// ---------- Cargar y pintar la tabla (dataset unido por el ETL) ----------

function loadData() {
  setStatus('');
  showLoading(true);
  closePanel();

  var fields = [FIELD_SKU, FIELD_CATEGORIA, FIELD_ISSUE, FIELD_COMENTARIO, FIELD_FECHA]
    .concat(EXTRA_COLUMNS.map(function (c) { return c.field; }));

  fetchAllRows(fields, function (rows) {
    lastAllRows = rows;
    showLoading(false);
    renderTable();
  }, function (err) {
    logError('Error cargando el dataset', err);
    setStatus('No se pudo cargar el dataset. ' + describeError(err));
    showLoading(false);
  });
}

function fetchAllRows(fields, onDone, onError) {
  var collected = [];
  var offset = 0;
  var page = 0;

  function fetchPage() {
    page += 1;
    if (page > MAX_PAGES) {
      onError(new Error('Se alcanzó el máximo de páginas (' + MAX_PAGES + ') sin terminar de leer los datos.'));
      return;
    }

    var query = '/data/v1/' + datasetId +
      '?fields=' + fields.join() +
      '&orderby=' + FIELD_SKU +
      '&limit=' + PAGE_SIZE +
      '&offset=' + offset;

    domo.get(query)
      .then(function (data) {
        data = data || [];
        collected = collected.concat(data);
        if (data.length < PAGE_SIZE) {
          onDone(collected);
        } else {
          offset += PAGE_SIZE;
          fetchPage();
        }
      })
      .catch(onError);
  }

  fetchPage();
}

// Junta lo que viene del dataset con overrides locales más recientes
// (comentarios guardados en esta sesión que el ETL todavía no reflejó).
function effectiveRowValue(row) {
  var sku = row[FIELD_SKU];
  var override = commentOverrides[sku];

  var base = {
    sku: sku,
    categoria: row[FIELD_CATEGORIA],
    issue: row[FIELD_ISSUE],
    comentario: row[FIELD_COMENTARIO],
    fecha: row[FIELD_FECHA]
  };

  if (!override) return base;

  var datasetFecha = row[FIELD_FECHA] ? new Date(row[FIELD_FECHA]) : null;
  // Si el dataset ya trae una fecha igual o más nueva que el override,
  // el ETL ya se puso al día: se descarta el override.
  if (datasetFecha && datasetFecha >= override.fecha) {
    delete commentOverrides[sku];
    return base;
  }

  return {
    sku: sku,
    categoria: row[FIELD_CATEGORIA],
    issue: override.issue,
    comentario: override.comentario,
    fecha: override.fecha.toISOString()
  };
}

function renderTable() {
  var thead = dataTable.querySelector('thead');
  var tbody = dataTable.querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  var headers = ['SKU', 'Categoría'].concat(EXTRA_COLUMNS.map(function (c) { return c.label; })).concat(['Issue', 'Comentario', 'Fecha']);
  var headerRow = document.createElement('tr');
  headers.forEach(function (text) {
    var th = document.createElement('th');
    th.textContent = text;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  var term = (searchInput.value || '').trim().toLowerCase();
  var filtered = lastAllRows.filter(function (row) {
    if (!term) return true;
    var sku = String(row[FIELD_SKU] || '').toLowerCase();
    var categoria = String(row[FIELD_CATEGORIA] || '').toLowerCase();
    return sku.indexOf(term) !== -1 || categoria.indexOf(term) !== -1;
  });

  rowCountHint.textContent = filtered.length.toLocaleString('es-MX') + ' registros';

  if (filtered.length === 0) {
    var emptyRow = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = headers.length;
    td.className = 'empty-cell';
    td.textContent = 'Sin datos para la búsqueda actual.';
    emptyRow.appendChild(td);
    tbody.appendChild(emptyRow);
    return;
  }

  filtered.forEach(function (row) {
    var values = effectiveRowValue(row);
    var tr = document.createElement('tr');
    tr.dataset.sku = values.sku;

    var cells = [values.sku, values.categoria];
    EXTRA_COLUMNS.forEach(function (c) { cells.push(row[c.field]); });
    cells.push(values.issue || '');
    cells.push(values.comentario || '');
    cells.push(formatFecha(values.fecha));

    cells.forEach(function (value) {
      var tdEl = document.createElement('td');
      tdEl.textContent = value === null || value === undefined ? '' : value;
      tr.appendChild(tdEl);
    });

    tr.addEventListener('click', function () {
      Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function (r) {
        r.classList.remove('selected-row');
      });
      tr.classList.add('selected-row');
      openPanelFor(values.sku, values.categoria);
    });

    if (values.sku === currentSelectedSku) tr.classList.add('selected-row');

    tbody.appendChild(tr);
  });
}

function formatFecha(value) {
  if (!value) return '';
  var d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  var day = ('0' + d.getDate()).slice(-2);
  var month = ('0' + (d.getMonth() + 1)).slice(-2);
  var hh = ('0' + d.getHours()).slice(-2);
  var mm = ('0' + d.getMinutes()).slice(-2);
  return day + '/' + month + '/' + d.getFullYear() + ' ' + hh + ':' + mm;
}

// ---------- Panel lateral: formulario + historial ----------

function renderIssueOptions() {
  ISSUE_OPTIONS.forEach(function (value) {
    var opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    formIssue.appendChild(opt);
  });
}

function openPanelFor(sku, categoria) {
  currentSelectedSku = sku;
  panelEmpty.style.display = 'none';
  panelContent.style.display = 'block';

  formSku.value = sku || '';
  formCategoria.value = categoria || '';
  formIssue.value = '';
  formComentario.value = '';
  setFormStatus('');

  loadHistory(sku);
}

function closePanel() {
  currentSelectedSku = null;
  panelEmpty.style.display = 'block';
  panelContent.style.display = 'none';
  Array.prototype.forEach.call(dataTable.querySelectorAll('tbody tr'), function (r) {
    r.classList.remove('selected-row');
  });
}

function loadHistory(sku) {
  historyList.innerHTML = '<span class="hint">Cargando historial...</span>';

  fetchCommentsForSku(sku, function (docs) {
    renderHistory(docs);
  }, function (err) {
    logError('Error cargando historial', err);
    historyList.innerHTML = '<span class="hint">No se pudo cargar el historial.</span>';
  });
}

function renderHistory(docs) {
  var entries = (docs || []).map(function (doc) {
    return doc.content || doc;
  });

  entries.sort(function (a, b) {
    return new Date(b.fecha_guardado || 0) - new Date(a.fecha_guardado || 0);
  });

  historyList.innerHTML = '';

  if (entries.length === 0) {
    historyList.innerHTML = '<span class="hint">Sin comentarios previos.</span>';
    return;
  }

  entries.forEach(function (entry) {
    var item = document.createElement('div');
    item.className = 'history-item';

    var meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.textContent = (entry.issue || '') + ' · ' + formatFecha(entry.fecha_guardado);
    item.appendChild(meta);

    var text = document.createElement('div');
    text.className = 'history-text';
    text.textContent = entry.comentarios || '';
    item.appendChild(text);

    historyList.appendChild(item);
  });
}

function onGuardarClick() {
  var sku = formSku.value;
  var categoria = formCategoria.value;
  var issue = formIssue.value;
  var comentario = formComentario.value.trim();

  if (!issue) {
    setFormStatus('Selecciona un issue.');
    return;
  }
  if (!comentario) {
    setFormStatus('Escribe un comentario.');
    return;
  }

  btnGuardar.disabled = true;
  setFormStatus('Guardando...');

  var fechaGuardado = new Date();

  saveComment({
    sku: sku,
    categoria: categoria,
    issue: issue,
    comentarios: comentario,
    fecha_guardado: fechaGuardado.toISOString()
  }, function () {
    commentOverrides[sku] = {
      issue: issue,
      comentario: comentario,
      fecha: fechaGuardado
    };

    formComentario.value = '';
    formIssue.value = '';
    setFormStatus('Comentario guardado.');
    btnGuardar.disabled = false;

    renderTable();
    loadHistory(sku);
  }, function (err) {
    logError('Error guardando comentario', err);
    setFormStatus('No se pudo guardar. ' + describeError(err));
    btnGuardar.disabled = false;
  });
}

// ---------- AppDB: colección de comentarios ----------

// Verifica que la colección exista; si no, la crea con el esquema
// necesario para que Domo también genere el dataset espejo que se usa
// en el ETL de join. Si la colección ya existe esto es un no-op.
function ensureCollection(onReady) {
  domo.get(COLLECTION_BASE)
    .then(function () {
      onReady();
    })
    .catch(function () {
      var schema = {
        name: COLLECTION_NAME,
        schema: {
          columns: [
            { name: 'sku', type: 'STRING' },
            { name: 'categoria', type: 'STRING' },
            { name: 'issue', type: 'STRING' },
            { name: 'comentarios', type: 'STRING' },
            { name: 'fecha_guardado', type: 'DATETIME' }
          ]
        }
      };

      domo.post('/domo/datastores/v1/collections', schema)
        .then(function () { onReady(); })
        .catch(function (err) {
          logError('No se pudo verificar/crear la colección AppDB "' + COLLECTION_NAME + '"', err);
          onReady();
        });
    });
}

function saveComment(content, onDone, onError) {
  domo.post(COLLECTION_DOCS, { content: content })
    .then(onDone)
    .catch(onError);
}

// Intenta filtrar por SKU en el servidor; si el endpoint de query no está
// disponible o cambia de forma, cae en traer todos los documentos y
// filtrar en el navegador (la colección de comentarios es chica comparada
// con el dataset primario, así que esto es aceptable).
function fetchCommentsForSku(sku, onDone, onError) {
  var queryBody = { query: "sku = '" + String(sku).replace(/'/g, "''") + "'" };

  domo.post(COLLECTION_DOCS + '/query', queryBody)
    .then(function (docs) { onDone(docs || []); })
    .catch(function () {
      fetchAllDocuments(function (allDocs) {
        onDone(allDocs.filter(function (doc) {
          var content = doc.content || doc;
          return content.sku === sku;
        }));
      }, onError);
    });
}

function fetchAllDocuments(onDone, onError) {
  var collected = [];
  var limit = 500;
  var offset = 0;

  function page() {
    domo.get(COLLECTION_DOCS + '?limit=' + limit + '&offset=' + offset)
      .then(function (docs) {
        docs = docs || [];
        collected = collected.concat(docs);
        if (docs.length < limit) {
          onDone(collected);
        } else {
          offset += limit;
          page();
        }
      })
      .catch(onError);
  }

  page();
}

// ---------- Utilidades ----------

function describeError(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err.status) return 'HTTP ' + err.status + (err.statusText ? ' ' + err.statusText : '');
  if (err.message) return err.message;
  try {
    return JSON.stringify(err);
  } catch (e) {
    return String(err);
  }
}

function logError(context, err) {
  console.error(context, err);
  if (err && typeof err.text === 'function') {
    err.text().then(function (body) {
      console.error(context + ' - respuesta del servidor:', body);
    }).catch(function () {});
  }
}

function setStatus(msg) {
  statusMsg.textContent = msg || '';
}

function setFormStatus(msg) {
  formStatus.textContent = msg || '';
}

function showLoading(show) {
  loadingEl.style.display = show ? 'block' : 'none';
}
