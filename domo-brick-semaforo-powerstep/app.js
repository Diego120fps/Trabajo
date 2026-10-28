var domo = window.domo;
var datasets = window.datasets;

// Dataset seleccionado en el botón de la esquina inferior izquierda del brick
var datasetId = datasets[0];

// ---------- Nombres de campo del dataset (ajusta aquí si difieren) ----------
var FIELD_CATEGORY_PARENT = 'CategoryParent';
var FIELD_BRANCH_PLANT = 'ILOC_BRANCH_PLANT';
var FIELD_ITEM = 'ITEM_NUMBER_SECOND';
var FIELD_ON_HAND = 'ON_HAND';
var FIELD_MINIMO = 'Minimo';
var FIELD_MAXIMO = 'Maximo';
var FIELD_MAX_DEMANDA_DIA = 'Max_Demanda_Dia';

// DIAGNÓSTICO TEMPORAL: si el brick no carga y la consola solo muestra "{}",
// pon esto en false para quitar Max_Demanda_Dia de la consulta y confirmar
// si ese es el nombre de columna que está fallando. Vuelve a poner true
// (y corrige FIELD_MAX_DEMANDA_DIA arriba) en cuanto sepas el nombre real.
var INCLUIR_MAX_DEMANDA_DIA = true;

// Todas las columnas que se piden al dataset: las de filtro más las que se
// muestran en la tabla.
var QUERY_FIELDS = [
  FIELD_CATEGORY_PARENT,
  FIELD_BRANCH_PLANT,
  FIELD_ITEM,
  FIELD_ON_HAND,
  FIELD_MINIMO,
  FIELD_MAXIMO
].concat(INCLUIR_MAX_DEMANDA_DIA ? [FIELD_MAX_DEMANDA_DIA] : []);

// Columnas de la tabla de detalle (en orden), con el encabezado que se
// quiere mostrar. "%" y "Semaforo" son columnas calculadas, se agregan aparte.
var DISPLAY_COLUMNS = [
  { field: FIELD_ITEM, label: 'ITEM' },
  { field: FIELD_ON_HAND, label: 'ON_HAND' },
  { field: FIELD_MINIMO, label: 'MIN', numeric: true },
  { field: FIELD_MAXIMO, label: 'MAX', numeric: true }
];

// ---------- Filtros fijos ----------
var FILTER_CATEGORY_PARENT = 'Powerstep';
var FILTER_BRANCH_PLANT = '200';

// ---------- Umbrales del semáforo (sobre "%" calculado, ver calcPercent) ----------
var UMBRAL_MORADO = 0.2;   // % <= 0.2       -> Morado
var UMBRAL_ROJO = 0.3;     // % <= 0.3       -> Rojo
var UMBRAL_AMARILLO = 0.7; // % <= 0.7       -> Amarillo
// % > 0.7                                    -> Verde

// Tarjetas que se pintan, en este orden. "SinDemanda" y "SinInv" son casos
// especiales que se evalúan antes del % (ver calcSemaforo) y no entran al
// conteo de Rojo/Amarillo/Morado/Verde.
var SEMAFORO_CONFIG = [
  { key: 'Verde', label: '> 70%', color: '#27ae60' },
  { key: 'Amarillo', label: '<= 70%', color: '#f1c40f' },
  { key: 'Rojo', label: '<= 30%', color: '#c0392b' },
  { key: 'Morado', label: '<= 20%', color: '#8e44ad' },
  { key: 'SinDemanda', label: 'Sin Demanda', color: '#2980b9' },
  { key: 'SinInv', label: 'Sin Inv', color: '#7f8c8d' }
];

var SEMAFORO_COLOR_BY_KEY = {};
var SEMAFORO_LABEL_BY_KEY = {};
SEMAFORO_CONFIG.forEach(function (cfg) {
  SEMAFORO_COLOR_BY_KEY[cfg.key] = cfg.color;
  SEMAFORO_LABEL_BY_KEY[cfg.key] = cfg.label;
});

// Orden de la tabla de detalle: primero Morado, Rojo, Amarillo, Verde
// (por bucket de %), y al final Sin Inv y Sin Demanda.
var TABLE_SORT_ORDER = ['Morado', 'Rojo', 'Amarillo', 'Verde', 'SinInv', 'SinDemanda'];
var TABLE_SORT_RANK = {};
TABLE_SORT_ORDER.forEach(function (key, idx) { TABLE_SORT_RANK[key] = idx; });

// Páginas más chicas = respuesta más chica por request. domo.get() pasa los
// datos del sandbox del brick a la página por un canal interno con límite
// de tamaño; con páginas de 5000 filas se vio fallar con un error genérico
// ("f.onload ... message: ''") que no viene de este código sino del SDK
// de Domo. 1000 es más seguro sin disparar demasiado el número de requests.
var PAGE_SIZE = 1000;
var MAX_PAGES = 2500; // tope de seguridad: hasta 2.5M filas filtradas

// Reintentos automáticos por página antes de rendirse: ese mismo error
// genérico del SDK de Domo ha resultado ser intermitente (recargar el brick
// a veces basta para que la siguiente carga funcione).
var RETRY_MAX_ATTEMPTS = 3;
var RETRY_DELAY_MS = 1500;

var cardsEl = document.getElementById('cards');
var statusMsg = document.getElementById('statusMsg');
var loadingEl = document.getElementById('loading');
var btnRefrescar = document.getElementById('btnRefrescar');
var btnExportDetail = document.getElementById('btnExportDetail');
var detailTable = document.getElementById('detailTable');

// Filas ya filtradas (Powerstep + planta 200) con Semáforo calculable,
// listas para pintar tarjetas y la tabla completa.
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
    // Solo entran a tarjetas y tabla las filas con un Semáforo calculable
    // (ON_HAND y Minimo numéricos, o Sin Demanda / Sin Inv).
    var withSemaforo = rows.filter(function (row) {
      return calcSemaforo(row) !== null;
    });

    withSemaforo.sort(function (a, b) {
      // Primero se agrupa por bucket en el orden de TABLE_SORT_ORDER
      // (Morado, Rojo, Amarillo, Verde, Sin Inv, Sin Demanda)...
      var rankA = TABLE_SORT_RANK[calcSemaforo(a)];
      var rankB = TABLE_SORT_RANK[calcSemaforo(b)];
      if (rankA !== rankB) return rankA - rankB;

      // ...y dentro del mismo bucket, por % ascendente.
      var pctA = calcPercent(a);
      var pctB = calcPercent(b);
      if (pctA === null && pctB === null) return 0;
      if (pctA === null) return 1;
      if (pctB === null) return -1;
      return pctA - pctB;
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

// Calcula el Semáforo de una fila. Se evalúa en este orden (el primero que
// aplique gana): Sin Demanda, Sin Inv, Morado, Rojo, Amarillo, Verde.
//   Max_Demanda_Dia = 0 -> SinDemanda (sin importar el inventario)
//   ON_HAND = 0         -> SinInv
//   si no, según el % (ver calcPercent):
//     %  <= 0.2 -> Morado
//     %  <= 0.3 -> Rojo
//     %  <= 0.7 -> Amarillo
//     %  > 0.7  -> Verde
// Filas sin datos numéricos para ninguno de los casos anteriores regresan
// null (quedan fuera del conteo).
function calcSemaforo(row) {
  var maxDemandaDia = Number(row[FIELD_MAX_DEMANDA_DIA]);
  if (!isNaN(maxDemandaDia) && maxDemandaDia === 0) return 'SinDemanda';

  var onHand = Number(row[FIELD_ON_HAND]);
  if (!isNaN(onHand) && onHand === 0) return 'SinInv';

  var pct = calcPercent(row);
  if (pct === null) return null;

  if (pct <= UMBRAL_MORADO) return 'Morado';
  if (pct <= UMBRAL_ROJO) return 'Rojo';
  if (pct <= UMBRAL_AMARILLO) return 'Amarillo';
  return 'Verde';
}

function groupByColor(rows) {
  var groups = {};
  SEMAFORO_CONFIG.forEach(function (cfg) { groups[cfg.key] = []; });
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
      if (col.numeric) {
        tdEl.className = 'numeric';
        tdEl.textContent = formatRoundedNumber(row[col.field]);
      } else {
        tdEl.textContent = row[col.field];
      }
      tr.appendChild(tdEl);
    });

    var pct = calcPercent(row);
    var tdPercent = document.createElement('td');
    tdPercent.className = 'numeric';
    tdPercent.textContent = pct === null ? '' : pct.toLocaleString('es-MX', { style: 'percent', minimumFractionDigits: 1 });
    tr.appendChild(tdPercent);

    var color = calcSemaforo(row);
    var tdSemaforo = document.createElement('td');
    tdSemaforo.textContent = SEMAFORO_LABEL_BY_KEY[color] || color;
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
    var color = calcSemaforo(row);
    return DISPLAY_COLUMNS.map(function (col) {
      return col.numeric ? formatRoundedNumber(row[col.field]) : row[col.field];
    }).concat([calcPercent(row), SEMAFORO_LABEL_BY_KEY[color] || color]);
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

  function fetchPage(attempt) {
    attempt = attempt || 1;
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

    console.log('Query Semáforo (página ' + page + ', intento ' + attempt + ', offset ' + offset + '):', query);
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
          fetchPage(1);
        }
      })
      .catch(function (err) {
        if (attempt < RETRY_MAX_ATTEMPTS) {
          logError('Fallo en página ' + page + ' (intento ' + attempt + ' de ' + RETRY_MAX_ATTEMPTS + '), reintentando', err);
          page -= 1; // no cuenta como una página nueva al reintentar
          setStatus('La carga falló, reintentando... (' + collected.length + ' registros hasta ahora)');
          setTimeout(function () { fetchPage(attempt + 1); }, RETRY_DELAY_MS);
        } else {
          onError(err);
        }
      });
  }

  fetchPage();
}

// ---------- Utilidades ----------

// Redondea a entero y formatea con "," como separador de miles (ej. 1234.6 -> "1,235").
function formatRoundedNumber(value) {
  var num = Number(value);
  if (isNaN(num)) return '';
  return Math.round(num).toLocaleString('en-US');
}

function describeError(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err.status) return 'HTTP ' + err.status + (err.statusText ? ' ' + err.statusText : '');
  if (err.message) return err.message;

  // Domo a veces rechaza con un objeto "vacío" (sin status/message propios,
  // típico cuando algún nombre de campo de la query no existe). Revisa
  // también las propiedades no enumerables antes de rendirse con "{}".
  var ownProps = Object.getOwnPropertyNames(err);
  if (ownProps.length > 0) {
    try {
      return JSON.stringify(err, ownProps);
    } catch (e) { /* sigue abajo */ }
  }

  try {
    return JSON.stringify(err);
  } catch (e) {
    return String(err);
  }
}

function logError(context, err) {
  console.error(context, err);
  console.error(context + ' - propiedades:', err ? Object.getOwnPropertyNames(err) : err);

  if (err && typeof err.text === 'function') {
    err.text().then(function (body) {
      console.error(context + ' - respuesta del servidor (text):', body);
    }).catch(function () {});
  }
  if (err && typeof err.json === 'function') {
    err.json().then(function (body) {
      console.error(context + ' - respuesta del servidor (json):', body);
    }).catch(function () {});
  }
}

function setStatus(msg) {
  statusMsg.textContent = msg || '';
}

function showLoading(show) {
  loadingEl.style.display = show ? 'block' : 'none';
}
