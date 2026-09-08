var domo = window.domo;
var datasets = window.datasets;

// Dataset de Inventario seleccionado en el botón de la esquina inferior
// izquierda del brick. Se usa SOLO para sugerir localidades FIFO al Asignar.
var datasetId = datasets[0];

var FIELD_ITEM_INV = 'ITEM_NUMBER_SECOND';       // Código de item en el dataset de inventario
var FIELD_LOCALIDAD = 'ILOC_BRANCH_PLANT';       // Branch/Plant = la "localidad" a sugerir
var FIELD_QTY_DISPONIBLE = 'ILOC_QTY_ON_HAND';   // Cantidad disponible en esa localidad
var FIELD_FIFO_ORDEN = 'ILOC_DATE_LAST_RECEIPT'; // Fecha de último recibo: se usa para ordenar FIFO

var INVENTARIO_LIMIT = 5000;

// Este almacén solo surte desde estos Branch/Plant (mismo grupo "Plataforma"
// que domo-brick-branch-item-pivot). El operador "in (...)" de la Data API
// de DOMO no se comportó confiable con varios valores, así que se hace UNA
// consulta por código (con "=") y se juntan los resultados, igual que allá.
var BRANCH_CODES = ['1221', '2300'];

// Este brick SOLO asigna (Picking) y libera (Release) solicitudes ya
// creadas. No tiene formulario de alta: eso vive en
// "domo-brick-solicitudes-alta", en otra página compartida solo a
// solicitantes. La separación real la da el permiso de página de DOMO,
// no el código de este brick.

var COLLECTION = 'solicitudes';
var DOCS_URL = '/domo/datastores/v1/collections/' + COLLECTION + '/documents';

// Estatus: 0 Pendiente (creado en el otro brick) -> 1 En proceso (al Asignar) -> 2 Completado (al Release).
var ESTATUS_LABELS = { 0: 'Pendiente', 1: 'En proceso', 2: 'Completado' };

var btnRefrescar = document.getElementById('btnRefrescar');
var buscarInput = document.getElementById('buscarInput');
var statusMsg = document.getElementById('statusMsg');
var loadingEl = document.getElementById('loading');
var tbody = document.querySelector('#solicitudesTable tbody');

var allDocs = []; // última lista traída de AppDB, formato [{id, content: {...}}, ...]

// Fila donde se está capturando el usuario de Asignar o de Release ahora mismo.
// { id: <doc.id>, type: 'picking' | 'release', esEdicion: bool, valorInicial: string }
var actionMode = null;

// Cache de la sugerencia FIFO por solicitud mientras se está Asignando.
// { [doc.id]: { loading, lineas: [{localidad, cantidadTomar, disponible}], cubierto, faltante, error } }
var fifoCache = {};

init();

function init() {
  btnRefrescar.addEventListener('click', cargarSolicitudes);
  buscarInput.addEventListener('input', renderTable);
  cargarSolicitudes();
}

// ---------- CONSULTA ----------
function cargarSolicitudes() {
  setLoading(true);
  showStatus('');
  return domo
    .get(DOCS_URL + '?limit=1000&offset=0')
    .then(function (docs) {
      allDocs = (docs || []).slice().sort(function (a, b) {
        return new Date(b.content.fechaHoraInsert) - new Date(a.content.fechaHoraInsert);
      });
      renderTable();
    })
    .catch(function (err) {
      showStatus('No se pudo cargar la lista: ' + describeError(err));
    })
    .then(function () {
      setLoading(false);
    });
}

function renderTable() {
  var filtro = buscarInput.value.trim().toLowerCase();
  var rows = allDocs.filter(function (doc) {
    var c = doc.content;
    if (c.estatus === 2) return false; // Completadas ya no se muestran, solo abiertas
    if (!filtro) return true;
    return (
      (c.solicitante || '').toLowerCase().indexOf(filtro) !== -1 ||
      (c.item || '').toLowerCase().indexOf(filtro) !== -1
    );
  });

  tbody.innerHTML = '';

  if (rows.length === 0) {
    var emptyTr = document.createElement('tr');
    var emptyTd = document.createElement('td');
    emptyTd.colSpan = 12;
    emptyTd.className = 'empty-cell';
    emptyTd.textContent = 'Sin solicitudes abiertas.';
    emptyTr.appendChild(emptyTd);
    tbody.appendChild(emptyTr);
    return;
  }

  rows.forEach(function (doc) {
    buildRowGroup(doc).forEach(function (tr) {
      tbody.appendChild(tr);
    });
  });
}

function buildRowGroup(doc) {
  var trs = [buildRow(doc)];
  if (actionMode && actionMode.id === doc.id && actionMode.type === 'picking' && !actionMode.esEdicion) {
    trs.push(buildFifoRow(doc));
  }
  return trs;
}

function buildRow(doc) {
  var c = doc.content;
  var tr = document.createElement('tr');

  tr.appendChild(cell(formatFolio(c.folio), 'numeric'));
  tr.appendChild(cell(c.solicitante));
  tr.appendChild(cell(c.item));
  tr.appendChild(cell(c.linea));
  tr.appendChild(cell(formatNumber(c.cantidad), 'numeric'));
  tr.appendChild(cell(formatDateTime(c.fechaHoraInsert)));
  tr.appendChild(cell(ESTATUS_LABELS[c.estatus] !== undefined ? ESTATUS_LABELS[c.estatus] : c.estatus));
  tr.appendChild(buildPickingCell(doc));
  tr.appendChild(cell(formatDateTime(c.fechaHoraPicking)));
  tr.appendChild(buildReleaseCell(doc));
  tr.appendChild(cell(formatDateTime(c.fechaHoraRelease)));
  tr.appendChild(cell(formatTiempoRespuesta(c)));

  return tr;
}

// ---------- ASIGNAR (Picking) + sugerencia FIFO ----------
function buildPickingCell(doc) {
  var c = doc.content;
  var td = document.createElement('td');

  if (actionMode && actionMode.id === doc.id && actionMode.type === 'picking') {
    td.appendChild(
      buildInlineCapture('Usuario que asigna', actionMode.valorInicial, function (valor) {
        if (actionMode.esEdicion) {
          editarPicking(doc, valor);
        } else {
          confirmarPicking(doc, valor);
        }
      })
    );
    return td;
  }

  if (c.userPicking) {
    var valorSpan = document.createElement('span');
    valorSpan.textContent = c.userPicking;
    td.appendChild(valorSpan);

    var btnEditarPicking = document.createElement('button');
    btnEditarPicking.className = 'secondary small';
    btnEditarPicking.textContent = 'Editar';
    btnEditarPicking.addEventListener('click', function () {
      actionMode = { id: doc.id, type: 'picking', esEdicion: true, valorInicial: c.userPicking };
      renderTable();
    });
    td.appendChild(btnEditarPicking);
    return td;
  }

  // Solo Pendiente (sin picking todavía) muestra el botón Asignar.
  if (c.estatus === 0) {
    var btnAsignar = document.createElement('button');
    btnAsignar.className = 'small';
    btnAsignar.textContent = 'Asignar';
    btnAsignar.addEventListener('click', function () {
      actionMode = { id: doc.id, type: 'picking', esEdicion: false, valorInicial: '' };
      fetchFifoLines(doc);
    });
    td.appendChild(btnAsignar);
  }

  return td;
}

function confirmarPicking(doc, userPicking) {
  if (!userPicking) {
    showStatus('Ingresa el usuario que asigna.');
    return;
  }
  var fifo = fifoCache[doc.id];
  var content = Object.assign({}, doc.content, {
    userPicking: userPicking,
    fechaHoraPicking: new Date().toISOString(),
    estatus: 1,
    lineasFifo: fifo ? fifo.lineas : [] // localidades sugeridas al momento de asignar, para auditoría
  });
  guardarCambios(doc.id, content);
}

// Corrige el nombre ya capturado sin tocar fechaHoraPicking/estatus/lineasFifo.
function editarPicking(doc, userPicking) {
  if (!userPicking) {
    showStatus('Ingresa el usuario que asigna.');
    return;
  }
  var content = Object.assign({}, doc.content, { userPicking: userPicking });
  guardarCambios(doc.id, content);
}

// ---------- Sugerencia FIFO ----------
function fetchFifoLines(doc) {
  fifoCache[doc.id] = { loading: true, lineas: [], cubierto: 0, faltante: doc.content.cantidad, error: null };
  renderTable();

  if (!datasetId) {
    fifoCache[doc.id] = {
      loading: false,
      lineas: [],
      cubierto: 0,
      faltante: doc.content.cantidad,
      error: 'Selecciona el dataset de Inventario en el brick (esquina inferior izquierda).'
    };
    renderTable();
    return;
  }

  fetchInventoryRows(doc.content.item)
    .then(function (rows) {
      var resultado = calcularLineasFifo(rows, doc.content.cantidad);
      resultado.loading = false;
      resultado.error = null;
      fifoCache[doc.id] = resultado;
      renderTable();
    })
    .catch(function (err) {
      fifoCache[doc.id] = {
        loading: false,
        lineas: [],
        cubierto: 0,
        faltante: doc.content.cantidad,
        error: describeError(err)
      };
      renderTable();
    });
}

// Una consulta por cada Branch/Plant de BRANCH_CODES (ver nota arriba sobre
// por qué no se usa "in (...)"), juntando y reordenando por FIFO al final.
function fetchInventoryRows(itemCode) {
  var fields = [FIELD_ITEM_INV, FIELD_LOCALIDAD, FIELD_QTY_DISPONIBLE, FIELD_FIFO_ORDEN];
  var itemFilter = buildFieldFilter(FIELD_ITEM_INV, itemCode);

  var queries = BRANCH_CODES.map(function (branchCode) {
    var filter = itemFilter + ',' + buildFieldFilter(FIELD_LOCALIDAD, branchCode);
    var query =
      '/data/v1/' + datasetId +
      '?fields=' + fields.join() +
      '&filter=' + filter +
      '&orderby=' + FIELD_FIFO_ORDEN +
      '&limit=' + INVENTARIO_LIMIT;
    return domo.get(query);
  });

  return Promise.all(queries).then(function (results) {
    var rows = [].concat.apply(
      [],
      results.map(function (r) {
        return r || [];
      })
    );
    rows.sort(function (a, b) {
      return new Date(a[FIELD_FIFO_ORDEN]) - new Date(b[FIELD_FIFO_ORDEN]);
    });
    return rows;
  });
}

// Recorre las filas de inventario (ya ordenadas FIFO por el query) y va
// tomando localidades hasta cubrir la cantidad solicitada. Solo regresa
// las localidades necesarias, no todo el inventario del item.
function calcularLineasFifo(rows, cantidadNecesaria) {
  var lineas = [];
  var restante = cantidadNecesaria;
  for (var i = 0; i < rows.length && restante > 0; i++) {
    var disponible = Number(rows[i][FIELD_QTY_DISPONIBLE]) || 0;
    if (disponible <= 0) continue;
    var tomar = Math.min(disponible, restante);
    lineas.push({
      localidad: rows[i][FIELD_LOCALIDAD],
      cantidadTomar: tomar,
      disponible: disponible
    });
    restante -= tomar;
  }
  return { lineas: lineas, cubierto: cantidadNecesaria - restante, faltante: restante };
}

function buildFieldFilter(field, value) {
  return field + "='" + String(value).replace(/'/g, "''") + "'";
}

function buildFifoRow(doc) {
  var tr = document.createElement('tr');
  tr.className = 'fifo-row';
  var td = document.createElement('td');
  td.colSpan = 12;
  td.appendChild(renderFifoPanel(doc));
  tr.appendChild(td);
  return tr;
}

function renderFifoPanel(doc) {
  var wrapper = document.createElement('div');
  wrapper.className = 'fifo-panel';

  var estado = fifoCache[doc.id];
  if (!estado || estado.loading) {
    wrapper.textContent = 'Calculando localidades FIFO...';
    return wrapper;
  }
  if (estado.error) {
    wrapper.textContent = 'No se pudo calcular FIFO: ' + estado.error;
    return wrapper;
  }

  var titulo = document.createElement('div');
  titulo.className = 'fifo-title';
  titulo.textContent =
    'Localidades sugeridas (FIFO) para cubrir ' + formatNumber(doc.content.cantidad) + ' de ' + doc.content.item + ':';
  wrapper.appendChild(titulo);

  if (estado.lineas.length === 0) {
    var vacio = document.createElement('div');
    vacio.className = 'hint';
    vacio.textContent = 'Sin existencia disponible para este item.';
    wrapper.appendChild(vacio);
  } else {
    var tabla = document.createElement('table');
    tabla.className = 'fifo-table';
    var thead = document.createElement('thead');
    var headTr = document.createElement('tr');
    headTr.appendChild(th('Localidad'));
    headTr.appendChild(th('Cantidad a tomar'));
    headTr.appendChild(th('Disponible'));
    thead.appendChild(headTr);
    tabla.appendChild(thead);

    var tb = document.createElement('tbody');
    estado.lineas.forEach(function (linea) {
      var lineaTr = document.createElement('tr');
      lineaTr.appendChild(cell(linea.localidad));
      lineaTr.appendChild(cell(formatNumber(linea.cantidadTomar), 'numeric'));
      lineaTr.appendChild(cell(formatNumber(linea.disponible), 'numeric'));
      tb.appendChild(lineaTr);
    });
    tabla.appendChild(tb);
    wrapper.appendChild(tabla);
  }

  if (estado.faltante > 0) {
    var warn = document.createElement('div');
    warn.className = 'fifo-warning';
    warn.textContent = 'Inventario insuficiente: faltan ' + formatNumber(estado.faltante) + ' unidades.';
    wrapper.appendChild(warn);
  }

  return wrapper;
}

function th(text) {
  var el = document.createElement('th');
  el.textContent = text;
  return el;
}

// ---------- RELEASE ----------
function buildReleaseCell(doc) {
  var c = doc.content;
  var td = document.createElement('td');

  if (actionMode && actionMode.id === doc.id && actionMode.type === 'release') {
    td.appendChild(
      buildInlineCapture('Usuario que libera', actionMode.valorInicial, function (valor) {
        if (actionMode.esEdicion) {
          editarRelease(doc, valor);
        } else {
          confirmarRelease(doc, valor);
        }
      })
    );
    return td;
  }

  if (c.userRelease) {
    var valorSpan = document.createElement('span');
    valorSpan.textContent = c.userRelease;
    td.appendChild(valorSpan);

    var btnEditarRelease = document.createElement('button');
    btnEditarRelease.className = 'secondary small';
    btnEditarRelease.textContent = 'Editar';
    btnEditarRelease.addEventListener('click', function () {
      actionMode = { id: doc.id, type: 'release', esEdicion: true, valorInicial: c.userRelease };
      renderTable();
    });
    td.appendChild(btnEditarRelease);
    return td;
  }

  // El botón Release solo aparece una vez que ya se asignó el Picking (estatus En proceso).
  if (c.estatus === 1) {
    var btnRelease = document.createElement('button');
    btnRelease.className = 'small';
    btnRelease.textContent = 'Release';
    btnRelease.addEventListener('click', function () {
      actionMode = { id: doc.id, type: 'release', esEdicion: false, valorInicial: '' };
      renderTable();
    });
    td.appendChild(btnRelease);
  }

  return td;
}

function confirmarRelease(doc, userRelease) {
  if (!userRelease) {
    showStatus('Ingresa el usuario que libera.');
    return;
  }
  var ahora = new Date();
  var tiempoRespuestaSegundos = (ahora.getTime() - new Date(doc.content.fechaHoraInsert).getTime()) / 1000;
  var content = Object.assign({}, doc.content, {
    userRelease: userRelease,
    fechaHoraRelease: ahora.toISOString(),
    estatus: 2,
    tiempoRespuestaSegundos: tiempoRespuestaSegundos
  });
  guardarCambios(doc.id, content);
}

// Corrige el nombre ya capturado sin tocar fechaHoraRelease/estatus/tiempoRespuestaSegundos.
function editarRelease(doc, userRelease) {
  if (!userRelease) {
    showStatus('Ingresa el usuario que libera.');
    return;
  }
  var content = Object.assign({}, doc.content, { userRelease: userRelease });
  guardarCambios(doc.id, content);
}

function guardarCambios(docId, content) {
  setLoading(true);
  showStatus('');
  domo
    .put(DOCS_URL + '/' + docId, { content: content })
    .then(function () {
      actionMode = null;
      return cargarSolicitudes();
    })
    .catch(function (err) {
      showStatus('No se pudo actualizar: ' + describeError(err));
    })
    .then(function () {
      setLoading(false);
    });
}

// Input + Confirmar/Cancelar en línea, usado tanto para Asignar/Release como para editarlos.
function buildInlineCapture(placeholder, valorInicial, onConfirm) {
  var wrapper = document.createElement('div');
  wrapper.className = 'inline-action';

  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.value = valorInicial || '';

  var btnConfirmar = document.createElement('button');
  btnConfirmar.className = 'small';
  btnConfirmar.textContent = 'Confirmar';
  btnConfirmar.addEventListener('click', function () {
    onConfirm(input.value.trim());
  });

  var btnCancelar = document.createElement('button');
  btnCancelar.className = 'secondary small';
  btnCancelar.textContent = 'Cancelar';
  btnCancelar.addEventListener('click', function () {
    actionMode = null;
    renderTable();
  });

  wrapper.appendChild(input);
  wrapper.appendChild(btnConfirmar);
  wrapper.appendChild(btnCancelar);
  return wrapper;
}

// ---------- Helpers ----------
function cell(text, cls) {
  var td = document.createElement('td');
  if (cls) td.className = cls;
  td.textContent = text === undefined || text === null ? '' : text;
  return td;
}

function formatNumber(n) {
  return typeof n === 'number' ? n.toLocaleString('es-MX') : n;
}

function formatFolio(folio) {
  return typeof folio === 'number' ? String(folio).padStart(4, '0') : '';
}

function formatDateTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return d.toLocaleString('es-MX');
}

// Si ya se hizo Release, muestra el tiempo de respuesta guardado (fijo, insert -> release).
// Si aún no, muestra el tiempo transcurrido desde el insert hasta ahora.
function formatTiempoRespuesta(c) {
  var segundos;
  if (typeof c.tiempoRespuestaSegundos === 'number') {
    segundos = c.tiempoRespuestaSegundos;
  } else {
    segundos = (Date.now() - new Date(c.fechaHoraInsert).getTime()) / 1000;
  }
  if (segundos < 0) segundos = 0;

  var minutos = Math.floor(segundos / 60);
  var restoSeg = Math.round(segundos % 60);
  var etiqueta = minutos > 0 ? minutos + 'm ' + restoSeg + 's' : restoSeg + 's';
  return typeof c.tiempoRespuestaSegundos === 'number' ? etiqueta : etiqueta + ' (en curso)';
}

function describeError(err) {
  if (!err) return 'Error desconocido';
  if (typeof err === 'string') return err;
  return err.message || JSON.stringify(err);
}

function showStatus(msg) {
  statusMsg.textContent = msg || '';
}

function setLoading(isLoading) {
  loadingEl.style.display = isLoading ? 'block' : 'none';
}
