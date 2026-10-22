var domo = window.domo;
var datasets = window.datasets;

// Dataset consolidado (salida del ETL "Tablero Metricos - Consolidado"),
// seleccionado en el botón de dataset del brick. Una fila por
// Planta + Metrico + Fecha, con estas columnas:
var FIELD_PLANTA = 'Planta';
var FIELD_METRICO = 'Metrico';
var FIELD_FECHA = 'Fecha';     // tipo Date ('YYYY-MM-DD')
var FIELD_VALOR = 'Valor';     // numerador (o el valor tal cual)
var FIELD_BASE = 'Base';       // denominador (vacío = solo se suma Valor)
var FIELD_FORMATO = 'Formato'; // '%', '$' o '#'

var datasetId = datasets[0];

// Orden de las filas. Los métricos que no estén aquí se agregan al final
// en orden alfabético.
var METRIC_ORDER = ['Accuracy', 'Capacidad', 'Days of Supply', 'Inventario'];

// Cálculo por periodo:
//   - Si la rama del ETL llena Base -> SUM(Valor) / SUM(Base) del periodo
//     (porcentajes, días de inventario, o promedios de una foto diaria
//     usando Base = 1 por día). Nunca se promedian valores diarios ya
//     divididos.
//   - Si Base viene vacía/0 -> SUM(Valor) (flujos: costo, piezas, ...).
// Formato solo decide cómo se muestra: '%' (x100), '$', '#' o 'd' (días).
var FORMAT_DECIMALS = { '%': 1, '$': 2, '#': 0, 'd': 1 };

// Métricos "foto al cierre": cada periodo toma SOLO el último día con datos
// dentro de su rango (fin de mes, fin de semana, el día mismo; el año queda
// como el valor al corte). Ese día se suman todas las plantas y se aplica
// la misma regla Valor / Base.
var LAST_DAY_METRICS = ['Days of Supply', 'Inventario'];

// false = solo días CERRADOS (el YTD y los días de la semana llegan hasta
// ayer). true = incluye el día de hoy (parcial).
var INCLUDE_TODAY = false;

var ALL_PLANTS = 'Todas';

// La semana corre de lunes a domingo.
var MONTH_NAMES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
var DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

var GROUP_TITLES = {
  ytd: 'Año a la fecha',
  month: 'Meses cerrados',
  week: 'Semanas cerradas del mes',
  day: 'Días de la semana'
};

// El dataset ya viene agregado por día, así que es chico (plantas x
// métricos x días); se trae COMPLETO en páginas con orderby fijo y se
// agrega en el navegador (cada periodo solo suma los días de su rango).
// No se filtra la fecha en el servidor: el filtro Fecha>='YYYY-MM-DD' de
// la Data API falló sin dar detalle. Cambiar de planta no vuelve a consultar.
var PAGE_SIZE = 5000;
var MAX_PAGES = 200;

var plantRadios = document.getElementById('plantRadios');
var cutoffInput = document.getElementById('cutoffInput');
var btnActualizar = document.getElementById('btnActualizar');
var btnExport = document.getElementById('btnExport');
var statusMsg = document.getElementById('statusMsg');
var scorecardTable = document.getElementById('scorecardTable');
var legendEl = document.getElementById('legend');

// Filas del último rango consultado, y lo que se pintó (para exportar).
var lastRows = [];
var lastPeriods = [];
var lastMetrics = [];

init();

function init() {
  cutoffInput.value = toKey(today());
  btnActualizar.addEventListener('click', loadData);
  btnExport.addEventListener('click', exportToExcel);
  plantRadios.addEventListener('change', render);
  loadData();
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

// ---------- Paso 2: traer el dataset consolidado del rango ----------

function loadData() {
  var cutoff = parseKey(cutoffInput.value) || today();
  var periods = buildPeriods(cutoff);

  lastPeriods = periods;
  lastRows = [];
  renderLegend(cutoff);

  if (periods.length === 0) {
    render();
    setStatus('No hay periodos cerrados para la fecha de corte seleccionada.');
    return;
  }

  setStatus('Cargando...');
  fetchAllRows(function (rows) {
    lastRows = rows;
    renderPlantRadios(rows);
    render();
    setStatus('');
  }, function (err) {
    logError('Error cargando el dataset consolidado', err);
    setStatus('No se pudo cargar el dataset. ' + describeError(err));
    showDatasetColumns();
  });
}

// Diagnóstico: si la consulta falla, pide 1 fila sin "fields" para mostrar
// qué columnas trae realmente el dataset de la posición 0 (un nombre mal
// escrito o con otra mayúscula hace fallar toda la consulta).
function showDatasetColumns() {
  domo.get('/data/v1/' + datasetId + '?limit=1')
    .then(function (data) {
      var row = (data || [])[0];
      var columns = row ? Object.keys(row).join(', ') : '(dataset vacío)';
      var expected = [FIELD_PLANTA, FIELD_METRICO, FIELD_FECHA, FIELD_VALOR, FIELD_BASE, FIELD_FORMATO].join(', ');
      setStatus(statusMsg.textContent + ' | Columnas del dataset: ' + columns + ' | Esperadas: ' + expected);
    })
    .catch(function (err) {
      logError('Error leyendo 1 fila del dataset', err);
      setStatus(statusMsg.textContent + ' | Tampoco se pudo leer 1 fila: revisa que el dataset esté asignado en la posición 0 del brick.');
    });
}

function fetchAllRows(onDone, onError) {
  var fields = [FIELD_PLANTA, FIELD_METRICO, FIELD_FECHA, FIELD_VALOR, FIELD_BASE, FIELD_FORMATO];
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
      '&orderby=' + FIELD_METRICO + ',' + FIELD_PLANTA + ',' + FIELD_FECHA +
      '&limit=' + PAGE_SIZE +
      '&offset=' + offset;

    console.log('Query Tablero (página ' + page + '):', query);

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

// ---------- Planta: radios dinámicos según lo que venga en el dataset ----------

function renderPlantRadios(rows) {
  var current = getSelectedPlant();
  var plants = distinctValues(rows, FIELD_PLANTA);

  plantRadios.innerHTML = '';
  [ALL_PLANTS].concat(plants).forEach(function (plant) {
    var label = document.createElement('label');

    var radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'plantRadio';
    radio.value = plant;
    radio.className = 'plant-radio';
    radio.checked = plant === current;

    label.appendChild(radio);
    label.appendChild(document.createTextNode(plant));
    plantRadios.appendChild(label);
  });

  if (!plantRadios.querySelector('.plant-radio:checked')) {
    plantRadios.querySelector('.plant-radio').checked = true;
  }
}

function getSelectedPlant() {
  var checked = plantRadios.querySelector('.plant-radio:checked');
  return checked ? checked.value : ALL_PLANTS;
}

// ---------- Paso 3: agregar por métrico y periodo ----------

function render() {
  var plant = getSelectedPlant();
  var rows = lastRows.filter(function (row) {
    return plant === ALL_PLANTS || row[FIELD_PLANTA] === plant;
  });

  lastMetrics = aggregateMetrics(rows, lastPeriods);
  renderTable(lastPeriods, lastMetrics);
}

// Regresa [{ name, format, values: [valor por periodo] }] en el orden de
// METRIC_ORDER. Valor y Base se suman por periodo y al final se divide
// (si hay Base), así el % o los días del mes ponderan bien cada día.
function aggregateMetrics(rows, periods) {
  var byMetric = {};

  rows.forEach(function (row) {
    var name = row[FIELD_METRICO];
    var key = String(row[FIELD_FECHA] || '').substring(0, 10);
    if (!name || !key) return;

    if (!byMetric[name]) {
      byMetric[name] = {
        name: name,
        format: row[FIELD_FORMATO] || '#',
        totals: periods.map(function () { return { valor: 0, base: 0, lastKey: '' }; })
      };
    }

    var valor = Number(row[FIELD_VALOR]) || 0;
    var base = Number(row[FIELD_BASE]) || 0;
    var lastDayOnly = LAST_DAY_METRICS.indexOf(name) !== -1;
    periods.forEach(function (p, i) {
      if (key < p.start || key > p.end) return;
      var t = byMetric[name].totals[i];
      if (lastDayOnly) {
        if (key < t.lastKey) return;
        if (key > t.lastKey) {
          t.lastKey = key;
          t.valor = 0;
          t.base = 0;
        }
      }
      t.valor += valor;
      t.base += base;
    });
  });

  var metrics = Object.keys(byMetric).map(function (name) {
    var metric = byMetric[name];
    metric.values = metric.totals.map(function (t) {
      if (t.base > 0) return t.valor / t.base;
      // Un cociente sin denominador en el periodo no tiene valor.
      if (metric.format === '%' || metric.format === 'd') return null;
      return t.valor;
    });
    return metric;
  });

  metrics.sort(function (a, b) {
    var ia = METRIC_ORDER.indexOf(a.name);
    var ib = METRIC_ORDER.indexOf(b.name);
    if (ia === -1) ia = METRIC_ORDER.length;
    if (ib === -1) ib = METRIC_ORDER.length;
    return ia !== ib ? ia - ib : String(a.name).localeCompare(String(b.name));
  });

  return metrics;
}

// ---------- Paso 4: pintar la tabla ----------

function renderTable(periods, metrics) {
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

  if (metrics.length === 0) {
    var emptyRow = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = periods.length + 1;
    td.className = 'empty-cell';
    td.textContent = 'Sin datos para la selección actual.';
    emptyRow.appendChild(td);
    tbody.appendChild(emptyRow);
    return;
  }

  metrics.forEach(function (metric) {
    var tr = document.createElement('tr');
    var tdLabel = document.createElement('td');
    tdLabel.className = 'metric-col';
    tdLabel.textContent = metric.name;
    tr.appendChild(tdLabel);

    periods.forEach(function (p, i) {
      var tdValue = document.createElement('td');
      tdValue.className = 'numeric cell-' + p.group + (isGroupStart(periods, i) ? ' group-start' : '');
      tdValue.textContent = formatValue(metric.format, metric.values[i]);
      tr.appendChild(tdValue);
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

function formatValue(format, value) {
  if (value === null || value === undefined) return '–';
  var decimals = FORMAT_DECIMALS[format] !== undefined ? FORMAT_DECIMALS[format] : 0;
  var shown = format === '%' ? value * 100 : value;
  var text = shown.toLocaleString('es-MX', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (format === '%') return text + '%';
  if (format === '$') return '$' + text;
  return text;
}

function renderLegend(cutoff) {
  var lastDay = INCLUDE_TODAY ? cutoff : addDays(cutoff, -1);
  legendEl.textContent = 'Datos hasta el ' + shortDate(lastDay) + ' ' + lastDay.getFullYear() +
    (INCLUDE_TODAY ? ' (incluye el día de hoy, parcial).' : ' (solo días cerrados).') +
    ' Semanas de lunes a domingo.';
}

// ---------- Exportar a Excel (CSV) ----------

function exportToExcel() {
  if (!lastMetrics.length) {
    setStatus('No hay datos para exportar.');
    return;
  }

  var headers = ['Planta', 'Métrico'].concat(lastPeriods.map(function (p) {
    return GROUP_TITLES[p.group] + ' - ' + p.label + (p.sub ? ' (' + p.sub + ')' : '');
  }));

  var plant = getSelectedPlant();
  var rows = lastMetrics.map(function (metric) {
    return [plant, metric.name].concat(metric.values.map(function (v) {
      if (v === null) return '';
      return metric.format === '%' ? v * 100 : v;
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

// ---------- Utilidades ----------

function distinctValues(rows, field) {
  var seen = {};
  var values = [];
  rows.forEach(function (row) {
    var v = row[field];
    if (v === null || v === undefined || v === '' || seen[v]) return;
    seen[v] = true;
    values.push(v);
  });
  values.sort();
  return values;
}

function describeError(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err.status) return 'HTTP ' + err.status + (err.statusText ? ' ' + err.statusText : '');
  if (err.message) return err.message;
  if (err.responseText) return err.responseText;
  var text = '';
  try {
    text = JSON.stringify(err);
  } catch (e) {
    text = '';
  }
  // Algunos errores se serializan como "{}"; String() al menos da el tipo.
  return text && text !== '{}' ? text : String(err);
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
