var domo = window.domo;
var datasets = window.datasets;

// Dataset seleccionada en el botón de la esquina inferior izquierda del brick
var datasetId = datasets[0];

// Nombres de campo del dataset (ajusta aquí si tu dataset usa otros alias)
var FIELD_ITEM = 'ITEM_NUMBER_SECOND';         // ITEMS (se cuentan distintos)
var FIELD_OH_QTY = 'ILOC_QTY_ON_HAND';         // OH (unidades)
var FIELD_CON_ORDEN_QTY = 'OH_CON_ORDEN';      // C/ORDEN (unidades)
var FIELD_SIN_ORDEN_QTY = 'OH_SIN_ORDEN';      // S/ORDEN (unidades)
var FIELD_OH_USD = 'COTS_OH_USD';              // OH (USD)
var FIELD_CON_ORDEN_USD = 'COST_CON_ORDEN_USD'; // C/ORDEN (USD)
var FIELD_SIN_ORDEN_USD = 'COST_SIN_ORDEN_USD'; // S/ORDEN (USD)
var FIELD_UPDATED_DATE = 'ITEM_UPDATED_DATE';  // Base para calcular el aging

// Buckets de aging: días transcurridos de ITEM_UPDATED_DATE a hoy.
// max = null significa "sin límite superior".
var BUCKETS = [
  { label: '0 - 2 Days', min: 0, max: 2 },
  { label: '3 - 5 Days', min: 3, max: 5 },
  { label: '> 5 Days', min: 6, max: null }
];
var SUMMARY_LABEL = 'Summary';

// Igual que en el brick de pivote: se traen las filas en páginas con un
// orderby fijo y se agrega en el navegador, para no depender del groupby
// de Domo en datasets grandes.
var PAGE_SIZE = 5000;
var MAX_PAGES = 500; // tope de seguridad: hasta 2.5M filas

var MS_PER_DAY = 24 * 60 * 60 * 1000;

var statusMsg = document.getElementById('statusMsg');
var loadingEl = document.getElementById('loading');
var bucketsRow = document.getElementById('bucketsRow');

init();

function init() {
  renderAll(emptyTotals());
  loadData();
}

function loadData() {
  showLoading(true);
  setStatus('');

  fetchAllRows(function (rows) {
    showLoading(false);
    renderAll(aggregateRows(rows));
  }, function (err) {
    showLoading(false);
    logError('Error al cargar datos:', err);
    setStatus('Error al cargar datos: ' + describeError(err), true);
  });
}

// Trae, en páginas de PAGE_SIZE, todas las filas del dataset (ya con los
// filtros de página de Domo aplicados), hasta que una página regresa
// menos filas de las pedidas (fin de los datos).
function fetchAllRows(onDone, onError) {
  var fields = [
    FIELD_ITEM, FIELD_OH_QTY, FIELD_CON_ORDEN_QTY, FIELD_SIN_ORDEN_QTY,
    FIELD_OH_USD, FIELD_CON_ORDEN_USD, FIELD_SIN_ORDEN_USD, FIELD_UPDATED_DATE
  ];
  var collected = [];
  var offset = 0;
  var page = 0;

  function fetchPage() {
    page += 1;
    if (page > MAX_PAGES) {
      onError(new Error('Se alcanzó el máximo de páginas (' + MAX_PAGES + ') sin terminar de leer los datos.'));
      return;
    }

    // orderby fijo para que offset/limit recorra todo sin huecos ni repeticiones.
    var query = '/data/v1/' + datasetId +
      '?fields=' + fields.join() +
      '&orderby=' + FIELD_ITEM + ',' + FIELD_UPDATED_DATE +
      '&limit=' + PAGE_SIZE +
      '&offset=' + offset;

    console.log('Query Aging (página ' + page + ', offset ' + offset + '):', query);
    setStatus('Cargando registros... (' + collected.length + ' hasta ahora)');

    domo.get(query)
      .then(function (data) {
        data = data || [];
        collected = collected.concat(data);

        if (data.length < PAGE_SIZE) {
          console.log('Total de registros leídos:', collected.length);
          setStatus('');
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

// ---------- Agregación ----------

function newTotals() {
  return {
    items: {}, // set de ITEM_NUMBER_SECOND para el conteo distinto
    ohQty: 0,
    conOrdenQty: 0,
    sinOrdenQty: 0,
    ohUsd: 0,
    conOrdenUsd: 0,
    sinOrdenUsd: 0
  };
}

function emptyTotals() {
  return {
    buckets: BUCKETS.map(function () { return newTotals(); }),
    summary: newTotals()
  };
}

function aggregateRows(rows) {
  var totals = emptyTotals();
  var today = startOfToday();
  var sinFecha = 0;

  rows.forEach(function (row) {
    var age = ageInDays(row[FIELD_UPDATED_DATE], today);
    var bucketIndex = age === null ? -1 : findBucket(age);

    // Summary incluye todo, aunque el registro no tenga fecha válida.
    addRow(totals.summary, row);

    if (bucketIndex < 0) {
      sinFecha += 1;
      return;
    }
    addRow(totals.buckets[bucketIndex], row);
  });

  if (sinFecha > 0) {
    console.warn(sinFecha + ' registros sin ' + FIELD_UPDATED_DATE + ' válida (o con fecha futura): solo cuentan en Summary.');
  }

  return totals;
}

function addRow(t, row) {
  var item = row[FIELD_ITEM];
  if (item !== null && item !== undefined && item !== '') {
    t.items[item] = true;
  }
  t.ohQty += toNumber(row[FIELD_OH_QTY]);
  t.conOrdenQty += toNumber(row[FIELD_CON_ORDEN_QTY]);
  t.sinOrdenQty += toNumber(row[FIELD_SIN_ORDEN_QTY]);
  t.ohUsd += toNumber(row[FIELD_OH_USD]);
  t.conOrdenUsd += toNumber(row[FIELD_CON_ORDEN_USD]);
  t.sinOrdenUsd += toNumber(row[FIELD_SIN_ORDEN_USD]);
}

function findBucket(age) {
  for (var i = 0; i < BUCKETS.length; i++) {
    var b = BUCKETS[i];
    if (age >= b.min && (b.max === null || age <= b.max)) return i;
  }
  return -1;
}

// Días completos entre la fecha (sin hora) y hoy. null si no hay fecha válida.
function ageInDays(value, today) {
  var date = parseDate(value);
  if (!date) return null;
  return Math.round((today - date) / MS_PER_DAY);
}

// Domo regresa fechas como "YYYY-MM-DD" o "YYYY-MM-DDTHH:mm:ss". Se toma
// solo la parte de fecha y se arma en hora local, para que el huso horario
// no recorra el día.
function parseDate(value) {
  if (!value) return null;
  var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  var d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfToday() {
  var now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toNumber(value) {
  var n = Number(value);
  return isNaN(n) ? 0 : n;
}

// ---------- Render ----------

function renderAll(totals) {
  bucketsRow.innerHTML = '';
  BUCKETS.forEach(function (b, i) {
    bucketsRow.appendChild(renderBucket(b.label, totals.buckets[i]));
  });
  bucketsRow.appendChild(renderBucket(SUMMARY_LABEL, totals.summary));
}

function renderBucket(title, t) {
  var wrapper = document.createElement('div');
  wrapper.className = 'bucket';

  var h3 = document.createElement('h3');
  h3.textContent = title;
  wrapper.appendChild(h3);

  var table = document.createElement('table');
  table.innerHTML =
    '<colgroup><col style="width:22%"><col style="width:26%"><col style="width:26%"><col style="width:26%"></colgroup>' +
    '<thead><tr>' +
      '<th>ITEMS</th><th>OH</th><th>C/ORDEN</th><th>S/ORDEN</th>' +
    '</tr></thead>' +
    '<tbody>' +
      '<tr>' +
        '<td class="items">' + formatNumber(Object.keys(t.items).length) + '</td>' +
        '<td>' + formatNumber(t.ohQty) + '</td>' +
        '<td>' + formatNumber(t.conOrdenQty) + '</td>' +
        '<td>' + formatNumber(t.sinOrdenQty) + '</td>' +
      '</tr>' +
      '<tr>' +
        '<td class="row-label">USD</td>' +
        usdCell(t.ohUsd) +
        usdCell(t.conOrdenUsd) +
        usdCell(t.sinOrdenUsd) +
      '</tr>' +
    '</tbody>';
  wrapper.appendChild(table);

  return wrapper;
}

function usdCell(value) {
  return '<td class="usd"><span class="money"><span>$</span><span>' + formatNumber(value) + '</span></span></td>';
}

function formatNumber(value) {
  return Math.round(value).toLocaleString('en-US');
}

// ---------- Utilidades ----------

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

function setStatus(msg, isError) {
  statusMsg.textContent = msg || '';
  statusMsg.classList.toggle('error', !!isError);
}

function showLoading(show) {
  loadingEl.style.display = show ? 'block' : 'none';
}
