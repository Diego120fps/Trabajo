var domo = window.domo;
var datasets = window.datasets;

// Dataset seleccionada en el botón de la esquina inferior izquierda del brick.
// Se espera una dataset de FOTOS (snapshots) del inventario: una o varias
// filas por día y planta con el valor del inventario a esa fecha.
var datasetId = datasets[0];

// Nombres de campo del dataset (ajusta aquí si tu dataset usa otros alias)
var FIELD_FECHA = 'fecha';            // Fecha de la foto del inventario
var FIELD_PLANTA = 'planta';          // Branch/Plant
var FIELD_VALOR = 'valor_inventario'; // Valor del inventario ($)
var FIELD_ITEM = 'item';              // Item (para el Top 100)
var FIELD_ITEM_DESC = 'descripcion';  // Descripción del item ('' si la dataset no la trae)

// Formato de FIELD_FECHA: 'iso' (AAAA-MM-DD, columna fecha de Domo) o
// 'julian' (entero JDE CYYDDD, como iltrdj).
var DATE_FORMAT = 'iso';

// Si el valor viene en centavos (como ilpaid) pon 100.
var VALUE_DIVISOR = 1;

// Si no hay foto exactamente en la fecha de cierre (fin de semana, carga
// faltante), se usa la foto más reciente ANTERIOR a esa fecha, buscando
// hasta este número de días hacia atrás.
var LOOKBACK_DAYS = 7;

// Hay registros donde Branch/Plant viene en blanco; esos registros en
// realidad pertenecen al branch 1221 por defecto.
var DEFAULT_BRANCH = '1221';

// Cada radio agrupa uno o varios códigos crudos de Branch/Plant bajo un
// nombre de planta. "Todas" suma todo lo que venga en la dataset.
var BRANCH_GROUPS = [
  { label: 'Plataforma', codes: ['1221', '2300'] },
  { label: 'Laredo', codes: ['5130', '5140'] },
  { label: 'AMP', codes: ['2200'] },
  { label: 'Calle2', codes: ['2190'] },
  { label: 'CDI', codes: ['1122'] }
];
var ALL_LABEL = 'Todas';
var TOTAL_KEY = '__total__';
var TOP_N = 100;

var GROUP_BY_CODE = {};
BRANCH_GROUPS.forEach(function (group) {
  group.codes.forEach(function (code) { GROUP_BY_CODE[code] = group.label; });
});

var PAGE_SIZE = 50000;
var MAX_PAGES = 50;

var MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
var DAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

var plantRadios = document.getElementById('plantRadios');
var corteInput = document.getElementById('corteInput');
var btnActualizar = document.getElementById('btnActualizar');
var btnExport = document.getElementById('btnExport');
var statusMsg = document.getElementById('statusMsg');
var loadingEl = document.getElementById('loading');
var invTable = document.getElementById('invTable');
var footNote = document.getElementById('footNote');
var topTable = document.getElementById('topTable');
var topLoading = document.getElementById('topLoading');
var btnExportTop = document.getElementById('btnExportTop');

// Resultado del último cálculo, usado para exportar.
var lastSections = [];
var lastRows = [];
var lastTopCompares = [];
var lastTopRows = [];

// Cada refresh incrementa este contador; respuestas de cargas anteriores
// (ej. el usuario cambió de planta a media carga) se descartan.
var requestSeq = 0;

init();

function init() {
  btnActualizar.addEventListener('click', refresh);
  btnExport.addEventListener('click', exportToExcel);
  btnExportTop.addEventListener('click', exportTopToExcel);
  plantRadios.addEventListener('change', refresh);

  renderPlantRadios();
  corteInput.value = toKey(new Date());
  refresh();
}

function renderPlantRadios() {
  plantRadios.innerHTML = '';

  [ALL_LABEL].concat(BRANCH_GROUPS.map(function (g) { return g.label; })).forEach(function (labelText) {
    var label = document.createElement('label');

    var radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'plantRadio';
    radio.value = labelText;
    radio.className = 'plant-radio';
    radio.checked = labelText === ALL_LABEL;

    label.appendChild(radio);
    label.appendChild(document.createTextNode(labelText));

    plantRadios.appendChild(label);
  });
}

function getSelectedPlant() {
  var checked = plantRadios.querySelector('.plant-radio:checked');
  return checked ? checked.value : ALL_LABEL;
}

// ---------- Periodos: cierres de mes, semanas cerradas del mes y días de la semana ----------

// Solo se toman días cerrados: el último día con datos es el día ANTERIOR
// a la fecha de corte.
function buildSections(lastClosed) {
  var year = lastClosed.getFullYear();
  var month = lastClosed.getMonth();

  // Meses cerrados del año: el cierre es el último día del mes y se compara
  // contra el cierre del mes anterior (enero contra 31 dic del año pasado).
  // Si el último día cerrado es fin de mes, ese mes también cuenta.
  var lastMonth = isLastDayOfMonth(lastClosed) ? month : month - 1;
  var months = [];
  for (var m = 0; m <= lastMonth; m++) {
    var close = new Date(year, m + 1, 0);
    months.push({
      label: MONTHS_SHORT[m].toUpperCase(),
      sub: 'cierre ' + formatShort(close),
      close: close,
      prev: new Date(year, m, 0)
    });
  }

  // Semanas (lunes a domingo) del mes en curso que ya cerraron: el cierre
  // es el domingo y se compara contra el domingo anterior. La primera
  // semana puede arrancar a medio semana (día 1 del mes).
  var weeks = [];
  var firstOfMonth = new Date(year, month, 1);
  var sunday = addDays(firstOfMonth, (7 - firstOfMonth.getDay()) % 7);
  while (sunday <= lastClosed) {
    var monday = addDays(sunday, -6);
    var start = monday < firstOfMonth ? firstOfMonth : monday;
    weeks.push({
      label: 'SEM ' + (weeks.length + 1),
      sub: formatShort(start) + ' – ' + formatShort(sunday),
      close: sunday,
      prev: addDays(sunday, -7)
    });
    sunday = addDays(sunday, 7);
  }

  // Días cerrados de la semana en curso (desde el lunes), cada uno contra
  // el día anterior.
  var days = [];
  var day = addDays(lastClosed, -((lastClosed.getDay() + 6) % 7));
  while (day <= lastClosed) {
    days.push({
      label: DAYS_SHORT[day.getDay()].toUpperCase() + ' ' + day.getDate(),
      sub: formatShort(day),
      close: day,
      prev: addDays(day, -1)
    });
    day = addDays(day, 1);
  }

  return [
    { title: 'Cierre de mes', css: 'sec-month', periods: months, empty: 'Sin meses cerrados' },
    { title: 'Cierre de semanas del mes', css: 'sec-week', periods: weeks, empty: 'Sin semanas cerradas' },
    { title: 'Días de la semana', css: 'sec-day', periods: days, empty: 'Sin días cerrados' }
  ];
}

// ---------- Carga de datos ----------

function refresh() {
  if (!corteInput.value) {
    setStatus('Selecciona una fecha de corte.');
    return;
  }

  var corte = parseKey(corteInput.value);
  var lastClosed = addDays(corte, -1);
  var sections = buildSections(lastClosed);

  // Rango a pedir: desde el "periodo anterior" más viejo (menos el margen
  // para buscar la foto previa) hasta el último día cerrado.
  var minDate = lastClosed;
  sections.forEach(function (section) {
    section.periods.forEach(function (p) {
      if (p.prev < minDate) minDate = p.prev;
    });
  });
  minDate = addDays(minDate, -LOOKBACK_DAYS);

  setStatus('');
  showLoading(true);
  clearTopTable();
  var seq = ++requestSeq;

  fetchDailyTotals(minDate, lastClosed, function (rows) {
    if (seq !== requestSeq) return;
    var series = buildSeries(rows);
    var plant = getSelectedPlant();
    var rowKeys = plant === ALL_LABEL
      ? BRANCH_GROUPS.map(function (g) { return g.label; }).concat([TOTAL_KEY])
      : [plant];

    lastSections = sections;
    lastRows = rowKeys.map(function (key) {
      return {
        label: key === TOTAL_KEY ? 'Total' : key,
        isTotal: key === TOTAL_KEY,
        cells: sections.map(function (section) {
          return section.periods.map(function (p) {
            return buildCell(series, key, p);
          });
        })
      };
    });

    renderTable(sections, lastRows);
    footNote.textContent = 'Valor del inventario al cierre de cada periodo. Datos hasta el ' +
      formatLong(lastClosed) + ' (solo días cerrados). Semanas de lunes a domingo. ' +
      '▲/▼ respecto al periodo anterior (mes vs mes, semana vs semana, día vs día). ' +
      '* = no hubo foto ese día, se usa la más reciente anterior.';
    showLoading(false);

    loadTopItems(series, lastClosed, plant, seq);
  }, function (err) {
    if (seq !== requestSeq) return;
    logError('Error cargando el valor del inventario', err);
    setStatus('No se pudo cargar el valor del inventario. ' + describeError(err));
    showLoading(false);
  });
}

// Pide a Domo la suma del valor por fecha + planta dentro del rango. El
// resultado es chico (días x plantas), pero se pagina por seguridad.
function fetchDailyTotals(fromDate, toDate, onDone, onError) {
  var filter = [
    FIELD_FECHA + '>=' + dateFilterValue(fromDate),
    FIELD_FECHA + '<=' + dateFilterValue(toDate)
  ].join(',');

  fetchGrouped([FIELD_FECHA, FIELD_PLANTA], filter, onDone, onError);
}

// Suma FIELD_VALOR agrupando por groupFields, leyendo en páginas de
// PAGE_SIZE hasta que una página regresa menos filas de las pedidas.
function fetchGrouped(groupFields, filter, onDone, onError) {
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
      '?fields=' + groupFields.concat([FIELD_VALOR]).join() +
      '&sum=' + FIELD_VALOR +
      '&groupby=' + groupFields.join() +
      '&filter=' + filter +
      '&orderby=' + groupFields.join() +
      '&limit=' + PAGE_SIZE +
      '&offset=' + offset;

    console.log('Query Inventario (página ' + page + '):', query);

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

// series[fechaKey][planta|TOTAL_KEY] = valor; además la lista ordenada de
// fechas con datos para poder buscar la foto más reciente <= una fecha.
function buildSeries(rows) {
  var byDate = {};

  rows.forEach(function (row) {
    var key = rowDateKey(row[FIELD_FECHA]);
    if (!key) return;

    var value = (Number(row[FIELD_VALOR]) || 0) / VALUE_DIVISOR;
    var group = GROUP_BY_CODE[normalizeBranch(row[FIELD_PLANTA])];

    if (!byDate[key]) byDate[key] = {};
    byDate[key][TOTAL_KEY] = (byDate[key][TOTAL_KEY] || 0) + value;
    if (group) {
      byDate[key][group] = (byDate[key][group] || 0) + value;
    }
  });

  return { byDate: byDate, dates: Object.keys(byDate).sort() };
}

// Foto más reciente con fecha <= target (máximo LOOKBACK_DAYS atrás).
function valueAt(series, key, target) {
  var targetKey = toKey(target);
  var minKey = toKey(addDays(target, -LOOKBACK_DAYS));

  for (var i = series.dates.length - 1; i >= 0; i--) {
    var d = series.dates[i];
    if (d > targetKey) continue;
    if (d < minKey) break;
    return { value: series.byDate[d][key] || 0, dateKey: d, exact: d === targetKey };
  }
  return null;
}

function buildCell(series, key, period) {
  var cur = valueAt(series, key, period.close);
  var prev = valueAt(series, key, period.prev);

  var cell = { cur: cur, prev: prev, diff: null, pct: null };
  if (cur && prev) {
    cell.diff = cur.value - prev.value;
    cell.pct = prev.value !== 0 ? cell.diff / Math.abs(prev.value) : null;
  }
  return cell;
}

// ---------- Top 100 items más caros ----------

// Comparaciones del Top: el último día cerrado contra el día anterior, el
// cierre de la semana anterior (domingo antes del lunes en curso) y el
// cierre del mes anterior.
function buildTopCompares(lastClosed) {
  var monday = addDays(lastClosed, -((lastClosed.getDay() + 6) % 7));
  return [
    { label: 'vs día anterior', date: addDays(lastClosed, -1) },
    { label: 'vs cierre semana anterior', date: addDays(monday, -1) },
    { label: 'vs cierre mes anterior', date: new Date(lastClosed.getFullYear(), lastClosed.getMonth(), 0) }
  ];
}

function loadTopItems(series, lastClosed, plant, seq) {
  var current = valueAt(series, TOTAL_KEY, lastClosed);
  if (!current) {
    renderTopTable([], []);
    return;
  }

  // Se usa la foto que realmente existe para cada fecha (misma regla de
  // "más reciente anterior" que la tabla principal); fechas repetidas se
  // piden una sola vez.
  var compares = buildTopCompares(lastClosed).map(function (c) {
    var found = valueAt(series, TOTAL_KEY, c.date);
    return { label: c.label, date: c.date, dateKey: found ? found.dateKey : null };
  });

  var dateKeys = [current.dateKey];
  compares.forEach(function (c) {
    if (c.dateKey && dateKeys.indexOf(c.dateKey) === -1) dateKeys.push(c.dateKey);
  });

  var groupFields = [FIELD_ITEM, FIELD_PLANTA];
  if (FIELD_ITEM_DESC) groupFields.push(FIELD_ITEM_DESC);

  var byDate = {};
  var index = 0;
  topLoading.style.display = 'block';

  function next() {
    if (seq !== requestSeq) return;
    if (index >= dateKeys.length) {
      topLoading.style.display = 'none';
      finishTop(byDate, current.dateKey, compares, plant);
      return;
    }
    var key = dateKeys[index];
    var filter = FIELD_FECHA + '=' + dateFilterValue(parseKey(key));
    fetchGrouped(groupFields, filter, function (rows) {
      byDate[key] = rows;
      index += 1;
      next();
    }, function (err) {
      if (seq !== requestSeq) return;
      logError('Error cargando el Top de items', err);
      setStatus('No se pudo cargar el Top de items. ' + describeError(err));
      topLoading.style.display = 'none';
    });
  }

  next();
}

// Suma por item las filas de la planta seleccionada.
function sumByItem(rows, plant) {
  var map = {};
  (rows || []).forEach(function (row) {
    if (plant !== ALL_LABEL && GROUP_BY_CODE[normalizeBranch(row[FIELD_PLANTA])] !== plant) return;
    var item = row[FIELD_ITEM];
    if (item === null || item === undefined || item === '') return;
    if (!map[item]) {
      map[item] = { value: 0, desc: FIELD_ITEM_DESC ? (row[FIELD_ITEM_DESC] || '') : '' };
    }
    map[item].value += (Number(row[FIELD_VALOR]) || 0) / VALUE_DIVISOR;
  });
  return map;
}

function finishTop(byDate, currentKey, compares, plant) {
  var current = sumByItem(byDate[currentKey], plant);
  var prevMaps = compares.map(function (c) {
    return c.dateKey ? sumByItem(byDate[c.dateKey], plant) : null;
  });

  var items = Object.keys(current).sort(function (a, b) {
    return current[b].value - current[a].value;
  }).slice(0, TOP_N);

  lastTopCompares = compares;
  lastTopRows = items.map(function (item, i) {
    var curValue = current[item].value;
    return {
      rank: i + 1,
      item: item,
      desc: current[item].desc,
      value: curValue,
      dateKey: currentKey,
      cells: compares.map(function (c, k) {
        if (!prevMaps[k]) return { prev: null, diff: null, pct: null };
        // Si el item no existía en esa fecha, su valor anterior es 0.
        var prevValue = prevMaps[k][item] ? prevMaps[k][item].value : 0;
        var diff = curValue - prevValue;
        return {
          prev: { value: prevValue, dateKey: c.dateKey },
          diff: diff,
          pct: prevValue !== 0 ? diff / Math.abs(prevValue) : null
        };
      })
    };
  });

  renderTopTable(compares, lastTopRows);
}

function renderTopTable(compares, rows) {
  var thead = topTable.querySelector('thead');
  var tbody = topTable.querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  var headerRow = document.createElement('tr');
  var currentLabel = rows.length ? 'Valor al ' + formatShort(parseKey(rows[0].dateKey)) : 'Valor';
  ['#', 'Item', 'Descripción', currentLabel].forEach(function (text, i) {
    var th = document.createElement('th');
    th.textContent = text;
    if (i === 0 || i === 3) th.className = 'period-head';
    headerRow.appendChild(th);
  });
  compares.forEach(function (c) {
    var th = document.createElement('th');
    th.className = 'period-head';
    th.innerHTML = '<span class="period-label">' + c.label + '</span>' +
      '<span class="period-sub">' + (c.dateKey ? formatShort(parseKey(c.dateKey)) : 'sin foto') + '</span>';
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  if (rows.length === 0) {
    var emptyRow = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = 4 + compares.length;
    td.className = 'empty-cell';
    td.textContent = 'Sin datos para la selección actual.';
    emptyRow.appendChild(td);
    tbody.appendChild(emptyRow);
    return;
  }

  rows.forEach(function (row) {
    var tr = document.createElement('tr');

    [row.rank, row.item, row.desc, formatMoney(row.value)].forEach(function (text, i) {
      var tdEl = document.createElement('td');
      tdEl.textContent = text;
      if (i === 0 || i === 3) tdEl.className = 'numeric';
      tr.appendChild(tdEl);
    });

    row.cells.forEach(function (cell) {
      var tdEl = document.createElement('td');
      tdEl.className = 'numeric';
      if (cell.diff === null) {
        tdEl.textContent = '–';
      } else {
        var diffSpan = document.createElement('span');
        diffSpan.textContent = (cell.diff > 0 ? '+' : '') + formatMoney(cell.diff);
        tdEl.appendChild(diffSpan);
        appendTrend(tdEl, cell.diff, cell.pct);
        tdEl.title = 'Anterior (' + formatLong(parseKey(cell.prev.dateKey)) + '): ' + formatMoney(cell.prev.value);
      }
      tr.appendChild(tdEl);
    });

    tbody.appendChild(tr);
  });
}

function clearTopTable() {
  topTable.querySelector('thead').innerHTML = '';
  topTable.querySelector('tbody').innerHTML = '';
  topLoading.style.display = 'none';
  lastTopRows = [];
}

// ---------- Render ----------

function renderTable(sections, rows) {
  var thead = invTable.querySelector('thead');
  var tbody = invTable.querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  var groupRow = document.createElement('tr');
  var colRow = document.createElement('tr');

  var thMetric = document.createElement('th');
  thMetric.rowSpan = 2;
  thMetric.className = 'metric-col';
  thMetric.textContent = 'Planta';
  groupRow.appendChild(thMetric);

  sections.forEach(function (section) {
    var thGroup = document.createElement('th');
    thGroup.colSpan = Math.max(section.periods.length, 1);
    thGroup.className = 'group-head ' + section.css;
    thGroup.textContent = section.title;
    groupRow.appendChild(thGroup);

    if (section.periods.length === 0) {
      var thEmpty = document.createElement('th');
      thEmpty.className = 'period-head ' + section.css;
      thEmpty.innerHTML = '<span class="period-sub">' + section.empty + '</span>';
      colRow.appendChild(thEmpty);
      return;
    }

    section.periods.forEach(function (p) {
      var th = document.createElement('th');
      th.className = 'period-head ' + section.css;
      th.innerHTML = '<span class="period-label">' + p.label + '</span>' +
        '<span class="period-sub">' + p.sub + '</span>';
      colRow.appendChild(th);
    });
  });

  thead.appendChild(groupRow);
  thead.appendChild(colRow);

  rows.forEach(function (row) {
    var tr = document.createElement('tr');
    if (row.isTotal) tr.className = 'total-row';

    var tdLabel = document.createElement('td');
    tdLabel.className = 'metric-col';
    tdLabel.textContent = row.label;
    tr.appendChild(tdLabel);

    sections.forEach(function (section, s) {
      if (section.periods.length === 0) {
        var tdEmpty = document.createElement('td');
        tdEmpty.className = 'numeric ' + section.css;
        tdEmpty.textContent = '–';
        tr.appendChild(tdEmpty);
        return;
      }

      row.cells[s].forEach(function (cell, p) {
        tr.appendChild(renderCell(cell, section.periods[p], section.css));
      });
    });

    tbody.appendChild(tr);
  });
}

function renderCell(cell, period, css) {
  var td = document.createElement('td');
  td.className = 'numeric ' + css;

  if (!cell.cur) {
    td.textContent = '–';
    td.title = 'Sin foto del inventario al ' + formatLong(period.close);
    return td;
  }

  var valueSpan = document.createElement('span');
  valueSpan.textContent = formatMoney(cell.cur.value) + (cell.cur.exact ? '' : '*');
  td.appendChild(valueSpan);

  var tip = 'Al ' + formatLong(parseKey(cell.cur.dateKey));

  if (cell.diff !== null) {
    appendTrend(td, cell.diff, cell.pct);

    tip += '\nAnterior (' + formatLong(parseKey(cell.prev.dateKey)) + '): ' + formatMoney(cell.prev.value) +
      '\nVariación: ' + (cell.diff >= 0 ? '+' : '') + formatMoney(cell.diff) +
      (cell.pct === null ? '' : ' (' + formatPct(cell.pct) + ')');
  } else {
    tip += '\nSin dato del periodo anterior (' + formatLong(period.prev) + ')';
  }

  if (!cell.cur.exact) {
    tip += '\n* No hubo foto el ' + formatLong(period.close) + ', se usa la más reciente anterior.';
  }

  td.title = tip;
  return td;
}

// Agrega la flecha ▲/▼ (o = si no cambió) y el % de variación a la celda.
function appendTrend(td, diff, pct) {
  var direction = diff > 0 ? 'up' : (diff < 0 ? 'down' : 'flat');

  var arrow = document.createElement('span');
  arrow.className = 'trend ' + direction;
  arrow.textContent = diff > 0 ? '▲' : (diff < 0 ? '▼' : '=');
  td.appendChild(arrow);

  var pctSpan = document.createElement('span');
  pctSpan.className = 'trend-pct ' + direction;
  pctSpan.textContent = pct === null ? '' : formatPct(pct);
  td.appendChild(pctSpan);
}

// ---------- Exportar a Excel (CSV) ----------

function exportToExcel() {
  if (!lastRows || lastRows.length === 0) {
    setStatus('No hay datos para exportar.');
    return;
  }

  var headers = ['Planta'];
  lastSections.forEach(function (section) {
    section.periods.forEach(function (p) {
      var name = section.title + ' - ' + p.label + ' (' + p.sub + ')';
      headers.push(name, name + ' - Variación $', name + ' - Variación %');
    });
  });

  var rows = lastRows.map(function (row) {
    var line = [row.label];
    lastSections.forEach(function (section, s) {
      row.cells[s].forEach(function (cell) {
        line.push(
          cell.cur ? round2(cell.cur.value) : '',
          cell.diff !== null ? round2(cell.diff) : '',
          cell.pct !== null ? round2(cell.pct * 100) : ''
        );
      });
    });
    return line;
  });

  downloadCSV('valor_inventario.csv', toCSV(headers, rows));
}

function exportTopToExcel() {
  if (!lastTopRows || lastTopRows.length === 0) {
    setStatus('No hay datos en el Top de items para exportar.');
    return;
  }

  var headers = ['#', 'Item', 'Descripción', 'Valor'];
  lastTopCompares.forEach(function (c) {
    headers.push(c.label + ' - Variación $', c.label + ' - Variación %');
  });

  var rows = lastTopRows.map(function (row) {
    var line = [row.rank, row.item, row.desc, round2(row.value)];
    row.cells.forEach(function (cell) {
      line.push(
        cell.diff !== null ? round2(cell.diff) : '',
        cell.pct !== null ? round2(cell.pct * 100) : ''
      );
    });
    return line;
  });

  downloadCSV('top_items_inventario.csv', toCSV(headers, rows));
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

function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

function isLastDayOfMonth(date) {
  return addDays(date, 1).getDate() === 1;
}

// Date -> 'AAAA-MM-DD' (hora local).
function toKey(date) {
  return date.getFullYear() + '-' +
    ('0' + (date.getMonth() + 1)).slice(-2) + '-' +
    ('0' + date.getDate()).slice(-2);
}

// 'AAAA-MM-DD' -> Date (hora local; new Date('AAAA-MM-DD') sería UTC).
function parseKey(key) {
  var parts = key.split('-');
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
}

function formatShort(date) {
  return ('0' + date.getDate()).slice(-2) + ' ' + MONTHS_SHORT[date.getMonth()];
}

function formatLong(date) {
  return date.getDate() + ' ' + MONTHS_SHORT[date.getMonth()] + ' ' + date.getFullYear();
}

function dateFilterValue(date) {
  return DATE_FORMAT === 'julian' ? String(dateToJulian(date)) : "'" + toKey(date) + "'";
}

// Valor de la columna fecha de la dataset -> 'AAAA-MM-DD'.
function rowDateKey(value) {
  if (value === null || value === undefined || value === '') return null;
  if (DATE_FORMAT === 'julian') {
    var date = julianToDate(value);
    return date ? toKey(date) : null;
  }
  return String(value).slice(0, 10);
}

// Date -> entero juliano estilo JDE CYYDDD.
function dateToJulian(date) {
  var year = date.getFullYear();
  var dayOfYear = Math.round((new Date(year, date.getMonth(), date.getDate()) - new Date(year, 0, 1)) / 86400000) + 1;
  return ((Math.floor(year / 100) - 19) * 100000) + ((year % 100) * 1000) + dayOfYear;
}

// Entero juliano estilo JDE CYYDDD -> Date (o null si no es válido).
function julianToDate(value) {
  var num = Math.trunc(Number(value));
  if (isNaN(num) || num <= 0) return null;

  var century = Math.floor(num / 100000);
  var yy = Math.floor((num % 100000) / 1000);
  var dayOfYear = num % 1000;
  if (dayOfYear < 1 || dayOfYear > 366) return null;

  return new Date(1900 + (century * 100) + yy, 0, dayOfYear);
}

// ---------- Utilidades ----------

// Blanco/vacío -> DEFAULT_BRANCH; si no, el valor tal cual (sin espacios).
function normalizeBranch(value) {
  var trimmed = (value === null || value === undefined) ? '' : String(value).trim();
  return trimmed === '' ? DEFAULT_BRANCH : trimmed;
}

function formatMoney(value) {
  var sign = value < 0 ? '-' : '';
  return sign + '$' + Math.abs(value).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(value) {
  return (value >= 0 ? '+' : '') + (value * 100).toFixed(1) + '%';
}

function round2(value) {
  return Math.round(value * 100) / 100;
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

function setStatus(msg) {
  statusMsg.textContent = msg || '';
}

function showLoading(show) {
  loadingEl.style.display = show ? 'block' : 'none';
}
