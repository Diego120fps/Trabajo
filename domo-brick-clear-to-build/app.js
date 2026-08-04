var domo = window.domo;
var datasets = window.datasets;

// ---------------------------------------------------------------------
// Orden esperado de los datasets del brick (se agregan en este orden con
// el botón de la esquina inferior izquierda del editor de bricks). Cada
// uno equivale a una tabla del SP_CTBPlan (kind = 1):
//
//   0 -> GDLRealTruck.data.Domo_Inventory        (inventario)
//   1 -> GDLRealTruck.data.opor                   (órdenes de compra/OPOR)
//   2 -> GDLRealTruck.data.Consumos               (consumos, Do Ty = 'IM')
//   3 -> GDLRealTruck.data.PlanCTB                (plan de producción)
//   4 -> GDLRealTruck.data.Domo_BillOfMaterial    (BOM)
// ---------------------------------------------------------------------
var DS_INVENTORY = datasets[0];
var DS_OPOR = datasets[1];
var DS_CONSUMOS = datasets[2];
var DS_PLAN = datasets[3];
var DS_BOM = datasets[4];

// Nombres de campo tal como aparecen en el SP_CTBPlan. Ajusta aquí si tu
// dataset en Domo usa otros alias.
var FIELD_INV_COMPONENT = 'ITEM_NUMBER_SECOND';
var FIELD_INV_QTY = 'ILOC_QTY_ON_HAND';
var FIELD_INV_BU = 'ITEM_BRANCH_PLANT';

var FIELD_OPOR_COMPONENT = 'Item_Number';
var FIELD_OPOR_DATE = 'DATE_REQUESTED_HEADER';
var FIELD_OPOR_QTY = 'primary_Qty';
var FIELD_OPOR_BU = 'ORDER_BUSINESS_UNIT';

var FIELD_CONS_COMPONENT = '2nd Item Number';
var FIELD_CONS_QTY = 'Trans QTY';
var FIELD_CONS_BU = 'Business Unit';
var FIELD_CONS_DOCTYPE = 'Do Ty';
var CONS_DOCTYPE_VALUE = 'IM';

var FIELD_PLAN_MODEL = 'Modelo';
var FIELD_PLAN_DATE = 'Fecha';
var FIELD_PLAN_QTY = 'qty';

var FIELD_BOM_FG = 'FINISHED_GOOD_ITEM_NUMBER';
var FIELD_BOM_COMPONENT = 'COMPONENT_ITEM_NUMBER';
var FIELD_BOM_QTY = 'COMPONENT_QUANTITY';

var PAGE_SIZE = 5000;
var MAX_PAGES = 500; // tope de seguridad: hasta 2.5M filas por consulta
var BOM_CHUNK_SIZE = 150; // modelos por consulta al filtrar el BOM con "in (...)"
var DISTINCT_LIMIT = 100000;

var buInput = document.getElementById('buInput');
var buList = document.getElementById('buList');
var searchInput = document.getElementById('searchInput');
var btnGenerar = document.getElementById('btnGenerar');
var btnLimpiar = document.getElementById('btnLimpiar');
var btnExport = document.getElementById('btnExport');
var statusMsg = document.getElementById('statusMsg');
var loadingEl = document.getElementById('loading');
var summaryEl = document.getElementById('summary');
var resultTable = document.getElementById('resultTable');

var lastResultRows = [];

init();

function init() {
  btnGenerar.addEventListener('click', generateCTB);
  btnLimpiar.addEventListener('click', resetAll);
  btnExport.addEventListener('click', exportToExcel);
  searchInput.addEventListener('input', function () {
    renderResult(filterRowsBySearch(lastResultRows, searchInput.value));
  });

  loadBusinessUnits();
  renderResult([]);
}

// ---------- Carga inicial: valores distintos de Business Unit/Plant ----------

function loadBusinessUnits() {
  var query = '/data/v1/' + DS_INVENTORY +
    '?fields=' + wrapField(FIELD_INV_BU) +
    '&groupby=' + wrapField(FIELD_INV_BU) +
    '&orderby=' + wrapField(FIELD_INV_BU) +
    '&limit=' + DISTINCT_LIMIT;

  domo.get(query)
    .then(function (data) {
      buList.innerHTML = '';
      distinctValues(data, FIELD_INV_BU).forEach(function (value) {
        var opt = document.createElement('option');
        opt.value = value;
        buList.appendChild(opt);
      });
    })
    .catch(function (err) {
      logError('Error cargando Business Unit / Plant', err);
    });
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

// ---------- Flujo principal: replica el cursor del SP_CTBPlan (kind = 1) ----------

function generateCTB() {
  var bu = buInput.value.trim();

  if (!bu) {
    setStatus('Captura un Business Unit / Plant.');
    return;
  }

  setStatus('');
  lastResultRows = [];
  renderResult([]);
  searchInput.value = '';
  showLoading(true, 'Cargando inventario...');

  loadInventory(bu, function (invMap) {
    showLoading(true, 'Cargando OPOR...');
    loadOpor(bu, function (oporMap) {
      showLoading(true, 'Cargando consumos...');
      loadConsumos(bu, function (consMap) {
        showLoading(true, 'Cargando plan de producción...');
        loadPlan(function (planRows) {
          var modelos = distinctValues(planRows, FIELD_PLAN_MODEL);

          if (modelos.length === 0) {
            finishCTB([]);
            return;
          }

          showLoading(true, 'Cargando BOM (' + modelos.length + ' modelos)...');
          loadBom(modelos, function (bomRows) {
            showLoading(true, 'Calculando balance...');
            var demand = buildDemand(planRows, bomRows);
            var resultRows = computeBalance(demand, invMap, oporMap, consMap);
            finishCTB(resultRows);
          }, handleGenerateError);
        }, handleGenerateError);
      }, handleGenerateError);
    }, handleGenerateError);
  }, handleGenerateError);
}

function handleGenerateError(err) {
  logError('Error generando el CTB', err);
  setStatus('No se pudo generar el CTB. ' + describeError(err));
  showLoading(false);
}

function finishCTB(resultRows) {
  lastResultRows = resultRows;
  renderResult(resultRows);
  showLoading(false);
  setStatus('');
}

// ---------- Paso 1: Inventario (Component -> InventoryQty) ----------

function loadInventory(bu, onDone, onError) {
  var filter = buildFieldFilter(FIELD_INV_BU, [bu]);

  fetchAllRows(DS_INVENTORY, [FIELD_INV_COMPONENT, FIELD_INV_QTY], filter, FIELD_INV_COMPONENT, function (rows) {
    var map = {};
    rows.forEach(function (row) {
      var component = normalizeComponent(row[FIELD_INV_COMPONENT]);
      var qty = toNumber(row[FIELD_INV_QTY]);
      map[component] = (map[component] || 0) + qty;
    });
    onDone(map);
  }, onError);
}

// ---------- Paso 2: OPOR (Component + Fecha -> OporQty) ----------

function loadOpor(bu, onDone, onError) {
  var filter = buildFieldFilter(FIELD_OPOR_BU, [bu]);

  fetchAllRows(DS_OPOR, [FIELD_OPOR_COMPONENT, FIELD_OPOR_DATE, FIELD_OPOR_QTY], filter, FIELD_OPOR_COMPONENT, function (rows) {
    var map = {};
    rows.forEach(function (row) {
      var component = normalizeComponent(row[FIELD_OPOR_COMPONENT]);
      var fecha = toDateKey(row[FIELD_OPOR_DATE]);
      if (!fecha) return;
      var key = component + '||' + fecha;
      var qty = toNumber(row[FIELD_OPOR_QTY]);
      map[key] = (map[key] || 0) + qty;
    });
    onDone(map);
  }, onError);
}

// ---------- Paso 3: Consumos, Do Ty = 'IM' (Component -> ConsumoQty) ----------

function loadConsumos(bu, onDone, onError) {
  var filter = combineFilters(
    buildFieldFilter(FIELD_CONS_BU, [bu]),
    [buildFieldFilter(FIELD_CONS_DOCTYPE, [CONS_DOCTYPE_VALUE])]
  );

  fetchAllRows(DS_CONSUMOS, [FIELD_CONS_COMPONENT, FIELD_CONS_QTY], filter, FIELD_CONS_COMPONENT, function (rows) {
    var map = {};
    rows.forEach(function (row) {
      var component = normalizeComponent(row[FIELD_CONS_COMPONENT]);
      var qty = toNumber(row[FIELD_CONS_QTY]);
      map[component] = (map[component] || 0) + qty;
    });
    onDone(map);
  }, onError);
}

// ---------- Paso 4: Plan de producción (sin filtro de BU, igual que el SP) ----------

function loadPlan(onDone, onError) {
  fetchAllRows(DS_PLAN, [FIELD_PLAN_MODEL, FIELD_PLAN_DATE, FIELD_PLAN_QTY], null, FIELD_PLAN_MODEL, onDone, onError);
}

// ---------- Paso 5: BOM filtrado solo por los modelos del plan ----------

function loadBom(modelos, onDone, onError) {
  var chunks = chunkArray(modelos, BOM_CHUNK_SIZE);
  var collected = [];

  function nextChunk(i) {
    if (i >= chunks.length) {
      onDone(collected);
      return;
    }

    var filter = buildFieldFilter(FIELD_BOM_FG, chunks[i]);
    fetchAllRows(DS_BOM, [FIELD_BOM_FG, FIELD_BOM_COMPONENT, FIELD_BOM_QTY], filter, FIELD_BOM_FG, function (rows) {
      collected = collected.concat(rows);
      nextChunk(i + 1);
    }, onError);
  }

  nextChunk(0);
}

// ---------- Paso 6: explota el plan contra el BOM -> demanda por Component/Fecha ----------

function buildDemand(planRows, bomRows) {
  var bomByFG = {};
  bomRows.forEach(function (row) {
    var component = normalizeComponent(row[FIELD_BOM_COMPONENT]);
    if (!component) return; // COMPONENT_ITEM_NUMBER IS NOT NULL en el SP
    var fg = row[FIELD_BOM_FG];
    if (!bomByFG[fg]) bomByFG[fg] = [];
    bomByFG[fg].push({ component: component, qty: toNumber(row[FIELD_BOM_QTY]) });
  });

  // key "Component||Fecha" -> { demandQty, modelos: Set }
  var demand = {};

  planRows.forEach(function (planRow) {
    var modelo = planRow[FIELD_PLAN_MODEL];
    var fecha = toDateKey(planRow[FIELD_PLAN_DATE]);
    var planQty = toNumber(planRow[FIELD_PLAN_QTY]);
    if (!fecha) return;

    var bomLines = bomByFG[modelo];
    if (!bomLines) return;

    bomLines.forEach(function (line) {
      var key = line.component + '||' + fecha;
      if (!demand[key]) {
        demand[key] = { component: line.component, fecha: fecha, demandQty: 0, modelos: {} };
      }
      demand[key].demandQty += line.qty * planQty;
      demand[key].modelos[modelo] = true;
    });
  });

  return demand;
}

// ---------- Paso 7: cursor de balance corrido (equivalente a los cursores del SP) ----------

function computeBalance(demand, invMap, oporMap, consMap) {
  // Agrupa las claves de demanda por Component, ordenadas por Fecha.
  var byComponent = {};
  Object.keys(demand).forEach(function (key) {
    var entry = demand[key];
    if (!byComponent[entry.component]) byComponent[entry.component] = [];
    byComponent[entry.component].push(entry);
  });

  var results = [];

  Object.keys(byComponent).forEach(function (component) {
    var rows = byComponent[component];
    rows.sort(function (a, b) { return a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0; });

    var runningInv = invMap[component] || 0;

    rows.forEach(function (row) {
      var oporQty = oporMap[component + '||' + row.fecha] || 0;
      var consumoQty = consMap[component] || 0;
      var demandQty = row.demandQty || 0;
      var balance = runningInv + oporQty - demandQty;

      results.push({
        fg: Object.keys(row.modelos).sort().join(', '),
        component: component,
        fecha: row.fecha,
        inventoryQty: runningInv,
        oporQty: oporQty,
        consumoQty: consumoQty,
        demandQty: demandQty,
        balance: balance,
        ctb: balance >= 0 ? 'YES' : 'NO'
      });

      runningInv = balance;
    });
  });

  // ORDER BY CTB, Fecha, ABS(Balance) DESC (igual que el SELECT final del SP)
  results.sort(function (a, b) {
    if (a.ctb !== b.ctb) return a.ctb < b.ctb ? -1 : 1;
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
    return Math.abs(b.balance) - Math.abs(a.balance);
  });

  return results;
}

// ---------- Render ----------

function filterRowsBySearch(rows, term) {
  term = (term || '').trim().toLowerCase();
  if (!term) return rows;
  return rows.filter(function (row) {
    return row.component.toLowerCase().indexOf(term) !== -1 ||
      row.fg.toLowerCase().indexOf(term) !== -1;
  });
}

function renderResult(rows) {
  var thead = resultTable.querySelector('thead');
  var tbody = resultTable.querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  var headers = ['FG', 'Componente', 'Fecha', 'Inventario', 'OPOR', 'Consumo', 'Demanda', 'Balance', 'CTB'];
  var headerRow = document.createElement('tr');
  headers.forEach(function (text) {
    var th = document.createElement('th');
    th.textContent = text;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  renderSummary(rows);

  if (!rows || rows.length === 0) {
    var emptyRow = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = headers.length;
    td.className = 'empty-cell';
    td.textContent = 'Sin datos para la selección actual.';
    emptyRow.appendChild(td);
    tbody.appendChild(emptyRow);
    return;
  }

  rows.forEach(function (row) {
    var tr = document.createElement('tr');
    tr.className = row.ctb === 'YES' ? 'ctb-yes' : 'ctb-no';

    [
      { value: row.fg },
      { value: row.component },
      { value: formatDateDisplay(row.fecha) },
      { value: formatNumber(row.inventoryQty), numeric: true },
      { value: formatNumber(row.oporQty), numeric: true },
      { value: formatNumber(row.consumoQty), numeric: true },
      { value: formatNumber(row.demandQty), numeric: true },
      { value: formatNumber(row.balance), numeric: true },
      { value: row.ctb }
    ].forEach(function (cell) {
      var tdEl = document.createElement('td');
      if (cell.numeric) tdEl.className = 'numeric';
      tdEl.textContent = cell.value;
      tr.appendChild(tdEl);
    });

    tbody.appendChild(tr);
  });
}

function renderSummary(rows) {
  if (!rows || rows.length === 0) {
    summaryEl.textContent = '';
    return;
  }
  var components = {};
  var noCount = 0;
  rows.forEach(function (row) {
    components[row.component] = true;
    if (row.ctb === 'NO') noCount += 1;
  });
  var componentCount = Object.keys(components).length;
  summaryEl.textContent = componentCount.toLocaleString('es-MX') + ' componente(s), ' +
    rows.length.toLocaleString('es-MX') + ' fila(s), ' +
    noCount.toLocaleString('es-MX') + ' con desabasto (CTB = NO)';
}

function formatNumber(value) {
  return (Number(value) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateDisplay(key) {
  if (!key) return '';
  var parts = key.split('-');
  if (parts.length !== 3) return key;
  return parts[2] + '/' + parts[1] + '/' + parts[0];
}

// ---------- Exportar a Excel (CSV) ----------

function exportToExcel() {
  var rows = filterRowsBySearch(lastResultRows, searchInput.value);
  if (!rows || rows.length === 0) {
    setStatus('No hay datos para exportar.');
    return;
  }

  var headers = ['FG', 'Componente', 'Fecha', 'Inventario', 'OPOR', 'Consumo', 'Demanda', 'Balance', 'CTB'];
  var csvRows = rows.map(function (row) {
    return [
      row.fg,
      row.component,
      formatDateDisplay(row.fecha),
      row.inventoryQty,
      row.oporQty,
      row.consumoQty,
      row.demandQty,
      row.balance,
      row.ctb
    ];
  });

  downloadCSV('clear_to_build.csv', toCSV(headers, csvRows));
}

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
  var blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
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

// Trae, en páginas de PAGE_SIZE, todas las filas que cumplen el filtro (sin
// groupby): igual que en el brick de Branch/Plant, se evita el groupby con
// SUM de la Data API porque en datasets grandes puede samplear/truncar en
// vez de escanear todo. El orderby es indispensable para que offset/limit
// recorra el conjunto completo sin huecos ni repeticiones.
function fetchAllRows(datasetId, fields, filter, orderbyField, onDone, onError) {
  var collected = [];
  var offset = 0;
  var page = 0;

  function fetchPage() {
    page += 1;
    if (page > MAX_PAGES) {
      onError(new Error('Se alcanzó el máximo de páginas (' + MAX_PAGES + ') leyendo el dataset ' + datasetId));
      return;
    }

    var query = '/data/v1/' + datasetId + '?fields=' + fields.map(wrapField).join(',');
    if (filter) query += '&filter=' + filter;
    if (orderbyField) query += '&orderby=' + wrapField(orderbyField);
    query += '&limit=' + PAGE_SIZE + '&offset=' + offset;

    console.log('Query CTB (página ' + page + ', offset ' + offset + '):', query);

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

// Un solo valor -> field='valor'. Varios valores -> field in ('a','b',...).
function buildFieldFilter(field, values) {
  var wrapped = wrapField(field);
  var escaped = values.map(function (v) {
    return "'" + String(v).replace(/'/g, "''") + "'";
  });
  if (escaped.length === 1) {
    return wrapped + '=' + escaped[0];
  }
  return wrapped + ' in (' + escaped.join(',') + ')';
}

// Varias condiciones se unen con COMA (equivale a AND) en la Data API de Domo.
function combineFilters(baseFilter, extraParts) {
  return [baseFilter].concat(extraParts).join(',');
}

// Nombres de campo con espacios u otros caracteres necesitan corchetes,
// ej. [2nd Item Number], [Do Ty]; los identificadores simples van tal cual.
function wrapField(name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : '[' + name + ']';
}

function chunkArray(arr, size) {
  var chunks = [];
  for (var i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function normalizeComponent(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function toNumber(value) {
  var num = Number(value);
  return isNaN(num) ? 0 : num;
}

// Convierte el valor de fecha del dataset (string ISO, datetime o epoch en
// milisegundos) a una llave 'YYYY-MM-DD' comparable, equivalente a
// CAST(... AS DATE) en el SP.
function toDateKey(value) {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number') {
    var fromEpoch = new Date(value);
    return isNaN(fromEpoch.getTime()) ? null : isoDateKey(fromEpoch);
  }

  var str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.substring(0, 10);

  var parsed = new Date(str);
  return isNaN(parsed.getTime()) ? null : isoDateKey(parsed);
}

function isoDateKey(date) {
  var y = date.getFullYear();
  var m = ('0' + (date.getMonth() + 1)).slice(-2);
  var d = ('0' + date.getDate()).slice(-2);
  return y + '-' + m + '-' + d;
}

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

function showLoading(show, msg) {
  loadingEl.style.display = show ? 'block' : 'none';
  loadingEl.textContent = msg || 'Cargando...';
}

function resetAll() {
  buInput.value = '';
  searchInput.value = '';
  lastResultRows = [];
  renderResult([]);
  setStatus('');
}
