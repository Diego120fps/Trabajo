var domo = window.domo;
var datasets = window.datasets;

// Datasets, en este orden en el botón de la esquina inferior izquierda:
// 1 = Inventario (FIFO de componentes), 2 = BOM (FG -> componentes),
// 3 = Work Orders (FG abiertas).
var datasetId = datasets[0];
var bomDatasetId = datasets[1];
var workOrdersDatasetId = datasets[2];

var FIELD_ITEM_INV = 'ITEM_NUMBER_SECOND';       // Código de item en el dataset de inventario (ahora: el componente, no el FG)
var FIELD_BRANCH_PLANT = 'ILOC_BRANCH_PLANT';    // Branch/Plant: se usa solo para filtrar (BRANCH_CODES)
var FIELD_LOCATION = 'ILOC_LOCATION';            // Localidad real a donde ir por el material
var FIELD_QTY_DISPONIBLE = 'ILOC_QTY_ON_HAND';   // Cantidad disponible en esa localidad
var FIELD_FIFO_ORDEN = 'ILOC_DATE_LAST_RECEIPT'; // Fecha de último recibo: se usa para ordenar FIFO
var INVENTARIO_LIMIT = 5000;

// Localidad que nunca cuenta como disponible para el FIFO.
var LOCALIDAD_EXCLUIDA = 'SMK';

// Este almacén (Calle2, según el nombre de ALMACEN_COLLECTION de abajo)
// solo surte desde estos Branch/Plant. El operador "in (...)" de la Data
// API de DOMO no se comportó confiable con varios valores, así que si
// agregas más de un código se hace UNA consulta por código y se juntan
// resultados (mismo patrón usado para WO y para BOM).
var BRANCH_CODES = ['2190'];

// ============================================================
// Field IDs reales del dataset de Work Orders (dataset 3). Son a nivel
// Finished Good (FG): la cantidad real a surtir se calcula por componente
// vía BOM (ver más abajo), no se surte el FG directo.
// ============================================================
var FIELD_WO_NUMBER = 'WO_DOC_NUMBER';                        // Número/folio de la Work Order
var FIELD_WO_ITEM = 'WO_ITEM_NUMBER_SECOND';                  // Item Finished Good a producir
var FIELD_WO_LINEA = 'WO_CAT_CODE_01';                        // Línea/centro de trabajo
var FIELD_WO_BRANCH_PLANT = 'WO_BRANCH_PLANT';                // Branch/Plant de la orden
var FIELD_WO_DATE_START = 'WO_DATE_START';                    // Fecha de inicio: se ordena de más antigua a más nueva
// Cantidad pendiente (FG) = WO_QUANTITY_ORDERED - WO_QUANTITY_COMPLETED.
var FIELD_WO_QTY_ORDERED = 'WO_QUANTITY_ORDERED';
var FIELD_WO_QTY_COMPLETED = 'WO_QUANTITY_COMPLETED';
var FIELD_WO_ESTATUS = 'WO_STATUS_CODE';                      // Campo de estatus de la orden

// "Abierta" = WO_STATUS_CODE entre estos dos valores (inclusive).
var WO_ESTATUS_ABIERTO_MIN = 40;
var WO_ESTATUS_ABIERTO_MAX = 80;
var WO_LIMIT = 50000; // antes 5000, se veia truncado exacto en ese numero
// Tope de cuántas WO abiertas se procesan (las más nuevas por
// WO_DATE_START). Con muchas WO, expandir a componentes y crear su
// tracking en AppDB se vuelve lento; esto acota el trabajo por corrida.
var WO_TOP_N = 100;

// ============================================================
// Field IDs del dataset de BOM (dataset 2): qué componentes (materia
// prima) hacen falta por cada Finished Good, y en qué proporción. Ya
// viene filtrado por branch del lado de DOMO -- no tiene columna de branch.
// ============================================================
var FIELD_BOM_FG_ITEM = 'FINISHED_GOOD';    // FG: se junta con FIELD_WO_ITEM
var FIELD_BOM_COMPONENT_ITEM = 'COMPONENT_ITEM_NUMBER'; // Componente que hay que surtir
var FIELD_BOM_COMPONENT_QTY = 'COMPONENT_QUANTITY';     // Factor de uso: se multiplica x la cantidad pendiente de la WO
var BOM_LIMIT = 50000; // antes 5000, se veia truncado exacto en ese numero

// ============================================================
// AppDB: tracking de Asignar/Release por componente x Work Order (no por
// WO completa: una WO puede tener varios componentes, cada uno con su
// propio ciclo de Asignar/Release). Vive en UN SOLO brick/app (este) --
// AppDB está aislado por app en DOMO, así que no se puede compartir con
// el proyecto de Solicitudes aunque uses el mismo nombre de colección.
// ============================================================
var TRACKING_COLLECTION = 'work_order_picking';
var TRACKING_DOCS_URL = '/domo/datastores/v1/collections/' + TRACKING_COLLECTION + '/documents';
// Cuántos documentos de tracking se crean en paralelo a la vez (ver
// ejecutarEnLotes/crearTrackingFaltante): disparar miles de peticiones de
// golpe revienta el navegador con ERR_INSUFFICIENT_RESOURCES.
var TRACKING_BATCH_SIZE = 20;

// Lista blanca de quién puede Asignar/Release, propia de este proyecto
// (Calle2), dada de alta a mano por el administrador en AppDB -- no hay
// autoregistro. OJO: esto es control de UI, NO una barrera de seguridad real.
var ALMACEN_COLLECTION = 'almacen_usuarios_calle2';
var ALMACEN_DOCS_URL = '/domo/datastores/v1/collections/' + ALMACEN_COLLECTION + '/documents';

var ESTATUS_LABELS = { 0: 'Pendiente', 1: 'En proceso', 2: 'Completado' };

// Umbrales del semáforo en minutos desde que se detectó el componente
// pendiente (o el tiempo de respuesta ya congelado si se liberó).
var AGING_AMARILLO_MIN = 30;
var AGING_ROJO_MIN = 45;

var AUTO_REFRESH_MS = 60000;

// Este navegador no tiene forma de saber quién eres si domo.env()/el
// endpoint de entorno no están disponibles en este tipo de brick; se
// recuerda el nombre capturado manualmente aquí.
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

var btnRefrescar = document.getElementById('btnRefrescar');
var workOrdersTbody = document.querySelector('#workOrdersTable tbody');

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
// Tabla 1 (resumen, solo lectura): una fila por Work Order abierta, con el
// % de cumplimiento calculado sobre filasComponentes.
var filasWO = [];
// Tabla 2 (Asignar/Release): una fila por componente de BOM x Work Order,
// mezclando el dato vivo (item/cantidad/línea) con el tracking de AppDB
// (userPicking/userRelease/fechas/estatus). Ver mezclarComponentes().
var filasComponentes = [];
var almacenUsuarios = []; // lista blanca de almacén: [{id, content: {userId, nombre}}, ...]
var CURRENT_USER = { id: null, label: 'Usuario desconocido' };
var isAlmacen = false;

// Fila (identificada por key = woNumber+componentItem) donde se está
// capturando el usuario de Asignar o de Release ahora mismo.
var actionMode = null;
// Cache de la sugerencia FIFO por componente (keyed por fila.key) mientras se está Asignando.
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
            { name: 'componentItem', type: 'STRING' },
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
// obtiene el mismo id. Si prefieres dar de alta a mano en
// "almacen_usuarios_calle2" desde el explorador de AppDB de DOMO, el id a
// escribir es exactamente "local-" + el nombre en minúsculas con guiones
// en vez de espacios (ej. "Juan Pérez" -> "local-juan-pérez"); también
// matchea directo por el campo "nombre" tal cual.
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
  renderTable();
}

// ---------- Fuente de datos: Work Orders abiertas + BOM + tracking ----------
function cargarTodo() {
  setLoading(true);
  showStatus('');
  return fetchWorkOrdersAbiertas()
    .then(function (wosAbiertas) {
      return fetchBom().then(function (bomRows) {
        var pendientes = expandirComponentes(wosAbiertas, bomRows);
        return fetchTracking().then(function (trackingDocs) {
          return crearTrackingFaltante(pendientes, trackingDocs).then(function (trackingFinal) {
            var componentesFinal = mezclarComponentes(pendientes, trackingFinal);
            var woFinal = construirFilasWO(wosAbiertas, componentesFinal);
            return { wo: woFinal, componentes: componentesFinal };
          });
        });
      });
    })
    .then(function (resultado) {
      filasWO = resultado.wo;
      filasComponentes = resultado.componentes;
      renderWorkOrdersTable();
      renderTable();
      renderSemaforoTable();
    })
    .catch(function (err) {
      logFetchError('Error general en cargarTodo()', err);
      showStatus('No se pudo cargar: ' + describeError(err));
    })
    .then(function () {
      setLoading(false);
    });
}

// Trae las Work Orders (Finished Good) de los Branch/Plant de BRANCH_CODES
// (una consulta por código, mismo patrón ya usado para el inventario), y se
// queda solo con las que están "abiertas" (WO_STATUS_CODE entre
// WO_ESTATUS_ABIERTO_MIN/MAX) y con cantidad FG pendiente > 0. El rango de
// estatus se filtra en JS (Number()): WO_STATUS_CODE puede venir como
// texto (ej. "040") y el operador >=/<= del filtro de DOMO no se comportó
// confiable contra eso.
function fetchWorkOrdersAbiertas() {
  if (!workOrdersDatasetId) {
    showStatus('Selecciona el dataset de Work Orders en el brick (esquina inferior izquierda, dataset 3).');
    return Promise.resolve([]);
  }

  var fields = [FIELD_WO_NUMBER, FIELD_WO_ITEM, FIELD_WO_LINEA, FIELD_WO_BRANCH_PLANT, FIELD_WO_DATE_START, FIELD_WO_QTY_ORDERED, FIELD_WO_QTY_COMPLETED, FIELD_WO_ESTATUS];

  var queries = BRANCH_CODES.map(function (branchCode) {
    var filter = buildFieldFilter(FIELD_WO_BRANCH_PLANT, branchCode);
    var query =
      '/data/v1/' + workOrdersDatasetId +
      '?fields=' + fields.join() +
      '&filter=' + filter +
      '&limit=' + WO_LIMIT;
    console.log('Query Work Orders (Branch/Plant ' + branchCode + '):', query);
    return domo.get(query).catch(function (err) {
      logFetchError('Error en query Work Orders (Branch/Plant ' + branchCode + ')', err);
      throw err;
    });
  });

  return Promise.all(queries).then(function (results) {
    console.log('Respuesta Work Orders (por Branch/Plant):', results);
    var rows = [].concat.apply([], results.map(function (r) { return r || []; }));
    var abiertas = rows.filter(function (r) {
      var estatus = Number(r[FIELD_WO_ESTATUS]);
      var cantidad = cantidadPendiente(r);
      return (
        estatus >= WO_ESTATUS_ABIERTO_MIN && estatus <= WO_ESTATUS_ABIERTO_MAX &&
        cantidad > 0 &&
        fechaInicioHastaHoy(r)
      );
    });

    // Solo las WO_TOP_N más nuevas por WO_DATE_START, para no procesar
    // (y crear tracking de) miles de WO en cada corrida.
    abiertas.sort(function (a, b) {
      return new Date(b[FIELD_WO_DATE_START]) - new Date(a[FIELD_WO_DATE_START]);
    });
    return abiertas.slice(0, WO_TOP_N);
  });
}

// No hay un campo directo de "cantidad pendiente" en el dataset de Work
// Orders: se calcula como ordenada - completada (a nivel Finished Good).
function cantidadPendiente(wo) {
  var ordenada = Number(wo[FIELD_WO_QTY_ORDERED]) || 0;
  var completada = Number(wo[FIELD_WO_QTY_COMPLETED]) || 0;
  return ordenada - completada;
}

// Solo WO cuya fecha de inicio ya llegó (<= hoy, comparando hasta el final
// del día de hoy para no perder las que arrancan hoy mismo). Si
// WO_DATE_START no se pudo interpretar como fecha, no se descarta por
// esto (mejor mostrarla que ocultarla por un parseo raro).
function fechaInicioHastaHoy(wo) {
  var fecha = new Date(wo[FIELD_WO_DATE_START]);
  if (isNaN(fecha.getTime())) return true;
  var finDeHoy = new Date();
  finDeHoy.setHours(23, 59, 59, 999);
  return fecha <= finDeHoy;
}

// Trae el BOM completo (ya viene filtrado por branch del lado de DOMO, no
// hace falta filtrarlo aquí -- de hecho COMPONENT_ITEM_BRANCH ni existe en
// este dataset, por eso filtrar por ese campo daba 400).
function fetchBom() {
  if (!bomDatasetId) {
    showStatus('Selecciona el dataset de BOM en el brick (esquina inferior izquierda, dataset 2).');
    return Promise.resolve([]);
  }

  var fields = [FIELD_BOM_FG_ITEM, FIELD_BOM_COMPONENT_ITEM, FIELD_BOM_COMPONENT_QTY];
  var query =
    '/data/v1/' + bomDatasetId +
    '?fields=' + fields.join() +
    '&limit=' + BOM_LIMIT;
  console.log('Query BOM:', query);

  return domo
    .get(query)
    .catch(function (err) {
      logFetchError('Error en query BOM', err);
      throw err;
    })
    .then(function (rows) {
      console.log('Respuesta BOM:', rows);
      return rows || [];
    });
}

// Por cada WO abierta, junta sus componentes de BOM (por FINISHED_GOOD_ITEM_NUMBER
// = item FG de la WO) y calcula cuánto de cada componente hace falta:
// COMPONENT_QUANTITY (factor de uso por 1 FG) x cantidad FG pendiente.
function expandirComponentes(wosAbiertas, bomRows) {
  var bomPorFgItem = {};
  bomRows.forEach(function (b) {
    var fg = String(b[FIELD_BOM_FG_ITEM]);
    if (!bomPorFgItem[fg]) bomPorFgItem[fg] = [];
    bomPorFgItem[fg].push(b);
  });

  var pendientes = [];
  wosAbiertas.forEach(function (wo) {
    var woNumber = String(wo[FIELD_WO_NUMBER]);
    var fgItem = String(wo[FIELD_WO_ITEM]);
    var cantidadFG = cantidadPendiente(wo);
    var componentesBom = bomPorFgItem[fgItem] || [];

    componentesBom.forEach(function (comp) {
      var factor = Number(comp[FIELD_BOM_COMPONENT_QTY]) || 0;
      var cantidadComponente = factor * cantidadFG;
      if (cantidadComponente <= 0) return;
      pendientes.push({
        woNumber: woNumber,
        fgItem: fgItem,
        componentItem: String(comp[FIELD_BOM_COMPONENT_ITEM]),
        cantidad: cantidadComponente,
        linea: wo[FIELD_WO_LINEA],
        branchPlant: wo[FIELD_WO_BRANCH_PLANT]
      });
    });
  });
  return pendientes;
}

function fetchTracking() {
  return domo.get(TRACKING_DOCS_URL + '?limit=1000').catch(function (err) {
    logFetchError('Error leyendo tracking de AppDB', err);
    return [];
  });
}

// Clave única por componente x Work Order (una WO puede necesitar varios
// componentes, cada uno con su propio ciclo de Asignar/Release).
function trackingKey(woNumber, componentItem) {
  return woNumber + '|' + componentItem;
}

// Para cada componente pendiente sin registro de tracking todavía, crea
// uno con la fecha/hora en que esta app lo detectó pendiente por primera
// vez (equivalente al "fechaHoraInsert" manual de antes, pero automático).
// Si ya existe, se deja tal cual (preserva userPicking/userRelease/fechas
// ya capturados). Tras crear lo que faltaba, se vuelve a traer el tracking
// completo para tener los ids reales.
function crearTrackingFaltante(pendientes, trackingDocs) {
  var trackingPorKey = {};
  trackingDocs.forEach(function (doc) {
    trackingPorKey[trackingKey(doc.content.woNumber, doc.content.componentItem)] = doc;
  });

  var faltantes = pendientes.filter(function (p) {
    return !trackingPorKey[trackingKey(p.woNumber, p.componentItem)];
  });

  if (faltantes.length === 0) return Promise.resolve(trackingDocs);

  console.log('Creando tracking para ' + faltantes.length + ' componente(s) nuevo(s), en lotes de ' + TRACKING_BATCH_SIZE + '...');

  // En lotes, NO todo con un solo Promise.all: con miles de componentes
  // nuevos de golpe (primer arranque con muchas WO/BOM), disparar todas
  // las peticiones a la vez tronaba el navegador con
  // ERR_INSUFFICIENT_RESOURCES ("Network Error").
  return ejecutarEnLotes(faltantes, TRACKING_BATCH_SIZE, function (p) {
    return domo.post(TRACKING_DOCS_URL, {
      content: {
        woNumber: p.woNumber,
        componentItem: p.componentItem,
        fechaHoraPendienteDetectada: new Date().toISOString(),
        estatus: 0
      }
    });
  }).then(function () {
    return fetchTracking();
  });
}

function mezclarComponentes(pendientes, trackingDocs) {
  var trackingPorKey = {};
  trackingDocs.forEach(function (doc) {
    trackingPorKey[trackingKey(doc.content.woNumber, doc.content.componentItem)] = doc;
  });

  return pendientes.map(function (p) {
    var key = trackingKey(p.woNumber, p.componentItem);
    var trackingDoc = trackingPorKey[key];
    return {
      key: key,
      docId: trackingDoc ? trackingDoc.id : null, // null = aún no se pudo crear su tracking; refresca
      woNumber: p.woNumber,
      fgItem: p.fgItem,
      item: p.componentItem, // el componente: reutiliza "item" para no duplicar FIFO/render
      linea: p.linea,
      branchPlant: p.branchPlant,
      cantidad: p.cantidad,
      content: trackingDoc
        ? trackingDoc.content
        : { woNumber: p.woNumber, componentItem: p.componentItem, fechaHoraPendienteDetectada: new Date().toISOString(), estatus: 0 }
    };
  });
}

// Tabla 1 (resumen): una fila por WO con su % de cumplimiento, calculado
// como componentes ya Liberados / total de componentes de esa WO. Es un
// conteo, no una suma de cantidades, porque los componentes pueden venir
// en unidades distintas entre sí (sumar cantidades crudas no sería
// comparable). Ordenada por WO_DATE_START, de más antigua a más nueva.
function construirFilasWO(wosAbiertas, componentesFinal) {
  var componentesPorWo = {};
  componentesFinal.forEach(function (fc) {
    if (!componentesPorWo[fc.woNumber]) componentesPorWo[fc.woNumber] = [];
    componentesPorWo[fc.woNumber].push(fc);
  });

  return wosAbiertas
    .map(function (wo) {
      var woNumber = String(wo[FIELD_WO_NUMBER]);
      var componentes = componentesPorWo[woNumber] || [];
      var total = componentes.length;
      var completados = componentes.filter(function (fc) {
        return fc.content.estatus === 2;
      }).length;

      var estatus;
      if (total === 0) {
        estatus = 'Sin BOM';
      } else if (completados === 0) {
        estatus = 'Pendiente';
      } else if (completados === total) {
        estatus = 'Completado';
      } else {
        estatus = 'En proceso';
      }

      return {
        woNumber: woNumber,
        item: wo[FIELD_WO_ITEM],
        linea: wo[FIELD_WO_LINEA],
        cantidad: cantidadPendiente(wo),
        fechaInicio: wo[FIELD_WO_DATE_START],
        estatus: estatus,
        porcentaje: total > 0 ? Math.round((completados / total) * 100) : null
      };
    })
    .sort(function (a, b) {
      return new Date(a.fechaInicio) - new Date(b.fechaInicio);
    });
}

// ---------- Tabla 1: Work Orders (resumen, solo lectura) ----------
function renderWorkOrdersTable() {
  workOrdersTbody.innerHTML = '';

  if (filasWO.length === 0) {
    var emptyTr = document.createElement('tr');
    var emptyTd = document.createElement('td');
    emptyTd.colSpan = 7;
    emptyTd.className = 'empty-cell';
    emptyTd.textContent = 'Sin Work Orders abiertas para mostrar.';
    emptyTr.appendChild(emptyTd);
    workOrdersTbody.appendChild(emptyTr);
    return;
  }

  filasWO.forEach(function (fila) {
    var tr = document.createElement('tr');
    tr.appendChild(cell(fila.woNumber));
    tr.appendChild(cell(fila.item));
    tr.appendChild(cell(fila.linea));
    tr.appendChild(cell(formatNumber(fila.cantidad), 'numeric'));
    tr.appendChild(cell(formatDateTime(fila.fechaInicio)));
    tr.appendChild(cell(fila.estatus));
    tr.appendChild(cell(fila.porcentaje === null ? 'Sin BOM' : fila.porcentaje + '%', 'numeric'));
    workOrdersTbody.appendChild(tr);
  });
}

// ---------- Tabla 2: Componentes a surtir (Asignar / Release) ----------
function renderTable() {
  var filtro = buscarInput.value.trim().toLowerCase();
  var mostrarCompletadas = mostrarCompletadasInput.checked;
  var rows = filasComponentes.filter(function (fila) {
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
    emptyTd.colSpan = 11;
    emptyTd.className = 'empty-cell';
    emptyTd.textContent = 'Sin componentes pendientes para mostrar.';
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
  if (isAlmacen && actionMode && actionMode.key === fila.key && actionMode.type === 'picking' && !actionMode.esEdicion) {
    trs.push(buildFifoRow(fila));
  }
  return trs;
}

function buildRow(fila) {
  var c = fila.content;
  var tr = document.createElement('tr');

  tr.appendChild(cell(fila.woNumber));
  tr.appendChild(cell(fila.item));
  tr.appendChild(cell(formatNumber(fila.cantidad), 'numeric'));
  tr.appendChild(cell(fila.linea));
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

  if (actionMode && actionMode.key === fila.key && actionMode.type === 'picking') {
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
      actionMode = { key: fila.key, type: 'picking', esEdicion: true, valorInicial: c.userPicking };
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
      actionMode = { key: fila.key, type: 'picking', esEdicion: false, valorInicial: CURRENT_USER.label };
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
  var fifo = fifoCache[fila.key];
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

// ---------- Sugerencia FIFO (según la cantidad de componente requerida) ----------
function fetchFifoLines(fila) {
  fifoCache[fila.key] = { loading: true, lineas: [], cubierto: 0, faltante: fila.cantidad, error: null };
  renderTable();

  if (!datasetId) {
    fifoCache[fila.key] = {
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
      fifoCache[fila.key] = resultado;
      renderTable();
    })
    .catch(function (err) {
      fifoCache[fila.key] = {
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
  td.colSpan = 11;
  td.appendChild(renderFifoPanel(fila));
  tr.appendChild(td);
  return tr;
}

function renderFifoPanel(fila) {
  var wrapper = document.createElement('div');
  wrapper.className = 'fifo-panel';

  var estado = fifoCache[fila.key];
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
        'No se encontró inventario para el componente "' + fila.item + '" en los Branch/Plant ' + BRANCH_CODES.join('/') +
        '. Revisa la consola del navegador (se imprime la query exacta) o confirma que el item existe tal cual en el dataset.';
    } else {
      vacio.textContent = 'Hay ' + estado.rowCount + ' registro(s) de este componente, pero con cantidad disponible en 0.';
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

  if (actionMode && actionMode.key === fila.key && actionMode.type === 'release') {
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
      actionMode = { key: fila.key, type: 'release', esEdicion: true, valorInicial: c.userRelease };
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
      actionMode = { key: fila.key, type: 'release', esEdicion: false, valorInicial: CURRENT_USER.label };
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
    showStatus('Todavía se está preparando el registro de este componente. Refresca e intenta de nuevo.');
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

// ---------- SEMÁFORO (solo lectura, por componente) ----------
function renderSemaforoTable() {
  var filtro = buscarSemaforoInput.value.trim().toLowerCase();
  var mostrarCompletadas = mostrarCompletadasSemaforoInput.checked;

  var rows = filasComponentes
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
    emptyTd.colSpan = 8;
    emptyTd.className = 'empty-cell';
    emptyTd.textContent = 'Sin componentes para mostrar.';
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
// Corre fn(item) sobre items en lotes de tamanoLote (en paralelo dentro de
// cada lote, lotes en serie), en vez de lanzar todo con un solo
// Promise.all -- con miles de items eso agota los recursos del navegador.
function ejecutarEnLotes(items, tamanoLote, fn) {
  var resultados = [];
  var index = 0;

  function siguienteLote() {
    if (index >= items.length) return Promise.resolve(resultados);
    var lote = items.slice(index, index + tamanoLote);
    index += tamanoLote;
    return Promise.all(lote.map(fn)).then(function (res) {
      resultados = resultados.concat(res);
      return siguienteLote();
    });
  }

  return siguienteLote();
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
  // domo.js usa XMLHttpRequest internamente (no fetch): el detalle real
  // suele venir en responseText, no en err.message ni al hacer
  // JSON.stringify (por eso antes esto se veía como "{}").
  if (err.status || err.statusText || typeof err.responseText === 'string') {
    var detalle = err.responseText ? ' - ' + err.responseText : '';
    return 'HTTP ' + (err.status || '?') + ' ' + (err.statusText || '') + detalle;
  }
  if (err.message) return err.message;
  try {
    var json = JSON.stringify(err);
    return json === '{}' ? 'Error sin detalle (revisa la consola del navegador)' : json;
  } catch (e) {
    return String(err);
  }
}

// Loguea el error crudo. Si viene de XMLHttpRequest (como domo.js), el
// detalle real suele estar en responseText; si viniera de un fetch
// Response, se intenta leer con .text(). Cualquiera de los dos suele
// traer el motivo real del 400/404/500 de la Data API (ej. field id
// inexistente).
function logFetchError(etiqueta, err) {
  console.error(etiqueta, err);
  if (err && typeof err.responseText === 'string' && err.responseText) {
    console.error(etiqueta + ' - responseText:', err.responseText);
  }
  if (err && typeof err.text === 'function') {
    err.text()
      .then(function (body) {
        console.error(etiqueta + ' - cuerpo de la respuesta:', body);
      })
      .catch(function () {});
  }
}

function showStatus(msg) {
  statusMsg.textContent = msg || '';
}

function setLoading(isLoading) {
  loadingEl.style.display = isLoading ? 'block' : 'none';
}
