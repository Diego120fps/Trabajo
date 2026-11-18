var domo = window.domo;
var datasets = window.datasets;
var datasetId = datasets[0];
var FIELD_ITEM_INV = 'ITEM_NUMBER_SECOND';
var FIELD_BRANCH_PLANT = 'ILOC_BRANCH_PLANT';
var FIELD_LOCATION = 'ILOC_LOCATION';
var FIELD_QTY_DISPONIBLE = 'ILOC_QTY_ON_HAND';
var FIELD_FIFO_ORDEN = 'ILOC_DATE_LAST_RECEIPT';
var INVENTARIO_LIMIT = 5000;
var BRANCH_CODES = ['1221', '2300'];

// Localidades que nunca cuentan como disponibles: ni para validar la
// cantidad en Alta, ni para las localidades sugeridas del FIFO.
var LOCALIDADES_EXCLUIDAS = ['SPM101', 'SPM102', 'SPM103', 'SPM104', 'SPM105', 'SPM106', 'SPMKT', 'SPMKT4'];

// Catálogo de items (del dataset de Inventario) para sugerir mientras se
// escribe en Item. Se carga una vez al inicio y se filtra en el navegador.
var ITEM_CATALOGO_LIMIT = 10000;

var COLLECTION = 'solicitudes';
var DOCS_URL = '/domo/datastores/v1/collections/' + COLLECTION + '/documents';
var ALMACEN_COLLECTION = 'almacen_usuarios';
var ALMACEN_DOCS_URL = '/domo/datastores/v1/collections/' + ALMACEN_COLLECTION + '/documents';
var ESTATUS_LABELS = { 0: 'Pendiente', 1: 'En proceso', 2: 'Completado' };
var ESTATUS_INICIAL = 0;
var AGING_AMARILLO_MIN = 30;
var AGING_ROJO_MIN = 45;
var AUTO_REFRESH_MS = 60000;
var tabBtnAlta = document.getElementById('tabBtnAlta');
var tabBtnAlmacen = document.getElementById('tabBtnAlmacen');
var tabBtnSemaforo = document.getElementById('tabBtnSemaforo');
var tabAlta = document.getElementById('tabAlta');
var tabAlmacen = document.getElementById('tabAlmacen');
var tabSemaforo = document.getElementById('tabSemaforo');
var userLabelEl = document.getElementById('userLabel');
var roleBadgeEl = document.getElementById('roleBadge');
var solicitanteInput = document.getElementById('solicitanteInput');
var itemInput = document.getElementById('itemInput');
var itemOptionsEl = document.getElementById('itemOptions');
var lineaInput = document.getElementById('lineaInput');
var cantidadInput = document.getElementById('cantidadInput');
var btnCrear = document.getElementById('btnCrear');
var btnRefrescarAlta = document.getElementById('btnRefrescarAlta');
var buscarAltaInput = document.getElementById('buscarAltaInput');
var mostrarCompletadasAltaInput = document.getElementById('mostrarCompletadasAltaInput');
var altaTbody = document.querySelector('#altaTable tbody');
var btnRefrescar = document.getElementById('btnRefrescar');
var buscarInput = document.getElementById('buscarInput');
var mostrarCompletadasInput = document.getElementById('mostrarCompletadasInput');
var statusMsg = document.getElementById('statusMsg');
var loadingEl = document.getElementById('loading');
var tbody = document.querySelector('#solicitudesTable tbody');
var buscarSemaforoInput = document.getElementById('buscarSemaforoInput');
var mostrarCompletadasSemaforoInput = document.getElementById('mostrarCompletadasSemaforoInput');
var semaforoTbody = document.querySelector('#semaforoTable tbody');
var countVerdeEl = document.getElementById('countVerde');
var countAmarilloEl = document.getElementById('countAmarillo');
var countRojoEl = document.getElementById('countRojo');
var allDocs = [];
var almacenUsuarios = [];
var CURRENT_USER = { id: null, label: 'Usuario desconocido' };
var isAlmacen = false;
var actionMode = null;
var fifoCache = {};

init();

function init() {
  tabBtnAlta.addEventListener('click', function () { switchTab('alta'); });
  tabBtnAlmacen.addEventListener('click', function () { switchTab('almacen'); });
  tabBtnSemaforo.addEventListener('click', function () { switchTab('semaforo'); });

  btnCrear.addEventListener('click', crearSolicitud);
  btnRefrescarAlta.addEventListener('click', cargarSolicitudes);
  buscarAltaInput.addEventListener('input', renderAltaTable);
  mostrarCompletadasAltaInput.addEventListener('change', renderAltaTable);

  btnRefrescar.addEventListener('click', cargarSolicitudes);
  buscarInput.addEventListener('input', renderTable);
  mostrarCompletadasInput.addEventListener('change', renderTable);

  buscarSemaforoInput.addEventListener('input', renderSemaforoTable);
  mostrarCompletadasSemaforoInput.addEventListener('change', renderSemaforoTable);

  cargarCatalogoItems();

  ensureCollections()
    .then(cargarUsuarioActual)
    .then(cargarAlmacenUsuarios)
    .then(function () {
      renderRoleUI();
      return cargarSolicitudes();
    })
    .catch(function (err) {
      showStatus('Error inicializando: ' + describeError(err));
    });

  setInterval(cargarSolicitudes, AUTO_REFRESH_MS);
}

function switchTab(tab) {
  tabAlta.style.display = tab === 'alta' ? '' : 'none';
  tabAlmacen.style.display = tab === 'almacen' ? '' : 'none';
  tabSemaforo.style.display = tab === 'semaforo' ? '' : 'none';
  tabBtnAlta.classList.toggle('active', tab === 'alta');
  tabBtnAlmacen.classList.toggle('active', tab === 'almacen');
  tabBtnSemaforo.classList.toggle('active', tab === 'semaforo');
  if (tab === 'semaforo') renderSemaforoTable();
}

function ensureCollections() {
  return Promise.all([
    domo
      .post('/domo/datastores/v1/collections', {
        name: COLLECTION,
        schema: {
          columns: [
            { name: 'folio', type: 'LONG' },
            { name: 'solicitante', type: 'STRING' },
            { name: 'item', type: 'STRING' },
            { name: 'linea', type: 'STRING' },
            { name: 'cantidad', type: 'DOUBLE' },
            { name: 'fechaHoraInsert', type: 'DATETIME' },
            { name: 'estatus', type: 'LONG' },
            { name: 'userPicking', type: 'STRING' },
            { name: 'fechaHoraPicking', type: 'DATETIME' },
            { name: 'userRelease', type: 'STRING' },
            { name: 'fechaHoraRelease', type: 'DATETIME' },
            { name: 'tiempoRespuestaSegundos', type: 'DOUBLE' }
          ]
        }
      })
      .catch(function () { return null; }),
    domo
      .post('/domo/datastores/v1/collections', {
        name: ALMACEN_COLLECTION,
        schema: {
          columns: [
            { name: 'userId', type: 'STRING' },
            { name: 'nombre', type: 'STRING' }
          ]
        }
      })
      .catch(function () { return null; })
  ]);
}

// ---------- Usuario actual y rol ----------
// Obtiene la identidad de la sesión activa de DOMO.
function cargarUsuarioActual() {
  var domoUserId = domo.env && domo.env.userId;

  if (!domoUserId) {
    CURRENT_USER = { id: null, label: 'Usuario desconocido' };
    showStatus('No se encontró domo.env.userId. Verifica que el brick tenga disponible el contexto de usuario de DOMO.');
    return Promise.resolve();
  }

  return domo
    .get('/domo/users/v1/' + encodeURIComponent(domoUserId) + '?includeDetails=true')
    .then(function (user) {
      CURRENT_USER = {
        id: String(user.id || domoUserId),
        label: user.displayName || user.name || 'Usuario sin nombre'
      };

      // Precarga el solicitante sin sobrescribir un valor que ya haya escrito el usuario.
      if (!solicitanteInput.value.trim()) {
        solicitanteInput.value = CURRENT_USER.label;
      }
    })
    .catch(function (err) {
      CURRENT_USER = { id: null, label: 'Usuario desconocido' };
      showStatus('No se pudo obtener el usuario de DOMO: ' + describeError(err));
    });
}

// Lista blanca de quién puede Asignar/Release. Se da de alta a mano
// (userId + nombre) directo en la colección AppDB "almacen_usuarios" --
// no hay autoregistro, así se mantiene control total de quién entra.
function cargarAlmacenUsuarios() {
  return domo
    .get(ALMACEN_DOCS_URL + '?limit=1000')
    .then(function (docs) {
      almacenUsuarios = docs || [];
      isAlmacen = !!CURRENT_USER.id && almacenUsuarios.some(function (doc) {
        return doc.content.userId === CURRENT_USER.id;
      });
    })
    .catch(function () {
      almacenUsuarios = [];
      isAlmacen = false;
    });
}

function renderRoleUI() {
  userLabelEl.textContent = CURRENT_USER.id ? CURRENT_USER.label + ' (id: ' + CURRENT_USER.id + ')' : CURRENT_USER.label;
  roleBadgeEl.textContent = isAlmacen ? 'Almacén' : 'Solicitante';
  roleBadgeEl.className = 'role-badge ' + (isAlmacen ? 'role-almacen' : 'role-solicitante');
  renderTable();
}

// ---------- Catálogo de items para autocompletar ----------
// Trae los items distintos del dataset de Inventario (por Branch/Plant de
// BRANCH_CODES, una consulta por código) y los pone en el <datalist> del
// Item para que el navegador los sugiera mientras se escribe.
function cargarCatalogoItems() {
  if (!datasetId) return Promise.resolve();

  var queries = BRANCH_CODES.map(function (branchCode) {
    var filter = buildFieldFilter(FIELD_BRANCH_PLANT, branchCode);
    var query =
      '/data/v1/' + datasetId +
      '?fields=' + FIELD_ITEM_INV +
      '&groupby=' + FIELD_ITEM_INV +
      '&filter=' + filter +
      '&orderby=' + FIELD_ITEM_INV +
      '&limit=' + ITEM_CATALOGO_LIMIT;
    return domo.get(query);
  });

  return Promise.all(queries)
    .then(function (results) {
      var vistos = {};
      var items = [];
      results.forEach(function (rows) {
        (rows || []).forEach(function (r) {
          var valor = r[FIELD_ITEM_INV];
          if (valor && !vistos[valor]) {
            vistos[valor] = true;
            items.push(valor);
          }
        });
      });
      items.sort();
      poblarItemOptions(items);
    })
    .catch(function (err) {
      console.error('No se pudo cargar el catálogo de items para sugerencias', err);
    });
}

function poblarItemOptions(items) {
  itemOptionsEl.innerHTML = '';
  items.forEach(function (valor) {
    var opt = document.createElement('option');
    opt.value = valor;
    itemOptionsEl.appendChild(opt);
  });
}

// ---------- ALTA ----------
function crearSolicitud() {
  var solicitante = solicitanteInput.value.trim();
  var item = itemInput.value.trim();
  var linea = lineaInput.value.trim();
  var cantidadRaw = cantidadInput.value.trim();

  if (!solicitante || !item || !linea || cantidadRaw === '') {
    showStatus('Completa Quien solicita, Item, Línea y Cantidad.');
    return;
  }
  var cantidad = Number(cantidadRaw);
  if (isNaN(cantidad)) {
    showStatus('Cantidad debe ser numérica.');
    return;
  }

  setLoading(true);
  showStatus('');

  validarInventarioDisponible(item)
    .then(function (disponible) {
      // disponible === null cuando no hay dataset de Inventario
      // seleccionado todavía: en ese caso no se puede validar, se deja crear.
      if (disponible !== null && disponible < cantidad) {
        showStatus(
          'Inventario insuficiente: disponible ' + formatNumber(disponible) +
          ' de ' + formatNumber(cantidad) + ' solicitadas (no incluye las localidades ' + LOCALIDADES_EXCLUIDAS.join('/') + ').'
        );
        return null;
      }

      var content = {
        folio: nextFolio(),
        solicitante: solicitante,
        item: item,
        linea: linea,
        cantidad: cantidad,
        fechaHoraInsert: new Date().toISOString(),
        estatus: ESTATUS_INICIAL
      };
      return domo.post(DOCS_URL, { content: content }).then(function () {
        itemInput.value = '';
        lineaInput.value = '';
        cantidadInput.value = '';
        return cargarSolicitudes();
      });
    })
    .catch(function (err) {
      showStatus('No se pudo crear la solicitud: ' + describeError(err));
    })
    .then(function () {
      setLoading(false);
    });
}

// Cantidad disponible del item (sumando todos los Branch/Plant de
// BRANCH_CODES, sin contar LOCALIDADES_EXCLUIDAS). Regresa null si no hay
// dataset de Inventario seleccionado y por lo tanto no se puede validar.
function validarInventarioDisponible(item) {
  if (!datasetId) return Promise.resolve(null);
  return fetchInventoryRows(item).then(function (rows) {
    return rows.reduce(function (sum, r) {
      return sum + (Number(r[FIELD_QTY_DISPONIBLE]) || 0);
    }, 0);
  });
}

function nextFolio() {
  var max = 0;
  allDocs.forEach(function (doc) {
    var f = doc.content.folio;
    if (typeof f === 'number' && f > max) max = f;
  });
  return max + 1;
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
      renderAltaTable();
      renderTable();
      renderSemaforoTable();
    })
    .catch(function (err) {
      showStatus('No se pudo cargar la lista: ' + describeError(err));
    })
    .then(function () {
      setLoading(false);
    });
}

function renderAltaTable() {
  var filtro = buscarAltaInput.value.trim().toLowerCase();
  var mostrarCompletadas = mostrarCompletadasAltaInput.checked;
  var rows = allDocs.filter(function (doc) {
    var c = doc.content;
    if (!mostrarCompletadas && c.estatus === 2) return false;
    if (!filtro) return true;
    return (
      (c.solicitante || '').toLowerCase().indexOf(filtro) !== -1 ||
      (c.item || '').toLowerCase().indexOf(filtro) !== -1
    );
  });

  altaTbody.innerHTML = '';

  if (rows.length === 0) {
    var emptyTr = document.createElement('tr');
    var emptyTd = document.createElement('td');
    emptyTd.colSpan = 7;
    emptyTd.className = 'empty-cell';
    emptyTd.textContent = 'Sin solicitudes para mostrar.';
    emptyTr.appendChild(emptyTd);
    altaTbody.appendChild(emptyTr);
    return;
  }

  rows.forEach(function (doc) {
    var c = doc.content;
    var tr = document.createElement('tr');
    tr.appendChild(cell(formatFolio(c.folio), 'numeric'));
    tr.appendChild(cell(c.solicitante));
    tr.appendChild(cell(c.item));
    tr.appendChild(cell(c.linea));
    tr.appendChild(cell(formatNumber(c.cantidad), 'numeric'));
    tr.appendChild(cell(formatDateTime(c.fechaHoraInsert)));
    tr.appendChild(cell(ESTATUS_LABELS[c.estatus] !== undefined ? ESTATUS_LABELS[c.estatus] : c.estatus));
    altaTbody.appendChild(tr);
  });
}

function renderTable() {
  var filtro = buscarInput.value.trim().toLowerCase();
  var mostrarCompletadas = mostrarCompletadasInput.checked;
  var rows = allDocs.filter(function (doc) {
    var c = doc.content;
    if (!mostrarCompletadas && c.estatus === 2) return false;
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
    emptyTd.textContent = 'Sin solicitudes para mostrar.';
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
  if (isAlmacen && actionMode && actionMode.id === doc.id && actionMode.type === 'picking' && !actionMode.esEdicion) {
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

function buildPickingCell(doc) {
  var c = doc.content;
  var td = document.createElement('td');

  if (!isAlmacen) {
    td.textContent = c.userPicking || '';
    return td;
  }

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

  if (c.estatus === 0) {
    var btnAsignar = document.createElement('button');
    btnAsignar.className = 'small';
    btnAsignar.textContent = 'Asignar';
    btnAsignar.addEventListener('click', function () {
      actionMode = { id: doc.id, type: 'picking', esEdicion: false, valorInicial: CURRENT_USER.label };
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
    lineasFifo: fifo ? fifo.lineas : []
  });
  guardarCambios(doc.id, content);
}

function editarPicking(doc, userPicking) {
  if (!userPicking) {
    showStatus('Ingresa el usuario que asigna.');
    return;
  }
  var content = Object.assign({}, doc.content, { userPicking: userPicking });
  guardarCambios(doc.id, content);
}

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

function fetchInventoryRows(itemCode) {
  var fields = [FIELD_ITEM_INV, FIELD_BRANCH_PLANT, FIELD_LOCATION, FIELD_QTY_DISPONIBLE, FIELD_FIFO_ORDEN];
  var itemFilter = buildFieldFilter(FIELD_ITEM_INV, itemCode);

  var queries = BRANCH_CODES.map(function (branchCode) {
    var filter = itemFilter + ',' + buildFieldFilter(FIELD_BRANCH_PLANT, branchCode);
    var query =
      '/data/v1/' + datasetId +
      '?fields=' + fields.join() +
      '&filter=' + filter +
      '&orderby=' + FIELD_FIFO_ORDEN +
      '&limit=' + INVENTARIO_LIMIT;
    console.log('Query FIFO inventario:', query);
    return domo.get(query);
  });

  return Promise.all(queries).then(function (results) {
    console.log('Respuesta FIFO inventario (por Branch/Plant):', results);
    var rows = [].concat.apply(
      [],
      results.map(function (r) { return r || []; })
    );
    // Las localidades excluidas nunca cuentan como disponibles, ni para
    // validar la cantidad en Alta ni para las localidades sugeridas del FIFO.
    rows = rows.filter(function (r) {
      return LOCALIDADES_EXCLUIDAS.indexOf(r[FIELD_LOCATION]) === -1;
    });
    rows.sort(function (a, b) {
      return new Date(a[FIELD_FIFO_ORDEN]) - new Date(b[FIELD_FIFO_ORDEN]);
    });
    return rows;
  });
}

function calcularLineasFifo(rows, cantidadNecesaria) {
  var lineas = [];
  var restante = cantidadNecesaria;
  for (var i = 0; i < rows.length && restante > 0; i++) {
    var disponible = Number(rows[i][FIELD_QTY_DISPONIBLE]) || 0;
    if (disponible <= 0) continue;
    var tomar = Math.min(disponible, restante);
    lineas.push({
      branchPlant: rows[i][FIELD_BRANCH_PLANT],
      localidad: rows[i][FIELD_LOCATION],
      cantidadTomar: tomar,
      disponible: disponible
    });
    restante -= tomar;
  }

  return { lineas: lineas, cubierto: cantidadNecesaria - restante, faltante: restante, rowCount: rows.length };
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
    if (!estado.rowCount) {

      vacio.textContent =
        'No se encontró inventario para el item "' + doc.content.item + '" en los Branch/Plant ' + BRANCH_CODES.join('/') +
        '. Revisa la consola del navegador (se imprime la query exacta) o confirma que "' + doc.content.item + '" existe tal cual en el dataset.';
    } else {
      vacio.textContent = 'Hay ' + estado.rowCount + ' registro(s) de este item, pero con cantidad disponible en 0.';
    }
    wrapper.appendChild(vacio);
  } else {
    var tabla = document.createElement('table');
    tabla.className = 'fifo-table';
    var thead = document.createElement('thead');
    var headTr = document.createElement('tr');
    headTr.appendChild(th('Branch/Plant'));
    headTr.appendChild(th('Localidad'));
    headTr.appendChild(th('Cantidad a tomar'));
    headTr.appendChild(th('Disponible'));
    thead.appendChild(headTr);
    tabla.appendChild(thead);

    var tb = document.createElement('tbody');
    estado.lineas.forEach(function (linea) {
      var lineaTr = document.createElement('tr');
      lineaTr.appendChild(cell(linea.branchPlant));
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


function buildReleaseCell(doc) {
  var c = doc.content;
  var td = document.createElement('td');

  if (!isAlmacen) {
    td.textContent = c.userRelease || '';
    return td;
  }

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

  if (c.estatus === 1) {
    var btnRelease = document.createElement('button');
    btnRelease.className = 'small';
    btnRelease.textContent = 'Release';
    btnRelease.addEventListener('click', function () {
      actionMode = { id: doc.id, type: 'release', esEdicion: false, valorInicial: CURRENT_USER.label };
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

function renderSemaforoTable() {
  var filtro = buscarSemaforoInput.value.trim().toLowerCase();
  var mostrarCompletadas = mostrarCompletadasSemaforoInput.checked;

  var rows = allDocs
    .filter(function (doc) {
      var c = doc.content;
      if (!mostrarCompletadas && c.estatus === 2) return false;
      if (!filtro) return true;
      return (
        (c.solicitante || '').toLowerCase().indexOf(filtro) !== -1 ||
        (c.item || '').toLowerCase().indexOf(filtro) !== -1
      );
    })
    .slice()
    .sort(function (a, b) {
      var aCerrada = a.content.estatus === 2;
      var bCerrada = b.content.estatus === 2;
      if (aCerrada !== bCerrada) return aCerrada ? 1 : -1;
      return aging(b.content) - aging(a.content);
    });

  renderSemaforoCards(rows);

  semaforoTbody.innerHTML = '';

  if (rows.length === 0) {
    var emptyTr = document.createElement('tr');
    var emptyTd = document.createElement('td');
    emptyTd.colSpan = 10;
    emptyTd.className = 'empty-cell';
    emptyTd.textContent = 'Sin solicitudes para mostrar.';
    emptyTr.appendChild(emptyTd);
    semaforoTbody.appendChild(emptyTr);
    return;
  }

  rows.forEach(function (doc) {
    semaforoTbody.appendChild(buildSemaforoRow(doc));
  });
}

function buildSemaforoRow(doc) {
  var c = doc.content;
  var tr = document.createElement('tr');

  tr.appendChild(buildSemaforoCell(c));
  tr.appendChild(cell(formatFolio(c.folio), 'numeric'));
  tr.appendChild(cell(c.solicitante));
  tr.appendChild(cell(c.item));
  tr.appendChild(cell(c.linea));
  tr.appendChild(cell(formatNumber(c.cantidad), 'numeric'));
  tr.appendChild(cell(ESTATUS_LABELS[c.estatus] !== undefined ? ESTATUS_LABELS[c.estatus] : c.estatus));
  tr.appendChild(cell(c.userPicking));
  tr.appendChild(cell(c.userRelease));
  tr.appendChild(cell(formatTiempo(c)));

  return tr;
}

function aging(c) {
  if (typeof c.tiempoRespuestaSegundos === 'number') return c.tiempoRespuestaSegundos;
  return (Date.now() - new Date(c.fechaHoraInsert).getTime()) / 1000;
}

function nivelSemaforo(c) {
  var minutos = aging(c) / 60;
  if (minutos < AGING_AMARILLO_MIN) return 'verde';
  if (minutos < AGING_ROJO_MIN) return 'amarillo';
  return 'rojo';
}

function renderSemaforoCards(rows) {
  var conteos = { verde: 0, amarillo: 0, rojo: 0 };
  rows.forEach(function (doc) {
    conteos[nivelSemaforo(doc.content)]++;
  });
  countVerdeEl.textContent = conteos.verde;
  countAmarilloEl.textContent = conteos.amarillo;
  countRojoEl.textContent = conteos.rojo;
}

function buildSemaforoCell(c) {
  var td = document.createElement('td');
  var dot = document.createElement('span');
  dot.className = 'semaforo-dot semaforo-' + nivelSemaforo(c);
  td.appendChild(dot);
  return td;
}

function formatTiempo(c) {
  return formatTiempoRespuesta(c);
}

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

function formatTiempoRespuesta(c) {
  var segundos = aging(c);
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
