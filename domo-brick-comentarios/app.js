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

// Más campos editables a mano: dos fechas y un texto libre. Se guardan y se
// conservan igual que Comentarios/Issue.
var FAB_DATE_FIELD = 'estimatedFabDate';
var PLAN_DATE_FIELD = 'planDate';
var MISSING_COMPONENT_FIELD = 'missingComponent';

// "Observaciones" también es una columna que NO viene tal cual del ETL,
// pero a diferencia de los campos anteriores no la captura una persona: se
// recalcula en cada sincronización a partir de los campos del ETL (ver
// calcularObservaciones más abajo), así que siempre refleja los valores
// más recientes del dataset.
var OBSERVACIONES_FIELD = 'observaciones';

// Campos editables a mano que NUNCA vienen del ETL: se excluyen de las
// columnas dinámicas y de la comparación de cambios del merge, y se
// conservan tal cual entre sincronizaciones.
var EDITABLE_FIELDS = [COMENTARIOS_FIELD, ISSUE_FIELD, FAB_DATE_FIELD, PLAN_DATE_FIELD, MISSING_COMPONENT_FIELD];

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

// Etiqueta que se muestra en el encabezado de cada columna (lo visual). La
// llave es el nombre real del campo en el dataset/AppDB (no cambia); si un
// campo no aparece aquí, se usa su nombre tal cual como encabezado. Edita
// solo los valores para renombrar columnas sin afectar el merge.
var COLUMN_LABELS = {
  sku: 'SKU',
  CustomerFinal: 'Cliente',
  CategoriaFinal: 'Categoría',
  Motors: 'Motor',
  ITEM_DESC: 'Descripción',
  TotalBackOrder: 'Back Order',
  TotalCurrentMonth: 'Mes Actual',
  Total30Days: '30 Días',
  PastDue: 'Vencido',
  QtyDallas: 'Cant. Dallas',
  QtyonHandJDE: 'Cant. en JDE',
  QtyInTransit: 'Cant. en Tránsito',
  QtyWO: 'Cant. en WO',
  QtyWON: 'Cant. en WON',
  CostopenOrder: 'Costo Orden Abierta',
  CostPastdue: 'Costo Vencido',
  CostPastDueDallas: 'Costo Vencido Dallas',
  CostPastDueInTransit: 'Costo Vencido Tránsito',
  CostPastDueGDL: 'Costo Vencido GDL'
};

function columnLabel(field) {
  return COLUMN_LABELS[field] || field;
}

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
var tableWrapper = document.querySelector('.table-wrapper');

// ---------- Estado ----------
var allDocs = []; // últimos documentos de AppDB tras la sincronización: [{id, content}, ...]

// Los 5 campos editables (Issue, Estimated Fab Date, Plan date, Missing
// component, Comentarios) comparten un solo botón "Guardar" por fila, en
// vez de guardar cada uno por separado: doc.id -> { campo: valor en edición }.
var pendingEdits = {};
var savingRows = {}; // doc.id -> true mientras se guarda esa fila

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
          { name: OBSERVACIONES_FIELD, type: 'STRING' },
          // Fechas como STRING 'YYYY-MM-DD' (el valor nativo de <input
          // type="date">): evita depender de si esta instancia de AppDB
          // soporta un tipo DATE dedicado.
          { name: FAB_DATE_FIELD, type: 'STRING' },
          { name: PLAN_DATE_FIELD, type: 'STRING' },
          { name: MISSING_COMPONENT_FIELD, type: 'STRING' }
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
    content[FAB_DATE_FIELD] = '';
    content[PLAN_DATE_FIELD] = '';
    content[MISSING_COMPONENT_FIELD] = '';
    content[OBSERVACIONES_FIELD] = calcularObservaciones(etlRow);
    return domo.post(DOCS_URL, { content: content });
  })
    .then(function () {
      return runPool(updates, function (item) {
        var content = Object.assign({}, item.etlRow);
        EDITABLE_FIELDS.forEach(function (f) { content[f] = item.doc.content[f] || ''; });
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
// Editar un campo (elegir fecha, escribir un comentario, cambiar el issue)
// solo actualiza pendingEdits y habilita el botón "Guardar" de esa fila —
// NO reconstruye la tabla. Antes cada campo se guardaba por su cuenta y
// disparaba renderTable() en cada cambio, lo que además de forzar una
// llamada a AppDB por campo, tiraba tbody.innerHTML y perdía el scroll de
// .table-wrapper en cada fecha elegida. Ahora la tabla solo se reconstruye
// al buscar, sincronizar, o dar clic en "Guardar" — y en esos casos se
// restaura el scroll manualmente (ver preservarScroll).
function renderTable() {
  preservarScroll(function () {
    var thead = dataTable.querySelector('thead');
    var tbody = dataTable.querySelector('tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';

    var headerRow = document.createElement('tr');
    DISPLAY_COLUMNS.forEach(function (col) {
      var th = document.createElement('th');
      th.textContent = columnLabel(col);
      headerRow.appendChild(th);
    });
    ['Observaciones', 'Issue', 'Estimated Fab Date', 'Plan date', 'Missing component', 'Comentarios', 'Acciones'].forEach(function (texto) {
      var th = document.createElement('th');
      th.textContent = texto;
      headerRow.appendChild(th);
    });
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

    // + Observaciones + Issue + Estimated Fab Date + Plan date + Missing component + Comentarios + Acciones
    var totalColumnas = DISPLAY_COLUMNS.length + 7;

    if (allDocs.length === 0) {
      tbody.appendChild(mensajeVacio(totalColumnas, 'Sin datos. Sincroniza o revisa el dataset ETL seleccionado.'));
      return;
    }

    if (rows.length === 0) {
      tbody.appendChild(mensajeVacio(totalColumnas, 'Sin resultados para el filtro actual.'));
      return;
    }

    rows.forEach(function (doc) {
      tbody.appendChild(buildRow(doc));
    });
  });
}

function mensajeVacio(colSpan, texto) {
  var tr = document.createElement('tr');
  var td = document.createElement('td');
  td.colSpan = colSpan;
  td.className = 'empty-cell';
  td.textContent = texto;
  tr.appendChild(td);
  return tr;
}

// Mantiene la posición de scroll de .table-wrapper mientras "accion"
// reconstruye el contenido de la tabla (tbody.innerHTML = '' + repoblar).
function preservarScroll(accion) {
  var scrollTop = tableWrapper ? tableWrapper.scrollTop : 0;
  accion();
  if (tableWrapper) tableWrapper.scrollTop = scrollTop;
}

// Descriptor de los 5 campos editables: cómo se ve en modo lectura y qué
// tipo de control usa en modo edición. Un solo lugar para agregar/quitar un
// campo editable en vez de tocar dos ramas de buildRow por separado.
var CAMPOS_EDITABLES = [
  { field: ISSUE_FIELD, type: 'select', options: ISSUE_OPTIONS, vacio: 'Sin issue' },
  { field: FAB_DATE_FIELD, type: 'date', vacio: 'Sin fecha' },
  { field: PLAN_DATE_FIELD, type: 'date', vacio: 'Sin fecha' },
  { field: MISSING_COMPONENT_FIELD, type: 'text', vacio: 'Sin componente faltante' },
  { field: COMENTARIOS_FIELD, type: 'text', vacio: 'Sin comentarios' }
];

// Filas en modo edición (doc.id -> true). Fuera de este modo los 5 campos
// se muestran de solo lectura y la única acción es "Editar".
var editingRows = {};

// Arma una fila completa: las columnas del ETL (siempre solo lectura) + los
// 5 campos editables (texto plano, o sus controles si la fila está en modo
// edición) + Acciones (Editar, o Guardar/Cancelar mientras se edita).
function buildRow(doc) {
  var tr = document.createElement('tr');

  DISPLAY_COLUMNS.forEach(function (col) {
    tr.appendChild(cell(doc.content[col]));
  });
  tr.appendChild(cell(doc.content[OBSERVACIONES_FIELD]));

  var editando = !!editingRows[doc.id];

  if (!editando) {
    CAMPOS_EDITABLES.forEach(function (cfg) {
      tr.appendChild(cell(doc.content[cfg.field] || cfg.vacio));
    });
    var tdEditar = document.createElement('td');
    var btnEditar = document.createElement('button');
    btnEditar.className = 'small';
    btnEditar.textContent = 'Editar';
    btnEditar.addEventListener('click', function () {
      editingRows[doc.id] = true;
      renderTable();
    });
    tdEditar.appendChild(btnEditar);
    tr.appendChild(tdEditar);
    return tr;
  }

  var cambios = pendingEdits[doc.id] || {};
  var btnGuardar; // creado más abajo; los campos lo referencian por closure

  function valorActual(field) {
    return cambios[field] !== undefined ? cambios[field] : (doc.content[field] || '');
  }

  function marcarCambio(field, value) {
    if (!pendingEdits[doc.id]) pendingEdits[doc.id] = {};
    pendingEdits[doc.id][field] = value;
    cambios = pendingEdits[doc.id];
    actualizarBotonGuardar();
  }

  function actualizarBotonGuardar() {
    var hayCambios = Object.keys(cambios).some(function (f) {
      return cambios[f] !== (doc.content[f] || '');
    });
    btnGuardar.disabled = !hayCambios || !!savingRows[doc.id];
  }

  CAMPOS_EDITABLES.forEach(function (cfg) {
    var td = document.createElement('td');
    var input;

    if (cfg.type === 'select') {
      input = document.createElement('select');
      var optionVacia = document.createElement('option');
      optionVacia.value = '';
      optionVacia.textContent = cfg.vacio;
      input.appendChild(optionVacia);
      cfg.options.forEach(function (opcion) {
        var option = document.createElement('option');
        option.value = opcion;
        option.textContent = opcion;
        input.appendChild(option);
      });
      input.value = valorActual(cfg.field);
      input.addEventListener('change', function () { marcarCambio(cfg.field, input.value); });
    } else {
      input = document.createElement('input');
      input.type = cfg.type === 'date' ? 'date' : 'text';
      if (cfg.type === 'text') input.placeholder = cfg.vacio;
      input.value = valorActual(cfg.field);
      input.addEventListener(cfg.type === 'date' ? 'change' : 'input', function () {
        marcarCambio(cfg.field, input.value);
      });
    }

    input.disabled = !!savingRows[doc.id];
    td.appendChild(input);
    tr.appendChild(td);
  });

  // Acciones: Guardar (manda los cambios pendientes de la fila en una sola
  // llamada a AppDB) + Cancelar (descarta los cambios y sale del modo edición).
  var tdAcciones = document.createElement('td');

  btnGuardar = document.createElement('button');
  btnGuardar.className = 'small';
  btnGuardar.textContent = savingRows[doc.id] ? 'Guardando...' : 'Guardar';
  btnGuardar.addEventListener('click', function () { guardarFila(doc); });
  tdAcciones.appendChild(btnGuardar);

  var btnCancelar = document.createElement('button');
  btnCancelar.className = 'secondary small';
  btnCancelar.textContent = 'Cancelar';
  btnCancelar.disabled = !!savingRows[doc.id];
  btnCancelar.addEventListener('click', function () {
    delete pendingEdits[doc.id];
    delete editingRows[doc.id];
    renderTable();
  });
  tdAcciones.appendChild(btnCancelar);

  tr.appendChild(tdAcciones);

  actualizarBotonGuardar();

  return tr;
}

function guardarFila(doc) {
  var cambios = pendingEdits[doc.id];
  if (!cambios) return;

  savingRows[doc.id] = true;
  renderTable();

  var content = Object.assign({}, doc.content, cambios);

  domo
    .put(DOCS_URL + '/' + doc.id, { content: content })
    .then(function () {
      delete pendingEdits[doc.id];
      delete savingRows[doc.id];
      delete editingRows[doc.id];
      return cargarDocsAppDb();
    })
    .catch(function (err) {
      delete savingRows[doc.id];
      showStatus('No se pudo guardar: ' + describeError(err));
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
