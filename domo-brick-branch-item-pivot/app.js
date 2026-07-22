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

init();

function init() {
  branchSelect.addEventListener('change', onBranchChange);
  itemSelect.addEventListener('change', onItemChange);
  btnGenerar.addEventListener('click', generatePivot);
  btnLimpiar.addEventListener('click', resetAll);

  loadBranches();
}

// ---------- Paso 1: cargar Branch/Plant ----------

function loadBranches() {
  showLoading(true);
  setStatus('');

  var query = '/data/v1/' + datasetId +
    '?fields=' + FIELD_BRANCH +
    '&groupby=' + FIELD_BRANCH +
    '&orderby=' + FIELD_BRANCH;

  domo.get(query)
    .then(function (data) {
      populateSelect(branchSelect, data, FIELD_BRANCH);
      showLoading(false);
    })
    .catch(function (err) {
      console.error('Error cargando Branch/Plant', err);
      setStatus('No se pudo cargar Branch/Plant.');
      showLoading(false);
    });
}

// ---------- Paso 2: al cambiar Branch/Plant, cargar Items ----------

function onBranchChange() {
  var branches = getSelectedValues(branchSelect);

  itemSelect.innerHTML = '';
  itemSelect.disabled = true;
  btnGenerar.disabled = true;
  clearTable();
  setStatus('');

  if (branches.length === 0) {
    return;
  }

  showLoading(true);

  var filter = buildInFilter(FIELD_BRANCH, branches);
  var query = '/data/v1/' + datasetId +
    '?fields=' + FIELD_ITEM +
    '&groupby=' + FIELD_ITEM +
    '&filter=' + encodeURIComponent(filter) +
    '&orderby=' + FIELD_ITEM;

  domo.get(query)
    .then(function (data) {
      populateSelect(itemSelect, data, FIELD_ITEM);
      itemSelect.disabled = false;
      showLoading(false);
    })
    .catch(function (err) {
      console.error('Error cargando Items', err);
      setStatus('No se pudo cargar Items.');
      showLoading(false);
    });
}

function onItemChange() {
  var items = getSelectedValues(itemSelect);
  btnGenerar.disabled = items.length === 0;
  clearTable();
}

// ---------- Paso 3: generar el pivote ----------

function generatePivot() {
  var branches = getSelectedValues(branchSelect);
  var items = getSelectedValues(itemSelect);

  if (branches.length === 0 || items.length === 0) {
    setStatus('Selecciona al menos un Branch/Plant y un Item.');
    return;
  }

  showLoading(true);
  setStatus('');
  clearTable();

  var filter = buildInFilter(FIELD_BRANCH, branches) + ' and ' + buildInFilter(FIELD_ITEM, items);

  // iltrqt no va en el groupby: Domo lo suma automáticamente por cada
  // combinación de iltrex + iltrum (tipo de transacción / unidad de medida).
  var fields = [FIELD_TRX_DESC, FIELD_UM, FIELD_QTY];
  var groupby = [FIELD_TRX_DESC, FIELD_UM];

  var query = '/data/v1/' + datasetId +
    '?fields=' + fields.join() +
    '&groupby=' + groupby.join() +
    '&filter=' + encodeURIComponent(filter) +
    '&orderby=' + FIELD_TRX_DESC;

  domo.get(query)
    .then(function (data) {
      renderPivot(data);
      showLoading(false);
    })
    .catch(function (err) {
      console.error('Error generando el pivote', err);
      setStatus('No se pudo generar el pivote.');
      showLoading(false);
    });
}

function renderPivot(data) {
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

  if (!data || data.length === 0) {
    var emptyRow = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = 3;
    td.className = 'empty-cell';
    td.textContent = 'Sin datos para la selección actual.';
    emptyRow.appendChild(td);
    tbody.appendChild(emptyRow);
    return;
  }

  data.forEach(function (row) {
    var tr = document.createElement('tr');
    var qty = (Number(row[FIELD_QTY]) || 0) / QTY_DIVISOR;

    var tdDesc = document.createElement('td');
    tdDesc.textContent = row[FIELD_TRX_DESC];
    tr.appendChild(tdDesc);

    var tdQty = document.createElement('td');
    tdQty.className = 'numeric';
    tdQty.textContent = qty.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    tr.appendChild(tdQty);

    var tdUm = document.createElement('td');
    tdUm.textContent = row[FIELD_UM];
    tr.appendChild(tdUm);

    tbody.appendChild(tr);
  });
}

// ---------- Utilidades ----------

function populateSelect(selectEl, data, field) {
  selectEl.innerHTML = '';
  (data || []).forEach(function (row) {
    var value = row[field];
    if (value === null || value === undefined || value === '') return;
    var opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    selectEl.appendChild(opt);
  });
}

function getSelectedValues(selectEl) {
  return Array.prototype.slice.call(selectEl.selectedOptions).map(function (opt) {
    return opt.value;
  });
}

function buildInFilter(field, values) {
  var escaped = values.map(function (v) {
    return "'" + String(v).replace(/'/g, "''") + "'";
  });
  return field + ' in (' + escaped.join(',') + ')';
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
