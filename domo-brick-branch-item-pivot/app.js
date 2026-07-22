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

var QTY_DIVISOR = 10000;

var branchSelect = document.getElementById('branchSelect');
var itemSelect = document.getElementById('itemSelect');
var btnGenerar = document.getElementById('btnGenerar');
var btnLimpiar = document.getElementById('btnLimpiar');
var statusMsg = document.getElementById('statusMsg');
var loadingEl = document.getElementById('loading');
var pivotTable = document.getElementById('pivotTable');

// Cache en memoria de todo el dataset ya agrupado. Se llena una sola vez al
// iniciar y de ahí en adelante TODO el filtrado/cascada/pivote se hace en el
// navegador con JS, sin volver a pegarle a domo.get. Esto evita depender de
// la sintaxis exacta de "filter=" en la Data API, que estaba devolviendo 400.
var allRows = [];

init();

function init() {
  branchSelect.addEventListener('change', onBranchChange);
  itemSelect.addEventListener('change', onItemChange);
  btnGenerar.addEventListener('click', generatePivot);
  btnLimpiar.addEventListener('click', resetAll);

  loadAllData();
}

// ---------- Carga única de datos ----------

function loadAllData() {
  showLoading(true);
  setStatus('');

  var fields = [FIELD_BRANCH, FIELD_ITEM, FIELD_TRX_DESC, FIELD_UM, FIELD_QTY];
  var groupby = [FIELD_BRANCH, FIELD_ITEM, FIELD_TRX_DESC, FIELD_UM];

  // Mismo patrón fields+groupby que ya funcionaba para Branch/Plant, sin
  // "filter": iltrqt queda fuera del groupby, así que Domo lo suma solo
  // por cada combinación de branch/item/tipo de transacción/UM.
  var query = '/data/v1/' + datasetId +
    '?fields=' + fields.join() +
    '&groupby=' + groupby.join();

  console.log('Query inicial:', query);

  domo.get(query)
    .then(function (data) {
      allRows = data || [];
      populateBranchSelect();
      showLoading(false);
    })
    .catch(function (err) {
      logError('Error cargando datos', err);
      setStatus('No se pudieron cargar los datos. ' + describeError(err));
      showLoading(false);
    });
}

function populateBranchSelect() {
  var branches = uniqueValues(allRows, FIELD_BRANCH);
  branchSelect.innerHTML = '';
  branches.forEach(function (value) {
    var opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    branchSelect.appendChild(opt);
  });
}

// ---------- Paso 2: al cambiar Branch/Plant, arma el select de Items ----------

function onBranchChange() {
  var branches = getSelectedValues(branchSelect);

  itemSelect.innerHTML = '';
  itemSelect.disabled = branches.length === 0;
  btnGenerar.disabled = true;
  clearTable();
  setStatus('');

  if (branches.length === 0) {
    return;
  }

  var branchSet = toSet(branches);
  var rowsForBranches = allRows.filter(function (row) {
    return branchSet[row[FIELD_BRANCH]];
  });

  var items = uniqueValues(rowsForBranches, FIELD_ITEM);
  items.forEach(function (value) {
    var opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    itemSelect.appendChild(opt);
  });
}

function onItemChange() {
  var items = getSelectedValues(itemSelect);
  btnGenerar.disabled = items.length === 0;
  clearTable();
}

// ---------- Paso 3: generar el pivote (agregado en el navegador) ----------

function generatePivot() {
  var branches = getSelectedValues(branchSelect);
  var items = getSelectedValues(itemSelect);

  if (branches.length === 0 || items.length === 0) {
    setStatus('Selecciona al menos un Branch/Plant y un Item.');
    return;
  }

  setStatus('');
  clearTable();

  var branchSet = toSet(branches);
  var itemSet = toSet(items);

  var filteredRows = allRows.filter(function (row) {
    return branchSet[row[FIELD_BRANCH]] && itemSet[row[FIELD_ITEM]];
  });

  // Agrupa por tipo de transacción + unidad de medida, sumando la cantidad.
  var pivotMap = {};
  filteredRows.forEach(function (row) {
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

  renderPivot(pivotRows);
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

    tbody.appendChild(tr);
  });
}

// ---------- Utilidades ----------

function uniqueValues(rows, field) {
  var seen = {};
  var result = [];
  rows.forEach(function (row) {
    var value = row[field];
    if (value === null || value === undefined || value === '') return;
    if (!seen[value]) {
      seen[value] = true;
      result.push(value);
    }
  });
  result.sort();
  return result;
}

function toSet(values) {
  var set = {};
  values.forEach(function (v) {
    set[v] = true;
  });
  return set;
}

function getSelectedValues(selectEl) {
  return Array.prototype.slice.call(selectEl.selectedOptions).map(function (opt) {
    return opt.value;
  });
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
  Array.prototype.forEach.call(branchSelect.options, function (opt) { opt.selected = false; });
  itemSelect.innerHTML = '';
  itemSelect.disabled = true;
  btnGenerar.disabled = true;
  clearTable();
  setStatus('');
}
