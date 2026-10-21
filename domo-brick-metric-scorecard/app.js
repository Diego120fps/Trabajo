var domo = window.domo;
var datasets = window.datasets;

// ---------- Configuración de métricos ----------
//
// Cada objeto es UNA fila del tablero. Ajusta aquí tus métricos:
//
//   label      Nombre que se muestra en la fila.
//   dataset    Índice del dataset en los botones del brick (0 = primero,
//              1 = segundo, ...). Varios métricos pueden usar el mismo
//              dataset (ej. un dataset consolidado con columna "Metrica",
//              usando "filters" para separar cada uno).
//   dateField  Columna de fecha del dataset.
//   dateType   'julian' (JDE CYYDDD, ej. 126294) o 'date' ('YYYY-MM-DD').
//   valueField Columna a medir.
//   agg        'sum' | 'count' | 'countDistinct' | 'avg'.
//   divisor    (opcional) Se divide el resultado entre esto (ej. 100).
//   decimals   (opcional) Decimales a mostrar. Default 0.
//   prefix / suffix (opcional) Ej. '$' o '%'.
//   filters    (opcional) Filtros extra de la Data API, ej. ["ildct='IM'"].
var METRICS = [
  {
    label: 'Costo de transacciones',
    dataset: 0,
    dateField: 'iltrdj',
    dateType: 'julian',
    valueField: 'ilpaid',
    agg: 'sum',
    divisor: 100,
    decimals: 2,
    prefix: '$'
  },
  {
    label: 'Documentos',
    dataset: 0,
    dateField: 'iltrdj',
    dateType: 'julian',
    valueField: 'ildoc',
    agg: 'countDistinct'
  },
  {
    label: 'Métrico del dataset 2',
    dataset: 1,
    dateField: 'fecha',
    dateType: 'date',
    valueField: 'valor',
    agg: 'sum'
  }
];

// false = solo días CERRADOS (el YTD y los días de la semana llegan hasta
// ayer). true = incluye el día de hoy (parcial).
var INCLUDE_TODAY = false;

// La semana corre de lunes a domingo.
var MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
var DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

var GROUP_TITLES = {
  ytd: 'Año a la fecha',
  month: 'Meses cerrados',
  week: 'Semanas cerradas del mes',
  day: 'Días de la semana'
};

// Mismo criterio que el brick del pivote: para traer filas crudas se pagina
// con orderby fijo. Para 'sum' / 'count' se le pide a Domo que agrupe por
// día (máximo ~400 grupos), que es un resultado chico.
var PAGE_SIZE = 5000;
var MAX_PAGES = 500;
var GROUPBY_LIMIT = 5000;

var cutoffInput = document.getElementById('cutoffInput');
var btnActualizar = document.getElementById('btnActualizar');
var btnExport = document.getElementById('btnExport');
var statusMsg = document.getElementById('statusMsg');
var scorecardTable = document.getElementById('scorecardTable');
var legendEl = document.getElementById('legend');

// Periodos (columnas) y valores calculados del último tablero generado,
// usados para exportar.
var lastPeriods = [];
var lastValues = [];

init();

function init() {
  cutoffInput.value = toKey(today());
  btnActualizar.addEventListener('click', buildScorecard);
  btnExport.addEventListener('click', exportToExcel);
  buildScorecard();
}

// ---------- Paso 1: calcular las columnas (periodos) ----------

// Regresa la lista de periodos, en orden: YTD, meses cerrados, semanas
// cerradas del mes corriente y días de la semana corriente. Cada periodo
// tiene start/end como llaves 'YYYY-MM-DD' (inclusivas).
function buildPeriods(cutoff) {
  var periods = [];
  var year = cutoff.getFullYear();
  var month = cutoff.getMonth();
  var lastDay = INCLUDE_TODAY ? cutoff : addDays(cutoff, -1);

  var jan1 = new Date(year, 0, 1);
  if (lastDay >= jan1) {
    periods.push({ group: 'ytd', label: String(year), sub: '01 ene – ' + shortDate(lastDay), start: toKey(jan1), end: toKey(lastDay) });
  }

  for (var m = 0; m < month; m++) {
    periods.push({ group: 'month', label: MONTH_NAMES[m], start: toKey(new Date(year, m, 1)), end: toKey(new Date(year, m + 1, 0)) });
  }

  // Semanas que ya terminaron (domingo antes del lunes de esta semana) y
  // que tocan el mes corriente. Se recortan al día 1 del mes para no
  // repetir días que ya cuentan en el mes anterior.
  var monthStart = new Date(year, month, 1);
  var currentWeekStart = startOfWeek(cutoff);
  var weekStart = startOfWeek(monthStart);
  var weekNumber = 1;
  while (weekStart < currentWeekStart) {
    var weekEnd = addDays(weekStart, 6);
    var clippedStart = weekStart < monthStart ? monthStart : weekStart;
    periods.push({ group: 'week', label: 'Sem ' + weekNumber, sub: shortDate(clippedStart) + ' – ' + shortDate(weekEnd), start: toKey(clippedStart), end: toKey(weekEnd) });
    weekStart = addDays(weekStart, 7);
    weekNumber += 1;
  }

  for (var d = currentWeekStart; d <= lastDay; d = addDays(d, 1)) {
    periods.push({ group: 'day', label: DAY_NAMES[d.getDay()] + ' ' + d.getDate(), sub: shortDate(d), start: toKey(d), end: toKey(d) });
  }

  return periods;
}

// ---------- Paso 2: traer datos de cada métrico ----------

function buildScorecard() {
  var cutoff = parseKey(cutoffInput.value) || today();
  var periods = buildPeriods(cutoff);

  lastPeriods = periods;
  lastValues = METRICS.map(function () { return { state: 'loading' }; });
  renderTable(periods, lastValues);
  renderLegend(cutoff);

  if (periods.length === 0) {
    setStatus('No hay periodos cerrados para la fecha de corte seleccionada.');
    return;
  }

  // Rango total a consultar: del inicio más antiguo al fin más reciente.
  var rangeStart = periods.reduce(function (min, p) { return p.start < min ? p.start : min; }, periods[0].start);
  var rangeEnd = periods.reduce(function (max, p) { return p.end > max ? p.end : max; }, periods[0].end);

  setStatus('');
  var pending = METRICS.length;

  METRICS.forEach(function (metric, idx) {
    fetchDailyBuckets(metric, rangeStart, rangeEnd, function (buckets) {
      lastValues[idx] = {
        state: 'ok',
        values: periods.map(function (p) { return computePeriodValue(metric, buckets, p); })
      };
      renderTable(periods, lastValues);
      pending -= 1;
    }, function (err) {
      logError('Error cargando "' + metric.label + '"', err);
      lastValues[idx] = { state: 'error', message: describeError(err) };
      renderTable(periods, lastValues);
      setStatus('No se pudo cargar "' + metric.label + '". ' + describeError(err));
      pending -= 1;
    });
  });
}

// Deja los datos del métrico resumidos por día:
//   { 'YYYY-MM-DD': { sum, count, distinct: {valor: true} } }
// Así cualquier periodo (año, mes, semana, día) se arma sumando días.
function fetchDailyBuckets(metric, startKey, endKey, onDone, onError) {
  var datasetId = datasets[metric.dataset];
  if (!datasetId) {
    onError(new Error('No hay dataset en la posición ' + metric.dataset + ' del brick.'));
    return;
  }

  var filter = [
    metric.dateField + '>=' + dateFilterValue(metric, startKey),
    metric.dateField + '<=' + dateFilterValue(metric, endKey)
  ].concat(metric.filters || []).join(',');

  if (metric.agg === 'sum' || metric.agg === 'count') {
    var query = '/data/v1/' + datasetId +
      '?fields=' + metric.dateField + ',' + metric.valueField +
      '&' + metric.agg + '=' + metric.valueField +
      '&groupby=' + metric.dateField +
      '&filter=' + filter +
      '&orderby=' + metric.dateField +
      '&limit=' + GROUPBY_LIMIT;

    console.log('Query "' + metric.label + '":', query);
    domo.get(query)
      .then(function (rows) {
        var buckets = {};
        (rows || []).forEach(function (row) {
          var key = rowDateKey(metric, row[metric.dateField]);
          if (!key) return;
          var bucket = getBucket(buckets, key);
          var value = Number(row[metric.valueField]) || 0;
          bucket.sum += value;
          bucket.count += value;
        });
        onDone(buckets);
      })
      .catch(onError);
    return;
  }

  // 'countDistinct' y 'avg' no se pueden re-sumar desde agregados por día,
  // así que se traen las filas crudas (solo las 2 columnas necesarias).
  fetchAllRows(datasetId, metric, filter, function (rows) {
    var buckets = {};
    rows.forEach(function (row) {
      var key = rowDateKey(metric, row[metric.dateField]);
      if (!key) return;
      var bucket = getBucket(buckets, key);
      var raw = row[metric.valueField];
      if (raw === null || raw === undefined || raw === '') return;
      bucket.sum += Number(raw) || 0;
      bucket.count += 1;
      bucket.distinct[raw] = true;
    });
    onDone(buckets);
  }, onError);
}

function fetchAllRows(datasetId, metric, filter, onDone, onError) {
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
      '?fields=' + metric.dateField + ',' + metric.valueField +
      '&filter=' + filter +
      '&orderby=' + metric.dateField + ',' + metric.valueField +
      '&limit=' + PAGE_SIZE +
      '&offset=' + offset;

    console.log('Query "' + metric.label + '" (página ' + page + '):', query);

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

function getBucket(buckets, key) {
  if (!buckets[key]) {
    buckets[key] = { sum: 0, count: 0, distinct: {} };
  }
  return buckets[key];
}

// Junta los días del periodo y aplica la agregación del métrico.
function computePeriodValue(metric, buckets, period) {
  var sum = 0;
  var count = 0;
  var distinct = {};

  Object.keys(buckets).forEach(function (key) {
    if (key < period.start || key > period.end) return;
    var bucket = buckets[key];
    sum += bucket.sum;
    count += bucket.count;
    Object.keys(bucket.distinct).forEach(function (v) { distinct[v] = true; });
  });

  var value;
  if (metric.agg === 'sum') value = sum;
  else if (metric.agg === 'count') value = count;
  else if (metric.agg === 'countDistinct') value = Object.keys(distinct).length;
  else if (metric.agg === 'avg') value = count > 0 ? sum / count : null;
  else value = null;

  if (value !== null && metric.divisor) value = value / metric.divisor;
  return value;
}

// ---------- Paso 3: pintar la tabla ----------

function renderTable(periods, values) {
  var thead = scorecardTable.querySelector('thead');
  var tbody = scorecardTable.querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  // Fila 1: grupos (Año / Meses / Semanas / Días) con colspan.
  var groupRow = document.createElement('tr');
  groupRow.className = 'group-row';
  var corner = document.createElement('th');
  corner.rowSpan = 2;
  corner.className = 'metric-col';
  corner.textContent = 'Métrico';
  groupRow.appendChild(corner);

  groupSpans(periods).forEach(function (span) {
    var th = document.createElement('th');
    th.colSpan = span.count;
    th.className = 'group-' + span.group + ' group-start';
    th.textContent = GROUP_TITLES[span.group];
    groupRow.appendChild(th);
  });
  thead.appendChild(groupRow);

  // Fila 2: cada periodo, con su rango de fechas abajo.
  var periodRow = document.createElement('tr');
  periods.forEach(function (p, i) {
    var th = document.createElement('th');
    th.className = 'numeric-head group-' + p.group + (isGroupStart(periods, i) ? ' group-start' : '');
    th.textContent = p.label;
    if (p.sub) {
      var sub = document.createElement('div');
      sub.className = 'period-sub';
      sub.textContent = p.sub;
      th.appendChild(sub);
    }
    periodRow.appendChild(th);
  });
  thead.appendChild(periodRow);

  METRICS.forEach(function (metric, idx) {
    var tr = document.createElement('tr');
    var tdLabel = document.createElement('td');
    tdLabel.className = 'metric-col';
    tdLabel.textContent = metric.label;
    tr.appendChild(tdLabel);

    var result = values[idx];
    periods.forEach(function (p, i) {
      var td = document.createElement('td');
      td.className = 'numeric cell-' + p.group + (isGroupStart(periods, i) ? ' group-start' : '');
      if (result.state === 'loading') {
        td.textContent = '…';
        td.classList.add('muted');
      } else if (result.state === 'error') {
        td.textContent = 'Error';
        td.classList.add('error-cell');
        td.title = result.message;
      } else {
        td.textContent = formatValue(metric, result.values[i]);
      }
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

function groupSpans(periods) {
  var spans = [];
  periods.forEach(function (p) {
    var last = spans[spans.length - 1];
    if (last && last.group === p.group) {
      last.count += 1;
    } else {
      spans.push({ group: p.group, count: 1 });
    }
  });
  return spans;
}

function isGroupStart(periods, i) {
  return i === 0 || periods[i - 1].group !== periods[i].group;
}

function formatValue(metric, value) {
  if (value === null || value === undefined) return '–';
  var decimals = metric.decimals || 0;
  var text = value.toLocaleString('es-MX', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (metric.prefix || '') + text + (metric.suffix || '');
}

function renderLegend(cutoff) {
  var lastDay = INCLUDE_TODAY ? cutoff : addDays(cutoff, -1);
  legendEl.textContent = 'Datos hasta el ' + shortDate(lastDay) + ' ' + lastDay.getFullYear() +
    (INCLUDE_TODAY ? ' (incluye el día de hoy, parcial).' : ' (solo días cerrados).') +
    ' Semanas de lunes a domingo.';
}

// ---------- Exportar a Excel (CSV) ----------

function exportToExcel() {
  if (!lastPeriods.length) {
    setStatus('No hay datos para exportar.');
    return;
  }

  var headers = ['Métrico'].concat(lastPeriods.map(function (p) {
    return GROUP_TITLES[p.group] + ' - ' + p.label + (p.sub ? ' (' + p.sub + ')' : '');
  }));

  var rows = METRICS.map(function (metric, idx) {
    var result = lastValues[idx];
    return [metric.label].concat(lastPeriods.map(function (p, i) {
      return result.state === 'ok' ? result.values[i] : '';
    }));
  });

  downloadCSV('tablero_metricos.csv', toCSV(headers, rows));
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

// ---------- Fechas ----------

function today() {
  var now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// Lunes de la semana de "date".
function startOfWeek(date) {
  var offset = (date.getDay() + 6) % 7; // lunes -> 0, domingo -> 6
  return addDays(date, -offset);
}

function toKey(date) {
  return date.getFullYear() + '-' + ('0' + (date.getMonth() + 1)).slice(-2) + '-' + ('0' + date.getDate()).slice(-2);
}

function parseKey(key) {
  var parts = String(key || '').split('-');
  if (parts.length !== 3) return null;
  var date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  return isNaN(date.getTime()) ? null : date;
}

function shortDate(date) {
  return ('0' + date.getDate()).slice(-2) + ' ' + MONTH_NAMES[date.getMonth()].toLowerCase();
}

// Valor a usar en el filtro de la Data API según el tipo de fecha.
function dateFilterValue(metric, key) {
  if (metric.dateType === 'julian') return dateToJulian(parseKey(key));
  return "'" + key + "'";
}

// Fecha de una fila -> llave 'YYYY-MM-DD'.
function rowDateKey(metric, value) {
  if (value === null || value === undefined || value === '') return null;
  if (metric.dateType === 'julian') {
    var date = julianToDate(value);
    return date ? toKey(date) : null;
  }
  return String(value).substring(0, 10);
}

// Date -> entero juliano JDE CYYDDD (ej. 21/10/2026 -> 126294).
function dateToJulian(date) {
  var startOfYear = new Date(date.getFullYear(), 0, 1);
  var dayOfYear = Math.round((date - startOfYear) / 86400000) + 1;
  var century = Math.floor(date.getFullYear() / 100) - 19;
  return (century * 100000) + ((date.getFullYear() % 100) * 1000) + dayOfYear;
}

// Juliano JDE CYYDDD -> Date (o null si no es válido).
function julianToDate(value) {
  var num = Number(value);
  if (isNaN(num) || num <= 0) return null;

  var digits = ('000000' + String(Math.trunc(num))).slice(-6);
  var century = parseInt(digits.substring(0, 1), 10);
  var yy = parseInt(digits.substring(1, 3), 10);
  var dayOfYear = parseInt(digits.substring(3, 6), 10);
  if (dayOfYear < 1 || dayOfYear > 366) return null;

  return new Date(1900 + (century * 100) + yy, 0, dayOfYear);
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
