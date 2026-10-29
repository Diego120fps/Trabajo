var domo = window.domo;
var datasets = window.datasets;

// dataset0 = localidades del almacén (Rack, Nivel, Posicion, Localidad, Color, Material)
// dataset1 = detalle del inventario por localidad
var DETAIL_FIELDS = {
    location: 'ILOC_LOCATION',
    item: 'ITEM_NUMBER',
    uom: 'ITEM_UOM_PRIMARY',
    family: 'ITEM_SRP2',
    oh: 'ILOC_QTY_ON_HAND'
};

// Detalle ya consultado por localidad, para no volver a pedirlo en cada clic
let detailCache = {};

domo.get(`/data/v1/${datasets[0]}`)
    .then(drawWarehouse);

initModal();

function drawWarehouse(data){

    // Ordenar por Rack, Nivel y Posicion
    data.sort((a,b)=>{

        if(a.Rack != b.Rack)
            return a.Rack.localeCompare(b.Rack);

        if(a.Nivel != b.Nivel)
            return a.Nivel.localeCompare(b.Nivel);

        return a.Posicion.localeCompare(b.Posicion);

    });

    let html="";

    let currentRack="";
    let currentLevel="";

    data.forEach(r=>{

        if(r.Rack != currentRack){

            if(currentRack!=""){
                html+="</div></div>";
            }

            html+=`
                <div class="rack">
                    <div class="rack-title">
                        Rack ${r.Rack}
                    </div>
            `;

            currentRack=r.Rack;
            currentLevel="";
        }

        if(r.Nivel != currentLevel){

            if(currentLevel!=""){
                html+="</div>";
            }

            html+=`
                <div class="level">
                    <div class="level-label">${r.Nivel}</div>
            `;

            currentLevel=r.Nivel;
        }

      // data-location guarda la localidad para saber cuál se consultó al dar clic
      html += `
<div class="cell"
     data-location="${escapeHtml(r.Localidad)}"
     style="background:${r.Color}"
     title="Localidad: ${escapeHtml(r.Localidad)}
Materiales: ${escapeHtml(r.Material)}">
</div>`;
    });

    html+="</div></div>";

    document.getElementById("warehouse").innerHTML=html;

}

// ---------- Clic en una localidad -> modal con el detalle ----------

// Un solo listener en el contenedor (delegación): funciona para todas las
// celdas aunque el HTML se repinte.
document.getElementById("warehouse").addEventListener("click", e=>{
    const cell = e.target.closest(".cell");
    if(!cell) return;
    showLocationDetail(cell.dataset.location);
});

function showLocationDetail(location){

    openModal(location);
    setModalBody(`<div class="modal-msg">Cargando...</div>`);

    if(detailCache[location]){
        renderDetail(detailCache[location]);
        return;
    }

    domo.get(buildDetailQuery(location))
        .then(rows=>{
            detailCache[location] = rows || [];
            renderDetail(detailCache[location]);
        })
        .catch(err=>{
            console.error("Error al cargar detalle de " + location, err);
            setModalBody(`<div class="modal-msg error">No se pudo cargar el detalle de la localidad.</div>`);
        });
}

function buildDetailQuery(location){
    const f = DETAIL_FIELDS;
    const filter = `${f.location}='${String(location).trim().replace(/'/g, "''")}'`;

    return `/data/v1/${datasets[1]}` +
        `?fields=${[f.item, f.uom, f.family, f.oh].join()}` +
        `&filter=${encodeURIComponent(filter)}` +
        `&orderby=${f.item}` +
        `&limit=10000`;
}

function renderDetail(rows){
    const f = DETAIL_FIELDS;

    if(rows.length == 0){
        setModalBody(`<div class="modal-msg">Sin inventario en esta localidad.</div>`);
        return;
    }

    // Si el mismo material viene en varias filas (ej. varios lotes), se suma el OH
    let byItem = {};
    rows.forEach(r=>{
        const key = r[f.item] + "||" + r[f.uom];
        if(!byItem[key]){
            byItem[key] = { item: r[f.item], uom: r[f.uom], family: r[f.family], oh: 0 };
        }
        byItem[key].oh += Number(r[f.oh]) || 0;
    });

    const items = Object.values(byItem);
    const totalOh = items.reduce((sum, x)=> sum + x.oh, 0);

    let html = `
        <table class="detail-table">
            <thead>
                <tr>
                    <th>Material</th>
                    <th>UM</th>
                    <th>Familia</th>
                    <th class="num">OH</th>
                </tr>
            </thead>
            <tbody>`;

    items.forEach(x=>{
        html += `
                <tr>
                    <td>${escapeHtml(x.item)}</td>
                    <td>${escapeHtml(x.uom)}</td>
                    <td>${escapeHtml(x.family)}</td>
                    <td class="num">${formatNumber(x.oh)}</td>
                </tr>`;
    });

    html += `
            </tbody>
            <tfoot>
                <tr>
                    <td colspan="3">Total (${items.length} materiales)</td>
                    <td class="num">${formatNumber(totalOh)}</td>
                </tr>
            </tfoot>
        </table>`;

    setModalBody(html);
}

// ---------- Modal ----------

function initModal(){
    const modal = document.getElementById("detailModal");

    document.getElementById("modalClose").addEventListener("click", closeModal);

    // Clic fuera de la caja (en el fondo oscuro) también cierra
    modal.addEventListener("click", e=>{
        if(e.target === modal) closeModal();
    });

    document.addEventListener("keydown", e=>{
        if(e.key === "Escape") closeModal();
    });
}

function openModal(location){
    document.getElementById("modalTitle").textContent = "Localidad: " + location;
    document.getElementById("detailModal").classList.add("open");
}

function closeModal(){
    document.getElementById("detailModal").classList.remove("open");
}

function setModalBody(html){
    document.getElementById("modalBody").innerHTML = html;
}

// ---------- Utilidades ----------

function formatNumber(value){
    return Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function escapeHtml(value){
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
