var domo = window.domo;
var datasets = window.datasets;

// Dataset 1 (botón de la esquina inferior izquierda, en orden): Inventario.
// Se usa SOLO para sugerir localidades FIFO al Asignar.
var datasetId = datasets[0];
// Dataset 2: Work Orders. Es la fuente de verdad de qué hay que picfar: ya
// no hay alta manual, esta tabla se arma sola a partir de las WO abiertas.
var workOrdersDatasetId = datasets[1];

var FIELD_ITEM_INV = 'ITEM_NUMBER_SECOND';       // Código de item en el dataset de inventario
var FIELD_BRANCH_PLANT = 'ILOC_BRANCH_PLANT';    // Branch/Plant: se usa solo para filtrar (BRANCH_CODES)
var FIELD_LOCATION = 'ILOC_LOCATION';            // Localidad real a donde ir por el material
var FIELD_QTY_DISPONIBLE = 'ILOC_QTY_ON_HAND';   // Cantidad disponible en esa localidad
var FIELD_FIFO_ORDEN = 'ILOC_DATE_LAST_RECEIPT'; // Fecha de último recibo: se usa para ordenar FIFO
var INVENTARIO_LIMIT = 5000;

// Localidad que nunca cuenta como disponible para el FIFO.
var LOCALIDAD_EXCLUIDA = 'SMK';

// Este almacén (Calle2, según el nombre de ALMACEN_COLLECTION de abajo)
// solo surte desde estos Branch/Plant. AJUSTA este código si Calle2 no es
// '2190' en tu instancia (viene del grupo "Calle2" de
// domo-brick-branch-item-pivot) -- el operador "in (...)" de la Data API
// de DOMO no se comportó confiable con varios valores, así que si agregas
// más de un código se hace UNA consulta por código y se juntan resultados.
var BRANCH_CODES = ['2190'];

// ============================================================
// TODO: ajusta estos field IDs a los nombres reales de tu dataset de Work
// Orders (dataset 2). Revisa la consola del navegador: la query exacta y
// la respuesta cruda quedan logueadas ahí si algo no regresa lo esperado.
// ============================================================
var FIELD_WO_NUMBER = 'WO_NUMBER';                  // Número/folio de la Work Order
var FIELD_WO_ITEM = 'WO_ITEM';                       // Item a producir
var FIELD_WO_LINEA = 'WO_LINEA';                     // Línea/centro de trabajo (ya no se captura a mano)
var FIELD_WO_BRANCH_PLANT = 'WO_BRANCH_PLANT';       // Branch/Plant de la orden
var FIELD_WO_CANTIDAD_PENDIENTE = 'WO_QTY_PENDING';  // Cantidad pendiente de surtir
var FIELD_WO_ESTATUS = 'WO_STATUS';                  // Campo de estatus de la orden
var WO_ESTATUS_ABIERTOS = ['OP'];                    // Valor(es) de FIELD_WO_ESTATUS que significan "abierta"
var WO_LIMIT = 5000;

// ============================================================
// AppDB: tracking de Asignar/Release por Work Order. Vive en UN SOLO
// brick/app (este) -- AppDB está aislado por app en DOMO, así que no se
// puede compartir con el proyecto de Solicitudes aunque uses el mismo
// nombre de colección (por eso cada proyecto tiene su propio
// almacen_usuarios, con su propio alta/autoregistro).
// ============================================================
var TRACKING_COLLECTION = 'work_order_picking';
var TRACKING_DOCS_URL = '/domo/datastores/v1/collections/' + TRACKING_COLLECTION + '/documents';

// Lista blanca de quién puede Asignar/Release, propia de este proyecto
// (Calle2). OJO: esto es control de UI, NO una barrera de seguridad real.
var ALMACEN_COLLECTION = 'almacen_usuarios_calle2';
var ALMACEN_DOCS_URL = '/domo/datastores/v1/collections/' + ALMACEN_COLLECTION + '/documents';

var ESTATUS_LABELS = { 0: 'Pendiente', 1: 'En proceso', 2: 'Completado' };

// Umbrales del semáforo en minutos desde que se detectó la WO pendiente (o
// el tiempo de respuesta ya congelado si se liberó).
var AGING_AMARILLO_MIN = 30;
var AGING_ROJO_MIN = 45;

var AUTO_REFRESH_MS = 60000;

// Este navegador no tiene forma de saber quién eres si domo.env()/el
// endpoint de entorno no están disponibles en este tipo de brick; se
// recuerda el nombre capturado manualmente aquí (clave distinta a la del
// proyecto de Solicitudes para no mezclar identidades entre los dos).
var LOCAL_USER_KEY = 'wo_picking_miIdentidad';

// ---------- DOM ----------
var tabBtnAlmacen = document.getElementById('tabBtnAlmacen');
var tabBtnSemaforo = document.getElementById('tabBtnSemaforo');
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
// Una fila por Work Order abierta, mezclando el dato vivo del dataset
// (item/línea/cantidad pendiente/branch) con el tracking de AppDB
// (userPicking/userRelease/fechas/estatus). Ver mezclar().
var filas = [];
var almacenUsuarios = []; // lista blanca de almacén: [{id, content: {userId, nombre}}, ...]
var CURRENT_USER = { id: null, label: 'Usuario desconocido' };
var isAlmacen = false;

// Fila (identificada por woNumber) donde se está capturando el usuario de
// Asignar o de Release ahora mismo.
var actionMode = null;
// Cache de la sugerencia FIFO por WO (keyed por woNumber) mientras se está Asignando.
var fifoCache = {};

init();

function init() {
  tabBtnAlmacen.addEventListener('click', function () { switchTab('almacen'); });
  tabBtnSemaforo.addEventListener('click', function () { switchTab('semaforo'); });

  btnRefrescar.addEventListener('click', cargarTodo);
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
      return cargarTodo();
    })
    .catch(function (err) {
      showStatus('Error inicializando: ' + describeError(err));
    });

  setInterval(cargarTodo, AUTO_REFRESH_MS);
}

function switchTab(tab) {
  tabAlmacen.style.display = tab === 'almacen' ? '' : 'none';
  tabSemaforo.style.display = tab === 'semaforo' ? '' : 'none';
  tabBtnAlmacen.classList.toggle('active', tab === 'almacen');
  tabBtnSemaforo.classList.toggle('active', tab === 'semaforo');
  if (tab === 'semaforo') renderSemaforoTable();
}

// ---------- Colecciones AppDB ----------
function ensureCollections() {
  return Promise.all([
    domo
      .post('/domo/datastores/v1/collections', {
        name: TRACKING_COLLECTION,
        schema: {
          columns: [
            { name: 'woNumber', type: 'STRING' },
            { name: 'fechaHoraPendienteDetectada', type: 'DATETIME' },
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
// expone la identidad real de la sesión de DOMO: domo.env() no existe como
// función aquí. En su lugar, se pide el nombre una sola vez y se recuerda
// en este navegador (ver mostrarCapturaManual).
function cargarUsuarioActual() {
  mostrarCapturaManual();
  return Promise.resolve();
}

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
// obtiene el mismo id, y si prefieres precargar "almacen_usuarios_calle2"
// a mano desde el explorador de AppDB de DOMO en vez de que cada quien use
// el botón "Registrarme como almacén", el id a escribir es exactamente
// "local-" + el nombre en minúsculas con guiones en vez de espacios.
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
      var coincidePorId = !!CURRENT_USER.id && almacenUsuarios.some(function (doc) {
        return doc.content.userId === CURRENT_USER.id;
      });
      isAlmacen = coincidePorId || nombreCoincideConAlmacen(CURRENT_USER.label);
    })
    .catch(function () {
      almacenUsuarios = [];
      isAlmacen = false;
    });
}

function nombreCoincideConAlmacen(nombre) {
  var normalizado = normalizarTexto(nombre);
  if (!normalizado) return false;
  return almacenUsuarios.some(function (doc) {
    return normalizarTexto(doc.content.nombre) === normalizado;
  });
}

function normalizarTexto(s) {
  return (s || '').trim().toLowerCase();
}

function renderRoleUI() {
  userLabelEl.textContent = CURRENT_USER.id ? CURRENT_USER.label + ' (id: ' + CURRENT_USER.id + ')' : CURRENT_USER.label;
  roleBadgeEl.textContent = isAlmacen ? 'Almacén' : 'Sin rol';
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
  var doc = almacenUsuarios.filter(function (d) {
    return (
      (CURRENT_USER.id && d.content.userId === CURRENT_USER.id) ||
      normalizarTexto(d.content.nombre) === normalizarTexto(CURRENT_USER.label)
    );
  })[0];
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

// ---------- Fuente de datos: Work Orders abiertas + tracking ----------
function cargarTodo() {
  setLoading(true);
  showStatus('');
  return fetchWorkOrdersAbiertas()
    .then(function (wosAbiertas) {
      return fetchTracking().then(function (trackingDocs) {
        return crearTrackingFaltante(wosAbiertas, trackingDocs).then(function (trackingFinal) {
          return mezclar(wosAbiertas, trackingFinal);
        });
      });
    })
    .then(function (filasFinal) {
      filas = filasFinal;
      renderTable();
      renderSemaforoTable();
    })
    .catch(function (err) {
      showStatus('No se pudo cargar: ' + describeError(err));
    })
    .then(function () {
      setLoading(false);
    });
}

// Trae las Work Orders abiertas (una consulta por valor de WO_ESTATUS_ABIERTOS,
// mismo patrón que BRANCH_CODES: el operador "in (...)" no es confiable) y
// se queda solo con las que de verdad tienen cantidad pendiente > 0.
function fetchWorkOrdersAbiertas() {
  if (!workOrdersDatasetId) {
    showStatus('Selecciona el dataset de Work Orders en el brick (esquina inferior izquierda, dataset 2).');
    return Promise.resolve([]);
  }

  var fields = [FIELD_WO_NUMBER, FIELD_WO_ITEM, FIELD_WO_LINEA, FIELD_WO_BRANCH_PLANT, FIELD_WO_CANTIDAD_PENDIENTE, FIELD_WO_ESTATUS];
  var queries = WO_ESTATUS_ABIERTOS.map(function (valorAbierto) {
    var filter = buildFieldFilter(FIELD_WO_ESTATUS, valorAbierto);
    var query =
      '/data/v1/' + workOrdersDatasetId +
      '?fields=' + fields.join() +
      '&filter=' + filter +
      '&limit=' + WO_LIMIT;
    console.log('Query Work Orders abiertas:', query);
    return domo.get(query);
  });

  return Promise.all(queries).then(function (results) {
    console.log('Respuesta Work Orders abiertas:', results);
    var rows = [].concat.apply([], results.map(function (r) { return r || []; }));
    return rows.filter(function (r) {
      return (Number(r[FIELD_WO_CANTIDAD_PENDIENTE]) || 0) > 0;
    });
  });
}

function fetchTracking() {
  return domo.get(TRACKING_DOCS_URL + '?limit=1000').catch(function () {
    return [];
  });
}

// Para cada WO abierta sin registro de tracking todavía, crea uno con la
// fecha/hora en que esta app la detectó pendiente por primera vez (es el
// equivalente al "fechaHoraInsert" de las solicitudes manuales, pero
// automático: nadie lo captura). Si ya existe, se deja tal cual (preserva
// userPicking/userRelease/fechas ya capturados). Tras crear lo que faltaba,
// se vuelve a traer el tracking completo para tener los ids reales.
function crearTrackingFaltante(wosAbiertas, trackingDocs) {
  var trackingPorWo = {};
  trackingDocs.forEach(function (doc) {
    trackingPorWo[doc.content.woNumber] = doc;
  });

  var faltantes = wosAbiertas.filter(function (wo) {
    return !trackingPorWo[String(wo[FIELD_WO_NUMBER])];
  });

  if (faltantes.length === 0) return Promise.resolve(trackingDocs);

  var creaciones = faltantes.map(function (wo) {
    return domo.post(TRACKING_DOCS_URL, {
      content: {
        woNumber: String(wo[FIELD_WO_NUMBER]),
        fechaHoraPendienteDetectada: new Date().toISOString(),
        estatus: 0
      }
    });
  });

  return Promise.all(creaciones).then(function () {
    return fetchTracking();
  });
}

function mezclar(wosAbiertas, trackingDocs) {
  var trackingPorWo = {};
  trackingDocs.forEach(function (doc) {
    trackingPorWo[doc.content.woNumber] = doc;
  });

  return wosAbiertas.map(function (wo) {
    var woNumber = String(wo[FIELD_WO_NUMBER]);
    var trackingDoc = trackingPorWo[woNumber];
    return {
      docId: trackingDoc ? trackingDoc.id : null, // null = aún no se pudo crear su tracking; refresca
      woNumber: woNumber,
      item: wo[FIELD_WO_ITEM],
      linea: wo[FIELD_WO_LINEA],
      branchPlant: wo[FIELD_WO_BRANCH_PLANT],
      cantidad: Number(wo[FIELD_WO_CANTIDAD_PENDIENTE]) || 0,
      content: trackingDoc ? trackingDoc.content : { woNumber: woNumber, fechaHoraPendienteDetectada: new Date().toISOString(), estatus: 0 }
    };
  });
}

// ---------- Tabla Asignar / Release ----------
function renderTable() {
  var filtro = buscarInput.value.trim().toLowerCase();
  var mostrarCompletadas = mostrarCompletadasInput.checked;
  var rows = filas.filter(function (fila) {
    var c = fila.content;
    if (!mostrarCompletadas && c.estatus === 2) return false;
    if (!filtro) return true;
    return (
      fila.woNumber.toLowerCase().indexOf(filtro) !== -1 ||
      (fila.item || '').toLowerCase().indexOf(filtro) !== -1
    );
  });

  tbody.innerHTML = '';

  if (rows.length === 0) {
    var emptyTr = document.createElement('tr');
    var emptyTd = document.createElement('td');
    emptyTd.colSpan = 12;
    emptyTd.className = 'empty-cell';
    emptyTd.textContent = 'Sin Work Orders abiertas para mostrar.';
    emptyTr.appendChild(emptyTd);
    tbody.appendChild(emptyTr);
    return;
  }

  rows.forEach(function (fila) {
    buildRowGroup(fila).forEach(function (tr) {
      tbody.appendChild(tr);
    });
  });
}

function buildRowGroup(fila) {
  var trs = [buildRow(fila)];
  if (isAlmacen && actionMode && actionMode.woNumber === fila.woNumber && actionMode.type === 'picking' && !actionMode.esEdicion) {
    trs.push(buildFifoRow(fila));
  }
  return trs;
}

function buildRow(fila) {
  var c = fila.content;
  var tr = document.createElement('tr');

  tr.appendChild(cell(fila.woNumber));
  tr.appendChild(cell(fila.item));
  tr.appendChild(cell(fila.linea));
  tr.appendChild(cell(fila.branchPlant));
  tr.appendChild(cell(formatNumber(fila.cantidad), 'numeric'));
  tr.appendChild(cell(formatDateTime(c.fechaHoraPendienteDetectada)));
  tr.appendChild(cell(ESTATUS_LABELS[c.estatus] !== undefined ? ESTATUS_LABELS[c.estatus] : c.estatus));
  tr.appendChild(buildPickingCell(fila));
  tr.appendChild(cell(formatDateTime(c.fechaHoraPicking)));
  tr.appendChild(buildReleaseCell(fila));
  tr.appendChild(cell(formatDateTime(c.fechaHoraRelease)));
  tr.appendChild(cell(formatTiempoRespuesta(c)));

  return tr;
}

// ---------- ASIGNAR (Picking) + sugerencia FIFO — solo Almacén ----------
function buildPickingCell(fila) {
  var c = fila.content;
  var td = document.createElement('td');

  if (!isAlmacen) {
    td.textContent = c.userPicking || '';
    return td;
  }

  if (actionMode && actionMode.woNumber === fila.woNumber && actionMode.type === 'picking') {
    td.appendChild(
      buildInlineCapture('Usuario que asigna', actionMode.valorInicial, function (valor) {
        if (actionMode.esEdicion) {
          editarPicking(fila, valor);
        } else {
          confirmarPicking(fila, valor);
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
      actionMode = { woNumber: fila.woNumber, type: 'picking', esEdicion: true, valorInicial: c.userPicking };
      renderTable();
    });
    td.appendChild(btnEditarPicking);
    return td;
  }

  if (c.estatus === 0) {
    var btnAsignar = document.createElement('button');
    btnAsignar.className = 'small';
    btnAsignar.textContent = 'Asignar';
    btnAsignar.disabled = !fila.docId;
    btnAsignar.title = fila.docId ? '' : 'Todavía preparando este registro, refresca en unos segundos.';
    btnAsignar.addEventListener('click', function () {
      actionMode = { woNumber: fila.woNumber, type: 'picking', esEdicion: false, valorInicial: CURRENT_USER.label };
      fetchFifoLines(fila);
    });
    td.appendChild(btnAsignar);
  }

  return td;
}

function confirmarPicking(fila, userPicking) {
  if (!userPicking) {
    showStatus('Ingresa el usuario que asigna.');
    return;
  }
  var fifo = fifoCache[fila.woNumber];
  var content = Object.assign({}, fila.content, {
    userPicking: userPicking,
    fechaHoraPicking: new Date().toISOString(),
    estatus: 1,
    lineasFifo: fifo ? fifo.lineas : []
  });
  guardarCambios(fila, content);
}

function editarPicking(fila, userPicking) {
  if (!userPicking) {
    showStatus('Ingresa el usuario que asigna.');
    return;
  }
  var content = Object.assign({}, fila.content, { userPicking: userPicking });
  guardarCambios(fila, content);
}

// ---------- Sugerencia FIFO (según la cantidad pendiente de la WO) ----------
function fetchFifoLines(fila) {
  fifoCache[fila.woNumber] = { loading: true, lineas: [], cubierto: 0, faltante: fila.cantidad, error: null };
  renderTable();

  if (!datasetId) {
    fifoCache[fila.woNumber] = {
      loading: false,
      lineas: [],
      cubierto: 0,
      faltante: fila.cantidad,
      error: 'Selecciona el dataset de Inventario en el brick (esquina inferior izquierda, dataset 1).'
    };
    renderTable();
    return;
  }

  fetchInventoryRows(fila.item)
    .then(function (rows) {
      var resultado = calcularLineasFifo(rows, fila.cantidad);
      resultado.loading = false;
      resultado.error = null;
      fifoCache[fila.woNumber] = resultado;
      renderTable();
    })
    .catch(function (err) {
      fifoCache[fila.woNumber] = {
        loading: false,
        lineas: [],
        cubierto: 0,
        faltante: fila.cantidad,
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
    rows = rows.filter(function (r) {
      return r[FIELD_LOCATION] !== LOCALIDAD_EXCLUIDA;
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

function buildFifoRow(fila) {
  var tr = document.createElement('tr');
  tr.className = 'fifo-row';
  var td = document.createElement('td');
  td.colSpan = 12;
  td.appendChild(renderFifoPanel(fila));
  tr.appendChild(td);
  return tr;
}

function renderFifoPanel(fila) {
  var wrapper = document.createElement('div');
  wrapper.className = 'fifo-panel';

  var estado = fifoCache[fila.woNumber];
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
    'Localidades sugeridas (FIFO) para cubrir ' + formatNumber(fila.cantidad) + ' de ' + fila.item + ' (WO ' + fila.woNumber + '):';
  wrapper.appendChild(titulo);

  if (estado.lineas.length === 0) {
    var vacio = document.createElement('div');
    vacio.className = 'hint';
    if (!estado.rowCount) {
      vacio.textContent =
        'No se encontró inventario para el item "' + fila.item + '" en los Branch/Plant ' + BRANCH_CODES.join('/') +
        '. Revisa la consola del navegador (se imprime la query exacta) o confirma que el item existe tal cual en el dataset.';
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
function buildReleaseCell(fila) {
  var c = fila.content;
  var td = document.createElement('td');

  if (!isAlmacen) {
    td.textContent = c.userRelease || '';
    return td;
  }

  if (actionMode && actionMode.woNumber === fila.woNumber && actionMode.type === 'release') {
    td.appendChild(
      buildInlineCapture('Usuario que libera', actionMode.valorInicial, function (valor) {
        if (actionMode.esEdicion) {
          editarRelease(fila, valor);
        } else {
          confirmarRelease(fila, valor);
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
      actionMode = { woNumber: fila.woNumber, type: 'release', esEdicion: true, valorInicial: c.userRelease };
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
      actionMode = { woNumber: fila.woNumber, type: 'release', esEdicion: false, valorInicial: CURRENT_USER.label };
      renderTable();
    });
    td.appendChild(btnRelease);
  }

  return td;
}

function confirmarRelease(fila, userRelease) {
  if (!userRelease) {
    showStatus('Ingresa el usuario que libera.');
    return;
  }
  var ahora = new Date();
  var tiempoRespuestaSegundos = (ahora.getTime() - new Date(fila.content.fechaHoraPendienteDetectada).getTime()) / 1000;
  var content = Object.assign({}, fila.content, {
    userRelease: userRelease,
    fechaHoraRelease: ahora.toISOString(),
    estatus: 2,
    tiempoRespuestaSegundos: tiempoRespuestaSegundos
  });
  guardarCambios(fila, content);
}

function editarRelease(fila, userRelease) {
  if (!userRelease) {
    showStatus('Ingresa el usuario que libera.');
    return;
  }
  var content = Object.assign({}, fila.content, { userRelease: userRelease });
  guardarCambios(fila, content);
}

function guardarCambios(fila, content) {
  if (!fila.docId) {
    showStatus('Todavía se está preparando el registro de esta Work Order. Refresca e intenta de nuevo.');
    return;
  }
  setLoading(true);
  showStatus('');
  domo
    .put(TRACKING_DOCS_URL + '/' + fila.docId, { content: content })
    .then(function () {
      actionMode = null;
      return cargarTodo();
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

  var rows = filas
    .filter(function (fila) {
      var c = fila.content;
      if (!mostrarCompletadas && c.estatus === 2) return false;
      if (!filtro) return true;
      return (
        fila.woNumber.toLowerCase().indexOf(filtro) !== -1 ||
        (fila.item || '').toLowerCase().indexOf(filtro) !== -1
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
    emptyTd.colSpan = 9;
    emptyTd.className = 'empty-cell';
    emptyTd.textContent = 'Sin Work Orders para mostrar.';
    emptyTr.appendChild(emptyTd);
    semaforoTbody.appendChild(emptyTr);
    return;
  }

  rows.forEach(function (fila) {
    semaforoTbody.appendChild(buildSemaforoRow(fila));
  });
}

function buildSemaforoRow(fila) {
  var c = fila.content;
  var tr = document.createElement('tr');

  tr.appendChild(buildSemaforoCell(c));
  tr.appendChild(cell(fila.woNumber));
  tr.appendChild(cell(fila.item));
  tr.appendChild(cell(fila.linea));
  tr.appendChild(cell(formatNumber(fila.cantidad), 'numeric'));
  tr.appendChild(cell(ESTATUS_LABELS[c.estatus] !== undefined ? ESTATUS_LABELS[c.estatus] : c.estatus));
  tr.appendChild(cell(c.userPicking));
  tr.appendChild(cell(c.userRelease));
  tr.appendChild(cell(formatTiempoRespuesta(c)));

  return tr;
}

function aging(c) {
  if (typeof c.tiempoRespuestaSegundos === 'number') return c.tiempoRespuestaSegundos;
  return (Date.now() - new Date(c.fechaHoraPendienteDetectada).getTime()) / 1000;
}

function nivelSemaforo(c) {
  var minutos = aging(c) / 60;
  if (minutos < AGING_AMARILLO_MIN) return 'verde';
  if (minutos < AGING_ROJO_MIN) return 'amarillo';
  return 'rojo';
}

function renderSemaforoCards(rows) {
  var conteos = { verde: 0, amarillo: 0, rojo: 0 };
  rows.forEach(function (fila) {
    conteos[nivelSemaforo(fila.content)]++;
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
