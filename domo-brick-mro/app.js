(function(){
'use strict';
var domo=window.domo;

// ================= Configuración =================
var CAT_COLLECTION='mro_catalogo';
var MOV_COLLECTION='mro_movimientos';
var SOL_COLLECTION='mro_solicitudes';
var DOCS=function(c){return '/domo/datastores/v1/collections/'+c+'/documents';};
var CAT_URL=DOCS(CAT_COLLECTION), MOV_URL=DOCS(MOV_COLLECTION), SOL_URL=DOCS(SOL_COLLECTION);
var REFRESH_MS=300000, PAGE=1000;
var TABS=['Inventario','Solicitar','Entregas','Movimientos','Catalogo','Etiquetas'];

// Datos tomados de CONTROL_MRO_1.xlsm (hojas Inventario y Movimientos).
var SEED_CATALOGO=[{"codigo": "MROBAG1", "descripcion": "BOLSA 9X12", "categoria": "PRODUCTION LINE", "proveedorNum": "843575", "proveedor": "CP PACK SA DE CV", "leadTimeDias": 10}, {"codigo": "MROBAG2", "descripcion": "BOLSA 12X16", "categoria": "PRODUCTION LINE", "proveedorNum": "843575", "proveedor": "CP PACK SA DE CV", "leadTimeDias": 10}, {"codigo": "MROCNC1", "descripcion": "NAVAJAS CNC", "categoria": "PRODUCTION LINE", "proveedorNum": "842209", "proveedor": "EASTMAN MACHINE COMPANY", "leadTimeDias": 45}, {"codigo": "MROCNC2", "descripcion": "PLUMAS CNC", "categoria": "PRODUCTION LINE", "proveedorNum": "842209", "proveedor": "EASTMAN MACHINE COMPANY", "leadTimeDias": 45}, {"codigo": "MROCNC3", "descripcion": "PLUMA CNC TRX", "categoria": "PRODUCTION LINE", "proveedorNum": "842934", "proveedor": "MID-STATES BOLT & SCREW LLC", "leadTimeDias": 45}, {"codigo": "MROCONS1", "descripcion": "Paño microfibra 40 X 40 cm amarillo FOY-MF44", "categoria": "PRODUCTION LINE", "proveedorNum": "801254", "proveedor": "REP. INDUSTRIALES DINAMICAS SA DE CV", "leadTimeDias": 5}, {"codigo": "MROCONS2", "descripcion": "Grapas 1 1/4\" S-22480", "categoria": "PRODUCTION LINE", "proveedorNum": "801254", "proveedor": "REP. INDUSTRIALES DINAMICAS SA DE CV", "leadTimeDias": 5}, {"codigo": "MROCONS3", "descripcion": "SHARPIE PLATA PUNTO FINO", "categoria": "PRODUCTION LINE", "proveedorNum": "843247", "proveedor": "GERARDO PARTIDA LANDEROS", "leadTimeDias": 5}, {"codigo": "MROCONS4", "descripcion": "PUNTA INSERTO PH2 MILWAUKEE-48-32-4601", "categoria": "PRODUCTION LINE", "proveedorNum": "801254", "proveedor": "REP. INDUSTRIALES DINAMICAS SA DE CV", "leadTimeDias": 10}, {"codigo": "MROCONS5", "descripcion": "EXTENSIONES MAGNÉTICAS MILWAUKEE-48-32-45-15", "categoria": "PRODUCTION LINE", "proveedorNum": "801254", "proveedor": "REP. INDUSTRIALES DINAMICAS SA DE CV", "leadTimeDias": 10}, {"codigo": "MROCONS6", "descripcion": "3M 94 Base para Cinta Adhesiva - 1⁄2 S-17444", "categoria": "PRODUCTION LINE", "proveedorNum": "801169", "proveedor": "EMPAQUES Y SUMINISTROS ORZA SA DE CV", "leadTimeDias": 5}, {"codigo": "MROCONS7", "descripcion": "S-20621BL Markal Punta Mediana", "categoria": "PRODUCTION LINE", "proveedorNum": "800097", "proveedor": "GRAINGER SA DE CV", "leadTimeDias": 5}, {"codigo": "MROCONS8", "descripcion": "PUNTA CLAVADORA MAK-HY00000911", "categoria": "PRODUCTION LINE", "proveedorNum": "801254", "proveedor": "REP. INDUSTRIALES DINAMICAS SA DE CV", "leadTimeDias": 10}, {"codigo": "MROCONS9", "descripcion": "ESI FELT TIP APPLICATOR 0.750\" x 0.312\"", "categoria": "PRODUCTION LINE", "proveedorNum": "843179", "proveedor": "Extruded Solutions, Inc.", "leadTimeDias": 30}, {"codigo": "MROCONS10", "descripcion": "Punta URR-4770-3/16 atornillador ingersol para atornillado de corner brace", "categoria": "PRODUCTION LINE", "proveedorNum": "801254", "proveedor": "REP. INDUSTRIALES DINAMICAS SA DE CV", "leadTimeDias": 20}, {"codigo": "MROPACK1", "descripcion": "CINTA SHURTAPE", "categoria": "PRODUCTION LINE", "proveedorNum": "801169", "proveedor": "EMPAQUES Y SUMINISTROS ORZA SA DE CV", "leadTimeDias": 5}, {"codigo": "MROPACK2", "descripcion": "RUBBER BAND NATURAL #18 80g c/u", "categoria": "PRODUCTION LINE", "proveedorNum": "801169", "proveedor": "EMPAQUES Y SUMINISTROS ORZA SA DE CV", "leadTimeDias": 5}, {"codigo": "MROPACK3", "descripcion": "Crumble paper", "categoria": "PRODUCTION LINE", "proveedorNum": "802627", "proveedor": "ECO FITPACK SAS DE CV", "leadTimeDias": 7}, {"codigo": "MROPACK4", "descripcion": "FILL PACK", "categoria": "PRODUCTION LINE", "proveedorNum": "802627", "proveedor": "ECO FITPACK SAS DE CV", "leadTimeDias": 7}, {"codigo": "MROPACK4", "descripcion": "Pelicula plastica 19x5000CA80N", "categoria": "PACKAGING", "proveedorNum": "801169", "proveedor": "EMPAQUES Y SUMINISTROS ORZA SA DE CV", "leadTimeDias": 5}, {"codigo": "MROPACK5", "descripcion": "FLEJE BLANCO 12mm", "categoria": "SHIPPING", "proveedorNum": "843300", "proveedor": "TABEL PALLET", "leadTimeDias": 10}, {"codigo": "40000005", "descripcion": "Wooden Pallet 80\"X 45\"", "categoria": "SHIPPING", "proveedorNum": "843300", "proveedor": "TABEL PALLET", "leadTimeDias": 5}, {"codigo": "40000004", "descripcion": "Pallet - 76\" X 48\" (Gm – Brown)", "categoria": "SHIPPING", "proveedorNum": "843300", "proveedor": "TABEL PALLET", "leadTimeDias": 5}, {"codigo": "40000006", "descripcion": "Pallet 86\" X 48\" (Stellantis – Green)", "categoria": "SHIPPING", "proveedorNum": "843300", "proveedor": "TABEL PALLET", "leadTimeDias": 5}, {"codigo": "40000007", "descripcion": "Pallet 73.5\" X 40\" (Ford – Purple)", "categoria": "SHIPPING", "proveedorNum": "843300", "proveedor": "TABEL PALLET", "leadTimeDias": 5}, {"codigo": "40000008", "descripcion": "Pallet 90\" X 48\" (Toyota – Nissan – Silver)", "categoria": "SHIPPING", "proveedorNum": "843300", "proveedor": "TABEL PALLET", "leadTimeDias": 5}, {"codigo": "1704652", "descripcion": "Tarima 42X101", "categoria": "SHIPPING", "proveedorNum": "843300", "proveedor": "TABEL PALLET", "leadTimeDias": 5}, {"codigo": "1704857", "descripcion": "Tarima 42X84", "categoria": "SHIPPING", "proveedorNum": "843300", "proveedor": "TABEL PALLET", "leadTimeDias": 5}, {"codigo": "401S0002", "descripcion": "Tarima De Madera De 74\" X 32\"", "categoria": "SHIPPING", "proveedorNum": "843300", "proveedor": "TABEL PALLET", "leadTimeDias": 5}, {"codigo": "401S0003", "descripcion": "Tarima De Madera De 83\" X 48\"", "categoria": "SHIPPING", "proveedorNum": "843300", "proveedor": "TABEL PALLET", "leadTimeDias": 5}, {"codigo": "MROPRIN1", "descripcion": "LABEL Polyester Matte Plata 4x.75 in", "categoria": "PRODUCTION LINE", "proveedorNum": "802419", "proveedor": "RS FLEXOGRAFICA S DE RL DE CV", "leadTimeDias": 20}, {"codigo": "MROPRIN2", "descripcion": "RIBBON 4 x 6 D*0433*1182*W", "categoria": "PRODUCTION LINE", "proveedorNum": "802419", "proveedor": "RS FLEXOGRAFICA S DE RL DE CV", "leadTimeDias": 10}, {"codigo": "MROPRIN3", "descripcion": "RIBBON 4 x .75 #05095GS11007", "categoria": "PRODUCTION LINE", "proveedorNum": "802419", "proveedor": "RS FLEXOGRAFICA S DE RL DE CV", "leadTimeDias": 10}, {"codigo": "MROSEWI1", "descripcion": "T-135 blk. polyester style M p", "categoria": "PRODUCTION LINE", "proveedorNum": "843249", "proveedor": "AMERICAN & EFIRD LLC", "leadTimeDias": 80}, {"codigo": "MROSEWI2", "descripcion": "T-135 polyester thread 2 lb sp", "categoria": "PRODUCTION LINE", "proveedorNum": "843249", "proveedor": "AMERICAN & EFIRD LLC", "leadTimeDias": 80}, {"codigo": "MROSEWI3", "descripcion": "BOBINAS COATS (CAJA)", "categoria": "PRODUCTION LINE", "proveedorNum": "843361", "proveedor": "COATS MEXICO", "leadTimeDias": 40}, {"codigo": "MROSEWI4", "descripcion": "CARRETES COATS", "categoria": "PRODUCTION LINE", "proveedorNum": "843361", "proveedor": "COATS MEXICO", "leadTimeDias": 40}, {"codigo": "MROSEWI5", "descripcion": "140/22 R SCHMETZ NEEDLES", "categoria": "PRODUCTION LINE", "proveedorNum": "843275", "proveedor": "MAQUINAS Y REFACCIONES MONTENEGRO", "leadTimeDias": 30}, {"codigo": "MROSEWI6", "descripcion": "160/23 SCHMETZ NEEDLES", "categoria": "PRODUCTION LINE", "proveedorNum": "843275", "proveedor": "MAQUINAS Y REFACCIONES MONTENEGRO", "leadTimeDias": 30}, {"codigo": "MROSEWI7", "descripcion": "180/24 SCHMETZ NEEDLES", "categoria": "PRODUCTION LINE", "proveedorNum": "843275", "proveedor": "MAQUINAS Y REFACCIONES MONTENEGRO", "leadTimeDias": 30}, {"codigo": "MROSEWI8", "descripcion": "SPRAY_DRY SILICONE LUBRICANT", "categoria": "PRODUCTION LINE", "proveedorNum": "843275", "proveedor": "MAQUINAS Y REFACCIONES MONTENEGRO", "leadTimeDias": 10}, {"codigo": "MROSHIP1", "descripcion": "Sellos alta seguridad amarillos H-435Y", "categoria": "SHIPPING", "proveedorNum": "843575", "proveedor": "CP PACK SA DE CV", "leadTimeDias": 20}, {"codigo": "MROSHIP2", "descripcion": "Bolsas industriales 48 x 84 S-14354S", "categoria": "SHIPPING", "proveedorNum": "843575", "proveedor": "CP PACK SA DE CV", "leadTimeDias": 30}, {"codigo": "MROSTRE1", "descripcion": "Clear Cast Stretch Banding Fil", "categoria": "SHIPPING", "proveedorNum": "801169", "proveedor": "EMPAQUES Y SUMINISTROS ORZA SA DE CV", "leadTimeDias": 5}, {"codigo": "MROTOOL1", "descripcion": "TIJERAS ALUMINIO 8 SUR-T10", "categoria": "PRODUCTION LINE", "proveedorNum": "801254", "proveedor": "REP. INDUSTRIALES DINAMICAS SA DE CV", "leadTimeDias": 10}, {"codigo": "MROTOOL2", "descripcion": "PINZA BUCKLES URR-PRES2", "categoria": "PRODUCTION LINE", "proveedorNum": "801254", "proveedor": "REP. INDUSTRIALES DINAMICAS SA DE CV", "leadTimeDias": 10}, {"codigo": "MROTOOL3", "descripcion": "TIJERAS KNIPEX-6701200SB-02", "categoria": "PRODUCTION LINE", "proveedorNum": "801254", "proveedor": "REP. INDUSTRIALES DINAMICAS SA DE CV", "leadTimeDias": 10}, {"codigo": "MROTOOL4", "descripcion": "TIJERAS KNIPEX-9455200-00", "categoria": "PRODUCTION LINE", "proveedorNum": "801254", "proveedor": "REP. INDUSTRIALES DINAMICAS SA DE CV", "leadTimeDias": 30}, {"codigo": "MROTOOL5", "descripcion": "MAZO GOMA 8 OZ URR-1366", "categoria": "PRODUCTION LINE", "proveedorNum": "801254", "proveedor": "REP. INDUSTRIALES DINAMICAS SA DE CV", "leadTimeDias": 5}, {"codigo": "MROTOOL6", "descripcion": "H-464O Despachador cinta - 2\", Naranja, 48 mm", "categoria": "PRODUCTION LINE", "proveedorNum": "801254", "proveedor": "REP. INDUSTRIALES DINAMICAS SA DE CV", "leadTimeDias": 5}, {"codigo": "MROTOOL7", "descripcion": "TIJERAS DESHEBRAR", "categoria": "PRODUCTION LINE", "proveedorNum": "843275", "proveedor": "MAQUINAS Y REFACCIONES MONTENEGRO", "leadTimeDias": 20}, {"codigo": "MROTOOL8", "descripcion": "WISS Scissors Stainless Steel", "categoria": "PRODUCTION LINE", "proveedorNum": "843275", "proveedor": "MAQUINAS Y REFACCIONES MONTENEGRO", "leadTimeDias": 20}, {"codigo": "MROTOOL9", "descripcion": "TIJERAS COSTURA KAI 10\" ZURDO", "categoria": "PRODUCTION LINE", "proveedorNum": "843275", "proveedor": "MAQUINAS Y REFACCIONES MONTENEGRO", "leadTimeDias": 20}, {"codigo": "MROTOOL10", "descripcion": "TIJERAS DE ELECTRICISTA", "categoria": "PRODUCTION LINE", "proveedorNum": "801254", "proveedor": "REP. INDUSTRIALES DINAMICAS SA DE CV", "leadTimeDias": 20}];
var SEED_MOVIMIENTOS=[{"fecha": "2026-10-19", "codigo": "MROBAG1", "tipo": "Entrada", "cantidad": 2000, "notas": "OC 331521"}, {"fecha": "2026-10-19", "codigo": "MROBAG2", "tipo": "Entrada", "cantidad": 4000, "notas": "OC 323423"}, {"fecha": "2026-10-19", "codigo": "MROCONS2", "tipo": "Entrada", "cantidad": 2000, "notas": ""}];

// ================= Estado =================
var catalogo=[], movimientos=[], solicitudes=[];
var info={};          // codigo -> {stock, comprometido, disponible, ultimoMov, estado}
var carrito=[];       // [{codigo, cantidad}]
var selEtq={};        // codigo -> copias
var editandoCat=null; // documento del catálogo en edición
var CURRENT_USER={id:null,label:'Usuario desconocido'};
var $=function(id){return document.getElementById(id);};
var statusMsg=$('statusMsg'),loading=$('loading');

// ================= Inicio =================
function init(){
  TABS.forEach(function(t){
    $('tabBtn'+t).onclick=function(){switchTab(t);};
    $('btnRefrescar'+t)&&($('btnRefrescar'+t).onclick=cargarDatos);
  });
  // Inventario
  ['buscarInv','filtroCategoriaInv','filtroEstadoInv'].forEach(function(id){$(id).addEventListener('input',renderInventario);});
  $('btnExportarInv').onclick=exportarInventario;
  $('alertaMinimo').onclick=function(){$('filtroEstadoInv').value='reorden';switchTab('Inventario');renderInventario();};
  // Solicitar
  $('solMaterialInput').addEventListener('input',renderSolStockInfo);
  $('btnAgregarLinea').onclick=agregarLinea;
  $('btnEnviarSolicitud').onclick=enviarSolicitud;
  ['buscarSol','filtroEstatusSol','soloMiasSol'].forEach(function(id){$(id).addEventListener('input',renderSolicitudes);});
  $('soloMiasSol').addEventListener('change',renderSolicitudes);
  // Entregas
  $('buscarEnt').addEventListener('input',renderEntregas);
  // Movimientos
  $('movTipoInput').addEventListener('change',renderMovForm);
  $('movMaterialInput').addEventListener('input',renderMovStockInfo);
  $('movCantidadInput').addEventListener('input',renderMovStockInfo);
  $('btnRegistrarMov').onclick=registrarMovimiento;
  ['movDesde','movHasta','movFiltroTipo','movBuscar'].forEach(function(id){$(id).addEventListener('input',renderMovimientos);});
  $('btnExportarMov').onclick=exportarMovimientos;
  // Catálogo
  $('catAplicaMinMax').addEventListener('change',function(){$('catMinimo').disabled=$('catMaximo').disabled=!this.checked;});
  // Proveedor # y Proveedor se autocompletan entre sí con los ya dados de alta.
  $('catProveedorNum').addEventListener('input',function(){var n=proveedorPorNum(this.value);if(n)$('catProveedor').value=n;});
  $('catProveedor').addEventListener('input',function(){var n=numPorProveedor(this.value);if(n&&!$('catProveedorNum').value.trim())$('catProveedorNum').value=n;});
  $('btnGuardarCat').onclick=guardarCatalogo;
  $('btnLimpiarCat').onclick=limpiarCatForm;
  ['buscarCat','filtroCategoriaCat'].forEach(function(id){$(id).addEventListener('input',renderCatalogo);});
  $('mostrarInactivosCat').addEventListener('change',renderCatalogo);
  $('btnSeed').onclick=importarSeed;
  $('btnTogglePegar').onclick=function(){var b=$('pegarBox');b.style.display=b.style.display==='none'?'':'none';};
  $('btnImportarPegado').onclick=importarPegado;
  // Etiquetas
  ['buscarEtq','filtroCategoriaEtq'].forEach(function(id){$(id).addEventListener('input',renderEtiquetas);});
  $('btnSelVisibles').onclick=function(){etqVisibles().forEach(function(m){if(!selEtq[m.codigo])selEtq[m.codigo]=1;});renderEtiquetas();};
  $('btnLimpiarSel').onclick=function(){selEtq={};renderEtiquetas();};
  $('btnGenerarZpl').onclick=function(){generarZpl();};
  $('btnCopiarZpl').onclick=copiarZpl;
  $('btnDescargarZpl').onclick=function(){var z=zplActual();if(z)descargar('etiquetas_mro.zpl',z,'text/plain');};
  $('btnImprimirZebra').onclick=imprimirZebra;
  $('btnPreviewZpl').onclick=previewZpl;
  // Modal
  $('motivoCerrar').onclick=cerrarModal;

  renderMovForm();
  ensureCollections()
    .then(cargarUsuarioActual)
    .then(cargarDatos)
    .catch(function(e){showError('Error al inicializar: '+errText(e));});
  setInterval(cargarDatos,REFRESH_MS);
}
function switchTab(tab){
  TABS.forEach(function(t){
    $('tab'+t).style.display=t===tab?'':'none';
    $('tabBtn'+t).classList.toggle('active',t===tab);
  });
}

// ================= Usuario activo de DOMO =================
function cargarUsuarioActual(){
  var domoUserId=domo.env&&domo.env.userId;
  if(!domoUserId){
    renderUsuario();
    showError('No se encontró domo.env.userId. Verifica que el brick tenga disponible el contexto de usuario de DOMO.');
    return Promise.resolve();
  }
  return domo.get('/domo/users/v1/'+encodeURIComponent(domoUserId)+'?includeDetails=true')
    .then(function(user){
      CURRENT_USER={id:String(user.id||domoUserId),label:user.displayName||user.name||'Usuario sin nombre'};
      renderUsuario();
    })
    .catch(function(e){
      CURRENT_USER={id:null,label:'Usuario desconocido'};
      renderUsuario();
      showError('No se pudo obtener el usuario de DOMO: '+errText(e));
    });
}
function renderUsuario(){
  $('userLabel').textContent=CURRENT_USER.id?CURRENT_USER.label+' (id: '+CURRENT_USER.id+')':CURRENT_USER.label;
  $('solicitanteInput').value=CURRENT_USER.id?CURRENT_USER.label:'';
}
function requireUser(){
  if(CURRENT_USER.id)return true;
  showError('No se pudo identificar tu usuario de DOMO. Recarga la página antes de continuar.');
  return false;
}

// ================= Colecciones AppDB =================
function ensureOneCollection(name,columns){
  var body={name:name,schema:{columns:columns}};
  return domo.post('/domo/datastores/v1/collections',body)
    .catch(function(){return domo.put('/domo/datastores/v1/collections/'+name,body);})
    .catch(function(){return null;});
}
function cols(spec){return spec.split(',').map(function(p){var x=p.split(':');return {name:x[0].trim(),type:x[1]||'STRING'};});}
function ensureCollections(){
  return Promise.all([
    ensureOneCollection(CAT_COLLECTION,cols('codigo,descripcion,categoria,proveedorNum,proveedor,leadTimeDias:LONG,unidad,ubicacion,aplicaMinMax,minimo:DOUBLE,maximo:DOUBLE,stockInicial:DOUBLE,activo,fechaAlta,usuarioAlta,usuarioAltaId,fechaModificacion,usuarioModificacion,usuarioModificacionId')),
    ensureOneCollection(MOV_COLLECTION,cols('fechaHora,tipo,codigo,descripcion,cantidad:DOUBLE,efecto:DOUBLE,stockAnterior:DOUBLE,stockResultante:DOUBLE,referencia,persona,notas,folioSolicitud:LONG,usuario,usuarioId')),
    ensureOneCollection(SOL_COLLECTION,cols('folio:LONG,linea:LONG,fechaSolicitud,solicitante,solicitanteId,area,comentario,codigo,descripcion,unidad,cantidadSolicitada:DOUBLE,estatus,cantidadEntregada:DOUBLE,entregadoPor,entregadoPorId,recibe,fechaEntrega,motivo,fechaCierre,usuarioCierre,usuarioCierreId'))
  ]);
}
// Lee todos los documentos de una colección en páginas.
function getAll(url){
  var out=[];
  function page(offset){
    return domo.get(url+'?limit='+PAGE+'&offset='+offset).then(function(r){
      r=r||[];out=out.concat(r);
      return r.length===PAGE?page(offset+PAGE):out;
    });
  }
  return page(0);
}
// Recarga todo y recalcula; rechaza si falla (se usa antes de validar stock).
function recargar(){
  setBusy(true);
  return Promise.all([getAll(CAT_URL),getAll(MOV_URL),getAll(SOL_URL)])
    .then(function(r){
      catalogo=r[0];movimientos=r[1];solicitudes=r[2];
      calcularInventario();
      renderAll();
    })
    .then(function(){setBusy(false);},function(e){setBusy(false);throw e;});
}
function cargarDatos(){
  return recargar().catch(function(e){showError('No se pudieron cargar los datos: '+errText(e));});
}

// ================= Cálculo de inventario =================
function num(v){var n=Number(v);return isFinite(n)?n:0;}
function tieneValor(v){return v!==null&&v!==undefined&&v!==''&&isFinite(Number(v));}
function aplicaMinMax(m){return m.aplicaMinMax==='SI';}
function calcularInventario(){
  info={};
  catalogo.forEach(function(d){var m=d.content;info[key(m.codigo)]={stock:num(m.stockInicial),comprometido:0,ultimoMov:''};});
  movimientos.forEach(function(d){
    var c=d.content,i=info[key(c.codigo)];if(!i)return;
    i.stock+=num(c.efecto);
    if(!i.ultimoMov||c.fechaHora>i.ultimoMov)i.ultimoMov=c.fechaHora;
  });
  solicitudes.forEach(function(d){
    var c=d.content,i=info[key(c.codigo)];
    if(i&&c.estatus==='Pendiente')i.comprometido+=num(c.cantidadSolicitada);
  });
  catalogo.forEach(function(d){
    var m=d.content,i=info[key(m.codigo)];
    i.disponible=i.stock-i.comprometido;
    i.estado=estadoDe(m,i.stock);
    i.sugerido=(i.estado==='sin'||i.estado==='min')&&aplicaMinMax(m)&&tieneValor(m.maximo)?Math.max(0,num(m.maximo)-i.stock):'';
  });
}
// sin = sin stock, min = llegó al mínimo, max = sobre máximo, ok, na = sin control de mín/máx
function estadoDe(m,stock){
  if(stock<=0)return 'sin';
  if(!aplicaMinMax(m))return 'na';
  if(tieneValor(m.minimo)&&stock<=num(m.minimo))return 'min';
  if(tieneValor(m.maximo)&&stock>num(m.maximo))return 'max';
  return 'ok';
}
var ESTADO_TXT={sin:'Sin stock',min:'En mínimo',ok:'OK',max:'Sobre máximo',na:'Sin mín/máx'};
function key(codigo){return String(codigo||'').trim().toUpperCase();}
function activos(){return catalogo.filter(function(d){return d.content.activo!=='NO';});}
function matDoc(codigo){var k=key(codigo);for(var i=0;i<catalogo.length;i++)if(key(catalogo[i].content.codigo)===k)return catalogo[i];return null;}
function infoDe(codigo){return info[key(codigo)]||{stock:0,comprometido:0,disponible:0};}
// Acepta "CODIGO — descripción" (opción de la lista) o solo el código.
function materialDesdeInput(value){
  var v=String(value||'').trim();if(!v)return null;
  var code=v.split(' — ')[0];
  var d=matDoc(code);
  return d&&d.content.activo!=='NO'?d:null;
}

// ================= Render general =================
function renderAll(){
  renderListas();
  renderInventario();
  renderSolStockInfo();
  renderCarrito();
  renderSolicitudes();
  renderEntregas();
  renderMovStockInfo();
  renderMovimientos();
  renderCatalogo();
  renderEtiquetas();
  $('btnSeed').style.display=catalogo.length?'none':'';
}
function renderListas(){
  var dl=$('materialesList');dl.innerHTML='';
  activos().sort(byCodigo).forEach(function(d){var o=document.createElement('option');o.value=d.content.codigo+' — '+d.content.descripcion;dl.appendChild(o);});
  var cats={};catalogo.forEach(function(d){if(d.content.categoria)cats[d.content.categoria]=true;});
  var lista=Object.keys(cats).sort();
  // Proveedores únicos (número -> nombre)
  var provs=proveedores(),dn=$('proveedoresNumList'),dp=$('proveedoresList');dn.innerHTML='';dp.innerHTML='';
  Object.keys(provs).sort().forEach(function(n){var o=document.createElement('option');o.value=n;o.label=provs[n];o.textContent=provs[n];dn.appendChild(o);});
  var nombres={};Object.keys(provs).forEach(function(n){nombres[provs[n]]=true;});
  catalogo.forEach(function(d){if(d.content.proveedor)nombres[d.content.proveedor]=true;});
  Object.keys(nombres).sort().forEach(function(n){var o=document.createElement('option');o.value=n;dp.appendChild(o);});
  var dc=$('categoriasList');dc.innerHTML='';
  lista.forEach(function(c){var o=document.createElement('option');o.value=c;dc.appendChild(o);});
  Array.prototype.forEach.call(document.querySelectorAll('select.cat-filter'),function(sel){
    var cur=sel.value;sel.innerHTML='<option value="">Todas</option>';
    lista.forEach(function(c){var o=document.createElement('option');o.value=c;o.textContent=c;sel.appendChild(o);});
    sel.value=cur;
  });
  // Indicadores globales
  var reorden=activos().filter(function(d){var e=infoDe(d.content.codigo).estado;return e==='sin'||e==='min';}).length;
  var minimo=activos().filter(function(d){return infoDe(d.content.codigo).estado==='min';}).length;
  var banner=$('alertaMinimo');
  if(minimo){banner.style.display='';banner.textContent='⚠ '+minimo+' material(es) llegaron al mínimo y requieren reorden. Clic para verlos.';}
  else banner.style.display='none';
  var pend=solicitudes.filter(function(d){return d.content.estatus==='Pendiente';}).length;
  $('badgeEntregas').style.display=pend?'':'none';$('badgeEntregas').textContent=pend;
  void reorden;
}

// ================= Inventario =================
function invFiltrado(){
  var q=$('buscarInv').value.toLowerCase(),cat=$('filtroCategoriaInv').value,est=$('filtroEstadoInv').value;
  return activos().filter(function(d){
    var m=d.content,e=infoDe(m.codigo).estado;
    if(cat&&m.categoria!==cat)return false;
    if(est==='reorden'?(e!=='sin'&&e!=='min'):(est&&e!==est))return false;
    if(q&&[m.codigo,m.descripcion,m.proveedor,m.proveedorNum,m.ubicacion].join(' ').toLowerCase().indexOf(q)<0)return false;
    return true;
  }).sort(function(a,b){return ordenEstado(a)-ordenEstado(b)||byCodigo(a,b);});
}
var ORDEN_ESTADO={sin:0,min:1,max:2,ok:3,na:4};
function ordenEstado(d){return ORDEN_ESTADO[infoDe(d.content.codigo).estado];}
function renderInventario(){
  var act=activos(),cuenta={sin:0,min:0,max:0};
  act.forEach(function(d){var e=infoDe(d.content.codigo).estado;if(cuenta[e]!==undefined)cuenta[e]++;});
  $('kpiActivos').textContent=act.length;$('kpiSinStock').textContent=cuenta.sin;$('kpiMinimo').textContent=cuenta.min;$('kpiSobreMax').textContent=cuenta.max;
  $('kpiPendientes').textContent=foliosUnicos(solicitudes.filter(function(d){return d.content.estatus==='Pendiente';})).length;
  var body=$('inventarioTbody');body.innerHTML='';
  var rows=invFiltrado();
  if(!rows.length){empty(body,15,catalogo.length?'No hay materiales para los filtros seleccionados.':'El catálogo está vacío. Ve a Catálogo para importar el Excel o dar de alta materiales.');return;}
  rows.forEach(function(d){
    var m=d.content,i=infoDe(m.codigo),tr=document.createElement('tr');
    addPill(tr,ESTADO_TXT[i.estado],'st-'+i.estado);
    add(tr,m.codigo);add(tr,m.descripcion);add(tr,m.categoria);add(tr,m.proveedor);add(tr,m.ubicacion);add(tr,m.unidad);
    addNum(tr,i.stock);addNum(tr,i.comprometido||'');addNum(tr,i.disponible);
    addNum(tr,aplicaMinMax(m)&&tieneValor(m.minimo)?num(m.minimo):'');
    addNum(tr,aplicaMinMax(m)&&tieneValor(m.maximo)?num(m.maximo):'');
    addNum(tr,i.sugerido);
    addNum(tr,m.leadTimeDias);
    add(tr,fmtDateTime(i.ultimoMov));
    body.appendChild(tr);
  });
}
function exportarInventario(){
  var rows=[['Estado','Código','Descripción','Categoría','Proveedor #','Proveedor','Ubicación','Unidad','Stock','Comprometido','Disponible','Mínimo','Máximo','Sugerido a pedir','Lead time','Último movimiento']];
  invFiltrado().forEach(function(d){var m=d.content,i=infoDe(m.codigo);
    rows.push([ESTADO_TXT[i.estado],m.codigo,m.descripcion,m.categoria,m.proveedorNum,m.proveedor,m.ubicacion,m.unidad,i.stock,i.comprometido,i.disponible,aplicaMinMax(m)?m.minimo:'',aplicaMinMax(m)?m.maximo:'',i.sugerido,m.leadTimeDias,fmtDateTime(i.ultimoMov)]);});
  descargar('inventario_mro.csv',toCsv(rows),'text/csv');
}

// ================= Solicitar =================
function textoStock(d){
  if(!d)return '';
  var m=d.content,i=infoDe(m.codigo);
  return '<b>'+esc(m.codigo)+'</b> — '+esc(m.descripcion)+' · Stock: <b>'+i.stock+'</b> · Comprometido: <b>'+i.comprometido+'</b> · Disponible: <b>'+i.disponible+'</b> '+(m.unidad?esc(m.unidad)+' ':'')+'<span class="pill st-'+i.estado+'">'+ESTADO_TXT[i.estado]+'</span>';
}
function renderSolStockInfo(){
  var v=$('solMaterialInput').value.trim(),d=materialDesdeInput(v);
  $('solStockInfo').innerHTML=d?textoStock(d):(v?'Material no encontrado o inactivo.':'');
}
function enCarrito(codigo){return carrito.filter(function(x){return key(x.codigo)===key(codigo);}).reduce(function(a,x){return a+x.cantidad;},0);}
function agregarLinea(){
  var d=materialDesdeInput($('solMaterialInput').value),cant=Number($('solCantidadInput').value);
  if(!d){showError('Selecciona un material válido de la lista.');return;}
  if(!(cant>0)){showError('Captura una cantidad mayor a 0.');return;}
  var disp=infoDe(d.content.codigo).disponible,total=enCarrito(d.content.codigo)+cant;
  if(total>disp){showError('No hay inventario suficiente de '+d.content.codigo+': disponible '+disp+', solicitas '+total+'.');return;}
  var ex=carrito.filter(function(x){return key(x.codigo)===key(d.content.codigo);})[0];
  if(ex)ex.cantidad+=cant;else carrito.push({codigo:d.content.codigo,cantidad:cant});
  $('solMaterialInput').value='';$('solCantidadInput').value='';
  clearStatus();renderSolStockInfo();renderCarrito();
}
function renderCarrito(){
  var body=$('carritoTbody');body.innerHTML='';
  if(!carrito.length){empty(body,7,'Agrega uno o más materiales a la solicitud.');return;}
  carrito.forEach(function(x,idx){
    var d=matDoc(x.codigo),m=d?d.content:{},i=infoDe(x.codigo),tr=document.createElement('tr');
    add(tr,x.codigo);add(tr,m.descripcion);add(tr,m.unidad);addNum(tr,x.cantidad);addNum(tr,i.stock);addNum(tr,i.disponible);
    var td=document.createElement('td');td.appendChild(btn('Quitar','btn-borde-rojo small',function(){carrito.splice(idx,1);renderCarrito();}));tr.appendChild(td);
    body.appendChild(tr);
  });
}
function enviarSolicitud(){
  if(!requireUser())return;
  if(!carrito.length){showError('Agrega al menos un material.');return;}
  var area=$('areaInput').value.trim();
  if(!area){showError('Captura el área / línea que solicita.');return;}
  setBusy(true);clearStatus();
  // Se recarga para validar contra el inventario más reciente.
  recargar().then(function(){
    var faltantes=carrito.filter(function(x){return x.cantidad>infoDe(x.codigo).disponible;});
    if(faltantes.length){
      throw new Error('Inventario insuficiente: '+faltantes.map(function(x){return x.codigo+' (disponible '+infoDe(x.codigo).disponible+')';}).join(', '));
    }
    var folio=nextFolio(),ahora=new Date().toISOString(),comentario=$('solComentarioInput').value.trim(),chain=Promise.resolve();
    carrito.forEach(function(x,idx){
      var m=matDoc(x.codigo).content;
      chain=chain.then(function(){return domo.post(SOL_URL,{content:{
        folio:folio,linea:idx+1,fechaSolicitud:ahora,
        solicitante:CURRENT_USER.label,solicitanteId:CURRENT_USER.id,area:area,comentario:comentario,
        codigo:m.codigo,descripcion:m.descripcion,unidad:m.unidad||'',cantidadSolicitada:x.cantidad,
        estatus:'Pendiente',cantidadEntregada:0,entregadoPor:'',entregadoPorId:'',recibe:'',fechaEntrega:'',
        motivo:'',fechaCierre:'',usuarioCierre:'',usuarioCierreId:''}});});
    });
    return chain.then(function(){return folio;});
  }).then(function(folio){
    var n=carrito.length;carrito=[];$('solComentarioInput').value='';
    showOk('Solicitud '+fmtFolio(folio)+' enviada con '+n+' material(es).');
    return cargarDatos();
  }).catch(function(e){showError('No se pudo enviar la solicitud: '+errText(e));})
    .then(function(){setBusy(false);});
}
function nextFolio(){var max=0;solicitudes.forEach(function(d){var n=num(d.content.folio);if(n>max)max=n;});return max+1;}
function renderSolicitudes(){
  var q=$('buscarSol').value.toLowerCase(),est=$('filtroEstatusSol').value,mias=$('soloMiasSol').checked,body=$('solicitudesTbody');
  body.innerHTML='';
  var rows=solicitudes.filter(function(d){
    var c=d.content;
    if(mias&&c.solicitanteId!==CURRENT_USER.id)return false;
    if(est&&c.estatus!==est)return false;
    if(q&&[fmtFolio(c.folio),c.codigo,c.descripcion,c.solicitante,c.area].join(' ').toLowerCase().indexOf(q)<0)return false;
    return true;
  }).sort(function(a,b){return num(b.content.folio)-num(a.content.folio)||num(a.content.linea)-num(b.content.linea);});
  if(!rows.length){empty(body,14,'No hay solicitudes para los filtros seleccionados.');return;}
  rows.forEach(function(d){
    var c=d.content,tr=document.createElement('tr');
    add(tr,fmtFolio(c.folio));add(tr,fmtDateTime(c.fechaSolicitud));add(tr,c.solicitante);add(tr,c.area);add(tr,c.codigo);add(tr,c.descripcion);
    addNum(tr,c.cantidadSolicitada);addNum(tr,c.estatus==='Pendiente'?'':c.cantidadEntregada);
    addPill(tr,c.estatus,'est-'+String(c.estatus).replace(/ /g,'-'));
    add(tr,c.entregadoPor);add(tr,c.recibe);add(tr,fmtDateTime(c.fechaEntrega||c.fechaCierre));
    addWrap(tr,[c.comentario,c.motivo?(c.estatus+': '+c.motivo+(c.usuarioCierre?' ('+c.usuarioCierre+')':'')):''].filter(Boolean).join('\n'));
    var td=document.createElement('td');
    if(c.estatus==='Pendiente'&&c.solicitanteId===CURRENT_USER.id)
      td.appendChild(btn('Cancelar','btn-borde-rojo small',function(){cerrarSolicitud(d,'Cancelada');}));
    tr.appendChild(td);body.appendChild(tr);
  });
}

// ================= Entregas =================
function renderEntregas(){
  var q=$('buscarEnt').value.toLowerCase(),body=$('entregasTbody');body.innerHTML='';
  var rows=solicitudes.filter(function(d){
    var c=d.content;
    return c.estatus==='Pendiente'&&(!q||[fmtFolio(c.folio),c.codigo,c.descripcion,c.solicitante,c.area].join(' ').toLowerCase().indexOf(q)>=0);
  }).sort(function(a,b){return num(a.content.folio)-num(b.content.folio)||num(a.content.linea)-num(b.content.linea);});
  if(!rows.length){empty(body,11,'No hay solicitudes pendientes de entregar.');return;}
  rows.forEach(function(d){
    var c=d.content,i=infoDe(c.codigo),tr=document.createElement('tr');
    add(tr,fmtFolio(c.folio));add(tr,fmtDateTime(c.fechaSolicitud));add(tr,c.solicitante);add(tr,c.area);add(tr,c.codigo);add(tr,c.descripcion);
    addNum(tr,c.cantidadSolicitada);addNum(tr,i.stock);
    var tdC=document.createElement('td'),cant=document.createElement('input');
    cant.type='number';cant.min='0';cant.step='1';cant.value=Math.max(0,Math.min(num(c.cantidadSolicitada),i.stock));
    tdC.appendChild(cant);tr.appendChild(tdC);
    var tdR=document.createElement('td'),rec=document.createElement('input');
    rec.type='text';rec.className='wide';rec.value='';rec.placeholder='Nombre de quien recibe';
    tdR.appendChild(rec);tr.appendChild(tdR);
    var td=document.createElement('td');
    td.appendChild(btn('Entregar','btn-verde small',function(){entregar(d,Number(cant.value),rec.value.trim());}));
    td.appendChild(btn('Rechazar','btn-borde-rojo small',function(){cerrarSolicitud(d,'Rechazada');}));
    tr.appendChild(td);body.appendChild(tr);
  });
}
function entregar(d,cantidad,recibe){
  if(!requireUser())return;
  var c=d.content;
  if(!(cantidad>0)){showError('Captura la cantidad a entregar.');return;}
  if(cantidad>num(c.cantidadSolicitada)){showError('No puedes entregar más de lo solicitado ('+c.cantidadSolicitada+').');return;}
  if(!recibe){showError('Captura quién recibe el material.');return;}
  setBusy(true);clearStatus();
  recargar().then(function(){
    var actual=solicitudes.filter(function(x){return x.id===d.id;})[0];
    if(!actual||actual.content.estatus!=='Pendiente')throw new Error('La solicitud ya fue atendida por otro usuario.');
    var stock=infoDe(c.codigo).stock;
    if(cantidad>stock)throw new Error('Stock insuficiente de '+c.codigo+': hay '+stock+'.');
    var ahora=new Date().toISOString();
    return domo.post(MOV_URL,{content:movimientoDoc('Salida',c.codigo,c.descripcion,cantidad,-cantidad,stock,
      'Solicitud '+fmtFolio(c.folio),recibe,c.area?('Área: '+c.area):'',num(c.folio),ahora)})
      .then(function(){
        return domo.put(SOL_URL+'/'+d.id,{content:Object.assign({},actual.content,{
          estatus:cantidad<num(c.cantidadSolicitada)?'Entregada parcial':'Entregada',
          cantidadEntregada:cantidad,entregadoPor:CURRENT_USER.label,entregadoPorId:CURRENT_USER.id,
          recibe:recibe,fechaEntrega:ahora})});
      });
  }).then(function(){showOk('Entrega registrada: '+cantidad+' de '+c.codigo+' (folio '+fmtFolio(c.folio)+').');return cargarDatos();})
    .catch(function(e){showError('No se pudo registrar la entrega: '+errText(e));})
    .then(function(){setBusy(false);});
}
function cerrarSolicitud(d,estatus){
  if(!requireUser())return;
  var c=d.content;
  abrirModal((estatus==='Rechazada'?'Rechazar':'Cancelar')+' solicitud','Folio '+fmtFolio(c.folio)+' — '+c.codigo+' '+c.descripcion+' ('+c.cantidadSolicitada+').',function(motivo){
    setBusy(true);clearStatus();
    domo.put(SOL_URL+'/'+d.id,{content:Object.assign({},c,{estatus:estatus,motivo:motivo,fechaCierre:new Date().toISOString(),usuarioCierre:CURRENT_USER.label,usuarioCierreId:CURRENT_USER.id})})
      .then(function(){showOk('Solicitud '+fmtFolio(c.folio)+' '+estatus.toLowerCase()+'.');return cargarDatos();})
      .catch(function(e){showError('No se pudo actualizar la solicitud: '+errText(e));})
      .then(function(){setBusy(false);});
  });
}

// ================= Entradas / Salidas / Ajustes =================
function movimientoDoc(tipo,codigo,descripcion,cantidad,efecto,stockAnterior,referencia,persona,notas,folio,fecha){
  return {fechaHora:fecha||new Date().toISOString(),tipo:tipo,codigo:codigo,descripcion:descripcion,
    cantidad:cantidad,efecto:efecto,stockAnterior:stockAnterior,stockResultante:stockAnterior+efecto,
    referencia:referencia||'',persona:persona||'',notas:notas||'',folioSolicitud:folio||0,
    usuario:CURRENT_USER.label,usuarioId:CURRENT_USER.id};
}
function renderMovForm(){
  var t=$('movTipoInput').value;
  $('movCantidadLabel').textContent=t==='Ajuste'?'Conteo físico':'Cantidad';
  $('movPersonaLabel').textContent=t==='Entrada'?'Recibido de (proveedor)':t==='Salida'?'Entregado a':'Contado por';
  $('movNotasLabel').textContent=t==='Ajuste'?'Motivo del ajuste (obligatorio)':'Notas';
  renderMovStockInfo();
}
function renderMovStockInfo(){
  var v=$('movMaterialInput').value.trim(),d=materialDesdeInput(v),el=$('movStockInfo');
  if(!d){el.innerHTML=v?'Material no encontrado o inactivo.':'';return;}
  var html=textoStock(d),t=$('movTipoInput').value,c=$('movCantidadInput').value;
  if(t==='Ajuste'&&c!==''){var dif=Number(c)-infoDe(d.content.codigo).stock;html+=' · Diferencia del ajuste: <b>'+(dif>0?'+':'')+dif+'</b>';}
  el.innerHTML=html;
}
function registrarMovimiento(){
  if(!requireUser())return;
  var tipo=$('movTipoInput').value,d=materialDesdeInput($('movMaterialInput').value),valor=$('movCantidadInput').value,
      ref=$('movReferenciaInput').value.trim(),persona=$('movPersonaInput').value.trim(),notas=$('movNotasInput').value.trim();
  if(!d){showError('Selecciona un material válido de la lista.');return;}
  var cant=Number(valor);
  if(valor===''||!isFinite(cant)||cant<0||(tipo!=='Ajuste'&&cant===0)){showError(tipo==='Ajuste'?'Captura el conteo físico (0 o mayor).':'Captura una cantidad mayor a 0.');return;}
  if(tipo==='Salida'&&!persona){showError('Captura a quién se entrega el material.');return;}
  if(tipo==='Ajuste'&&!notas){showError('Captura el motivo del ajuste.');return;}
  setBusy(true);clearStatus();
  var m=d.content;
  recargar().then(function(){
    var stock=infoDe(m.codigo).stock,efecto,cantidad;
    if(tipo==='Entrada'){cantidad=cant;efecto=cant;}
    else if(tipo==='Salida'){
      if(cant>stock)throw new Error('Stock insuficiente de '+m.codigo+': hay '+stock+'.');
      cantidad=cant;efecto=-cant;
    }else{
      efecto=cant-stock;cantidad=Math.abs(efecto);
      if(efecto===0)return 'sin-diferencia';
    }
    return domo.post(MOV_URL,{content:movimientoDoc(tipo,m.codigo,m.descripcion,cantidad,efecto,stock,ref,persona,notas,0)});
  }).then(function(r){
    if(r==='sin-diferencia'){showOk('El conteo coincide con el sistema; no se registró ajuste.');return;}
    ['movMaterialInput','movCantidadInput','movReferenciaInput','movPersonaInput','movNotasInput'].forEach(function(id){$(id).value='';});
    showOk('Movimiento de '+(tipo==='Ajuste'?'ajuste':tipo.toLowerCase())+' registrado para '+m.codigo+'.');
    return cargarDatos();
  }).catch(function(e){showError('No se pudo registrar el movimiento: '+errText(e));})
    .then(function(){setBusy(false);});
}
function movFiltrados(){
  var desde=$('movDesde').value,hasta=$('movHasta').value,t=$('movFiltroTipo').value,q=$('movBuscar').value.toLowerCase();
  return movimientos.filter(function(d){
    var c=d.content,f=localDateKey(c.fechaHora);
    if(desde&&f<desde)return false;
    if(hasta&&f>hasta)return false;
    if(t&&c.tipo!==t)return false;
    if(q&&[c.codigo,c.descripcion,c.referencia,c.persona,c.notas,c.usuario,c.folioSolicitud?fmtFolio(c.folioSolicitud):''].join(' ').toLowerCase().indexOf(q)<0)return false;
    return true;
  }).sort(function(a,b){return a.content.fechaHora<b.content.fechaHora?1:-1;});
}
function renderMovimientos(){
  var body=$('movimientosTbody');body.innerHTML='';
  var rows=movFiltrados();
  if(!rows.length){empty(body,12,'No hay movimientos para los filtros seleccionados.');return;}
  rows.forEach(function(d){
    var c=d.content,tr=document.createElement('tr');
    add(tr,fmtDateTime(c.fechaHora));
    var td=document.createElement('td');td.className='mov-'+c.tipo;td.textContent=c.tipo;tr.appendChild(td);
    add(tr,c.codigo);add(tr,c.descripcion);
    addNum(tr,(num(c.efecto)>0?'+':'')+num(c.efecto));
    addNum(tr,c.stockAnterior);addNum(tr,c.stockResultante);
    add(tr,c.referencia);add(tr,c.folioSolicitud?fmtFolio(c.folioSolicitud):'');add(tr,c.persona);addWrap(tr,c.notas);add(tr,c.usuario);
    body.appendChild(tr);
  });
}
function exportarMovimientos(){
  var rows=[['Fecha/hora','Tipo','Código','Descripción','Cantidad','Stock anterior','Stock resultante','Referencia','Folio solicitud','Entregado a / Recibido de','Notas','Registró']];
  movFiltrados().forEach(function(d){var c=d.content;rows.push([fmtDateTime(c.fechaHora),c.tipo,c.codigo,c.descripcion,c.efecto,c.stockAnterior,c.stockResultante,c.referencia,c.folioSolicitud||'',c.persona,c.notas,c.usuario]);});
  descargar('movimientos_mro.csv',toCsv(rows),'text/csv');
}

// ================= Catálogo =================
// Mapa número de proveedor -> nombre, tomado del catálogo.
function proveedores(){var r={};catalogo.forEach(function(d){var m=d.content,n=String(m.proveedorNum||'').trim();if(n&&m.proveedor&&!r[n])r[n]=m.proveedor;});return r;}
function proveedorPorNum(num){return proveedores()[String(num||'').trim()]||'';}
function numPorProveedor(nombre){var p=proveedores(),k=String(nombre||'').trim().toUpperCase();if(!k)return '';for(var n in p)if(String(p[n]).trim().toUpperCase()===k)return n;return '';}
function leerCatForm(){
  var aplica=$('catAplicaMinMax').checked;
  return {
    codigo:$('catCodigo').value.trim(),
    descripcion:$('catDescripcion').value.trim(),
    categoria:$('catCategoria').value.trim().toUpperCase(),
    unidad:$('catUnidad').value.trim().toUpperCase(),
    ubicacion:$('catUbicacion').value.trim(),
    proveedorNum:$('catProveedorNum').value.trim(),
    proveedor:$('catProveedor').value.trim(),
    leadTimeDias:num($('catLeadTime').value),
    stockInicial:num($('catStockInicial').value),
    aplicaMinMax:aplica?'SI':'NO',
    minimo:aplica&&$('catMinimo').value!==''?num($('catMinimo').value):null,
    maximo:aplica&&$('catMaximo').value!==''?num($('catMaximo').value):null
  };
}
function validarMaterial(m,idActual){
  if(!m.codigo)return 'Captura el código.';
  if(!m.descripcion)return 'Captura la descripción.';
  var dup=matDoc(m.codigo);
  if(dup&&dup.id!==idActual)return 'El código '+m.codigo+' ya existe en el catálogo ('+dup.content.descripcion+').';
  if(m.aplicaMinMax==='SI'){
    if(m.minimo===null&&m.maximo===null)return 'Captura mínimo y/o máximo, o desmarca "Controlar mínimo / máximo".';
    if(m.minimo!==null&&m.maximo!==null&&m.minimo>m.maximo)return 'El mínimo no puede ser mayor que el máximo.';
  }
  return '';
}
function guardarCatalogo(){
  if(!requireUser())return;
  var m=leerCatForm(),err=validarMaterial(m,editandoCat&&editandoCat.id);
  if(err){showError(err);return;}
  var ahora=new Date().toISOString(),p;
  setBusy(true);clearStatus();
  if(editandoCat){
    var prev=editandoCat.content;
    m.codigo=prev.codigo;m.stockInicial=prev.stockInicial;
    p=domo.put(CAT_URL+'/'+editandoCat.id,{content:Object.assign({},prev,m,{fechaModificacion:ahora,usuarioModificacion:CURRENT_USER.label,usuarioModificacionId:CURRENT_USER.id})});
  }else{
    p=domo.post(CAT_URL,{content:Object.assign(m,{activo:'SI',fechaAlta:ahora,usuarioAlta:CURRENT_USER.label,usuarioAltaId:CURRENT_USER.id,fechaModificacion:ahora,usuarioModificacion:CURRENT_USER.label,usuarioModificacionId:CURRENT_USER.id})});
  }
  p.then(function(){showOk('Material '+m.codigo+' guardado.');limpiarCatForm();return cargarDatos();})
    .catch(function(e){showError('No se pudo guardar el material: '+errText(e));})
    .then(function(){setBusy(false);});
}
function limpiarCatForm(){
  editandoCat=null;
  ['catCodigo','catDescripcion','catCategoria','catUnidad','catUbicacion','catProveedorNum','catProveedor','catLeadTime','catStockInicial','catMinimo','catMaximo'].forEach(function(id){$(id).value='';});
  $('catAplicaMinMax').checked=false;$('catMinimo').disabled=$('catMaximo').disabled=true;
  $('catCodigo').readOnly=false;$('catStockInicial').disabled=false;
  $('catFormTitle').textContent='Nuevo material';
}
function editarCatalogo(d){
  var m=d.content;editandoCat=d;
  $('catCodigo').value=m.codigo;$('catDescripcion').value=m.descripcion||'';$('catCategoria').value=m.categoria||'';
  $('catUnidad').value=m.unidad||'';$('catUbicacion').value=m.ubicacion||'';$('catProveedorNum').value=m.proveedorNum||'';
  $('catProveedor').value=m.proveedor||'';$('catLeadTime').value=m.leadTimeDias||'';$('catStockInicial').value=m.stockInicial||0;
  $('catAplicaMinMax').checked=aplicaMinMax(m);$('catMinimo').disabled=$('catMaximo').disabled=!aplicaMinMax(m);
  $('catMinimo').value=tieneValor(m.minimo)?m.minimo:'';$('catMaximo').value=tieneValor(m.maximo)?m.maximo:'';
  $('catCodigo').readOnly=true;$('catStockInicial').disabled=true;
  $('catFormTitle').textContent='Editar material '+m.codigo;
  clearStatus();$('tabCatalogo').scrollIntoView({behavior:'smooth'});
}
function toggleActivo(d){
  if(!requireUser())return;
  var m=d.content,nuevo=m.activo==='NO'?'SI':'NO';
  setBusy(true);clearStatus();
  domo.put(CAT_URL+'/'+d.id,{content:Object.assign({},m,{activo:nuevo,fechaModificacion:new Date().toISOString(),usuarioModificacion:CURRENT_USER.label,usuarioModificacionId:CURRENT_USER.id})})
    .then(function(){showOk('Material '+m.codigo+(nuevo==='SI'?' activado.':' desactivado.'));return cargarDatos();})
    .catch(function(e){showError('No se pudo actualizar el material: '+errText(e));})
    .then(function(){setBusy(false);});
}
function renderCatalogo(){
  var q=$('buscarCat').value.toLowerCase(),cat=$('filtroCategoriaCat').value,inact=$('mostrarInactivosCat').checked,body=$('catalogoTbody');
  body.innerHTML='';
  var rows=catalogo.filter(function(d){
    var m=d.content;
    if(!inact&&m.activo==='NO')return false;
    if(cat&&m.categoria!==cat)return false;
    if(q&&[m.codigo,m.descripcion,m.proveedor,m.proveedorNum,m.ubicacion].join(' ').toLowerCase().indexOf(q)<0)return false;
    return true;
  }).sort(byCodigo);
  if(!rows.length){empty(body,13,catalogo.length?'No hay materiales para los filtros seleccionados.':'El catálogo está vacío. Usa "Importar catálogo del Excel CONTROL_MRO" o da de alta materiales.');return;}
  rows.forEach(function(d){
    var m=d.content,tr=document.createElement('tr');if(m.activo==='NO')tr.className='inactivo';
    add(tr,m.codigo);add(tr,m.descripcion);add(tr,m.categoria);add(tr,m.proveedorNum);add(tr,m.proveedor);addNum(tr,m.leadTimeDias);
    add(tr,m.unidad);add(tr,m.ubicacion);
    addNum(tr,aplicaMinMax(m)&&tieneValor(m.minimo)?m.minimo:'');addNum(tr,aplicaMinMax(m)&&tieneValor(m.maximo)?m.maximo:'');
    add(tr,m.activo==='NO'?'No':'Sí');
    add(tr,[m.usuarioModificacion,fmtDateTime(m.fechaModificacion)].filter(Boolean).join(' · '));
    var td=document.createElement('td');
    td.appendChild(btn('Editar','small',function(){editarCatalogo(d);}));
    td.appendChild(btn(m.activo==='NO'?'Activar':'Desactivar','secondary small',function(){toggleActivo(d);}));
    tr.appendChild(td);body.appendChild(tr);
  });
}
// Inserta materiales en serie; omite códigos repetidos (en el catálogo o en la misma carga).
function insertarMateriales(lista){
  var ahora=new Date().toISOString(),vistos={},omitidos=[],nuevos=[];
  lista.forEach(function(m){
    var k=key(m.codigo);
    if(!k||!m.descripcion)return;
    if(matDoc(k)||vistos[k]){omitidos.push(m.codigo+' ('+m.descripcion+')');return;}
    vistos[k]=true;nuevos.push(m);
  });
  var chain=Promise.resolve();
  nuevos.forEach(function(m){
    chain=chain.then(function(){return domo.post(CAT_URL,{content:Object.assign({
      codigo:'',descripcion:'',categoria:'',proveedorNum:'',proveedor:'',leadTimeDias:0,unidad:'',ubicacion:'',
      aplicaMinMax:'NO',minimo:null,maximo:null,stockInicial:0},m,{
      activo:'SI',fechaAlta:ahora,usuarioAlta:CURRENT_USER.label,usuarioAltaId:CURRENT_USER.id,
      fechaModificacion:ahora,usuarioModificacion:CURRENT_USER.label,usuarioModificacionId:CURRENT_USER.id})});});
  });
  return chain.then(function(){return {nuevos:nuevos,omitidos:omitidos};});
}
function importarSeed(){
  if(!requireUser())return;
  if(catalogo.length){showError('El catálogo ya tiene materiales; la importación inicial solo se permite con el catálogo vacío.');return;}
  setBusy(true);clearStatus();
  var res;
  insertarMateriales(SEED_CATALOGO).then(function(r){res=r;return recargar();}).then(function(){
    // Movimientos históricos del Excel (hoja Movimientos)
    var chain=Promise.resolve(),saldo={};
    SEED_MOVIMIENTOS.forEach(function(mv){
      var d=matDoc(mv.codigo);if(!d)return;
      var k=key(mv.codigo);saldo[k]=saldo[k]===undefined?infoDe(mv.codigo).stock:saldo[k];
      var efecto=mv.tipo==='Entrada'?mv.cantidad:-mv.cantidad,ant=saldo[k];saldo[k]+=efecto;
      chain=chain.then(function(){return domo.post(MOV_URL,{content:Object.assign(
        movimientoDoc(mv.tipo,d.content.codigo,d.content.descripcion,mv.cantidad,efecto,ant,mv.notas,'','Importado de Excel CONTROL_MRO',0,new Date(mv.fecha+'T12:00:00').toISOString()),
        {usuario:'Importación Excel ('+CURRENT_USER.label+')'})});});
    });
    return chain;
  }).then(function(){
    var msg=res.nuevos.length+' materiales y '+SEED_MOVIMIENTOS.length+' movimientos importados.';
    if(res.omitidos.length)msg+=' Códigos repetidos NO importados (dales un código nuevo en Catálogo): '+res.omitidos.join('; ');
    (res.omitidos.length?showError:showOk)(msg);
    return cargarDatos();
  }).catch(function(e){showError('Error en la importación: '+errText(e)+'. Revisa el catálogo antes de reintentar.');return cargarDatos();})
    .then(function(){setBusy(false);});
}
function importarPegado(){
  if(!requireUser())return;
  var lineas=$('pegarTexto').value.split(/\r?\n/).filter(function(l){return l.trim();});
  if(lineas.length&&/c[oó]digo/i.test(lineas[0].split('\t')[0]))lineas.shift();
  var lista=lineas.map(function(l){
    var c=l.split('\t').map(function(x){return x.replace(/\s+/g,' ').trim();});
    var min=c[8]!==undefined&&c[8]!==''?num(c[8]):null,max=c[9]!==undefined&&c[9]!==''?num(c[9]):null;
    return {codigo:c[0]||'',descripcion:c[1]||'',categoria:(c[2]||'').toUpperCase(),proveedorNum:c[3]||'',proveedor:c[4]||'',
      leadTimeDias:num(c[5]),unidad:(c[6]||'').toUpperCase(),ubicacion:c[7]||'',
      aplicaMinMax:min!==null||max!==null?'SI':'NO',minimo:min,maximo:max,stockInicial:num(c[10])};
  });
  if(!lista.length){showError('Pega al menos una fila.');return;}
  setBusy(true);clearStatus();
  insertarMateriales(lista).then(function(r){
    $('pegarTexto').value='';
    var msg=r.nuevos.length+' material(es) importado(s).';
    if(r.omitidos.length)msg+=' Omitidos por código existente o repetido: '+r.omitidos.join('; ');
    (r.omitidos.length?showError:showOk)(msg);
    return cargarDatos();
  }).catch(function(e){showError('Error al importar: '+errText(e));return cargarDatos();})
    .then(function(){setBusy(false);});
}

// ================= Etiquetas ZPL =================
function etqVisibles(){
  var q=$('buscarEtq').value.toLowerCase(),cat=$('filtroCategoriaEtq').value;
  return activos().map(function(d){return d.content;}).filter(function(m){
    if(cat&&m.categoria!==cat)return false;
    if(q&&[m.codigo,m.descripcion,m.ubicacion].join(' ').toLowerCase().indexOf(q)<0)return false;
    return true;
  }).sort(function(a,b){return a.codigo<b.codigo?-1:1;});
}
function renderEtiquetas(){
  var body=$('etiquetasTbody');body.innerHTML='';
  var rows=etqVisibles();
  if(!rows.length)empty(body,6,'No hay materiales para los filtros seleccionados.');
  rows.forEach(function(m){
    var tr=document.createElement('tr'),td=document.createElement('td'),ck=document.createElement('input');
    ck.type='checkbox';ck.checked=!!selEtq[m.codigo];
    ck.onchange=function(){if(ck.checked)selEtq[m.codigo]=num(cp.value)||1;else delete selEtq[m.codigo];contarSel();};
    td.appendChild(ck);tr.appendChild(td);
    add(tr,m.codigo);add(tr,m.descripcion);add(tr,m.categoria);add(tr,m.ubicacion);
    var tdc=document.createElement('td'),cp=document.createElement('input');
    cp.type='number';cp.min='1';cp.step='1';cp.value=selEtq[m.codigo]||1;cp.style.width='70px';
    cp.oninput=function(){if(selEtq[m.codigo])selEtq[m.codigo]=Math.max(1,Math.floor(num(cp.value))||1);};
    tdc.appendChild(cp);tr.appendChild(tdc);
    body.appendChild(tr);
  });
  contarSel();
}
function contarSel(){
  var n=Object.keys(selEtq).length,t=Object.keys(selEtq).reduce(function(a,k){return a+selEtq[k];},0);
  $('etqSelCount').textContent=n?n+' material(es) seleccionado(s), '+t+' etiqueta(s).':'';
}
// Escapa el texto para ^FH (indicador "_" en hexadecimal).
function zplTxt(s){return String(s===undefined||s===null?'':s).replace(/[_^~\\]/g,function(ch){return '_'+ch.charCodeAt(0).toString(16).toUpperCase();}).replace(/[\r\n]+/g,' ');}
function cortar(s,n){s=String(s||'');return s.length>n?s.slice(0,n-1)+'…':s;}
// Plantillas en puntos de 203 dpi; se escalan si la impresora es de 300 dpi.
var TAMANOS={
  '4x2':{w:4,h:2},'4x1':{w:4,h:1},'2x1':{w:2,h:1},'4x0.75':{w:4,h:0.75}
};
function zplEtiqueta(m,copias,cfg){
  var k=cfg.dpi/203,S=function(v){return Math.round(v*k);};
  var t=TAMANOS[cfg.tamano],W=S(t.w*203),H=S(t.h*203);
  var lineas=[],extra=[];
  if(cfg.cat&&m.categoria)extra.push(m.categoria);
  if(cfg.ubic&&m.ubicacion)extra.push('Ubic: '+m.ubicacion);
  if(cfg.minmax&&aplicaMinMax(m)&&(tieneValor(m.minimo)||tieneValor(m.maximo)))extra.push('Min: '+(tieneValor(m.minimo)?m.minimo:'-')+'  Max: '+(tieneValor(m.maximo)?m.maximo:'-'));
  var extraTxt=extra.join('  |  ');
  var txt=function(x,y,h,data,ancho,lineasMax){
    var fb=ancho?'^FB'+S(ancho)+','+(lineasMax||1)+',0,L,0':'';
    return '^FO'+S(x)+','+S(y)+'^A0N,'+S(h)+','+S(h)+fb+'^FH^FD'+zplTxt(data)+'^FS';
  };
  var codigo=function(x,y,alto,qrMag,modulo){
    if(cfg.codigo==='qr')return '^FO'+S(x)+','+S(y)+'^BQN,2,'+Math.max(1,Math.round(qrMag*k))+'^FH^FDQA,'+zplTxt(m.codigo)+'^FS';
    var by=Math.max(1,Math.round((modulo||2)*k));
    return '^FO'+S(x)+','+S(y)+'^BY'+by+',3,'+S(alto)+'^BCN,'+S(alto)+',N,N,N^FH^FD'+zplTxt(m.codigo)+'^FS';
  };
  var largo=String(m.codigo).length,mod=largo>12?1:2,mod42=largo>14?2:3;
  switch(cfg.tamano){
    case '4x2':
      lineas.push(txt(25,20,48,m.codigo,560,1));
      if(cfg.desc)lineas.push(txt(25,80,28,m.descripcion,cfg.codigo==='qr'?560:760,2));
      if(cfg.codigo==='qr'){lineas.push(codigo(600,15,0,7));}
      else lineas.push(codigo(25,155,110,0,mod42));
      if(extraTxt)lineas.push(txt(25,cfg.codigo==='qr'?160:290,24,extraTxt,760,2));
      lineas.push(txt(25,360,20,'MRO',100,1));
      break;
    case '4x1':
      lineas.push(txt(20,12,36,m.codigo,cfg.codigo==='qr'?600:430,1));
      if(cfg.desc)lineas.push(txt(20,55,22,cortar(m.descripcion,90),cfg.codigo==='qr'?600:430,2));
      if(extraTxt)lineas.push(txt(20,160,20,extraTxt,cfg.codigo==='qr'?600:780,1));
      lineas.push(cfg.codigo==='qr'?codigo(640,10,0,4):codigo(460,20,120,0,mod));
      break;
    case '2x1':
      lineas.push(txt(12,8,28,m.codigo,cfg.codigo==='qr'?250:380,1));
      if(cfg.codigo==='qr'){
        lineas.push(codigo(270,8,0,3));
        if(cfg.desc)lineas.push(txt(12,45,18,cortar(m.descripcion,60),250,3));
        if(extraTxt)lineas.push(txt(12,165,16,extraTxt,380,1));
      }else{
        lineas.push(codigo(12,42,70,0,largo>8?1:2));
        if(cfg.desc)lineas.push(txt(12,122,18,cortar(m.descripcion,40),380,1));
        if(extraTxt)lineas.push(txt(12,150,16,extraTxt,380,2));
      }
      break;
    default: // 4x0.75
      lineas.push(txt(15,8,30,m.codigo,cfg.codigo==='qr'?640:440,1));
      if(cfg.desc)lineas.push(txt(15,45,20,cortar(m.descripcion,50),cfg.codigo==='qr'?640:440,1));
      if(extraTxt)lineas.push(txt(15,75,18,extraTxt,cfg.codigo==='qr'?640:440,2));
      lineas.push(cfg.codigo==='qr'?codigo(680,8,0,3):codigo(460,12,95,0,mod));
  }
  return '^XA\n^CI28\n^PW'+W+'\n^LL'+H+'\n^LH0,0\n'+lineas.join('\n')+'\n^PQ'+copias+',0,1,Y\n^XZ';
}
function etqConfig(){
  return {tamano:$('etqTamano').value,dpi:Number($('etqDpi').value),codigo:$('etqCodigo').value,
    desc:$('etqDesc').checked,cat:$('etqCat').checked,ubic:$('etqUbic').checked,minmax:$('etqMinMax').checked};
}
function generarZpl(silencioso){
  var codigos=Object.keys(selEtq);
  if(!codigos.length){if(!silencioso)showError('Selecciona al menos un material para generar etiquetas.');return '';}
  var cfg=etqConfig();
  var zpl=codigos.sort().map(function(c){var d=matDoc(c);return d?zplEtiqueta(d.content,selEtq[c],cfg):'';}).filter(Boolean).join('\n');
  $('zplOutput').value=zpl;
  if(!silencioso)showOk('ZPL generado para '+codigos.length+' material(es).');
  return zpl;
}
function zplActual(){return generarZpl(true)||($('zplOutput').value||'');}
function copiarZpl(){
  var z=zplActual();if(!z){showError('Selecciona al menos un material.');return;}
  var ok=function(){showOk('ZPL copiado al portapapeles.');};
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(z).then(ok).catch(fallback);else fallback();
  function fallback(){var ta=$('zplOutput');ta.value=z;ta.select();try{document.execCommand('copy');ok();}catch(e){showError('No se pudo copiar; selecciona el texto y usa Ctrl+C.');}}
}
// Zebra Browser Print expone un servicio local (https 9101 / http 9100).
var BROWSER_PRINT=['https://localhost:9101','http://localhost:9100'];
function imprimirZebra(){
  var z=zplActual();if(!z){showError('Selecciona al menos un material.');return;}
  setBusy(true);clearStatus();
  function intentar(i){
    if(i>=BROWSER_PRINT.length)return Promise.reject(new Error('No se encontró Zebra Browser Print en esta PC.'));
    var base=BROWSER_PRINT[i];
    return fetch(base+'/default?type=printer').then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.text();})
      .then(function(t){
        if(!t)throw new Error('Browser Print no tiene una impresora predeterminada.');
        var printer=JSON.parse(t);
        return fetch(base+'/write',{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({device:printer,data:z})})
          .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return printer;});
      })
      .catch(function(e){if(/predeterminada/.test(e.message))throw e;return intentar(i+1);});
  }
  intentar(0).then(function(p){showOk('Etiquetas enviadas a '+(p.name||'la impresora Zebra')+'.');})
    .catch(function(e){showError(errText(e)+' Instala/abre Zebra Browser Print y define una impresora predeterminada, o usa "Descargar .zpl".');})
    .then(function(){setBusy(false);});
}
function previewZpl(){
  var codigos=Object.keys(selEtq).sort();
  if(!codigos.length){showError('Selecciona al menos un material.');return;}
  var cfg=etqConfig(),t=TAMANOS[cfg.tamano],d=matDoc(codigos[0]);
  var zpl=zplEtiqueta(d.content,1,cfg);
  generarZpl(true);
  setBusy(true);clearStatus();
  fetch('https://api.labelary.com/v1/printers/'+(cfg.dpi===300?'12':'8')+'dpmm/labels/'+t.w+'x'+t.h+'/0/',{method:'POST',headers:{'Accept':'image/png','Content-Type':'application/x-www-form-urlencoded'},body:zpl})
    .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.blob();})
    .then(function(b){var img=$('zplPreview');img.src=URL.createObjectURL(b);img.style.display='';showOk('Vista previa de '+d.content.codigo+'.');})
    .catch(function(e){showError('No se pudo obtener la vista previa (labelary.com): '+errText(e));})
    .then(function(){setBusy(false);});
}

// ================= Modal de motivo =================
function abrirModal(titulo,texto,onConfirm){
  $('motivoModalTitle').textContent=titulo;$('motivoModalText').textContent=texto;$('motivoTexto').value='';
  $('motivoModal').style.display='';$('motivoTexto').focus();
  $('motivoConfirmar').onclick=function(){
    var v=$('motivoTexto').value.trim();
    if(!v){$('motivoModalText').textContent='Escribe el motivo para continuar.';$('motivoTexto').focus();return;}
    cerrarModal();onConfirm(v);
  };
}
function cerrarModal(){$('motivoModal').style.display='none';}

// ================= Utilidades =================
function byCodigo(a,b){var x=String(a.content.codigo),y=String(b.content.codigo);return x<y?-1:x>y?1:0;}
function foliosUnicos(docs){var s={};docs.forEach(function(d){s[d.content.folio]=true;});return Object.keys(s);}
function add(tr,v){var td=document.createElement('td');td.textContent=v===undefined||v===null?'':String(v);tr.appendChild(td);return td;}
function addNum(tr,v){var td=add(tr,v===''||v===undefined||v===null?'':(typeof v==='number'?v.toLocaleString('es-MX'):v));td.className='numeric';return td;}
function addWrap(tr,v){var td=add(tr,v);td.className='wrap';return td;}
function addPill(tr,txt,cls){var td=document.createElement('td'),s=document.createElement('span');s.className='pill '+(cls||'');s.textContent=txt||'';td.appendChild(s);tr.appendChild(td);}
function empty(body,span,msg){var tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=span;td.className='empty-cell';td.textContent=msg;tr.appendChild(td);body.appendChild(tr);}
function btn(label,cls,fn){var b=document.createElement('button');b.className=cls||'small';b.textContent=label;b.onclick=fn;return b;}
function esc(s){return String(s===undefined||s===null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function fmtFolio(n){return String(n||'').padStart(4,'0');}
function fmtDateTime(v){if(!v)return '';var d=new Date(v);return isNaN(d)?'':d.toLocaleString('es-MX');}
function localDateKey(v){if(!v)return '';var d=new Date(v);if(isNaN(d))return '';return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function toCsv(rows){return '﻿'+rows.map(function(r){return r.map(function(v){v=v===undefined||v===null?'':String(v);return /[",\n;]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}).join(',');}).join('\r\n');}
function descargar(nombre,contenido,tipo){
  var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([contenido],{type:tipo+';charset=utf-8'}));a.download=nombre;
  document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},1000);
}
var busyCount=0;
function setBusy(v){busyCount=Math.max(0,busyCount+(v?1:-1));v=busyCount>0;loading.style.display=v?'block':'none';['btnEnviarSolicitud','btnRegistrarMov','btnGuardarCat','btnImportarPegado','btnSeed'].forEach(function(id){$(id).disabled=v;});}
function showError(s){statusMsg.style.color='#c0392b';statusMsg.textContent=s;}
function showOk(s){statusMsg.style.color='#1e8449';statusMsg.textContent=s;}
function clearStatus(){statusMsg.textContent='';}
function errText(e){return e&&(e.message||JSON.stringify(e))||'Error desconocido';}

init();
})();
