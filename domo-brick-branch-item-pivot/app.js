var domo = window.domo;
var datasets = window.datasets;

// Dataset seleccionada en el botón de la esquina inferior izquierda del brick
var datasetId = datasets[0];

// Nombres de campo del dataset (ajusta aquí si tu dataset usa otros alias)
var FIELD_BRANCH = 'ilmmcu';   // Branch/Plant
var FIELD_ITEM = 'illitm';     // Item
var FIELD_TRX_DESC = 'iltrex'; // Descripción del tipo de transacción (filas del pivote)
var FIELD_QTY = 'iltrqt';      // Cantidad de la transacción (se divide entre 10000)
var FIELD_UM = 'iltrum';       // Unidad de medida
var FIELD_DOCUMENT = 'ildoc';  // Documento
var FIELD_FECHA = 'iltrdj';    // Fecha (formato juliano JDE: CYYDDD)
var FIELD_DOC_TYPE = 'ildct';  // Tipo de documento (radios dinámicos)
var FIELD_COST = 'ilpaid';     // Costo (se divide entre 100)

var QTY_DIVISOR = 10000;
var COST_DIVISOR = 100;

// Hay registros donde Branch/Plant viene en blanco (aún no se había
// definido al momento de la transacción); esos registros en realidad
// pertenecen al branch 1221 por defecto.
var DEFAULT_BRANCH = '1221';

// Cada radio agrupa uno o varios códigos crudos de Branch/Plant bajo un
// nombre de planta. Al seleccionar un radio se filtra por TODOS los
// códigos de ese grupo.
var BRANCH_GROUPS = [
  { label: 'Plataforma', codes: ['1221', '2300'] },
  { label: 'Laredo', codes: ['5130', '5140'] },
  { label: 'AMP', codes: ['2200'] },
  { label: 'Calle2', codes: ['2190'] },
  { label: 'CDI', codes: ['1122'] }
];

var BRANCH_GROUPS_BY_LABEL = {};
BRANCH_GROUPS.forEach(function (group) {
  BRANCH_GROUPS_BY_LABEL[group.label] = group.codes;
});

// Para el pivote NO se le pide a Domo que agrupe (groupby): con datasets de
// millones de filas su motor de agregación parecía truncar/samplear en vez
// de escanear todo, devolviendo menos tipos de transacción de los que
// realmente existen. En su lugar se traen las filas YA FILTRADAS por Item
// (un subconjunto mucho más chico que el dataset completo) en páginas, y
// se suman/filtran por Branch/Plant en el navegador.
var PAGE_SIZE = 5000;
var MAX_PAGES = 500; // tope de seguridad: hasta 2.5M filas filtradas

// Para consultas de valores distintos (groupby sin sumar nada, ej. tipos de
// documento de una planta) el resultado es chico: no hace falta paginar,
// solo pedir un límite alto para no toparse con el límite por defecto.
var DISTINCT_LIMIT = 100000;

var branchCheckboxes = document.getElementById('branchCheckboxes');
var docTypeCheckboxes = document.getElementById('docTypeCheckboxes');
var itemInput = document.getElementById('itemInput');
var dateFromInput = document.getElementById('dateFromInput');
var dateToInput = document.getElementById('dateToInput');
var btnGenerar = document.getElementById('btnGenerar');
var btnLimpiar = document.getElementById('btnLimpiar');
var btnExportPivot = document.getElementById('btnExportPivot');
var btnExportDetail = document.getElementById('btnExportDetail');
var statusMsg = document.getElementById('statusMsg');
var loadingEl = document.getElementById('loading');
var pivotTable = document.getElementById('pivotTable');
var detailTable = document.getElementById('detailTable');
var detailTitle = document.getElementById('detailTitle');

// Filas crudas (branch+item+trx+um+qty) que arma el último pivote generado,
// usadas para armar el detalle al hacer clic en una fila y para exportar.
var lastMatchingRows = [];
var lastPivotRows = [];
var lastDetailRows = [];

init();

function init() {
  btnGenerar.addEventListener('click', generatePivot);
  btnLimpiar.addEventListener('click', resetAll);
  btnExportPivot.addEventListener('click', exportPivotToExcel);
  btnExportDetail.addEventListener('click', exportDetailToExcel);
  branchCheckboxes.addEventListener('change', onBranchSelectionChange);

  renderBranchRadios();
  renderDetail([], null);
}

// ---------- Paso 1: pintar los radios de planta (Branch/Plant) ----------

function renderBranchRadios() {
  branchCheckboxes.innerHTML = '';

  BRANCH_GROUPS.forEach(function (group) {
    var label = document.createElement('label');

    var radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'branchRadio';
    radio.value = group.label;
    radio.className = 'branch-radio';

    label.appendChild(radio);
    label.appendChild(document.createTextNode(group.label));

    branchCheckboxes.appendChild(label);
  });
}

// ---------- Tipo de documento: radios dinámicos según la planta elegida ----------

function onBranchSelectionChange(e) {
  if (!e.target.classList.contains('branch-radio')) return;
  loadDocTypesForSelectedBranch();
}

function loadDocTypesForSelectedBranch() {
  var branches = getSelectedBranches();

  docTypeCheckboxes.innerHTML = '<span class="hint">Cargando...</span>';

  if (branches.length === 0) {
    docTypeCheckboxes.innerHTML = '<span class="hint">Selecciona un Branch/Plant primero</span>';
    return;
  }

  fetchDistinctForBranches(FIELD_DOC_TYPE, branches, function (values) {
    renderDocTypeRadios(values);
  }, function (err) {
    logError('Error cargando tipos de documento', err);
    docTypeCheckboxes.innerHTML = '<span class="hint">No se pudieron cargar los tipos de documento.</span>';
  });
}

// Trae los valores distintos de "field" para los códigos de branch dados;
// si el grupo incluye DEFAULT_BRANCH, también junta lo que venga con
// Branch/Plant en blanco (misma lógica que el pivote sin Item).
function fetchDistinctForBranches(field, branches, onDone, onError) {
  var filter = buildFieldFilter(FIELD_BRANCH, branches);

  domo.get(buildDistinctQuery(field, filter))
    .then(function (data) {
      if (branches.indexOf(DEFAULT_BRANCH) === -1) {
        onDone(distinctValues(data, field));
        return;
      }

      var blankFilter = buildFieldFilter(FIELD_BRANCH, ['']);
      domo.get(buildDistinctQuery(field, blankFilter))
        .then(function (blankData) {
          onDone(distinctValues((data || []).concat(blankData || []), field));
        })
        .catch(onError);
    })
    .catch(onError);
}

function buildDistinctQuery(field, filter) {
  return '/data/v1/' + datasetId +
    '?fields=' + field +
    '&groupby=' + field +
    '&filter=' + filter +
    '&orderby=' + field +
    '&limit=' + DISTINCT_LIMIT;
}

function distinctValues(rows, field) {
  var seen = {};
  var values = [];
  (rows || []).forEach(function (row) {
    var v = row[field];
    if (v === null || v === undefined || v === '') return;
    if (!seen[v]) {
      seen[v] = true;
      values.push(v);
    }
  });
  values.sort();
  return values;
}

function renderDocTypeRadios(values) {
  docTypeCheckboxes.innerHTML = '';

  if (values.length === 0) {
    docTypeCheckboxes.innerHTML = '<span class="hint">No se encontraron tipos de documento.</span>';
    return;
  }

  values.forEach(function (value) {
    var label = document.createElement('label');

    var radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'docTypeRadio';
    radio.value = value;
    radio.className = 'doctype-radio';

    label.appendChild(radio);
    label.appendChild(document.createTextNode(value));

    docTypeCheckboxes.appendChild(label);
  });
}

// Ninguno marcado -> null (sin filtrar, se calcula todo).
function getSelectedDocType() {
  var checked = docTypeCheckboxes.querySelector('.doctype-radio:checked');
  return checked ? checked.value : null;
}

// ---------- Paso 2: generar el pivote filtrando por Branch/Plant + Item(s) ----------

function generatePivot() {
  var branches = getSelectedBranches();
  var items = getItemsFromInput();

  if (branches.length === 0) {
    setStatus('Selecciona un Branch/Plant.');
    return;
  }

  setStatus('');
  clearTable();
  renderDetail([], null);
  showLoading(true);

  // Tipo de documento y rango de fechas se mandan YA en el filtro del
  // servidor (antes se traían todas las filas y se filtraban en el
  // navegador, lo que en una planta completa podía significar más de un
  // millón de filas para acabar quedándose con un par de miles).
  var extraFilters = buildExtraFilters();

  if (items.length > 0) {
    generatePivotByItem(branches, items, extraFilters);
  } else {
    // Sin Item: se calcula TODO lo de la planta seleccionada.
    generatePivotByBranchOnly(branches, extraFilters);
  }
}

// Con Item(s): se filtra solo por Item en el servidor (bastantes registros
// traen Branch/Plant en blanco, equivalen al branch DEFAULT_BRANCH, así
// que filtrar por branch en el servidor los dejaría fuera). El branch se
// aplica después, en el navegador, ya con el valor por defecto asignado.
function generatePivotByItem(branches, items, extraFilters) {
  var filter = combineFilters(buildFieldFilter(FIELD_ITEM, items), extraFilters);

  fetchAllFilteredRows(filter, function (rows) {
    var branchSet = toSet(branches);
    var matchingRows = rows.filter(function (row) {
      return branchSet[normalizeBranch(row[FIELD_BRANCH])];
    });
    finishPivot(matchingRows);
  }, handlePivotError);
}

// Sin Item: no se puede pedir el dataset completo sin filtro (son millones
// de filas), así que aquí sí se filtra por Branch/Plant en el servidor. Si
// el grupo elegido incluye DEFAULT_BRANCH, se trae aparte también lo que
// venga con Branch/Plant en blanco (cuenta como DEFAULT_BRANCH).
function generatePivotByBranchOnly(branches, extraFilters) {
  var filter = combineFilters(buildFieldFilter(FIELD_BRANCH, branches), extraFilters);

  fetchAllFilteredRows(filter, function (rowsWithBranch) {
    if (branches.indexOf(DEFAULT_BRANCH) === -1) {
      finishPivot(rowsWithBranch);
      return;
    }

    var blankFilter = combineFilters(buildFieldFilter(FIELD_BRANCH, ['']), extraFilters);
    fetchAllFilteredRows(blankFilter, function (blankRows) {
      finishPivot(rowsWithBranch.concat(blankRows));
    }, handlePivotError);
  }, handlePivotError);
}

// Junta el filtro de Tipo de documento (=) y de rango de fechas (>=, <=)
// -si están definidos- para agregarlos al filtro base con combineFilters().
function buildExtraFilters() {
  var parts = [];

  var docType = getSelectedDocType();
  if (docType) {
    parts.push(buildFieldFilter(FIELD_DOC_TYPE, [docType]));
  }

  var fromJulian = dateFromInput.value ? dateToJulian(dateFromInput.value) : null;
  var toJulian = dateToInput.value ? dateToJulian(dateToInput.value) : null;
  if (fromJulian !== null) {
    parts.push(FIELD_FECHA + '>=' + fromJulian);
  }
  if (toJulian !== null) {
    parts.push(FIELD_FECHA + '<=' + toJulian);
  }

  return parts;
}

// Varias condiciones se unen con COMA (equivale a AND), igual que en
// buildFieldFilter.
function combineFilters(baseFilter, extraParts) {
  return [baseFilter].concat(extraParts).join(',');
}

function finishPivot(matchingRows) {
  lastMatchingRows = matchingRows;
  lastPivotRows = aggregateRows(matchingRows);
  lastDetailRows = [];

  renderPivot(lastPivotRows);
  renderDetail([], null);
  showLoading(false);
}

function handlePivotError(err) {
  logError('Error generando el pivote', err);
  setStatus('No se pudo generar el pivote. ' + describeError(err));
  showLoading(false);
}

// Convierte 'YYYY-MM-DD' (valor de <input type="date">) al entero juliano
// estilo JDE CYYDDD, para poder comparar contra iltrdj sin re-formatear
// cada fila. Es el inverso de julianToDate().
function dateToJulian(isoDate) {
  var parts = isoDate.split('-');
  if (parts.length !== 3) return null;

  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10);
  var day = parseInt(parts[2], 10);
  if (!year || !month || !day) return null;

  var startOfYear = new Date(year, 0, 1);
  var target = new Date(year, month - 1, day);
  var dayOfYear = Math.round((target - startOfYear) / 86400000) + 1;

  var century = Math.floor(year / 100) - 19; // 1900s -> 0, 2000s -> 1
  var yy = year % 100;

  return (century * 100000) + (yy * 1000) + dayOfYear;
}

// Blanco/vacío -> DEFAULT_BRANCH; si no, el valor tal cual (sin espacios).
function normalizeBranch(value) {
  var trimmed = (value === null || value === undefined) ? '' : String(value).trim();
  return trimmed === '' ? DEFAULT_BRANCH : trimmed;
}

function toSet(values) {
  var set = {};
  values.forEach(function (v) { set[v] = true; });
  return set;
}

// Trae, en páginas de PAGE_SIZE, todas las filas que cumplen el filtro
// (sin groupby), acumulándolas hasta que una página regresa menos filas
// de las pedidas (fin de los datos).
function fetchAllFilteredRows(filter, onDone, onError) {
  var fields = [FIELD_BRANCH, FIELD_ITEM, FIELD_TRX_DESC, FIELD_UM, FIELD_QTY, FIELD_DOCUMENT, FIELD_FECHA, FIELD_DOC_TYPE, FIELD_COST];
  var collected = [];
  var offset = 0;
  var page = 0;

  function fetchPage() {
    page += 1;
    if (page > MAX_PAGES) {
      onError(new Error('Se alcanzó el máximo de páginas (' + MAX_PAGES + ') sin terminar de leer los datos.'));
      return;
    }

    // orderby fijo es indispensable para que offset/limit recorra TODO el
    // conjunto sin huecos ni repeticiones: sin un orden determinístico,
    // cada página puede regresar un subconjunto distinto y no se cubre
    // el total real (esto causaba que faltaran tipos de transacción).
    var query = '/data/v1/' + datasetId +
      '?fields=' + fields.join() +
      '&filter=' + filter +
      '&orderby=' + FIELD_TRX_DESC + ',' + FIELD_UM +
      '&limit=' + PAGE_SIZE +
      '&offset=' + offset;

    console.log('Query Pivote (página ' + page + ', offset ' + offset + '):', query);
    setStatus('Cargando registros... (' + collected.length + ' hasta ahora)');

    domo.get(query)
      .then(function (data) {
        data = data || [];
        collected = collected.concat(data);

        if (data.length < PAGE_SIZE) {
          console.log('Total de registros leídos:', collected.length);
          setStatus('Se cargaron ' + collected.length.toLocaleString('es-MX') + ' registros.');
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

// Agrupa por tipo de transacción + unidad de medida, sumando la cantidad.
function aggregateRows(rows) {
  var pivotMap = {};

  rows.forEach(function (row) {
    var key = row[FIELD_TRX_DESC] + '||' + row[FIELD_UM];
    if (!pivotMap[key]) {
      pivotMap[key] = {
        trx: row[FIELD_TRX_DESC],
        um: row[FIELD_UM],
        qty: 0
      };
    }
    pivotMap[key].qty += Number(row[FIELD_QTY]) || 0;
  });

  var pivotRows = Object.keys(pivotMap).map(function (key) {
    return pivotMap[key];
  });
  pivotRows.sort(function (a, b) {
    return String(a.trx).localeCompare(String(b.trx));
  });

  return pivotRows;
}

function renderPivot(pivotRows) {
  var thead = pivotTable.querySelector('thead');
  var tbody = pivotTable.querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  var headerRow = document.createElement('tr');
  ['Tipo de transacción', 'Cantidad', 'Unidad de medida'].forEach(function (text) {
    var th = document.createElement('th');
    th.textContent = text;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  if (!pivotRows || pivotRows.length === 0) {
    var emptyRow = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = 3;
    td.className = 'empty-cell';
    td.textContent = 'Sin datos para la selección actual.';
    emptyRow.appendChild(td);
    tbody.appendChild(emptyRow);
    return;
  }

  pivotRows.forEach(function (row) {
    var tr = document.createElement('tr');
    var qty = row.qty / QTY_DIVISOR;

    var tdDesc = document.createElement('td');
    tdDesc.textContent = row.trx;
    tr.appendChild(tdDesc);

    var tdQty = document.createElement('td');
    tdQty.className = 'numeric';
    tdQty.textContent = qty.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    tr.appendChild(tdQty);

    var tdUm = document.createElement('td');
    tdUm.textContent = row.um;
    tr.appendChild(tdUm);

    tr.addEventListener('click', function () {
      Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function (r) {
        r.classList.remove('selected-row');
      });
      tr.classList.add('selected-row');
      showDetailFor(row.trx, row.um);
    });

    tbody.appendChild(tr);
  });
}

// ---------- Detalle: filas crudas del tipo de transacción seleccionado ----------

function showDetailFor(trx, um) {
  var rows = lastMatchingRows.filter(function (row) {
    return row[FIELD_TRX_DESC] === trx && row[FIELD_UM] === um;
  });
  lastDetailRows = rows;
  renderDetail(rows, trx);
}

function renderDetail(rows, trx) {
  detailTitle.textContent = trx ? ('Detalle: ' + trx) : 'Detalle';

  var thead = detailTable.querySelector('thead');
  var tbody = detailTable.querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  var headerRow = document.createElement('tr');
  ['Branch/Plant', 'Item', 'Tipo de transacción', 'Cantidad', 'Unidad de medida', 'Documento', 'Fecha', 'Costo'].forEach(function (text) {
    var th = document.createElement('th');
    th.textContent = text;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  if (!rows || rows.length === 0) {
    var emptyRow = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = 8;
    td.className = 'empty-cell';
    td.textContent = 'Da clic en una fila del pivote para ver su detalle.';
    emptyRow.appendChild(td);
    tbody.appendChild(emptyRow);
    return;
  }

  rows.forEach(function (row) {
    var tr = document.createElement('tr');
    var qty = (Number(row[FIELD_QTY]) || 0) / QTY_DIVISOR;
    var cost = (Number(row[FIELD_COST]) || 0) / COST_DIVISOR;

    [
      normalizeBranch(row[FIELD_BRANCH]),
      row[FIELD_ITEM],
      row[FIELD_TRX_DESC],
      null,
      row[FIELD_UM],
      row[FIELD_DOCUMENT],
      julianToDate(row[FIELD_FECHA]),
      null
    ].forEach(function (value, idx) {
      var tdEl = document.createElement('td');
      if (idx === 3) {
        tdEl.className = 'numeric';
        tdEl.textContent = qty.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      } else if (idx === 7) {
        tdEl.className = 'numeric';
        tdEl.textContent = cost.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      } else {
        tdEl.textContent = value;
      }
      tr.appendChild(tdEl);
    });

    tbody.appendChild(tr);
  });
}

// Convierte una fecha juliana estilo JDE (formato CYYDDD: siglo + año + día
// del año) a fecha estándar DD/MM/AAAA. Ej: 124001 -> 01/01/2024.
function julianToDate(value) {
  if (value === null || value === undefined || value === '') return '';

  var num = Number(value);
  if (isNaN(num) || num <= 0) return '';

  var digits = String(Math.trunc(num));
  if (digits.length < 5 || digits.length > 6) return String(value);
  digits = ('000000' + digits).slice(-6);

  var century = parseInt(digits.substring(0, 1), 10);
  var yy = parseInt(digits.substring(1, 3), 10);
  var dayOfYear = parseInt(digits.substring(3, 6), 10);

  if (dayOfYear < 1 || dayOfYear > 366) return String(value);

  var year = 1900 + (century * 100) + yy;
  var date = new Date(year, 0, 1);
  date.setDate(date.getDate() + dayOfYear - 1);

  var day = ('0' + date.getDate()).slice(-2);
  var month = ('0' + (date.getMonth() + 1)).slice(-2);

  return day + '/' + month + '/' + date.getFullYear();
}

// ---------- Exportar a Excel (CSV) ----------

function exportPivotToExcel() {
  if (!lastPivotRows || lastPivotRows.length === 0) {
    setStatus('No hay datos en el pivote para exportar.');
    return;
  }

  var headers = ['Tipo de transacción', 'Cantidad', 'Unidad de medida'];
  var rows = lastPivotRows.map(function (row) {
    return [row.trx, row.qty / QTY_DIVISOR, row.um];
  });

  downloadCSV('pivote.csv', toCSV(headers, rows));
}

function exportDetailToExcel() {
  if (!lastDetailRows || lastDetailRows.length === 0) {
    setStatus('No hay detalle para exportar. Da clic en una fila del pivote primero.');
    return;
  }

  var headers = ['Branch/Plant', 'Item', 'Tipo de transacción', 'Cantidad', 'Unidad de medida', 'Documento', 'Fecha', 'Costo'];
  var rows = lastDetailRows.map(function (row) {
    return [
      normalizeBranch(row[FIELD_BRANCH]),
      row[FIELD_ITEM],
      row[FIELD_TRX_DESC],
      (Number(row[FIELD_QTY]) || 0) / QTY_DIVISOR,
      row[FIELD_UM],
      row[FIELD_DOCUMENT],
      julianToDate(row[FIELD_FECHA]),
      (Number(row[FIELD_COST]) || 0) / COST_DIVISOR
    ];
  });

  downloadCSV('detalle.csv', toCSV(headers, rows));
}

// Excel abre .csv de forma nativa; se evita depender de una librería externa
// (SheetJS, etc.) dentro del sandbox del brick.
function toCSV(headers, rows) {
  var lines = [headers.map(csvEscape).join(',')];
  rows.forEach(function (row) {
    lines.push(row.map(csvEscape).join(','));
  });
  return lines.join('\r\n');
}

function csvEscape(value) {
  var str = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function downloadCSV(filename, csvContent) {
  // BOM UTF-8 para que Excel muestre bien acentos/ñ.
  var blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);

  var link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ---------- Utilidades ----------

// Devuelve los códigos crudos de Branch/Plant del grupo marcado
// (ej: "Plataforma" -> ['1221', '2300']).
function getSelectedBranches() {
  var checked = branchCheckboxes.querySelector('.branch-radio:checked');
  if (!checked) return [];
  return BRANCH_GROUPS_BY_LABEL[checked.value] || [];
}

function getItemsFromInput() {
  return itemInput.value
    .split(',')
    .map(function (v) { return v.trim(); })
    .filter(function (v) { return v.length > 0; });
}

// Un solo valor -> field='valor'. Varios valores -> field in ('a','b',...).
// Sin paréntesis extra ni "or": esa es la sintaxis real de la Data API.
function buildFieldFilter(field, values) {
  var escaped = values.map(function (v) {
    return "'" + String(v).replace(/'/g, "''") + "'";
  });
  if (escaped.length === 1) {
    return field + '=' + escaped[0];
  }
  return field + ' in (' + escaped.join(',') + ')';
}

// Extrae un mensaje legible del error que devuelve domo.get (puede ser un
// Error, una Response de fetch, o un string) para poder mostrarlo/loguearlo.
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

// Si domo.get rechaza con una Response (fetch), intenta leer el cuerpo
// para obtener el detalle real que Domo mandó (queda solo en consola).
function logError(context, err) {
  console.error(context, err);
  if (err && typeof err.text === 'function') {
    err.text().then(function (body) {
      console.error(context + ' - respuesta del servidor:', body);
    }).catch(function () {});
  }
}

function clearTable() {
  pivotTable.querySelector('thead').innerHTML = '';
  pivotTable.querySelector('tbody').innerHTML = '';
}

function setStatus(msg) {
  statusMsg.textContent = msg || '';
}

function showLoading(show) {
  loadingEl.style.display = show ? 'block' : 'none';
}

function resetAll() {
  var checked = branchCheckboxes.querySelectorAll('.branch-radio:checked');
  Array.prototype.forEach.call(checked, function (chk) { chk.checked = false; });
  docTypeCheckboxes.innerHTML = '<span class="hint">Selecciona un Branch/Plant primero</span>';
  itemInput.value = '';
  dateFromInput.value = '';
  dateToInput.value = '';
  clearTable();
  renderDetail([], null);
  lastMatchingRows = [];
  lastPivotRows = [];
  lastDetailRows = [];
  setStatus('');
}
