(function(){
'use strict';
var domo=window.domo;
// Colecciones nuevas de este proyecto (incluyen los campos de usuario).
var SOL_COLLECTION='solicitudes_cajas_v3';
var BOX_COLLECTION='detalle_cajas_v3';
var SOL_URL='/domo/datastores/v1/collections/'+SOL_COLLECTION+'/documents';
var BOX_URL='/domo/datastores/v1/collections/'+BOX_COLLECTION+'/documents';
var REFRESH_MS=300000, AMARILLO_MIN=120, ROJO_MIN=180;

var solicitudes=[], cajas=[];
var CURRENT_USER={id:null,label:'Usuario desconocido'};
var statusMsg=document.getElementById('statusMsg'),loading=document.getElementById('loading');
var $=function(id){return document.getElementById(id);};

function init(){
  $('tabBtnAlta').onclick=function(){switchTab('Alta');};
  $('tabBtnLogistica').onclick=function(){switchTab('Logistica');};
  $('tabBtnAlmacen').onclick=function(){switchTab('Almacen');};
  $('tabBtnSemaforo').onclick=function(){switchTab('Semaforo');};
  $('tabBtnHistorico').onclick=function(){switchTab('Historico');};
  $('btnCrear').onclick=crearSolicitud;
  ['btnRefrescarAlta','btnRefrescarLogistica','btnRefrescarAlmacen','btnRefrescarSemaforo','btnRefrescarHistorico'].forEach(function(id){$(id).onclick=cargarDatos;});
  ['buscarAlta','filtroPlantaAlta'].forEach(function(id){$(id).addEventListener('input',renderAlta);});
  ['buscarLogistica','filtroPlantaLogistica'].forEach(function(id){$(id).addEventListener('input',renderLogistica);});
  ['buscarAlmacen','filtroPlantaAlmacen'].forEach(function(id){$(id).addEventListener('input',renderAlmacen);});
  ['buscarSemaforo','filtroPlantaSemaforo'].forEach(function(id){$(id).addEventListener('input',renderSemaforo);});
  ['fechaDesdeHistorico','fechaHastaHistorico','filtroPlantaHistorico','buscarHistorico'].forEach(function(id){$(id).addEventListener('input',renderHistorico);});
  ensureCollections()
    .then(cargarUsuarioActual)
    .then(cargarDatos)
    .catch(function(e){showError('Error al inicializar: '+errText(e));});
  setInterval(cargarDatos,REFRESH_MS);
}
function switchTab(tab){
  ['Alta','Logistica','Almacen','Semaforo','Historico'].forEach(function(t){
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

function ensureOneCollection(name,schema){
  return domo.post('/domo/datastores/v1/collections',
  {name:name,schema:{columns:schema}}).catch(function(){return null;});}
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
    {name:'usuarioAlta',type:'STRING'}]),
  ensureOneCollection(BOX_COLLECTION,[
    {name:'folioSolicitud',type:'LONG'},
    {name:'numeroSecuencia',type:'LONG'},
    {name:'numeroCaja',type:'STRING'},
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
    {name:'usuarioAlmacenSalida',type:'STRING'}])
]);}
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
  var folio=nextFolio(),now=new Date().toISOString();
  var solicitud={
    folio:folio,
    solicitante:solicitante,
    cantidadCajas:cantidad,
    fechaRequerida:fecha,
    planta:planta,
    fechaHoraInsert:now,
    destino:destino,
    usuarioAltaId:CURRENT_USER.id,
    usuarioAlta:CURRENT_USER.label
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
            fechaHoraProgramada:'',
            fechaHoraRelease:'',
            fechaHoraLlegadaReal:'',
            fechaHoraSalida:'',
            estatus:0,
            usuarioLogisticaId:'',
            usuarioLogistica:'',
            usuarioAlmacenLlegadaId:'',
            usuarioAlmacenLlegada:'',
            usuarioAlmacenSalidaId:'',
            usuarioAlmacenSalida:''
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
    showOk('Solicitud '+folio+' registrada por '+solicitante+' con '+cantidad+' caja(s).');
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
  return ['Pendiente de asignación','Pendiente de llegada en Almacén','Pendiente de llegada en Almacén','En almacén / En carga','Despachada'][Number(c.estatus)]||'Desconocido';
}
function renderAlta(){
  var q=$('buscarAlta').value.toLowerCase(),
      p=$('filtroPlantaAlta').value,
      body=$('altaTbody');
  body.innerHTML='';
  var rows=solicitudes.filter(function(d){
    var c=d.content,related=cajasDeFolio(c.folio);
    var despachadas=related.filter(function(x){return Number(x.content.estatus)===4;}).length;
    var terminada=related.length>0&&despachadas===related.length;
    return !terminada&&(!p||c.planta===p)&&(!q||(String(c.folio).indexOf(q)>=0||(c.solicitante||'').toLowerCase().indexOf(q)>=0));
  }).sort(function(a,b){return Number(b.content.folio)-Number(a.content.folio);});
  if(!rows.length){empty(body,11,'No hay solicitudes pendientes de terminar.');return;}
  rows.forEach(function(d){
    var c=d.content,
        related=cajasDeFolio(c.folio),
        programadas=related.filter(function(x){return Number(x.content.estatus)>=1;}).length,
        recibidas=related.filter(function(x){return Number(x.content.estatus)>=3;}).length,
        despachadas=related.filter(function(x){return Number(x.content.estatus)===4;}).length;
    var estados=related.length>0&&despachadas===related.length?'Completada':(
      related.length&&related.every(function(x){return Number(x.content.estatus)>=1;})?'En proceso':'Pendiente');
    body.appendChild(row([
      folio(c.folio),c.solicitante,c.planta,c.destino,c.cantidadCajas,
      fmtDate(c.fechaRequerida),fmtDateTime(c.fechaHoraInsert),
      programadas,recibidas,despachadas,estados
    ]));
  });
}
function renderLogistica(){
  var q=$('buscarLogistica').value.toLowerCase(),
      p=$('filtroPlantaLogistica').value,
      body=$('logisticaTbody');
  body.innerHTML='';
  var rows=cajas.filter(function(d){
    var c=d.content,s=solByFolio(c.folioSolicitud);
    return Number(c.estatus)===0&&
          (!p||s.planta===p)&&
          (!q||(String(c.folioSolicitud).indexOf(q)>=0||(s.solicitante||'').toLowerCase().indexOf(q)>=0||(c.numeroCaja||'').toLowerCase().indexOf(q)>=0));
  }).sort(byFolioSeq);
  if(!rows.length){empty(body,10,'No hay cajas pendientes de asignación.');return;}
  rows.forEach(function(d){
    var c=d.content,s=solByFolio(c.folioSolicitud),tr=document.createElement('tr');
    add(tr,folio(c.folioSolicitud));
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
    if(Number(c.estatus)===0){
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
          estatus:2,
          usuarioLogisticaId:CURRENT_USER.id,
          usuarioLogistica:CURRENT_USER.label
        });
      }));
    }
    tr.appendChild(action);
    body.appendChild(tr);
  });
}
function renderAlmacen(){
  var q=$('buscarAlmacen').value.toLowerCase(),p=$('filtroPlantaAlmacen').value,body=$('almacenTbody');
  body.innerHTML='';
  var rows=cajas.filter(function(d){
    var c=d.content,s=solByFolio(c.folioSolicitud);
    return Number(c.estatus)>=1&&Number(c.estatus)<4&&(!p||s.planta===p)&&(!q||(String(c.folioSolicitud).indexOf(q)>=0||(s.solicitante||'').toLowerCase().indexOf(q)>=0||(c.numeroCaja||'').toLowerCase().indexOf(q)>=0));
  }).sort(byFolioSeq);
  if(!rows.length){empty(body,12,'No hay cajas pendientes de recepción o salida.');return;}
  rows.forEach(function(d){
    var c=d.content,s=solByFolio(c.folioSolicitud),tr=document.createElement('tr');
    add(tr,folio(c.folioSolicitud));
    add(tr,c.numeroCaja);
    add(tr,s.solicitante);
    add(tr,s.planta);
    add(tr,s.destino);
    add(tr,fmtDateTime(c.fechaHoraProgramada));
    add(tr,c.usuarioLogistica);
    add(tr,fmtDateTime(c.fechaHoraLlegadaReal));
    add(tr,c.usuarioAlmacenLlegada);
    add(tr,fmtDateTime(c.fechaHoraSalida));
    add(tr,c.fechaHoraLlegadaReal?duration(Date.now()-new Date(c.fechaHoraLlegadaReal).getTime()):'');
    var td=document.createElement('td');
    if(Number(c.estatus)===1||Number(c.estatus)===2)
      td.appendChild(btnVerde('Confirmar llegada',function(){
        if(!requireUser())return;
        updateBox(d,{
          fechaHoraLlegadaReal:new Date().toISOString(),
          estatus:3,
          usuarioAlmacenLlegadaId:CURRENT_USER.id,
          usuarioAlmacenLlegada:CURRENT_USER.label
        });
      }));
    else if(Number(c.estatus)===3)
      td.appendChild(btnRojo('Confirmar salida',function(){
        if(!requireUser())return;
        updateBox(d,{
          fechaHoraSalida:new Date().toISOString(),
          estatus:4,
          usuarioAlmacenSalidaId:CURRENT_USER.id,
          usuarioAlmacenSalida:CURRENT_USER.label
        });
      }));
    tr.appendChild(td);body.appendChild(tr);
  });
}
function renderSemaforo(){
  var q=$('buscarSemaforo').value.toLowerCase(),p=$('filtroPlantaSemaforo').value,body=$('semaforoTbody');
  body.innerHTML='';var now=Date.now();
  var rows=cajas.filter(function(d){
    var c=d.content,s=solByFolio(c.folioSolicitud);
    return Number(c.estatus)===3&&!!c.fechaHoraLlegadaReal&&!c.fechaHoraSalida&&(!p||s.planta===p)&&(!q||(String(c.folioSolicitud).indexOf(q)>=0||(s.solicitante||'').toLowerCase().indexOf(q)>=0||(c.numeroCaja||'').toLowerCase().indexOf(q)>=0));
  }).sort(function(a,b){return new Date(a.content.fechaHoraLlegadaReal)-new Date(b.content.fechaHoraLlegadaReal);});
  var counts={green:0,yellow:0,red:0};
  rows.forEach(function(d){counts[agingLevel((now-new Date(d.content.fechaHoraLlegadaReal).getTime())/60000)]++;});
  $('countVerde').textContent=counts.green;$('countAmarillo').textContent=counts.yellow;$('countRojo').textContent=counts.red;
  if(!rows.length){empty(body,9,'No hay cajas recibidas pendientes de despacho.');return;}
  rows.forEach(function(d){
    var c=d.content,s=solByFolio(c.folioSolicitud),
        ms=now-new Date(c.fechaHoraLlegadaReal).getTime(),
        tr=document.createElement('tr');
    addDot(tr,agingLevel(ms/60000));
    add(tr,folio(c.folioSolicitud));
    add(tr,c.numeroCaja);
    add(tr,s.solicitante);
    add(tr,s.planta);
    add(tr,s.destino);
    add(tr,fmtDateTime(c.fechaHoraLlegadaReal));
    add(tr,c.usuarioAlmacenLlegada);
    add(tr,duration(ms));
    body.appendChild(tr);
  });
}
// Nombres únicos de un campo de usuario entre las cajas de un folio.
function usuariosUnicos(related,field){
  var seen={},out=[];
  related.forEach(function(x){var v=x.content[field];if(v&&!seen[v]){seen[v]=true;out.push(v);}});
  return out.join(', ');
}
function renderHistorico(){
  var body=$('historicoTbody');if(!body)return;body.innerHTML='';
  var desde=$('fechaDesdeHistorico').value,hasta=$('fechaHastaHistorico').value,p=$('filtroPlantaHistorico').value,q=$('buscarHistorico').value.toLowerCase();
  var rows=solicitudes.map(function(d){
    var c=d.content,related=cajasDeFolio(c.folio);
    return {
      d:d,related:related,
      usuarioAlta:c.usuarioAlta||c.solicitante||'',
      usuarioLogistica:usuariosUnicos(related,'usuarioLogistica'),
      usuarioLlegada:usuariosUnicos(related,'usuarioAlmacenLlegada'),
      usuarioSalida:usuariosUnicos(related,'usuarioAlmacenSalida')
    };
  }).filter(function(r){
    var c=r.d.content;
    if(!r.related.length)return false;
    if(!r.related.every(function(x){return Number(x.content.estatus)===4;}))return false;
    var fecha=localDateKey(c.fechaHoraInsert);
    if(desde&&fecha<desde)return false;
    if(hasta&&fecha>hasta)return false;
    if(p&&c.planta!==p)return false;
    if(q){
      var texto=[String(c.folio),c.solicitante,r.usuarioAlta,r.usuarioLogistica,r.usuarioLlegada,r.usuarioSalida].join(' ').toLowerCase();
      if(texto.indexOf(q)<0)return false;
    }
    return true;
  }).sort(function(a,b){return Number(b.d.content.folio)-Number(a.d.content.folio);});
  if(!rows.length){empty(body,17,'No hay solicitudes procesadas para los filtros seleccionados.');return;}
  rows.forEach(function(r){
    var c=r.d.content,related=r.related,
        programadas=related.filter(function(x){return Number(x.content.estatus)>=1;}).length,
        recibidas=related.filter(function(x){return !!x.content.fechaHoraLlegadaReal;}).length,
        despachadas=related.filter(function(x){return Number(x.content.estatus)===4;}).length;
    var tiempos=related.map(function(x){
      var b=x.content,inicio=b.fechaHoraLlegadaReal,fin=b.fechaHoraSalida;
      if(!inicio||!fin)return null;
      var ms=new Date(fin).getTime()-new Date(inicio).getTime();
      return isFinite(ms)&&ms>=0?ms/3600000:null;
    }).filter(function(v){return v!==null;});
    var promedioMin=tiempos.length?(tiempos.reduce(function(a,b){return a+b;},0)/tiempos.length)*60:null;
    var promedio=promedioMin!==null?(promedioMin/60).toFixed(2)+' h':'Sin dato';
    var tr=row([
      folio(c.folio),c.solicitante,c.planta,c.destino,c.cantidadCajas,
      fmtDate(c.fechaRequerida),fmtDateTime(c.fechaHoraInsert),
      programadas,recibidas,despachadas,'Completada',
      r.usuarioAlta,r.usuarioLogistica,r.usuarioLlegada,r.usuarioSalida,
      promedio
    ]);
    addDot(tr,promedioMin===null?'gray':agingLevel(promedioMin));
    body.appendChild(tr);
  });
}
function agingLevel(minutes){return minutes<AMARILLO_MIN?'green':minutes<ROJO_MIN?'yellow':'red';}
function addDot(tr,level){var td=document.createElement('td');td.className='aging-cell';var dot=document.createElement('span');dot.className='semaforo-dot semaforo-'+(level||'gray');dot.title=level==='green'?'Verde: menos de 2 horas':level==='yellow'?'Amarillo: de 2 a menos de 3 horas':level==='red'?'Rojo: 3 horas o más':'Sin dato';dot.setAttribute('aria-label',dot.title);td.appendChild(dot);tr.appendChild(td);}
function localDateKey(value){if(!value)return '';var d=new Date(value);if(isNaN(d))return '';var y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return y+'-'+m+'-'+day;}
function updateBox(doc,changes){var content=Object.assign({},doc.content,changes);setBusy(true);clearStatus();domo.put(BOX_URL+'/'+doc.id,{content:content}).then(cargarDatos).catch(function(e){showError('No se pudo actualizar la caja: '+errText(e));}).then(function(){setBusy(false);});}
function byFolioSeq(a,b){var x=a.content,y=b.content;return Number(x.folioSolicitud)-Number(y.folioSolicitud)||Number(x.numeroSecuencia)-Number(y.numeroSecuencia);}
function row(values){var tr=document.createElement('tr');values.forEach(function(v){add(tr,v);});return tr;}
function add(tr,value){var td=document.createElement('td');td.textContent=value===undefined||value===null?'':String(value);tr.appendChild(td);}
function empty(body,span,message){var tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=span;td.className='empty-cell';td.textContent=message;tr.appendChild(td);body.appendChild(tr);}
function btn(label,fn){var b=document.createElement('button');b.className='small';b.textContent=label;b.onclick=fn;return b;}
function btnVerde(label,fn){var b=document.createElement('button');b.className='small-Verde';b.textContent=label;b.onclick=fn;return b;}
function btnRojo(label,fn){var b=document.createElement('button');b.className='small-Rojo';b.textContent=label;b.onclick=fn;return b;}
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
