# Clear to Build (Magic ETL)

Reemplaza el cursor del stored procedure `dbo.SP_CTBPlan` (`@kind = 1`) con un
Dataflow de Magic ETL que corre dentro de Domo, sobre los datasets que ya
tienes sincronizados ahí. Como corre para **todos** los Business Unit /
Plant a la vez (no por `@bu` como el SP), el dataset de salida queda
siempre actualizado con el schedule del dataflow y no depende de un
parámetro en vivo.

## Cómo armarlo en Magic ETL

1. Crea un nuevo Dataflow (Magic ETL 2.0).
2. Agrega los 4 datasets como inputs (ya **no** se usa `Domo_BillOfMaterial`:
   `PlanCTB` ya viene explosionado a nivel componente):
   - `GDLRealTruck.data.Domo_Inventory`
   - `GDLRealTruck.data.opor`
   - `GDLRealTruck.data.Consumos`
   - `GDLRealTruck.data.PlanCTB`
3. Agrega un tile **SQL** (categoría Utility) y conéctale los 4 inputs.
   Dentro del tile, renombra cada input con el alias que usa `ctb.sql`:
   `Inventory`, `Opor`, `Consumos`, `Plan`.
4. Pega el contenido de [`ctb.sql`](./ctb.sql) en el tile.
5. Conecta la salida del tile a un tile **Output** y nómbralo, por ejemplo,
   `CTB_Result`.
6. Programa el Dataflow con el mismo schedule (o uno posterior) al de los 4
   datasets de entrada, para que siempre corra con datos frescos.

## Antes de correrlo, verifica

- **Nombres/tipos de columna**: `ctb.sql` usa los mismos nombres que
  `domo-brick-clear-to-build/app.js` (ver esa carpeta). Si tus datasets en
  Domo tienen otros nombres, ajústalos en el SQL.
- **Tipo de fecha**: si `Fecha` (PlanCTB) o `DATE_REQUESTED_HEADER` (OPOR) ya
  vienen como `DATE`, el `CAST(... AS DATE)` es redundante pero inofensivo;
  si vienen como texto en otro formato, puede que necesites `STR_TO_DATE` en
  vez de `CAST`.
- **`GROUP_CONCAT`**: es sintaxis MySQL (el tile SQL de Magic ETL es
  MySQL-flavor). Si tu instancia usa el motor Redshift-flavor, cambia a
  `LISTAGG(DISTINCT Modelo, ', ') WITHIN GROUP (ORDER BY Modelo)`.
- **Tamaño del `CROSS JOIN`**: `base` cruza cada BU distinto (tabla
  `bu_list`, viene de Inventario) contra cada fila de `demand`
  (Component × Fecha). Con pocos BUs (plantas) esto es manejable; si tienes
  decenas de miles de componentes × fechas × muchísimos BUs, vale la pena
  revisar el tamaño resultante antes de dejarlo en producción.
- **Demanda sin filtro de BU**: igual que el SP, el plan de producción NO se
  filtra por planta — la misma demanda total se descuenta del inventario de
  cada BU por separado. Si esto no es el comportamiento de negocio deseado
  (y solo era así en el SP por conveniencia), avisa para ajustar el join.
- **Columnas de Plan usadas**: `PARENT_ITEM` (FG), `CPWF_COMPONENT_2ND_ITEM_NUMBER`
  (componente), `CPWF_DATE_REQUESTED` (fecha), `CPWF_UNITS_ORDER_TRANSACTION_QTY`
  (demanda ya a nivel componente). Como `Plan` ya viene explosionado, `ctb.sql`
  ya no hace ningún join contra un BOM ni explota niveles — si en algún
  momento cambia y vuelve a venir a nivel FG (sin explosionar), habría que
  reintroducir ese join.

## Resultado

El dataset `CTB_Result` queda con una fila por `BU + Component + Fecha`:

| Columna | Significado |
|---|---|
| `BU` | Business Unit / Plant |
| `FG` | Modelos (finished goods) que generan demanda de ese componente en esa fecha |
| `Component` | Componente |
| `Fecha` | Fecha del balance |
| `InventoryQty` | Inventario inicial del componente en ese BU |
| `OporQty` | OPOR de ese componente/fecha en ese BU |
| `ConsumoQty` | Consumo histórico (`Do Ty = 'IM'`), informativo, no afecta el balance |
| `DemandQty` | Demanda del plan, ya a nivel componente |
| `Balance` | Balance corrido (`InventoryQty` inicial + acumulado de `OporQty - DemandQty`) |
| `CTB` | `'YES'` si `Balance >= 0`, si no `'NO'` |

Con esto, el brick de `domo-brick-clear-to-build` puede simplificarse a **un
solo dataset** (`CTB_Result`): ya no necesita las 4 tablas ni recalcular el
cursor en el navegador, solo filtra por `BU`, colorea por `CTB` y exporta.
Si quieres, puedo reescribir ese `app.js` para que lea directamente de este
dataset.
