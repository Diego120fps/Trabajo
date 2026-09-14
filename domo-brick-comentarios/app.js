var domo = window.domo;
var datasets = window.datasets;

// Dataset ETL seleccionado en el botón de la esquina inferior izquierda del brick.
var datasetId = datasets[0];

// Campo que identifica de forma única cada fila, tanto en el dataset ETL
// como en AppDB. Ajusta aquí el nombre exacto si tu dataset usa otro alias
// (ej. 'SKU' en vez de 'sku').
var FIELD_KEY = 'sku';

// ============================================================
// AppDB: colección propia de este brick. Guarda TODOS los campos del ETL
// más "comentarios" (el único campo editable a mano). En cada sincronización
// se sobreescriben los campos del ETL y se conserva el comentario existente.
// ============================================================
var COLLECTION = 'comentarios_etl';
var DOCS_URL = '/domo/datastores/v1/collections/' + COLLECTION + '/documents';
var COMENTARIOS_FIELD = 'comentarios';

// "Issue" es el otro campo editable a mano: un select de catálogo cerrado
// (no texto libre), igual que comentarios se conserva entre sincronizaciones.
var ISSUE_FIELD = 'issue';
var ISSUE_OPTIONS = ['Designed Changed', 'Shortage', 'In Development'];

// "Observaciones" también es una columna que NO viene tal cual del ETL,
// pero a diferencia de Comentarios/Issue no la captura una persona: se
// recalcula en cada sincronización a partir de los campos del ETL (ver
// calcularObservaciones más abajo), así que siempre refleja los valores
// más recientes del dataset.
var OBSERVACIONES_FIELD = 'observaciones';

// Campos editables a mano que NUNCA vienen del ETL: se excluyen de las
// columnas dinámicas y de la comparación de cambios del merge, y se
// conservan tal cual entre sincronizaciones.
var EDITABLE_FIELDS = [COMENTARIOS_FIELD, ISSUE_FIELD];

// Todos los campos que no vienen directamente del ETL (editables +
// calculados): se excluyen de la comparación "¿cambió esta fila?" del merge,
// porque compararlos contra el dataset crudo no tendría sentido.
var NON_ETL_FIELDS = EDITABLE_FIELDS.concat([OBSERVACIONES_FIELD]);

// Columnas del ETL a mostrar, en este orden exacto. El dataset ya viene
// agrupado por sku (el ETL hace el SUM/max, no este brick): estos son los
// nombres reales de columna tal como están en el dataset, sin el envoltorio
// "SUM(...)"/"max(...)" que solo describía cómo se habían calculado. Si el
// ETL agrega/quita columnas que no estén en esta lista, se siguen guardando
// en AppDB (el merge copia todos los campos del ETL) pero no se muestran en
// la tabla; ajusta este arreglo si cambia lo que quieres ver.
var DISPLAY_COLUMNS = [
  'sku',
  'CustomerFinal',
  'CategoriaFinal',
  'Motors',
  'ITEM_DESC',
  'TotalBackOrder',
  'TotalCurrentMonth',
  'Total30Days',
  'PastDue',
  'QtyDallas',
  'QtyonHandJDE',
  'QtyInTransit',
  'QtyWO',
  'QtyWON',
  'CostopenOrder',
  'CostPastdue',
  'CostPastDueDallas',
  'CostPastDueInTransit',
  'CostPastDueGDL'
];

// Paginación al leer el dataset ETL (Data API) y AppDB.
var ETL_PAGE_SIZE = 5000;
var ETL_MAX_PAGES = 500; // tope de seguridad: hasta 2.5M filas
var APPDB_PAGE_SIZE = 1000;
var APPDB_MAX_PAGES = 500;

// Cuántas altas/bajas/cambios de AppDB se mandan en paralelo durante un
// merge (AppDB no tiene endpoint de batch: es una llamada HTTP por documento).
var MERGE_CONCURRENCY = 8;

// Reintenta la sincronización sola cada 5 min por si el ETL cambió mientras
// el brick estaba abierto; además corre al cargar y con el botón manual.
var AUTO_REFRESH_MS = 300000;

// ---------- DOM ----------
var buscarInput = document.getElementById('buscarInput');
var btnSincronizar = document.getElementById('btnSincronizar');
var lastSyncLabel = document.getElementById('lastSyncLabel');
var statusMsg = document.getElementById('statusMsg');
var loadingEl = document.getElementById('loading');
var dataTable = document.getElementById('dataTable');

// ---------- Estado ----------
var allDocs = []; // últimos documentos de AppDB tras la sincronización: [{id, content}, ...]
var editedComentarios = {}; // doc.id -> valor en edición (para no perderlo al re-renderizar)
var savingComentarios = {}; // doc.id -> true mientras se guarda ese comentario
var savingIssue = {}; // doc.id -> true mientras se guarda ese issue

init();

function init() {
  btnSincronizar.addEventListener('click', sincronizar);
  buscarInput.addEventListener('input', renderTable);

  if (!datasetId) {
    showStatus('Selecciona el dataset ETL en el brick (esquina inferior izquierda) y recarga.');
    return;
  }

  ensureCollection()
    .then(sincronizar)
    .catch(function (err) {
      showStatus('Error inicializando: ' + describeError(err));
    });

  setInterval(function () {
    if (datasetId) sincronizar();
  }, AUTO_REFRESH_MS);
}

function ensureCollection() {
  // El schema declara sku + comentarios como columnas tipadas; el resto de
  // los campos del ETL igual se guardan dentro de "content" aunque no estén
  // declarados aquí (AppDB no rechaza campos extra, solo no los tipa/indexa).
  // Si quieres que el explorador de AppDB muestre el resto de columnas con
  // su tipo, agrégalas a este arreglo.
  return domo
    .post('/domo/datastores/v1/collections', {
      name: COLLECTION,
      schema: {
        columns: [
          { name: FIELD_KEY, type: 'STRING' },
          { name: COMENTARIOS_FIELD, type: 'STRING' },
          { name: ISSUE_FIELD, type: 'STRING' },
          { name: OBSERVACIONES_FIELD, type: 'STRING' }
        ]
      }
    })
    .catch(function () { return null; });
}

// ---------- Sincronización (merge ETL -> AppDB) ----------
function sincronizar() {
  setLoading(true);
  showStatus('Leyendo dataset ETL...');

  return fetchAllEtlRows()
    .then(function (etlRows) {
      showStatus('Leyendo AppDB...');
      return fetchAllAppDbDocs().then(function (appDocs) {
        return aplicarMerge(etlRows, appDocs);
      });
    })
    .then(function () {
      return cargarDocsAppDb();
    })
    .then(function () {
      lastSyncLabel.textContent = 'Última sincronización: ' + new Date().toLocaleString('es-MX');
    })
    .catch(function (err) {
      showStatus('Error sincronizando: ' + describeError(err));
    })
    .then(function () {
      setLoading(false);
    });
}

function fetchAllEtlRows() {
  var collected = [];
  var offset = 0;
  var page = 0;

  function fetchPage() {
    page += 1;
    if (page > ETL_MAX_PAGES) {
      return Promise.reject(new Error('Se alcanzó el máximo de páginas (' + ETL_MAX_PAGES + ') leyendo el ETL.'));
    }

    // Sin "fields": se piden todas las columnas del dataset porque no
    // sabemos de antemano cuáles son (el ETL puede agregar/quitar columnas).
    // orderby fijo por la llave es indispensable para que offset/limit
    // recorra todo el dataset sin huecos ni repeticiones.
    var query = '/data/v1/' + datasetId +
      '?orderby=' + FIELD_KEY +
      '&limit=' + ETL_PAGE_SIZE +
      '&offset=' + offset;

    return domo.get(query).then(function (data) {
      data = data || [];
      collected = collected.concat(data);
      showStatus('Leyendo dataset ETL... (' + collected.length + ' filas hasta ahora)');

      if (data.length < ETL_PAGE_SIZE) return collected;
      offset += ETL_PAGE_SIZE;
      return fetchPage();
    });
  }

  return fetchPage();
}

function fetchAllAppDbDocs() {
  var collected = [];
  var offset = 0;
  var page = 0;

  function fetchPage() {
    page += 1;
    if (page > APPDB_MAX_PAGES) {
      return Promise.reject(new Error('Se alcanzó el máximo de páginas (' + APPDB_MAX_PAGES + ') leyendo AppDB.'));
    }

    return domo.get(DOCS_URL + '?limit=' + APPDB_PAGE_SIZE + '&offset=' + offset).then(function (docs) {
      docs = docs || [];
      collected = collected.concat(docs);

      if (docs.length < APPDB_PAGE_SIZE) return collected;
      offset += APPDB_PAGE_SIZE;
      return fetchPage();
    });
  }

  return fetchPage();
}

function aplicarMerge(etlRows, appDocs) {
  // Salvaguarda: si el ETL regresó 0 filas, lo más probable es un problema
  // temporal del dataset (no que el catálogo real esté vacío). No se borra
  // nada en ese caso para no perder todos los comentarios por accidente.
  if (etlRows.length === 0) {
    showStatus('El dataset ETL regresó 0 filas: no se aplicó ningún cambio en AppDB por seguridad.');
    return Promise.resolve();
  }

  var etlByKey = {};
  etlRows.forEach(function (row) {
    var key = normalizeKey(row[FIELD_KEY]);
    if (!key) return; // fila sin llave: no se puede sincronizar de forma confiable
    etlByKey[key] = row;
  });

  var appByKey = {};
  appDocs.forEach(function (doc) {
    var key = normalizeKey(doc.content[FIELD_KEY]);
    if (!key) return;
    appByKey[key] = doc;
  });

  var inserts = [];
  var updates = [];
  var deletes = [];

  Object.keys(etlByKey).forEach(function (key) {
    var etlRow = etlByKey[key];
    var doc = appByKey[key];
    if (!doc) {
      inserts.push(etlRow);
    } else if (etlRowChanged(etlRow, doc.content)) {
      updates.push({ doc: doc, etlRow: etlRow });
    }
  });

  Object.keys(appByKey).forEach(function (key) {
    if (!etlByKey[key]) deletes.push(appByKey[key]);
  });

  if (inserts.length === 0 && updates.length === 0 && deletes.length === 0) {
    showStatus('Sin cambios: AppDB ya está al día con el ETL.');
    return Promise.resolve();
  }

  showStatus(
    'Sincronizando: ' + inserts.length + ' nuevas, ' + updates.length + ' actualizadas, ' + deletes.length + ' eliminadas...'
  );

  return runPool(inserts, function (etlRow) {
    var content = Object.assign({}, etlRow);
    content[COMENTARIOS_FIELD] = '';
    content[ISSUE_FIELD] = '';
    content[OBSERVACIONES_FIELD] = calcularObservaciones(etlRow);
    return domo.post(DOCS_URL, { content: content });
  })
    .then(function () {
      return runPool(updates, function (item) {
        var content = Object.assign({}, item.etlRow);
        content[COMENTARIOS_FIELD] = item.doc.content[COMENTARIOS_FIELD] || '';
        content[ISSUE_FIELD] = item.doc.content[ISSUE_FIELD] || '';
        content[OBSERVACIONES_FIELD] = calcularObservaciones(item.etlRow);
        return domo.put(DOCS_URL + '/' + item.doc.id, { content: content });
      });
    })
    .then(function () {
      return runPool(deletes, function (doc) {
        return domo.delete(DOCS_URL + '/' + doc.id);
      });
    });
}

// Compara todos los campos del ETL (menos la llave, que ya coincidió, y
// menos los campos que no vienen del ETL: editables a mano + calculados)
// contra lo guardado.
function etlRowChanged(etlRow, content) {
  var a = JSON.stringify(sortedEntries(etlRow));
  var contentSinExtras = Object.assign({}, content);
  NON_ETL_FIELDS.forEach(function (f) { delete contentSinExtras[f]; });
  var b = JSON.stringify(sortedEntries(contentSinExtras));
  return a !== b;
}

// ---------- Observaciones (calculada, no editable a mano) ----------
// Traduce a JS la lógica de negocio que antes era una fórmula tipo SQL
// (CASE WHEN), leyendo las columnas del dataset ya agrupado tal cual están
// (PastDue, CostPastDueGDL, QtyDallas, QtyWO, QtyWON...). ITEM_STOCKING_TYPE,
// Vendor, EsObsoleto y QtyInTransit2 vienen en cada fila del dataset aunque
// no se muestren como columna en la tabla.
function calcularObservaciones(etlRow) {
  var pastDue = numField(etlRow, 'PastDue');

  if (pastDue <= 0) return 'NoPastDue';

  var costPastDueGDL = roundTo(numField(etlRow, 'CostPastDueGDL'), 3);

  if (costPastDueGDL > 0) {
    var itemStockingType = etlRow['ITEM_STOCKING_TYPE'];
    var esObsoleto = numField(etlRow, 'EsObsoleto');
    var qtyWO = numField(etlRow, 'QtyWO');
    var qtyWON = numField(etlRow, 'QtyWON');
    var sku = etlRow['sku'];

    if (itemStockingType === 'A') return 'Design Issue';
    if (!vendorEsCero(etlRow['Vendor'])) return 'Pending Supplier';
    if (sku === 'AMP-75137-01A' || sku === 'AMP-76137-01A') return 'New Motor';
    if (qtyWO > 0) return 'On a production Plan';
    if (qtyWON > 0) return 'On Planning';
    if (itemStockingType === 'O' || esObsoleto > 0) return 'Obsolete';
    return 'Pending to WO';
  }

  var qtyDallas = numField(etlRow, 'QtyDallas');
  var qtyInTransit2 = numField(etlRow, 'QtyInTransit2');

  if (pastDue <= qtyDallas) return 'FulfilledDallas';
  if (pastDue <= qtyInTransit2) return 'InTransit';
  if (pastDue <= qtyInTransit2 + qtyDallas) return 'Dallas-Transit';
  return ''; // el CASE original no tiene ELSE en esta rama: sin match, queda vacío
}

// `Vendor <> 0` de la fórmula original: vacío/nulo/0 cuenta como "sin
// vendedor"; cualquier otro valor (numérico distinto de 0, o un código no
// numérico) cuenta como "con vendedor".
function vendorEsCero(vendor) {
  if (vendor === null || vendor === undefined || vendor === '') return true;
  var n = Number(vendor);
  return !isNaN(n) && n === 0;
}

function numField(row, key) {
  var n = Number(row[key]);
  return isNaN(n) ? 0 : n;
}

function roundTo(value, decimals) {
  var factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function sortedEntries(obj) {
  return Object.keys(obj)
    .sort()
    .map(function (k) { return [k, obj[k]]; });
}

function normalizeKey(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

// Ejecuta "worker" sobre "items" con un máximo de MERGE_CONCURRENCY llamadas
// en paralelo (AppDB no tiene batch: una llamada HTTP por documento).
function runPool(items, worker) {
  return new Promise(function (resolve, reject) {
    if (items.length === 0) {
      resolve();
      return;
    }
    var index = 0;
    var active = 0;
    var failed = false;

    function next() {
      if (failed) return;
      if (index >= items.length && active === 0) {
        resolve();
        return;
      }
      while (!failed && active < MERGE_CONCURRENCY && index < items.length) {
        var item = items[index];
        index += 1;
        active += 1;
        worker(item)
          .then(function () {
            active -= 1;
            next();
          })
          .catch(function (err) {
            failed = true;
            reject(err);
          });
      }
    }

    next();
  });
}

// ---------- Carga ligera de AppDB (sin volver a leer el ETL) ----------
// Se usa después de guardar un comentario, para no disparar un merge
// completo solo por editar un campo.
function cargarDocsAppDb() {
  return fetchAllAppDbDocs().then(function (docs) {
    allDocs = docs.slice().sort(function (a, b) {
      return normalizeKey(a.content[FIELD_KEY]).localeCompare(normalizeKey(b.content[FIELD_KEY]));
    });
    renderTable();
  });
}

// ---------- Tabla ----------
function renderTable() {
  var thead = dataTable.querySelector('thead');
  var tbody = dataTable.querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  var headerRow = document.createElement('tr');
  DISPLAY_COLUMNS.forEach(function (col) {
    var th = document.createElement('th');
    th.textContent = col;
    headerRow.appendChild(th);
  });
  var thObservaciones = document.createElement('th');
  thObservaciones.textContent = 'Observaciones';
  headerRow.appendChild(thObservaciones);
  var thIssue = document.createElement('th');
  thIssue.textContent = 'Issue';
  headerRow.appendChild(thIssue);
  var thComentarios = document.createElement('th');
  thComentarios.textContent = 'Comentarios';
  headerRow.appendChild(thComentarios);
  thead.appendChild(headerRow);

  var filtro = buscarInput.value.trim().toLowerCase();
  var rows = allDocs.filter(function (doc) {
    if (!filtro) return true;
    return Object.keys(doc.content)
      .map(function (k) { return doc.content[k]; })
      .join(' ')
      .toLowerCase()
      .indexOf(filtro) !== -1;
  });

  var totalColumnas = DISPLAY_COLUMNS.length + 3; // + Observaciones + Issue + Comentarios

  if (allDocs.length === 0) {
    var emptyTr = document.createElement('tr');
    var emptyTd = document.createElement('td');
    emptyTd.colSpan = totalColumnas;
    emptyTd.className = 'empty-cell';
    emptyTd.textContent = 'Sin datos. Sincroniza o revisa el dataset ETL seleccionado.';
    emptyTr.appendChild(emptyTd);
    tbody.appendChild(emptyTr);
    return;
  }

  if (rows.length === 0) {
    var noMatchTr = document.createElement('tr');
    var noMatchTd = document.createElement('td');
    noMatchTd.colSpan = totalColumnas;
    noMatchTd.className = 'empty-cell';
    noMatchTd.textContent = 'Sin resultados para el filtro actual.';
    noMatchTr.appendChild(noMatchTd);
    tbody.appendChild(noMatchTr);
    return;
  }

  rows.forEach(function (doc) {
    var tr = document.createElement('tr');
    DISPLAY_COLUMNS.forEach(function (col) {
      tr.appendChild(cell(doc.content[col]));
    });
    tr.appendChild(cell(doc.content[OBSERVACIONES_FIELD]));
    tr.appendChild(buildIssueCell(doc));
    tr.appendChild(buildComentariosCell(doc));
    tbody.appendChild(tr);
  });
}

function buildComentariosCell(doc) {
  var td = document.createElement('td');
  var wrapper = document.createElement('div');
  wrapper.className = 'inline-action';

  var valorActual = editedComentarios[doc.id] !== undefined ? editedComentarios[doc.id] : (doc.content[COMENTARIOS_FIELD] || '');

  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Sin comentarios';
  input.value = valorActual;
  input.addEventListener('input', function () {
    editedComentarios[doc.id] = input.value;
    btnGuardar.disabled = input.value === (doc.content[COMENTARIOS_FIELD] || '');
  });

  var btnGuardar = document.createElement('button');
  btnGuardar.className = 'small';
  btnGuardar.textContent = savingComentarios[doc.id] ? 'Guardando...' : 'Guardar';
  btnGuardar.disabled = !!savingComentarios[doc.id] || valorActual === (doc.content[COMENTARIOS_FIELD] || '');
  btnGuardar.addEventListener('click', function () {
    guardarComentario(doc, input.value);
  });

  wrapper.appendChild(input);
  wrapper.appendChild(btnGuardar);
  td.appendChild(wrapper);
  return td;
}

// El select de Issue guarda solo al cambiar (es una elección de catálogo
// cerrado, no texto libre): no necesita un botón "Guardar" aparte.
function buildIssueCell(doc) {
  var td = document.createElement('td');

  var select = document.createElement('select');
  select.disabled = !!savingIssue[doc.id];

  var optionVacia = document.createElement('option');
  optionVacia.value = '';
  optionVacia.textContent = 'Sin issue';
  select.appendChild(optionVacia);

  ISSUE_OPTIONS.forEach(function (opcion) {
    var option = document.createElement('option');
    option.value = opcion;
    option.textContent = opcion;
    select.appendChild(option);
  });

  select.value = doc.content[ISSUE_FIELD] || '';
  select.addEventListener('change', function () {
    guardarIssue(doc, select.value);
  });

  td.appendChild(select);
  return td;
}

function guardarIssue(doc, nuevoValor) {
  savingIssue[doc.id] = true;
  renderTable();

  var content = Object.assign({}, doc.content);
  content[ISSUE_FIELD] = nuevoValor;

  domo
    .put(DOCS_URL + '/' + doc.id, { content: content })
    .then(function () {
      delete savingIssue[doc.id];
      return cargarDocsAppDb();
    })
    .catch(function (err) {
      delete savingIssue[doc.id];
      showStatus('No se pudo guardar el issue: ' + describeError(err));
      renderTable();
    });
}

function guardarComentario(doc, nuevoValor) {
  savingComentarios[doc.id] = true;
  renderTable();

  var content = Object.assign({}, doc.content);
  content[COMENTARIOS_FIELD] = nuevoValor;

  domo
    .put(DOCS_URL + '/' + doc.id, { content: content })
    .then(function () {
      delete editedComentarios[doc.id];
      delete savingComentarios[doc.id];
      return cargarDocsAppDb();
    })
    .catch(function (err) {
      delete savingComentarios[doc.id];
      showStatus('No se pudo guardar el comentario: ' + describeError(err));
      renderTable();
    });
}

// ---------- Helpers ----------
function cell(value) {
  var td = document.createElement('td');
  if (typeof value === 'number') {
    td.className = 'numeric';
    td.textContent = value.toLocaleString('es-MX', { maximumFractionDigits: 2 });
  } else {
    td.textContent = value === undefined || value === null ? '' : String(value);
  }
  return td;
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
