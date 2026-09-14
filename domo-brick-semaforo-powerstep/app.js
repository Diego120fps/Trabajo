var domo = window.domo;
var datasets = window.datasets;

// Dataset seleccionado en el botón de la esquina inferior izquierda del brick
var datasetId = datasets[0];

// ---------- Nombres de campo del dataset (ajusta aquí si difieren) ----------
var FIELD_CATEGORY_PARENT = 'CategoryParent';
var FIELD_BRANCH_PLANT = 'ILOC_BRANCH_PLANT';
var FIELD_RACK = 'Rack';
var FIELD_ITEM = 'ITEM_NUMBER_SECOND';
var FIELD_ON_HAND = 'ON_HAND';
var FIELD_MINIMO = 'Minimo';
var FIELD_MAXIMO = 'Maximo';

// Todas las columnas que se piden al dataset: las de filtro más las que se
// muestran en la tabla.
var QUERY_FIELDS = [
  FIELD_CATEGORY_PARENT,
  FIELD_BRANCH_PLANT,
  FIELD_RACK,
  FIELD_ITEM,
  FIELD_ON_HAND,
  FIELD_MINIMO,
  FIELD_MAXIMO
];

// Columnas de la tabla de detalle (en orden), con el encabezado que se
// quiere mostrar. "%" y "Semaforo" son columnas calculadas, se agregan aparte.
var DISPLAY_COLUMNS = [
  { field: FIELD_ITEM, label: 'ITEM' },
  { field: FIELD_ON_HAND, label: 'ON_HAND' },
  { field: FIELD_MINIMO, label: 'MIN' },
  { field: FIELD_MAXIMO, label: 'MAX' }
];

// ---------- Filtros fijos ----------
var FILTER_CATEGORY_PARENT = 'Powerstep';
var FILTER_BRANCH_PLANT = '200';

// "Rack in ('M-','N-',...)" se interpreta como: el código de Rack EMPIEZA
// CON alguno de estos prefijos (ej. 'M-01' pertenece al prefijo 'M-').
// El operador "in" de la Data API de Domo no soporta booleano por prefijo,
// así que este filtro se aplica en el navegador después de traer las filas.
var RACK_PREFIXES = ['M-', 'N-', 'O-', 'P-', 'Q-', 'R-'];

// ---------- Umbrales del semáforo (sobre "%" calculado, ver calcPercent) ----------
var UMBRAL_ROJO = 0.2;     // % <= 0.2       -> Rojo
var UMBRAL_AMARILLO = 0.3; // % <= 0.3       -> Amarillo
var UMBRAL_MORADO = 0.7;   // % <= 0.7       -> Morado
// % > 0.7                                    -> Verde

var SEMAFORO_CONFIG = [
  { key: 'Rojo', label: 'Rojo', color: '#c0392b' },
  { key: 'Amarillo', label: 'Amarillo', color: '#f1c40f' },
  { key: 'Morado', label: 'Morado', color: '#8e44ad' },
  { key: 'Verde', label: 'Verde', color: '#27ae60' }
];

var SEMAFORO_COLOR_BY_KEY = {};
SEMAFORO_CONFIG.forEach(function (cfg) { SEMAFORO_COLOR_BY_KEY[cfg.key] = cfg.color; });

var PAGE_SIZE = 5000;
var MAX_PAGES = 500; // tope de seguridad: hasta 2.5M filas filtradas

var cardsEl = document.getElementById('cards');
var statusMsg = document.getElementById('statusMsg');
var loadingEl = document.getElementById('loading');
var btnRefrescar = document.getElementById('btnRefrescar');
var btnExportDetail = document.getElementById('btnExportDetail');
var detailTable = document.getElementById('detailTable');

// Filas ya filtradas (Powerstep + planta 200 + prefijos de Rack) con
// Semáforo calculable, listas para pintar tarjetas y la tabla completa.
var lastDetailRows = [];

init();

function init() {
  btnRefrescar.addEventListener('click', loadAndRender);
  btnExportDetail.addEventListener('click', exportDetailToExcel);
  renderCards({});
  renderDetail([]);
  loadAndRender();
}

function loadAndRender() {
  setStatus('');
  showLoading(true);
  renderDetail([]);

  var filter = combineFilters([
    buildFieldFilter(FIELD_CATEGORY_PARENT, FILTER_CATEGORY_PARENT),
    buildFieldFilter(FIELD_BRANCH_PLANT, FILTER_BRANCH_PLANT)
  ]);

  fetchAllFilteredRows(filter, function (rows) {
    var rackFiltered = rows.filter(function (row) {
      return matchesRackPrefix(row[FIELD_RACK]);
    });

    // Solo entran a tarjetas y tabla las filas con un Semáforo calculable
    // (ON_HAND y Minimo numéricos).
    var withSemaforo = rackFiltered.filter(function (row) {
      return calcSemaforo(row) !== null;
    });

    withSemaforo.sort(function (a, b) {
      return calcPercent(a) - calcPercent(b);
    });

    lastDetailRows = withSemaforo;
    renderCards(groupByColor(withSemaforo));
    renderDetail(withSemaforo);
    showLoading(false);
  }, function (err) {
    logError('Error cargando el semáforo', err);
    setStatus('No se pudo cargar la información. ' + describeError(err));
    showLoading(false);
  });
}

// true si el valor de Rack empieza con alguno de RACK_PREFIXES.
function matchesRackPrefix(rackValue) {
  var value = rackValue === null || rackValue === undefined ? '' : String(rackValue);
  return RACK_PREFIXES.some(function (prefix) {
    return value.indexOf(prefix) === 0;
  });
}

// Calcula "%" según el CASE:
//   WHEN Minimo = 0 THEN 1
//   ELSE ON_HAND / Minimo
// Filas sin ON_HAND/Minimo numéricos regresan null (quedan fuera del conteo).
function calcPercent(row) {
  var minimo = Number(row[FIELD_MINIMO]);
  var onHand = Number(row[FIELD_ON_HAND]);

  if (isNaN(minimo) || isNaN(onHand)) return null;
  if (minimo === 0) return 1;
  return onHand / minimo;
}

// Calcula el Semáforo de una fila según el CASE:
//   %  <= 0.2 -> Rojo
//   %  <= 0.3 -> Amarillo
//   %  <= 0.7 -> Morado
//   %  > 0.7  -> Verde
// Filas sin un "%" numérico no entran a ningún color (quedan fuera del conteo).
function calcSemaforo(row) {
  var pct = calcPercent(row);
  if (pct === null) return null;

  if (pct <= UMBRAL_ROJO) return 'Rojo';
  if (pct <= UMBRAL_AMARILLO) return 'Amarillo';
  if (pct <= UMBRAL_MORADO) return 'Morado';
  return 'Verde';
}

function groupByColor(rows) {
  var groups = { Rojo: [], Amarillo: [], Morado: [], Verde: [] };
  rows.forEach(function (row) {
    var color = calcSemaforo(row);
    if (color && groups[color]) {
      groups[color].push(row);
    }
  });
  return groups;
}

// ---------- Tarjetas: una por color, con el count de Semáforo ----------

function renderCards(groups) {
  cardsEl.innerHTML = '';

  SEMAFORO_CONFIG.forEach(function (cfg) {
    var count = (groups[cfg.key] || []).length;

    var card = document.createElement('div');
    card.className = 'kpi-card';
    card.style.borderTopColor = cfg.color;

    var label = document.createElement('div');
    label.className = 'kpi-label';
    label.textContent = cfg.label;

    var value = document.createElement('div');
    value.className = 'kpi-value';
    value.style.color = cfg.color;
    value.textContent = count.toLocaleString('es-MX');

    card.appendChild(label);
    card.appendChild(value);
    cardsEl.appendChild(card);
  });
}

// ---------- Tabla de detalle: todas las filas, con el td de Semáforo pintado ----------

function renderDetail(rows) {
  var thead = detailTable.querySelector('thead');
  var tbody = detailTable.querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  var headerLabels = DISPLAY_COLUMNS.map(function (col) { return col.label; }).concat(['%', 'Semaforo']);

  var headerRow = document.createElement('tr');
  headerLabels.forEach(function (text) {
    var th = document.createElement('th');
    th.textContent = text;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  if (!rows || rows.length === 0) {
    var emptyRow = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = headerLabels.length;
    td.className = 'empty-cell';
    td.textContent = 'Sin datos para el filtro actual.';
    emptyRow.appendChild(td);
    tbody.appendChild(emptyRow);
    return;
  }

  rows.forEach(function (row) {
    var tr = document.createElement('tr');

    DISPLAY_COLUMNS.forEach(function (col) {
      var tdEl = document.createElement('td');
      tdEl.textContent = row[col.field];
      tr.appendChild(tdEl);
    });

    var pct = calcPercent(row);
    var tdPercent = document.createElement('td');
    tdPercent.className = 'numeric';
    tdPercent.textContent = pct === null ? '' : pct.toLocaleString('es-MX', { style: 'percent', minimumFractionDigits: 1 });
    tr.appendChild(tdPercent);

    var color = calcSemaforo(row);
    var tdSemaforo = document.createElement('td');
    tdSemaforo.textContent = color;
    tdSemaforo.style.backgroundColor = SEMAFORO_COLOR_BY_KEY[color] || '';
    tdSemaforo.style.color = '#fff';
    tdSemaforo.style.fontWeight = '600';
    tdSemaforo.style.textAlign = 'center';
    tr.appendChild(tdSemaforo);

    tbody.appendChild(tr);
  });
}

// ---------- Exportar a Excel (CSV) ----------

function exportDetailToExcel() {
  if (!lastDetailRows || lastDetailRows.length === 0) {
    setStatus('No hay datos para exportar.');
    return;
  }

  var headers = DISPLAY_COLUMNS.map(function (col) { return col.label; }).concat(['%', 'Semaforo']);
  var rows = lastDetailRows.map(function (row) {
    return DISPLAY_COLUMNS.map(function (col) { return row[col.field]; }).concat([calcPercent(row), calcSemaforo(row)]);
  });

  downloadCSV('semaforo_powerstep.csv', toCSV(headers, rows));
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
  // BOM UTF-8 para que Excel muestre bien acentos/ñ.
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

// ---------- Data API: filtro + paginación ----------

// field='valor', con la comilla simple escapada.
function buildFieldFilter(field, value) {
  return encodeURIComponent(field) + "='" + String(value).replace(/'/g, "''") + "'";
}

// Varias condiciones se unen con COMA (equivale a AND).
function combineFilters(parts) {
  return parts.join(',');
}

// Trae, en páginas de PAGE_SIZE, todas las filas que cumplen el filtro
// (sin groupby), acumulándolas hasta que una página regresa menos filas
// de las pedidas (fin de los datos). orderby fijo es indispensable para
// que offset/limit recorra TODO el conjunto sin huecos ni repeticiones.
function fetchAllFilteredRows(filter, onDone, onError) {
  var fieldsParam = QUERY_FIELDS.map(encodeURIComponent).join();
  var orderbyField = encodeURIComponent(FIELD_ITEM);
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
      '?fields=' + fieldsParam +
      '&filter=' + filter +
      '&orderby=' + orderbyField +
      '&limit=' + PAGE_SIZE +
      '&offset=' + offset;

    console.log('Query Semáforo (página ' + page + ', offset ' + offset + '):', query);
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

function showLoading(show) {
  loadingEl.style.display = show ? 'block' : 'none';
}
