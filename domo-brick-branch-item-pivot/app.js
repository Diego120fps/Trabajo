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

var branchCheckboxes = document.getElementById('branchCheckboxes');
var itemInput = document.getElementById('itemInput');
var btnGenerar = document.getElementById('btnGenerar');
var btnLimpiar = document.getElementById('btnLimpiar');
var statusMsg = document.getElementById('statusMsg');
var loadingEl = document.getElementById('loading');
var pivotTable = document.getElementById('pivotTable');

init();

function init() {
  btnGenerar.addEventListener('click', generatePivot);
  btnLimpiar.addEventListener('click', resetAll);

  loadBranches();
}

// ---------- Paso 1: cargar Branch/Plant como checkboxes ----------

function loadBranches() {
  showLoading(true);

  var query = '/data/v1/' + datasetId +
    '?fields=' + FIELD_BRANCH +
    '&groupby=' + FIELD_BRANCH +
    '&orderby=' + FIELD_BRANCH;

  console.log('Query Branch/Plant:', query);

  domo.get(query)
    .then(function (data) {
      renderBranchCheckboxes(data);
      showLoading(false);
    })
    .catch(function (err) {
      logError('Error cargando Branch/Plant', err);
      setStatus('No se pudo cargar Branch/Plant. ' + describeError(err));
      branchCheckboxes.innerHTML = '';
      showLoading(false);
    });
}

function renderBranchCheckboxes(data) {
  branchCheckboxes.innerHTML = '';

  var values = (data || [])
    .map(function (row) { return row[FIELD_BRANCH]; })
    .filter(function (v) { return v !== null && v !== undefined && v !== ''; });

  if (values.length === 0) {
    branchCheckboxes.innerHTML = '<span class="hint">No se encontraron valores.</span>';
    return;
  }

  values.forEach(function (value) {
    var label = document.createElement('label');

    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = value;
    checkbox.className = 'branch-checkbox';

    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(value));

    branchCheckboxes.appendChild(label);
  });
}

// ---------- Paso 2: generar el pivote filtrando por Branch/Plant + Item(s) ----------

function generatePivot() {
  var branches = getSelectedBranches();
  var items = getItemsFromInput();

  if (branches.length === 0) {
    setStatus('Selecciona al menos un Branch/Plant.');
    return;
  }
  if (items.length === 0) {
    setStatus('Escribe al menos un Item.');
    return;
  }

  setStatus('');
  clearTable();
  showLoading(true);

  var fields = [FIELD_TRX_DESC, FIELD_UM, FIELD_QTY];
  var groupby = [FIELD_TRX_DESC, FIELD_UM];

  // La Data API de Domo no soporta "and"/"or" ni paréntesis para combinar
  // condiciones: varias condiciones se unen con COMA (equivale a AND), y
  // "campo en varios valores" se expresa con el operador "in (...)".
  var filter = buildFieldFilter(FIELD_BRANCH, branches) + ',' + buildFieldFilter(FIELD_ITEM, items);

  var query = '/data/v1/' + datasetId +
    '?fields=' + fields.join() +
    '&groupby=' + groupby.join() +
    '&filter=' + filter +
    '&orderby=' + FIELD_TRX_DESC;

  console.log('Query Pivote:', query);

  domo.get(query)
    .then(function (data) {
      renderPivot(data);
      showLoading(false);
    })
    .catch(function (err) {
      logError('Error generando el pivote', err);
      setStatus('No se pudo generar el pivote. ' + describeError(err));
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

function getSelectedBranches() {
  var checked = branchCheckboxes.querySelectorAll('.branch-checkbox:checked');
  return Array.prototype.slice.call(checked).map(function (chk) {
    return chk.value;
  });
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
  var checked = branchCheckboxes.querySelectorAll('.branch-checkbox:checked');
  Array.prototype.forEach.call(checked, function (chk) { chk.checked = false; });
  itemInput.value = '';
  clearTable();
  setStatus('');
}
