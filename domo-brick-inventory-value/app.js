var domo = window.domo;
var datasets = window.datasets;

// Dataset seleccionada en el botón de la esquina inferior izquierda del brick.
// Se espera una dataset de FOTOS (snapshots) del inventario: una o varias
// filas por día y planta con el valor del inventario a esa fecha.
var datasetId = datasets[0];

// Nombres de campo del dataset (ajusta aquí si tu dataset usa otros alias)
var FIELD_FECHA = 'FechaCorta';            // Fecha de la foto del inventario
var FIELD_PLANTA = 'Planta';               // Branch/Plant
var FIELD_VALOR = 'ILOC_COST_ON_HAND';     // Valor del inventario en MXN
var FIELD_TIPO_CAMBIO = 'Valor';           // Tipo de cambio MXN/USD de ese día
var FIELD_ITEM = 'ITEM_NUMBER_SECOND';     // Item (para el Top 100)
var FIELD_ITEM_DESC = 'ITEM_DESC';         // Descripción del item ('' si la dataset no la trae)

// Formato de FIELD_FECHA: 'iso' (AAAA-MM-DD, columna fecha de Domo) o
// 'julian' (entero JDE CYYDDD, como iltrdj).
var DATE_FORMAT = 'iso';

// Si el valor viene en centavos (como ilpaid) pon 100.
var VALUE_DIVISOR = 1;

// Filas sin tipo de cambio válido (vacío o 0) en la última carga: no se
// pueden convertir a USD y se dejan fuera (se avisa en pantalla).
var missingRateRows = 0;

// Si no hay foto exactamente en la fecha de cierre (fin de semana, carga
// faltante), se usa la foto más reciente ANTERIOR a esa fecha, buscando
// hasta este número de días hacia atrás.
var LOOKBACK_DAYS = 7;

// Hay registros donde Branch/Plant viene en blanco; esos registros en
// realidad pertenecen al branch 1221 por defecto.
var DEFAULT_BRANCH = '1221';

// Cada grupo junta uno o varios códigos crudos de Branch/Plant bajo un
// nombre de planta (una fila por planta en la tabla principal). Un valor
// de planta que no coincida con ningún código ni nombre de grupo aparece
// como su propia planta (ver plantGroupOf). El filtro de planta lo pone el
// control del dashboard de Domo.
var BRANCH_GROUPS = [
  { label: 'Plataforma', codes: ['1221', '2300'] },
  { label: 'Laredo', codes: ['5130', '5140'] },
  { label: 'AMP', codes: ['2200'] },
  { label: 'Calle2', codes: ['2190'] },
  { label: 'CDI', codes: ['1122'] }
];
var TOTAL_KEY = '__total__';
var TOP_N = 100;

var GROUP_BY_CODE = {};
var GROUP_BY_NAME = {};
BRANCH_GROUPS.forEach(function (group) {
  group.codes.forEach(function (code) { GROUP_BY_CODE[code] = group.label; });
  GROUP_BY_NAME[nameKey(group.label)] = group.label;
});

var PAGE_SIZE = 50000;
var MAX_PAGES = 50;

var MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
var DAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

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
var lastTopTotal = null;

// Cada refresh incrementa este contador; respuestas de cargas anteriores
// (ej. el usuario cambió de planta a media carga) se descartan.
var requestSeq = 0;

init();

function init() {
  btnActualizar.addEventListener('click', refresh);
  btnExport.addEventListener('click', exportToExcel);
  btnExportTop.addEventListener('click', exportTopToExcel);

  corteInput.value = toKey(new Date());
  refresh();
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
  missingRateRows = 0;
  var seq = ++requestSeq;

  fetchDailyTotals(minDate, lastClosed, function (rows) {
    if (seq !== requestSeq) return;
    var series = buildSeries(rows);
    warnMissingRate();
    // El filtro de planta lo aplica el control del dashboard de Domo (ya
    // viene filtrado en la respuesta): aquí se muestra una fila por cada
    // planta que traiga la dataset, más el Total.
    var rowKeys = series.groups.concat([TOTAL_KEY]);

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
    footNote.textContent = 'Valor del inventario en USD (' + FIELD_VALOR + ' / tipo de cambio del día) al cierre de cada periodo. Datos hasta el ' +
      formatLong(lastClosed) + ' (solo días cerrados). Semanas de lunes a domingo. ' +
      '▲/▼ respecto al periodo anterior (mes vs mes, semana vs semana, día vs día). ' +
      '* = no hubo foto ese día, se usa la más reciente anterior.';
    showLoading(false);

    loadTopItems(series, lastClosed, seq);
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
// Siempre se agrupa también por el tipo de cambio: es el mismo para todo
// el día, así que no parte los grupos, y permite convertir cada suma en
// MXN a USD con el tipo de cambio de su propio día (ver rowValueUsd).
function fetchGrouped(groupFields, filter, onDone, onError) {
  groupFields = groupFields.concat([FIELD_TIPO_CAMBIO]);
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
  var groupSeen = {};
  var rawSeen = {};

  rows.forEach(function (row) {
    var key = rowDateKey(row[FIELD_FECHA]);
    if (!key) return;

    var value = rowValueUsd(row);
    var group = plantGroupOf(row[FIELD_PLANTA]);
    groupSeen[group] = true;
    rawSeen[row[FIELD_PLANTA]] = group;

    if (!byDate[key]) byDate[key] = {};
    byDate[key][TOTAL_KEY] = (byDate[key][TOTAL_KEY] || 0) + value;
    byDate[key][group] = (byDate[key][group] || 0) + value;
  });

  console.log('Valores de ' + FIELD_PLANTA + ' -> planta:', rawSeen);

  return { byDate: byDate, dates: Object.keys(byDate).sort(), groups: orderGroups(Object.keys(groupSeen)) };
}

// Grupos configurados primero (en el orden de BRANCH_GROUPS), luego las
// plantas no configuradas en orden alfabético.
function orderGroups(groups) {
  var configured = BRANCH_GROUPS.map(function (g) { return g.label; });
  return configured.filter(function (label) { return groups.indexOf(label) !== -1; })
    .concat(groups.filter(function (g) { return configured.indexOf(g) === -1; }).sort());
}

// Valor crudo de planta -> nombre de planta. Acepta el código (con o sin
// ceros a la izquierda, ej. '2200' o '000002200') o el nombre del grupo
// (sin importar mayúsculas/espacios, ej. 'CALLE 2' -> 'Calle2'); si no
// coincide con nada se usa el valor tal cual.
function plantGroupOf(value) {
  var code = normalizeBranch(value);
  var noZeros = code.replace(/^0+(?=.)/, '');
  return GROUP_BY_CODE[code] || GROUP_BY_CODE[noZeros] || GROUP_BY_NAME[nameKey(code)] || code;
}

function nameKey(value) {
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
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

function loadTopItems(series, lastClosed, seq) {
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
      finishTop(byDate, current.dateKey, compares);
      warnMissingRate();
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

// Suma por item + planta (un mismo item en dos plantas sale en dos
// renglones).
function sumByItem(rows) {
  var map = {};
  (rows || []).forEach(function (row) {
    var group = plantGroupOf(row[FIELD_PLANTA]);
    var item = row[FIELD_ITEM];
    if (item === null || item === undefined || item === '') return;
    var key = item + '||' + group;
    if (!map[key]) {
      map[key] = { item: item, plant: group, value: 0, desc: FIELD_ITEM_DESC ? (row[FIELD_ITEM_DESC] || '') : '' };
    }
    map[key].value += rowValueUsd(row);
  });
  return map;
}

function finishTop(byDate, currentKey, compares) {
  var current = sumByItem(byDate[currentKey]);
  var prevMaps = compares.map(function (c) {
    return c.dateKey ? sumByItem(byDate[c.dateKey]) : null;
  });

  var items = Object.keys(current).sort(function (a, b) {
    return current[b].value - current[a].value;
  }).slice(0, TOP_N);

  lastTopCompares = compares;
  lastTopRows = items.map(function (key, i) {
    var curValue = current[key].value;
    return {
      rank: i + 1,
      item: current[key].item,
      plant: current[key].plant,
      desc: current[key].desc,
      value: curValue,
      dateKey: currentKey,
      cells: compares.map(function (c, k) {
        if (!prevMaps[k]) return { prev: null, diff: null, pct: null };
        // Si el item no existía en esa fecha, su valor anterior es 0.
        var prevValue = prevMaps[k][key] ? prevMaps[k][key].value : 0;
        var diff = curValue - prevValue;
        return {
          prev: { value: prevValue, dateKey: c.dateKey },
          diff: diff,
          pct: prevValue !== 0 ? diff / Math.abs(prevValue) : null
        };
      })
    };
  });

  lastTopTotal = buildTopTotal(lastTopRows, compares);
  renderTopTable(compares, lastTopRows);
}

// Suma de los items del Top (valor actual y valor de cada comparación).
function buildTopTotal(rows, compares) {
  var value = 0;
  var prevValues = compares.map(function () { return 0; });
  rows.forEach(function (row) {
    value += row.value;
    row.cells.forEach(function (cell, k) {
      if (cell.prev) prevValues[k] += cell.prev.value;
    });
  });
  return {
    value: value,
    cells: compares.map(function (c, k) {
      if (!c.dateKey) return { prev: null, diff: null, pct: null };
      var diff = value - prevValues[k];
      return {
        prev: { value: prevValues[k], dateKey: c.dateKey },
        diff: diff,
        pct: prevValues[k] !== 0 ? diff / Math.abs(prevValues[k]) : null
      };
    })
  };
}

function renderTopTable(compares, rows) {
  var thead = topTable.querySelector('thead');
  var tbody = topTable.querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  var headerRow = document.createElement('tr');
  var currentLabel = rows.length ? 'Valor USD al ' + formatShort(parseKey(rows[0].dateKey)) : 'Valor';
  ['#', 'Planta', 'Item', 'Descripción', currentLabel].forEach(function (text, i) {
    var th = document.createElement('th');
    th.textContent = text;
    if (i === 0 || i === 4) th.className = 'period-head';
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
    td.colSpan = 5 + compares.length;
    td.className = 'empty-cell';
    td.textContent = 'Sin datos para la selección actual.';
    emptyRow.appendChild(td);
    tbody.appendChild(emptyRow);
    return;
  }

  // Total arriba, fijo debajo del encabezado al hacer scroll.
  var totalRow = Object.assign({ rank: '', plant: '', item: 'Total Top ' + rows.length, desc: '' }, lastTopTotal);
  [totalRow].concat(rows).forEach(function (row, r) {
    var tr = document.createElement('tr');
    if (r === 0) tr.className = 'total-row top-total';

    [row.rank, row.plant, row.item, row.desc, formatMoney(row.value)].forEach(function (text, i) {
      var tdEl = document.createElement('td');
      tdEl.textContent = text;
      if (i === 0 || i === 4) tdEl.className = 'numeric';
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
  lastTopTotal = null;
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
      headers.push(name + ' (USD)', name + ' - Variación USD', name + ' - Variación %');
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

  var headers = ['#', 'Planta', 'Item', 'Descripción', 'Valor USD'];
  lastTopCompares.forEach(function (c) {
    headers.push(c.label + ' - Variación USD', c.label + ' - Variación %');
  });

  var totalRow = Object.assign({ rank: '', plant: '', item: 'Total Top ' + lastTopRows.length, desc: '' }, lastTopTotal);
  var rows = [totalRow].concat(lastTopRows).map(function (row) {
    var line = [row.rank, row.plant, row.item, row.desc, round2(row.value)];
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

// Valor de la fila en USD: ILOC_COST_ON_HAND (MXN) / tipo de cambio del
// día. Sin tipo de cambio válido regresa 0 y se cuenta en missingRateRows.
function rowValueUsd(row) {
  var mxn = (Number(row[FIELD_VALOR]) || 0) / VALUE_DIVISOR;
  var rate = Number(row[FIELD_TIPO_CAMBIO]);
  if (!rate || isNaN(rate)) {
    if (mxn !== 0) missingRateRows += 1;
    return 0;
  }
  return mxn / rate;
}

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

function warnMissingRate() {
  if (missingRateRows > 0) {
    setStatus('Atención: ' + missingRateRows.toLocaleString('es-MX') + ' registros sin tipo de cambio (' +
      FIELD_TIPO_CAMBIO + ' vacío o 0) no se incluyeron en los valores en USD.');
  }
}

function setStatus(msg) {
  statusMsg.textContent = msg || '';
}

function showLoading(show) {
  loadingEl.style.display = show ? 'block' : 'none';
}
