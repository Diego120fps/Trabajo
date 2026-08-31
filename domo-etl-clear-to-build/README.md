# Clear to Build (Magic ETL)

Reemplaza el cursor del stored procedure `dbo.SP_CTBPlan` (`@kind = 1`) con un
Dataflow de Magic ETL que corre dentro de Domo, sobre los datasets que ya
tienes sincronizados ahí. Como corre para **todos** los Business Unit /
Plant a la vez (no por `@bu` como el SP), el dataset de salida queda
siempre actualizado con el schedule del dataflow y no depende de un
parámetro en vivo.

## Cómo armarlo en Magic ETL

1. Crea un nuevo Dataflow (Magic ETL 2.0).
2. Agrega los 5 datasets como inputs:
   - `GDLRealTruck.data.Domo_Inventory`
   - `GDLRealTruck.data.opor`
   - `GDLRealTruck.data.Consumos`
   - `GDLRealTruck.data.PlanCTB`
   - `GDLRealTruck.data.Domo_BillOfMaterial`
3. Agrega un tile **SQL** (categoría Utility) y conéctale los 5 inputs.
   Dentro del tile, renombra cada input con el alias que usa `ctb.sql`:
   `Inventory`, `Opor`, `Consumos`, `Plan`, `BOM`.
4. Pega el contenido de [`ctb.sql`](./ctb.sql) en el tile.
5. Conecta la salida del tile a un tile **Output** y nómbralo, por ejemplo,
   `CTB_Result`.
6. Programa el Dataflow con el mismo schedule (o uno posterior) al de los 5
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
- **Nombres de Plan**: asumí que la columna que hace match contra
  `BOM.FINISHED_GOOD_ITEM_NUMBER` es `PARENT_ITEM` y que la fecha es
  `PO_DATE_REQUESTED`. Si el campo de join real tiene otro nombre distinto
  al de FG mostrado en pantalla, dímelo para separarlos.

### BOM multinivel (sin recursión real)

El BOM puede ser multinivel: un componente puede a su vez ser un
subensamble con su propio BOM. El tile SQL de Magic ETL **no soporta
`WITH RECURSIVE` de forma confiable** (hay un bug reportado en el foro de
Domo), así que `bom_flat` desenrolla el BOM con auto-joins encadenados en
vez de recursión real, cubriendo hasta **8 niveles** por defecto. Un
componente que aparece en más de un nivel/camino para el mismo FG suma sus
cantidades (explosión estándar de BOM).

- Si tu BOM real tiene más de 8 niveles, copia el patrón del último bloque
  `UNION ALL` y agrega `b9`, `b10`, etc.
- Para validar que 8 niveles alcanzan, corre esta consulta contra tu BOM
  real (fuera del tile, en cualquier cliente SQL o en un tile de prueba):
  encuentra el nivel más profundo contando cuántas veces se puede
  encadenar `COMPONENT_ITEM_NUMBER -> FINISHED_GOOD_ITEM_NUMBER` antes de
  quedarse sin matches. Si tienes acceso a SQL Server, una recursive CTE
  ahí sí funciona y es la forma más simple de medir la profundidad real:
  ```sql
  WITH depth AS (
    SELECT FINISHED_GOOD_ITEM_NUMBER, COMPONENT_ITEM_NUMBER, 1 AS lvl
    FROM Domo_BillOfMaterial
    UNION ALL
    SELECT b.FINISHED_GOOD_ITEM_NUMBER, b.COMPONENT_ITEM_NUMBER, d.lvl + 1
    FROM Domo_BillOfMaterial b
    JOIN depth d ON b.FINISHED_GOOD_ITEM_NUMBER = d.COMPONENT_ITEM_NUMBER
  )
  SELECT MAX(lvl) AS max_depth FROM depth OPTION (MAXRECURSION 100);
  ```
- Si tu BOM tiene ciclos (un componente que termina siendo su propio
  ancestro), esta consulta de validación nunca termina — en `bom_flat` no
  hay ese riesgo porque los niveles están acotados a 8 self-joins fijos,
  nunca hace loop infinito.

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
| `DemandQty` | Demanda explotada del plan vía BOM |
| `Balance` | Balance corrido (`InventoryQty` inicial + acumulado de `OporQty - DemandQty`) |
| `CTB` | `'YES'` si `Balance >= 0`, si no `'NO'` |

Con esto, el brick de `domo-brick-clear-to-build` puede simplificarse a **un
solo dataset** (`CTB_Result`): ya no necesita las 5 tablas ni recalcular el
cursor en el navegador, solo filtra por `BU`, colorea por `CTB` y exporta.
Si quieres, puedo reescribir ese `app.js` para que lea directamente de este
dataset.
