var domo = window.domo;
var datasets = window.datasets;

// Dataset de Inventario seleccionado en el botón de la esquina inferior
// izquierda del brick. Se usa SOLO para sugerir localidades FIFO al Asignar.
var datasetId = datasets[0];

var FIELD_ITEM_INV = 'ITEM_NUMBER_SECOND';       // Código de item en el dataset de inventario
var FIELD_BRANCH_PLANT = 'ILOC_BRANCH_PLANT';    // Branch/Plant: se usa solo para filtrar (BRANCH_CODES)
var FIELD_LOCATION = 'ILOC_LOCATION';            // Localidad real a donde ir por el material
var FIELD_QTY_DISPONIBLE = 'ILOC_QTY_ON_HAND';   // Cantidad disponible en esa localidad
var FIELD_FIFO_ORDEN = 'ILOC_DATE_LAST_RECEIPT'; // Fecha de último recibo: se usa para ordenar FIFO
var INVENTARIO_LIMIT = 5000;

// Este almacén solo surte desde estos Branch/Plant (mismo grupo "Plataforma"
// que domo-brick-branch-item-pivot). El operador "in (...)" de la Data API
// de DOMO no se comportó confiable con varios valores, así que se hace UNA
// consulta por código (con "=") y se juntan los resultados, igual que allá.
var BRANCH_CODES = ['1221', '2300'];

// ============================================================
// AppDB: TODO va en UN SOLO brick/app para que las 3 vistas (alta,
// asignación/release, semáforo) compartan el mismo AppDB. AppDB en DOMO
// está aislado por app: si cada vista fuera un brick/app distinto, cada
// una tendría su propio almacén vacío aunque usen el mismo nombre de
// colección (eso fue justo el bug que traía la versión de 3 bricks
// separados: Alta veía sus datos, Almacén y Semáforo no).
// ============================================================
var COLLECTION = 'solicitudes';
var DOCS_URL = '/domo/datastores/v1/collections/' + COLLECTION + '/documents';

// Lista blanca de quién puede Asignar/Release. OJO: esto es control de UI,
// NO una barrera de seguridad real -- cualquiera con la consola del
// navegador podría llamar el API de AppDB directo con su propia sesión de
// DOMO, sin pasar por este check. Si necesitas una barrera dura de verdad,
// pregúntale a tu administrador de DOMO si su instancia soporta compartir
// un AppDB entre apps distintas vía Admin/Governance; de ser así se puede
// volver a separar en varios bricks con permisos de página reales.
var ALMACEN_COLLECTION = 'almacen_usuarios';
var ALMACEN_DOCS_URL = '/domo/datastores/v1/collections/' + ALMACEN_COLLECTION + '/documents';

var ESTATUS_LABELS = { 0: 'Pendiente', 1: 'En proceso', 2: 'Completado' };
var ESTATUS_INICIAL = 0;

// Umbrales del semáforo en minutos desde fechaHoraInsert (o el tiempo de
// respuesta ya congelado si la solicitud fue liberada).
var AGING_AMARILLO_MIN = 30;
var AGING_ROJO_MIN = 45;

var AUTO_REFRESH_MS = 60000;

// Este navegador no tiene forma de saber quién eres si domo.env()/el
// endpoint de entorno no están disponibles en este tipo de brick; se
// recuerda el nombre capturado manualmente aquí.
var LOCAL_USER_KEY = 'solicitudes_miIdentidad';

// ---------- DOM ----------
var tabBtnAlta = document.getElementById('tabBtnAlta');
var tabBtnAlmacen = document.getElementById('tabBtnAlmacen');
var tabBtnSemaforo = document.getElementById('tabBtnSemaforo');
var tabAlta = document.getElementById('tabAlta');
var tabAlmacen = document.getElementById('tabAlmacen');
var tabSemaforo = document.getElementById('tabSemaforo');

var userLabelEl = document.getElementById('userLabel');
var roleBadgeEl = document.getElementById('roleBadge');
var identidadManualEl = document.getElementById('identidadManual');
var identidadHintEl = document.getElementById('identidadHint');
var miNombreInput = document.getElementById('miNombreInput');
var btnGuardarNombre = document.getElementById('btnGuardarNombre');
var btnRegistrarAlmacen = document.getElementById('btnRegistrarAlmacen');
var btnQuitarAlmacen = document.getElementById('btnQuitarAlmacen');

var solicitanteInput = document.getElementById('solicitanteInput');
var itemInput = document.getElementById('itemInput');
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

// ---------- Estado ----------
var allDocs = []; // última lista de solicitudes traída de AppDB: [{id, content: {...}}, ...]
var almacenUsuarios = []; // lista blanca de almacén: [{id, content: {userId, nombre}}, ...]
var CURRENT_USER = { id: null, label: 'Usuario desconocido' };
var isAlmacen = false;

// Fila donde se está capturando el usuario de Asignar o de Release ahora mismo.
var actionMode = null;
// Cache de la sugerencia FIFO por solicitud mientras se está Asignando.
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

  btnRegistrarAlmacen.addEventListener('click', registrarmeComoAlmacen);
  btnQuitarAlmacen.addEventListener('click', dejarDeSerAlmacen);
  btnGuardarNombre.addEventListener('click', guardarIdentidadManual);

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

// ---------- Colecciones AppDB ----------
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
// Este tipo de brick (código simple de App Studio, sin manifest.json) NO
// expone la identidad real de la sesión de DOMO: ni domo.env() existe como
// función aquí, ni hay un endpoint equivalente disponible vía domo.get()
// (se probó /domo/environment/v1 y el propio cliente de DOMO tronaba con
// "domo.env is not a function" al pedirlo -- por eso ya no se intenta).
// En su lugar, se pide el nombre una sola vez y se recuerda en este
// navegador (ver mostrarCapturaManual).
function cargarUsuarioActual() {
  mostrarCapturaManual();
  return Promise.resolve();
}

// Recuerda un nombre capturado a mano en este navegador (localStorage), para
// cuando DOMO no expone la identidad real de sesión en este tipo de brick.
// OJO: esto NO es una identidad real de DOMO -- si varias personas comparten
// el mismo navegador/perfil, comparten esta "identidad".
function cargarIdentidadLocal() {
  try {
    var guardado = JSON.parse(localStorage.getItem(LOCAL_USER_KEY) || 'null');
    if (guardado && guardado.id && guardado.label) return guardado;
  } catch (e) {
    // localStorage no disponible; se pedirá el nombre cada vez.
  }
  return null;
}

function mostrarCapturaManual() {
  var guardado = cargarIdentidadLocal();
  if (guardado) {
    CURRENT_USER = guardado;
    return;
  }
  CURRENT_USER = { id: null, label: 'Sin identificar' };
  identidadHintEl.style.display = '';
  identidadManualEl.style.display = '';
}

// El id se deriva del nombre (sin parte aleatoria) para que sea predecible:
// la misma persona escribiendo el mismo nombre en cualquier navegador
// obtiene el mismo id, y si prefieres precargar la colección
// "almacen_usuarios" a mano desde el explorador de AppDB de DOMO en vez de
// que cada quien use el botón "Registrarme como almacén", el id a escribir
// es exactamente "local-" + el nombre en minúsculas con guiones en vez de
// espacios (ej. "Juan Pérez" -> "local-juan-pérez").
function guardarIdentidadManual() {
  var nombre = miNombreInput.value.trim();
  if (!nombre) {
    showStatus('Escribe tu nombre.');
    return;
  }
  var id = 'local-' + nombre.toLowerCase().replace(/\s+/g, '-');
  CURRENT_USER = { id: id, label: nombre };
  try {
    localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(CURRENT_USER));
  } catch (e) {
    // localStorage no disponible; seguirá funcionando en esta sesión pero
    // pedirá el nombre otra vez si se recarga la página.
  }
  identidadManualEl.style.display = 'none';
  identidadHintEl.style.display = 'none';
  setLoading(true);
  cargarAlmacenUsuarios()
    .then(renderRoleUI)
    .then(function () {
      setLoading(false);
    });
}

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
  // Se muestra el id junto al nombre para poder replicarlo a mano en el
  // explorador de AppDB de DOMO si se quiere precargar la colección
  // "almacen_usuarios" sin que cada persona use el botón de registro.
  userLabelEl.textContent = CURRENT_USER.id ? CURRENT_USER.label + ' (id: ' + CURRENT_USER.id + ')' : CURRENT_USER.label;
  roleBadgeEl.textContent = isAlmacen ? 'Almacén' : 'Solicitante';
  roleBadgeEl.className = 'role-badge ' + (isAlmacen ? 'role-almacen' : 'role-solicitante');
  btnRegistrarAlmacen.style.display = !isAlmacen && CURRENT_USER.id ? '' : 'none';
  btnQuitarAlmacen.style.display = isAlmacen ? '' : 'none';
  renderTable();
}

function registrarmeComoAlmacen() {
  if (!CURRENT_USER.id) {
    showStatus('No se pudo identificar tu usuario de DOMO.');
    return;
  }
  setLoading(true);
  domo
    .post(ALMACEN_DOCS_URL, { content: { userId: CURRENT_USER.id, nombre: CURRENT_USER.label } })
    .then(cargarAlmacenUsuarios)
    .then(renderRoleUI)
    .catch(function (err) {
      showStatus('No se pudo registrar: ' + describeError(err));
    })
    .then(function () {
      setLoading(false);
    });
}

function dejarDeSerAlmacen() {
  var doc = almacenUsuarios.filter(function (d) { return d.content.userId === CURRENT_USER.id; })[0];
  if (!doc) return;
  setLoading(true);
  domo
    .delete(ALMACEN_DOCS_URL + '/' + doc.id)
    .then(cargarAlmacenUsuarios)
    .then(renderRoleUI)
    .catch(function (err) {
      showStatus('No se pudo actualizar: ' + describeError(err));
    })
    .then(function () {
      setLoading(false);
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

  var content = {
    folio: nextFolio(),
    solicitante: solicitante,
    item: item,
    linea: linea,
    cantidad: cantidad,
    fechaHoraInsert: new Date().toISOString(),
    estatus: ESTATUS_INICIAL
  };

  setLoading(true);
  showStatus('');
  domo
    .post(DOCS_URL, { content: content })
    .then(function () {
      solicitanteInput.value = '';
      itemInput.value = '';
      lineaInput.value = '';
      cantidadInput.value = '';
      return cargarSolicitudes();
    })
    .catch(function (err) {
      showStatus('No se pudo crear la solicitud: ' + describeError(err));
    })
    .then(function () {
      setLoading(false);
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

// ---------- Tabla de Alta (solo lectura, sin botones de acción) ----------
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

// ---------- ASIGNAR (Picking) + sugerencia FIFO — solo Almacén ----------
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
    // Se deja en consola para poder revisar la query exacta y su respuesta
    // si el FIFO no regresa lo esperado (ej. field IDs incorrectos).
    console.log('Query FIFO inventario:', query);
    return domo.get(query);
  });

  return Promise.all(queries).then(function (results) {
    console.log('Respuesta FIFO inventario (por Branch/Plant):', results);
    var rows = [].concat.apply(
      [],
      results.map(function (r) { return r || []; })
    );
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
  // rowCount se guarda para poder distinguir en el panel "no hay registros
  // de este item en el dataset/Branch-Plant" de "hay registros pero sin
  // cantidad disponible".
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
      // 0 filas del dataset: lo más probable es que el item no exista tal
      // cual en ITEM_NUMBER_SECOND, que no haya inventario en los Branch/
      // Plant configurados (BRANCH_CODES), o que los field IDs no sean los
      // reales (revisa la consola del navegador: ahí queda la query y la
      // respuesta cruda de cada Branch/Plant).
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

// ---------- RELEASE — solo Almacén ----------
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

// ---------- SEMÁFORO (solo lectura) ----------
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

// Cuenta por rubro sobre las filas que ya se filtraron (buscador +
// "Mostrar completadas"), para que las tarjetas siempre coincidan con lo
// que se ve en la tabla de abajo.
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
