(function(){
'use strict';
var domo=window.domo;
// Colecciones de este proyecto (incluyen campos de usuario, cancelación y costo extra).
var SOL_COLLECTION='solicitudes_cajas_v3';
var BOX_COLLECTION='detalle_cajas_v3';
var SOL_URL='/domo/datastores/v1/collections/'+SOL_COLLECTION+'/documents';
var BOX_URL='/domo/datastores/v1/collections/'+BOX_COLLECTION+'/documents';
var REFRESH_MS=300000, AMARILLO_MIN=120, ROJO_MIN=180;
// Tiempo libre de carga después de confirmar la llegada y costo por hora o fracción excedente.
var TIEMPO_LIBRE_MIN=180, COSTO_HORA_USD=300;
// Día ordinario de registro (0=domingo ... 4=jueves).
var DIA_ORDINARIO=4;
// Estatus de caja.
var EST={PENDIENTE:0,PROGRAMADA:2,EN_ALMACEN:3,DESPACHADA:4,CANCELADA:5};

var solicitudes=[], cajas=[];
var CURRENT_USER={id:null,label:'Usuario desconocido'};
var statusMsg=document.getElementById('statusMsg'),loading=document.getElementById('loading');
var $=function(id){return document.getElementById(id);};
var TABS=['Alta','Logistica','Almacen','Semaforo','Historico','Canceladas'];

function init(){
  TABS.forEach(function(t){$('tabBtn'+t).onclick=function(){switchTab(t);};});
  $('btnCrear').onclick=crearSolicitud;
  TABS.forEach(function(t){$('btnRefrescar'+t).onclick=cargarDatos;});
  ['buscarAlta','filtroPlantaAlta'].forEach(function(id){$(id).addEventListener('input',renderAlta);});
  ['buscarLogistica','filtroPlantaLogistica'].forEach(function(id){$(id).addEventListener('input',renderLogistica);});
  ['buscarAlmacen','filtroPlantaAlmacen'].forEach(function(id){$(id).addEventListener('input',renderAlmacen);});
  ['buscarSemaforo','filtroPlantaSemaforo'].forEach(function(id){$(id).addEventListener('input',renderSemaforo);});
  ['fechaDesdeHistorico','fechaHastaHistorico','filtroPlantaHistorico','filtroTipoHistorico','filtroEstatusHistorico','buscarHistorico'].forEach(function(id){$(id).addEventListener('input',renderHistorico);});
  ['fechaDesdeCanceladas','fechaHastaCanceladas','filtroPlantaCanceladas','buscarCanceladas'].forEach(function(id){$(id).addEventListener('input',renderCanceladas);});
  $('cancelModalCerrar').onclick=cerrarModal;
  renderTipoHoy();
  ensureCollections()
    .then(cargarUsuarioActual)
    .then(cargarDatos)
    .catch(function(e){showError('Error al inicializar: '+errText(e));});
  setInterval(function(){renderTipoHoy();cargarDatos();},REFRESH_MS);
}
function switchTab(tab){
  TABS.forEach(function(t){
    $('tab'+t).style.display=t===tab?'':'none';
    $('tabBtn'+t).classList.toggle('active',t===tab);
  });
}

// ---------- Usuario activo de DOMO ----------
// Igual que en domo-brick-solicitudes: se toma domo.env.userId y se consulta
// /domo/users/v1/{id} para obtener el nombre visible.
function cargarUsuarioActual(){
  var domoUserId=domo.env&&domo.env.userId;
  if(!domoUserId){
    CURRENT_USER={id:null,label:'Usuario desconocido'};
    renderUsuario();
    showError('No se encontró domo.env.userId. Verifica que el brick tenga disponible el contexto de usuario de DOMO.');
    return Promise.resolve();
  }
  return domo.get('/domo/users/v1/'+encodeURIComponent(domoUserId)+'?includeDetails=true')
    .then(function(user){
      CURRENT_USER={
        id:String(user.id||domoUserId),
        label:user.displayName||user.name||'Usuario sin nombre'
      };
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
// Devuelve true si hay usuario identificado; si no, muestra el error.
function requireUser(){
  if(CURRENT_USER.id)return true;
  showError('No se pudo identificar tu usuario de DOMO. Recarga la página antes de continuar.');
  return false;
}

// ---------- Colecciones ----------
// Crea la colección; si ya existe, actualiza su schema para que los campos
// nuevos también lleguen al dataset sincronizado.
function ensureOneCollection(name,columns){
  var body={name:name,schema:{columns:columns}};
  return domo.post('/domo/datastores/v1/collections',body)
    .catch(function(){return domo.put('/domo/datastores/v1/collections/'+name,body);})
    .catch(function(){return null;});
}
function ensureCollections(){return Promise.all([
  ensureOneCollection(SOL_COLLECTION,[
    {name:'folio',type:'LONG'},
    {name:'solicitante',type:'STRING'},
    {name:'cantidadCajas',type:'LONG'},
    {name:'fechaRequerida',type:'STRING'},
    {name:'planta',type:'STRING'},
    {name:'fechaHoraInsert',type:'STRING'},
    {name:'destino',type:'STRING'},
    {name:'usuarioAltaId',type:'STRING'},
    {name:'usuarioAlta',type:'STRING'},
    {name:'tipoSolicitud',type:'STRING'},
    {name:'fechaHoraCancelacion',type:'STRING'},
    {name:'usuarioCancelacionId',type:'STRING'},
    {name:'usuarioCancelacion',type:'STRING'},
    {name:'comentarioCancelacion',type:'STRING'}]),
  ensureOneCollection(BOX_COLLECTION,[
    {name:'folioSolicitud',type:'LONG'},
    {name:'numeroSecuencia',type:'LONG'},
    {name:'numeroCaja',type:'STRING'},
    {name:'tipoSolicitud',type:'STRING'},
    {name:'fechaHoraProgramada',type:'STRING'},
    {name:'fechaHoraRelease',type:'STRING'},
    {name:'fechaHoraLlegadaReal',type:'STRING'},
    {name:'fechaHoraSalida',type:'STRING'},
    {name:'estatus',type:'LONG'},
    {name:'usuarioLogisticaId',type:'STRING'},
    {name:'usuarioLogistica',type:'STRING'},
    {name:'usuarioAlmacenLlegadaId',type:'STRING'},
    {name:'usuarioAlmacenLlegada',type:'STRING'},
    {name:'usuarioAlmacenSalidaId',type:'STRING'},
    {name:'usuarioAlmacenSalida',type:'STRING'},
    {name:'horasExtra',type:'LONG'},
    {name:'costoExtra',type:'DOUBLE'},
    {name:'fechaHoraCancelacion',type:'STRING'},
    {name:'etapaCancelacion',type:'STRING'},
    {name:'usuarioCancelacionId',type:'STRING'},
    {name:'usuarioCancelacion',type:'STRING'},
    {name:'comentarioCancelacion',type:'STRING'}])
]);}

// ---------- Reglas de negocio ----------
// Ordinaria si se registra en jueves; cualquier otro día es Extraordinaria.
function tipoPorFecha(value){
  var d=value?new Date(value):new Date();
  if(isNaN(d))return '';
  return d.getDay()===DIA_ORDINARIO?'Ordinaria':'Extraordinaria';
}
function tipoDeSolicitud(s){return (s&&(s.tipoSolicitud||tipoPorFecha(s.fechaHoraInsert)))||'';}
function renderTipoHoy(){
  var t=tipoPorFecha(),el=$('tipoHoy');
  el.textContent=t+(t==='Ordinaria'?' (hoy es jueves)':' (hoy no es jueves)');
  el.className='pill '+(t==='Extraordinaria'?'badge-extra':'badge-ord');
}
// Costo extra: 3 hrs libres desde la llegada; después, cada hora o fracción = 300 USD.
function calcCostoExtra(llegada,fin){
  if(!llegada)return {horas:0,costo:0};
  var ms=new Date(fin||Date.now()).getTime()-new Date(llegada).getTime();
  var excedenteMs=ms-TIEMPO_LIBRE_MIN*60000;
  if(!isFinite(excedenteMs)||excedenteMs<=0)return {horas:0,costo:0};
  var horas=Math.ceil(excedenteMs/3600000);
  return {horas:horas,costo:horas*COSTO_HORA_USD};
}
function esCancelada(c){return Number(c.estatus)===EST.CANCELADA;}

// ---------- Alta ----------
function crearSolicitud(){
  if(!requireUser())return;
  var solicitante=CURRENT_USER.label,
      cantidad=Number($('cantidadCajasInput').value),
      fecha=$('fechaRequeridaInput').value,
      planta=$('plantaInput').value,
      destino=$('destinoInput').value;
  if(!Number.isInteger(cantidad)||cantidad<1||!fecha||!planta||!destino){
    showError('Completa número de cajas, fecha requerida, planta y destino.');
    return;
  }
  setBusy(true);clearStatus();
  var folio=nextFolio(),now=new Date().toISOString(),tipo=tipoPorFecha(now);
  var solicitud={
    folio:folio,
    solicitante:solicitante,
    cantidadCajas:cantidad,
    fechaRequerida:fecha,
    planta:planta,
    fechaHoraInsert:now,
    destino:destino,
    usuarioAltaId:CURRENT_USER.id,
    usuarioAlta:CURRENT_USER.label,
    tipoSolicitud:tipo,
    fechaHoraCancelacion:'',
    usuarioCancelacionId:'',
    usuarioCancelacion:'',
    comentarioCancelacion:''
  };
  domo.post(SOL_URL,{content:solicitud}).then(function(){
    var chain=Promise.resolve();
    for(var i=1;i<=cantidad;i++)
    (function(n){
      chain=chain.then(function(){
        return domo.post(BOX_URL,{
          content:{
            folioSolicitud:folio,
            numeroSecuencia:n,
            numeroCaja:'',
            tipoSolicitud:tipo,
            fechaHoraProgramada:'',
            fechaHoraRelease:'',
            fechaHoraLlegadaReal:'',
            fechaHoraSalida:'',
            estatus:EST.PENDIENTE,
            usuarioLogisticaId:'',
            usuarioLogistica:'',
            usuarioAlmacenLlegadaId:'',
            usuarioAlmacenLlegada:'',
            usuarioAlmacenSalidaId:'',
            usuarioAlmacenSalida:'',
            horasExtra:0,
            costoExtra:0,
            fechaHoraCancelacion:'',
            etapaCancelacion:'',
            usuarioCancelacionId:'',
            usuarioCancelacion:'',
            comentarioCancelacion:''
          }
        });
      });
    })(i);
    return chain;
  }).then(function(){
    $('cantidadCajasInput').value='';
    $('fechaRequeridaInput').value='';
    $('plantaInput').value='';
    $('destinoInput').value='';
    showOk('Solicitud '+folio+' ('+tipo+') registrada por '+solicitante+' con '+cantidad+' caja(s).');
    return cargarDatos();
  })
  .catch(function(e){
    showError('No se pudo registrar la solicitud o generar todas sus cajas: '+errText(e)+'. Revisa AppDB antes de volver a registrar para evitar duplicados.');
  }).then(function(){setBusy(false);});
}
function nextFolio(){var max=0;solicitudes.forEach(function(d){var n=Number(d.content.folio)||0;if(n>max)max=n;});return max+1;}
function cargarDatos(){
  setBusy(true);
  return Promise.all([
    domo.get(SOL_URL+'?limit=1000&offset=0'),
    domo.get(BOX_URL+'?limit=5000&offset=0')
  ]).then(function(r){
    solicitudes=r[0]||[];
    cajas=r[1]||[];
    renderAll();
  }).catch(function(e){
    showError('No se pudieron cargar los datos: '+errText(e));
  }).then(function(){setBusy(false);});
}
function renderAll(){
  renderAlta();
  renderLogistica();
  renderAlmacen();
  renderSemaforo();
  renderHistorico();
  renderCanceladas();
}
function solByFolio(folio){
  for(var i=0;i<solicitudes.length;i++)
    if(Number(solicitudes[i].content.folio)===Number(folio))
    return solicitudes[i].content;
  return {};
}
function cajasDeFolio(folio){
  return cajas.filter(function(x){return Number(x.content.folioSolicitud)===Number(folio);});
}
function boxStatus(c){
  return ['Pendiente de asignación','Pendiente de llegada en Almacén','Pendiente de llegada en Almacén','En almacén / En carga','Despachada','Cancelada'][Number(c.estatus)]||'Desconocido';
}
// Resumen de una solicitud a partir de sus cajas.
function resumen(c){
  var related=cajasDeFolio(c.folio),
      canceladas=related.filter(function(x){return esCancelada(x.content);}).length,
      despachadas=related.filter(function(x){return Number(x.content.estatus)===EST.DESPACHADA;}).length,
      activas=related.filter(function(x){return !esCancelada(x.content);});
  var terminada=related.length>0&&despachadas+canceladas===related.length;
  var estatus;
  if(terminada)estatus=canceladas===related.length?'Cancelada':(canceladas?'Completada con canceladas':'Completada');
  else estatus=activas.length&&activas.every(function(x){return Number(x.content.estatus)>=1;})?'En proceso':'Pendiente';
  return {
    related:related,
    programadas:related.filter(function(x){return !!x.content.fechaHoraRelease;}).length,
    recibidas:related.filter(function(x){return !!x.content.fechaHoraLlegadaReal;}).length,
    despachadas:despachadas,
    canceladas:canceladas,
    terminada:terminada,
    estatus:estatus
  };
}
function renderAlta(){
  var q=$('buscarAlta').value.toLowerCase(),
      p=$('filtroPlantaAlta').value,
      body=$('altaTbody');
  body.innerHTML='';
  var rows=solicitudes.map(function(d){return {d:d,r:resumen(d.content)};}).filter(function(x){
    var c=x.d.content;
    return !x.r.terminada&&(!p||c.planta===p)&&(!q||(String(c.folio).indexOf(q)>=0||(c.solicitante||'').toLowerCase().indexOf(q)>=0));
  }).sort(function(a,b){return Number(b.d.content.folio)-Number(a.d.content.folio);});
  if(!rows.length){empty(body,14,'No hay solicitudes pendientes de terminar.');return;}
  rows.forEach(function(x){
    var c=x.d.content,r=x.r,tr=document.createElement('tr');
    add(tr,folio(c.folio));
    addTipo(tr,tipoDeSolicitud(c));
    [c.solicitante,c.planta,c.destino,c.cantidadCajas,fmtDate(c.fechaRequerida),fmtDateTime(c.fechaHoraInsert),
     r.programadas,r.recibidas,r.despachadas,r.canceladas,r.estatus].forEach(function(v){add(tr,v);});
    var td=document.createElement('td');
    td.appendChild(btnCancelar('Cancelar',function(){cancelarSolicitud(x.d);}));
    tr.appendChild(td);
    body.appendChild(tr);
  });
}

// ---------- Logística ----------
function renderLogistica(){
  var q=$('buscarLogistica').value.toLowerCase(),
      p=$('filtroPlantaLogistica').value,
      body=$('logisticaTbody');
  body.innerHTML='';
  var rows=cajas.filter(function(d){
    var c=d.content,s=solByFolio(c.folioSolicitud);
    return Number(c.estatus)===EST.PENDIENTE&&
          (!p||s.planta===p)&&
          (!q||(String(c.folioSolicitud).indexOf(q)>=0||(s.solicitante||'').toLowerCase().indexOf(q)>=0||(c.numeroCaja||'').toLowerCase().indexOf(q)>=0));
  }).sort(byFolioSeq);
  if(!rows.length){empty(body,11,'No hay cajas pendientes de asignación.');return;}
  rows.forEach(function(d){
    var c=d.content,s=solByFolio(c.folioSolicitud),tr=document.createElement('tr');
    add(tr,folio(c.folioSolicitud));
    addTipo(tr,c.tipoSolicitud||tipoDeSolicitud(s));
    add(tr,'Caja '+c.numeroSecuencia);
    add(tr,s.solicitante);
    add(tr,s.planta);
    add(tr,s.destino);
    add(tr,fmtDate(s.fechaRequerida));
    var numTd=document.createElement('td'),num=document.createElement('input');
    num.type='text';num.placeholder='Número de caja';num.value=c.numeroCaja||'';
    numTd.appendChild(num);tr.appendChild(numTd);
    var dateTd=document.createElement('td'),date=document.createElement('input');
    date.type='datetime-local';date.value=toLocalInput(c.fechaHoraProgramada);
    dateTd.appendChild(date);tr.appendChild(dateTd);
    add(tr,boxStatus(c));
    var action=document.createElement('td');
    action.appendChild(btn('Asignar',function(){
      if(!requireUser())return;
      if(!num.value.trim()||!date.value){
        showError('Captura número de caja y fecha/hora programada.');
        return;
      }
      updateBox(d,{
        numeroCaja:num.value.trim(),
        fechaHoraProgramada:new Date(date.value).toISOString(),
        fechaHoraRelease:new Date().toISOString(),
        estatus:EST.PROGRAMADA,
        usuarioLogisticaId:CURRENT_USER.id,
        usuarioLogistica:CURRENT_USER.label
      });
    }));
    action.appendChild(btnCancelar('Cancelar',function(){cancelarCaja(d,'Logística');}));
    tr.appendChild(action);
    body.appendChild(tr);
  });
}

// ---------- Almacén ----------
function renderAlmacen(){
  var q=$('buscarAlmacen').value.toLowerCase(),p=$('filtroPlantaAlmacen').value,body=$('almacenTbody');
  body.innerHTML='';
  var rows=cajas.filter(function(d){
    var c=d.content,s=solByFolio(c.folioSolicitud),e=Number(c.estatus);
    return e>=1&&e<EST.DESPACHADA&&(!p||s.planta===p)&&(!q||(String(c.folioSolicitud).indexOf(q)>=0||(s.solicitante||'').toLowerCase().indexOf(q)>=0||(c.numeroCaja||'').toLowerCase().indexOf(q)>=0));
  }).sort(byFolioSeq);
  if(!rows.length){empty(body,13,'No hay cajas pendientes de recepción o salida.');return;}
  rows.forEach(function(d){
    var c=d.content,s=solByFolio(c.folioSolicitud),tr=document.createElement('tr');
    add(tr,folio(c.folioSolicitud));
    addTipo(tr,c.tipoSolicitud||tipoDeSolicitud(s));
    add(tr,c.numeroCaja);
    add(tr,s.solicitante);
    add(tr,s.planta);
    add(tr,s.destino);
    add(tr,fmtDateTime(c.fechaHoraProgramada));
    add(tr,c.usuarioLogistica);
    add(tr,fmtDateTime(c.fechaHoraLlegadaReal));
    add(tr,c.usuarioAlmacenLlegada);
    add(tr,c.fechaHoraLlegadaReal?duration(Date.now()-new Date(c.fechaHoraLlegadaReal).getTime()):'');
    addCosto(tr,c.fechaHoraLlegadaReal?calcCostoExtra(c.fechaHoraLlegadaReal).costo:null);
    var td=document.createElement('td'),e=Number(c.estatus);
    if(e===1||e===EST.PROGRAMADA)
      td.appendChild(btnVerde('Confirmar llegada',function(){
        if(!requireUser())return;
        updateBox(d,{
          fechaHoraLlegadaReal:new Date().toISOString(),
          estatus:EST.EN_ALMACEN,
          usuarioAlmacenLlegadaId:CURRENT_USER.id,
          usuarioAlmacenLlegada:CURRENT_USER.label
        });
      }));
    else if(e===EST.EN_ALMACEN)
      td.appendChild(btnRojo('Confirmar salida',function(){
        if(!requireUser())return;
        var salida=new Date().toISOString(),extra=calcCostoExtra(c.fechaHoraLlegadaReal,salida);
        updateBox(d,{
          fechaHoraSalida:salida,
          estatus:EST.DESPACHADA,
          usuarioAlmacenSalidaId:CURRENT_USER.id,
          usuarioAlmacenSalida:CURRENT_USER.label,
          horasExtra:extra.horas,
          costoExtra:extra.costo
        });
      }));
    td.appendChild(btnCancelar('Cancelar',function(){cancelarCaja(d,'Almacén');}));
    tr.appendChild(td);body.appendChild(tr);
  });
}

// ---------- Semáforo ----------
function renderSemaforo(){
  var q=$('buscarSemaforo').value.toLowerCase(),p=$('filtroPlantaSemaforo').value,body=$('semaforoTbody');
  body.innerHTML='';var now=Date.now();
  var rows=cajas.filter(function(d){
    var c=d.content,s=solByFolio(c.folioSolicitud);
    return Number(c.estatus)===EST.EN_ALMACEN&&!!c.fechaHoraLlegadaReal&&!c.fechaHoraSalida&&(!p||s.planta===p)&&(!q||(String(c.folioSolicitud).indexOf(q)>=0||(s.solicitante||'').toLowerCase().indexOf(q)>=0||(c.numeroCaja||'').toLowerCase().indexOf(q)>=0));
  }).sort(function(a,b){return new Date(a.content.fechaHoraLlegadaReal)-new Date(b.content.fechaHoraLlegadaReal);});
  var counts={green:0,yellow:0,red:0},total=0;
  rows.forEach(function(d){
    counts[agingLevel((now-new Date(d.content.fechaHoraLlegadaReal).getTime())/60000)]++;
    total+=calcCostoExtra(d.content.fechaHoraLlegadaReal,now).costo;
  });
  $('countVerde').textContent=counts.green;$('countAmarillo').textContent=counts.yellow;$('countRojo').textContent=counts.red;
  $('costoExtraTotal').textContent=fmtUSD(total);
  if(!rows.length){empty(body,11,'No hay cajas recibidas pendientes de despacho.');return;}
  rows.forEach(function(d){
    var c=d.content,s=solByFolio(c.folioSolicitud),
        ms=now-new Date(c.fechaHoraLlegadaReal).getTime(),
        tr=document.createElement('tr');
    addDot(tr,agingLevel(ms/60000));
    add(tr,folio(c.folioSolicitud));
    addTipo(tr,c.tipoSolicitud||tipoDeSolicitud(s));
    add(tr,c.numeroCaja);
    add(tr,s.solicitante);
    add(tr,s.planta);
    add(tr,s.destino);
    add(tr,fmtDateTime(c.fechaHoraLlegadaReal));
    add(tr,c.usuarioAlmacenLlegada);
    add(tr,duration(ms));
    addCosto(tr,calcCostoExtra(c.fechaHoraLlegadaReal,now).costo);
    body.appendChild(tr);
  });
}

// ---------- Histórico ----------
// Nombres únicos de un campo de usuario entre las cajas de un folio.
function usuariosUnicos(related,field,extra,sep){
  var seen={},out=[];
  (extra?[extra]:[]).concat(related.map(function(x){return x.content[field];})).forEach(function(v){if(v&&!seen[v]){seen[v]=true;out.push(v);}});
  return out.join(sep||', ');
}
function sumaCosto(related){return related.reduce(function(a,x){return a+(Number(x.content.costoExtra)||0);},0);}
function renderHistorico(){
  var body=$('historicoTbody');if(!body)return;body.innerHTML='';
  var desde=$('fechaDesdeHistorico').value,hasta=$('fechaHastaHistorico').value,p=$('filtroPlantaHistorico').value,
      tipoF=$('filtroTipoHistorico').value,estF=$('filtroEstatusHistorico').value,q=$('buscarHistorico').value.toLowerCase();
  var rows=solicitudes.map(function(d){
    var c=d.content,r=resumen(c),rel=r.related;
    return {
      d:d,r:r,tipo:tipoDeSolicitud(c),
      usuarioAlta:c.usuarioAlta||c.solicitante||'',
      usuarioLogistica:usuariosUnicos(rel,'usuarioLogistica'),
      usuarioLlegada:usuariosUnicos(rel,'usuarioAlmacenLlegada'),
      usuarioSalida:usuariosUnicos(rel,'usuarioAlmacenSalida'),
      usuarioCancelacion:usuariosUnicos(rel,'usuarioCancelacion',c.usuarioCancelacion),
      motivoCancelacion:usuariosUnicos(rel,'comentarioCancelacion',c.comentarioCancelacion,' | ')
    };
  }).filter(function(x){
    var c=x.d.content;
    if(!x.r.terminada)return false;
    var fecha=localDateKey(c.fechaHoraInsert);
    if(desde&&fecha<desde)return false;
    if(hasta&&fecha>hasta)return false;
    if(p&&c.planta!==p)return false;
    if(tipoF&&x.tipo!==tipoF)return false;
    if(estF&&x.r.estatus!==estF)return false;
    if(q){
      var texto=[String(c.folio),c.solicitante,x.usuarioAlta,x.usuarioLogistica,x.usuarioLlegada,x.usuarioSalida,x.usuarioCancelacion,x.motivoCancelacion].join(' ').toLowerCase();
      if(texto.indexOf(q)<0)return false;
    }
    return true;
  }).sort(function(a,b){return Number(b.d.content.folio)-Number(a.d.content.folio);});
  if(!rows.length){empty(body,22,'No hay solicitudes procesadas para los filtros seleccionados.');return;}
  rows.forEach(function(x){
    var c=x.d.content,r=x.r;
    var tiempos=r.related.map(function(y){
      var b=y.content;
      if(!b.fechaHoraLlegadaReal||!b.fechaHoraSalida)return null;
      var ms=new Date(b.fechaHoraSalida).getTime()-new Date(b.fechaHoraLlegadaReal).getTime();
      return isFinite(ms)&&ms>=0?ms/3600000:null;
    }).filter(function(v){return v!==null;});
    var promedioMin=tiempos.length?(tiempos.reduce(function(a,b){return a+b;},0)/tiempos.length)*60:null;
    var promedio=promedioMin!==null?(promedioMin/60).toFixed(2)+' h':'Sin dato';
    var tr=document.createElement('tr');
    add(tr,folio(c.folio));
    addTipo(tr,x.tipo);
    [c.solicitante,c.planta,c.destino,c.cantidadCajas,fmtDate(c.fechaRequerida),fmtDateTime(c.fechaHoraInsert),
     r.programadas,r.recibidas,r.despachadas,r.canceladas].forEach(function(v){add(tr,v);});
    addEstatus(tr,r.estatus);
    [x.usuarioAlta,x.usuarioLogistica,x.usuarioLlegada,x.usuarioSalida,x.usuarioCancelacion].forEach(function(v){add(tr,v);});
    var mtd=document.createElement('td');mtd.className='comentario';mtd.textContent=x.motivoCancelacion;tr.appendChild(mtd);
    addCosto(tr,sumaCosto(r.related));
    add(tr,promedio);
    addDot(tr,promedioMin===null?'gray':agingLevel(promedioMin));
    body.appendChild(tr);
  });
}

// ---------- Canceladas ----------
function renderCanceladas(){
  var body=$('canceladasTbody');body.innerHTML='';
  var desde=$('fechaDesdeCanceladas').value,hasta=$('fechaHastaCanceladas').value,p=$('filtroPlantaCanceladas').value,q=$('buscarCanceladas').value.toLowerCase();
  var rows=cajas.filter(function(d){
    var c=d.content,s=solByFolio(c.folioSolicitud);
    if(!esCancelada(c))return false;
    var fecha=localDateKey(c.fechaHoraCancelacion);
    if(desde&&fecha<desde)return false;
    if(hasta&&fecha>hasta)return false;
    if(p&&s.planta!==p)return false;
    if(q){
      var texto=[String(c.folioSolicitud),c.numeroCaja,s.solicitante,c.usuarioCancelacion,c.comentarioCancelacion].join(' ').toLowerCase();
      if(texto.indexOf(q)<0)return false;
    }
    return true;
  }).sort(function(a,b){return new Date(b.content.fechaHoraCancelacion)-new Date(a.content.fechaHoraCancelacion);});
  if(!rows.length){empty(body,12,'No hay cajas canceladas para los filtros seleccionados.');return;}
  rows.forEach(function(d){
    var c=d.content,s=solByFolio(c.folioSolicitud),tr=document.createElement('tr');
    add(tr,folio(c.folioSolicitud));
    addTipo(tr,c.tipoSolicitud||tipoDeSolicitud(s));
    add(tr,'Caja '+c.numeroSecuencia);
    add(tr,c.numeroCaja);
    add(tr,s.solicitante);
    add(tr,s.planta);
    add(tr,s.destino);
    add(tr,c.etapaCancelacion);
    add(tr,fmtDateTime(c.fechaHoraCancelacion));
    add(tr,c.usuarioCancelacion);
    var td=document.createElement('td');td.className='comentario';td.textContent=c.comentarioCancelacion||'';tr.appendChild(td);
    addCosto(tr,Number(c.costoExtra)||0);
    body.appendChild(tr);
  });
}

// ---------- Cancelación ----------
function abrirModal(titulo,texto,onConfirm){
  $('cancelModalTitle').textContent=titulo;
  $('cancelModalText').textContent=texto;
  $('cancelComentario').value='';
  $('cancelModal').style.display='';
  $('cancelComentario').focus();
  $('cancelModalConfirmar').onclick=function(){
    var comentario=$('cancelComentario').value.trim();
    if(!comentario){$('cancelComentario').focus();$('cancelModalText').textContent='Escribe el motivo de la cancelación para continuar.';return;}
    cerrarModal();
    onConfirm(comentario);
  };
}
function cerrarModal(){$('cancelModal').style.display='none';}
// Campos de cancelación de una caja. Si ya había llegado a almacén, se guarda
// también el costo extra generado hasta el momento de la cancelación.
function cambiosCancelacion(c,etapa,comentario,ahora){
  var cambios={
    estatus:EST.CANCELADA,
    fechaHoraCancelacion:ahora,
    etapaCancelacion:etapa,
    usuarioCancelacionId:CURRENT_USER.id,
    usuarioCancelacion:CURRENT_USER.label,
    comentarioCancelacion:comentario
  };
  if(c.fechaHoraLlegadaReal){
    var extra=calcCostoExtra(c.fechaHoraLlegadaReal,ahora);
    cambios.horasExtra=extra.horas;cambios.costoExtra=extra.costo;
  }
  return cambios;
}
function cancelarCaja(d,etapa){
  if(!requireUser())return;
  var c=d.content;
  abrirModal('Cancelar caja','Folio '+folio(c.folioSolicitud)+' — Caja '+c.numeroSecuencia+(c.numeroCaja?' ('+c.numeroCaja+')':'')+'. Se registrará tu usuario como quien cancela.',function(comentario){
    updateBox(d,cambiosCancelacion(c,etapa,comentario,new Date().toISOString()),'Caja cancelada.');
  });
}
function cancelarSolicitud(solDoc){
  if(!requireUser())return;
  var s=solDoc.content,
      pendientes=cajasDeFolio(s.folio).filter(function(x){var e=Number(x.content.estatus);return e!==EST.DESPACHADA&&e!==EST.CANCELADA;});
  if(!pendientes.length){showError('La solicitud no tiene cajas pendientes por cancelar.');return;}
  abrirModal('Cancelar solicitud','Folio '+folio(s.folio)+': se cancelarán '+pendientes.length+' caja(s) que aún no han salido. Se registrará tu usuario como quien cancela.',function(comentario){
    var ahora=new Date().toISOString();
    setBusy(true);clearStatus();
    var chain=domo.put(SOL_URL+'/'+solDoc.id,{content:Object.assign({},s,{
      fechaHoraCancelacion:ahora,
      usuarioCancelacionId:CURRENT_USER.id,
      usuarioCancelacion:CURRENT_USER.label,
      comentarioCancelacion:comentario
    })});
    pendientes.forEach(function(x){
      chain=chain.then(function(){
        return domo.put(BOX_URL+'/'+x.id,{content:Object.assign({},x.content,cambiosCancelacion(x.content,'Alta',comentario,ahora))});
      });
    });
    chain.then(function(){showOk('Solicitud '+folio(s.folio)+' cancelada ('+pendientes.length+' caja(s)).');return cargarDatos();})
      .catch(function(e){showError('No se pudo cancelar toda la solicitud: '+errText(e)+'. Revisa la pestaña Canceladas.');return cargarDatos();})
      .then(function(){setBusy(false);});
  });
}

// ---------- Utilidades ----------
function agingLevel(minutes){return minutes<AMARILLO_MIN?'green':minutes<ROJO_MIN?'yellow':'red';}
function addDot(tr,level){var td=document.createElement('td');td.className='aging-cell';var dot=document.createElement('span');dot.className='semaforo-dot semaforo-'+(level||'gray');dot.title=level==='green'?'Verde: menos de 2 horas':level==='yellow'?'Amarillo: de 2 a menos de 3 horas':level==='red'?'Rojo: 3 horas o más':'Sin dato';dot.setAttribute('aria-label',dot.title);td.appendChild(dot);tr.appendChild(td);}
function addTipo(tr,tipo){var td=document.createElement('td');if(tipo){var s=document.createElement('span');s.className='pill '+(tipo==='Extraordinaria'?'badge-extra':'badge-ord');s.textContent=tipo;td.appendChild(s);}tr.appendChild(td);}
function addEstatus(tr,estatus){var td=document.createElement('td');var s=document.createElement('span');s.className='pill'+(estatus==='Cancelada'?' badge-cancel':'');s.textContent=estatus;td.appendChild(s);tr.appendChild(td);}
function addCosto(tr,costo){var td=document.createElement('td');td.className='numeric';if(costo!==null&&costo!==undefined){td.textContent=fmtUSD(costo);if(costo>0)td.classList.add('costo-extra');}tr.appendChild(td);}
function fmtUSD(n){return '$'+Number(n||0).toLocaleString('en-US')+' USD';}
function localDateKey(value){if(!value)return '';var d=new Date(value);if(isNaN(d))return '';var y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return y+'-'+m+'-'+day;}
function updateBox(doc,changes,okMsg){var content=Object.assign({},doc.content,changes);setBusy(true);clearStatus();domo.put(BOX_URL+'/'+doc.id,{content:content}).then(function(){if(okMsg)showOk(okMsg);return cargarDatos();}).catch(function(e){showError('No se pudo actualizar la caja: '+errText(e));}).then(function(){setBusy(false);});}
function byFolioSeq(a,b){var x=a.content,y=b.content;return Number(x.folioSolicitud)-Number(y.folioSolicitud)||Number(x.numeroSecuencia)-Number(y.numeroSecuencia);}
function add(tr,value){var td=document.createElement('td');td.textContent=value===undefined||value===null?'':String(value);tr.appendChild(td);}
function empty(body,span,message){var tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=span;td.className='empty-cell';td.textContent=message;tr.appendChild(td);body.appendChild(tr);}
function btn(label,fn){var b=document.createElement('button');b.className='small';b.textContent=label;b.onclick=fn;return b;}
function btnVerde(label,fn){var b=document.createElement('button');b.className='small-Verde';b.textContent=label;b.onclick=fn;return b;}
function btnRojo(label,fn){var b=document.createElement('button');b.className='small-Rojo';b.textContent=label;b.onclick=fn;return b;}
function btnCancelar(label,fn){var b=document.createElement('button');b.className='small-Gris';b.textContent=label;b.onclick=fn;return b;}
function folio(n){return String(n||'').padStart(4,'0');}
function fmtDate(v){if(!v)return '';var d=new Date(v+'T00:00:00');return isNaN(d)?v:d.toLocaleDateString('es-MX');}
function fmtDateTime(v){if(!v)return '';var d=new Date(v);return isNaN(d)?'':d.toLocaleString('es-MX');}
function toLocalInput(v){if(!v)return '';var d=new Date(v);if(isNaN(d))return '';var z=new Date(d.getTime()-d.getTimezoneOffset()*60000);return z.toISOString().slice(0,16);}
function duration(ms){if(!isFinite(ms)||ms<0)ms=0;var sec=Math.floor(ms/1000),h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return(h?h+'h ':'')+(m?m+'m ':'')+s+'s';}
function setBusy(v){loading.style.display=v?'block':'none';$('btnCrear').disabled=v;}
function showError(s){statusMsg.style.color='#c0392b';statusMsg.textContent=s;}
function showOk(s){statusMsg.style.color='#1e8449';statusMsg.textContent=s;}
function clearStatus(){statusMsg.textContent='';}
function errText(e){return e&&(e.message||JSON.stringify(e))||'Error desconocido';}
init();
})();
