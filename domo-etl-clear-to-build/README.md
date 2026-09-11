# Clear to Build (Magic ETL)

`Plan` ya viene a nivel **Branch + Componente + Fecha + Cantidad requerida**
(no hace falta BOM ni Consumos). El Dataflow junta `Plan` contra `Inventory`
(por Branch + Item) y contra `Opor` (órdenes de compra por llegar, por
Branch + Item + Fecha esperada), y calcula el balance corrido: **inventario
inicial + compras acumuladas − demanda acumulada**, de la fecha más vieja a
la más nueva, por cada Branch + Componente.

## Cómo armarlo en Magic ETL

1. Crea un nuevo Dataflow (Magic ETL 2.0).
2. Agrega los 3 datasets como inputs:
   - El dataset con la demanda ya explosionada (columnas `CPWF_COMPONENT_BRANCH`,
     `CPWF_COMPONENT_2ND_ITEM_NUMBER`, `CPWF_ITEM_NUMBER_SECOND`,
     `CPWF_STOCKING_TYPE`, `CPWF_UNITS_ORDER_TRANSACTION_QTY_2`,
     `CPWF_DATE_REQUESTED`).
   - `GDLRealTruck.data.Domo_Inventory`
   - El dataset de órdenes de compra (columnas `PO_BUSINESS_UNIT`,
     `PO_ITEM_NUMBER_SECOND`, `PO_DATE_SCHEDULED_PICK`,
     `PO_UNITS_PRIMARY_QUANTITY_ORDERED`).
3. Agrega un tile **SQL** (categoría Utility) y conéctale los 3 inputs.
   Dentro del tile, renombra cada input con el alias que usa `ctb.sql`:
   `Plan`, `Inventory`, `Opor`.
4. Pega el contenido de [`ctb.sql`](./ctb.sql) en el tile.
5. Conecta la salida del tile a un tile **Output** y nómbralo, por ejemplo,
   `CTB_Result`.
6. Programa el Dataflow con el mismo schedule (o uno posterior) al de los 3
   datasets de entrada, para que siempre corra con datos frescos.

## Columnas usadas

| Dataset | Columna | Significado |
|---|---|---|
| Plan | `CPWF_COMPONENT_BRANCH` | Branch/Plant |
| Plan | `CPWF_COMPONENT_2ND_ITEM_NUMBER` | Componente |
| Plan | `CPWF_ITEM_NUMBER_SECOND` | FG (modelo/finished good) |
| Plan | `CPWF_STOCKING_TYPE` | Stocking Type del componente |
| Plan | `CPWF_UNITS_ORDER_TRANSACTION_QTY_2` | Cantidad requerida |
| Plan | `CPWF_DATE_REQUESTED` | Fecha requerida |
| Inventory | `ILOC_BRANCH_PLANT` | Branch/Plant |
| Inventory | `ITEM_NUMBER_SECOND` | Componente |
| Inventory | `ILOC_QTY_ON_HAND` | Inventario |
| Opor | `PO_BUSINESS_UNIT` | Branch/Plant |
| Opor | `PO_ITEM_NUMBER_SECOND` | Componente |
| Opor | `PO_DATE_SCHEDULED_PICK` | Fecha esperada de llegada |
| Opor | `PO_UNITS_PRIMARY_QUANTITY_ORDERED` | Cantidad por llegar |

Si tus datasets en Domo usan otros nombres, ajústalos directamente en
`ctb.sql`.

## Notas

- **Grano del resultado (`timeline`)**: ya no lo define solo `Plan` — es la
  unión de fechas de `demand` y de `opor_agg` por Branch+Componente. Así,
  una orden de compra que llega en una fecha sin demanda ese día sigue
  generando una fila y subiendo el balance ese día (si solo se tomaran las
  fechas de `Plan`, esas llegadas se "perderían" y el balance no las
  reflejaría hasta la siguiente fecha con demanda). Un Branch+Componente
  con demanda u OPOR pero sin fila en Inventario toma inventario inicial = 0.
- **Tipo de fecha**: si `CPWF_DATE_REQUESTED` / `PO_DATE_SCHEDULED_PICK` ya
  vienen como `DATE`, el `CAST(... AS DATE)` es redundante pero inofensivo;
  si vienen como texto en otro formato, puede que necesites `STR_TO_DATE`
  en vez de `CAST`.
- **Orden final**: quedó `BU, Component, Fecha` (lectura cronológica por
  componente). Si prefieres priorizar primero los que tienen desabasto
  (`CTB = 'NO'`), cambia el `ORDER BY` final a `CTB, Fecha, ABS(Balance) DESC`.
- **FG concatenado (`fg_rollup`)**: se calcula en una CTE aparte, agrupada
  **solo por Componente** (no por Componente+Fecha), y se le pega al
  resultado con un `LEFT JOIN`. Hacerlo dentro del mismo `GROUP BY` que
  agrega la demanda producía más filas de las esperadas; separarlo evita
  que el `GROUP_CONCAT` afecte el grano de `demand`.

## Resultado

El dataset `CTB_Result` queda con una fila por `BU + Component + Fecha`:

| Columna | Significado |
|---|---|
| `BU` | Branch/Plant |
| `Component` | Componente |
| `FG` | Todos los modelos (`CPWF_ITEM_NUMBER_SECOND`) que comparten este componente (en cualquier Branch/Fecha), concatenados por comas |
| `StockingType` | Stocking Type del componente (`CPWF_STOCKING_TYPE`) |
| `Fecha` | Fecha requerida |
| `InventoryQty` | Inventario inicial del componente en ese Branch |
| `OporQty` | Cantidad de orden(es) de compra que llegan en esa fecha |
| `DemandQty` | Cantidad requerida en esa fecha |
| `Balance` | Balance corrido (`InventoryQty` inicial + acumulado de `OporQty` − acumulado de `DemandQty`) |
| `CTB` | `'YES'` si `Balance >= 0`, si no `'NO'` |
| `Shortage` | `1` si `Balance < 0`, si no `0` (útil para sumar/graficar desabasto) |
| `FirstShortageFecha` | Fecha más vieja en que ese `BU + Component` se pone en negativo (`9999-12-31` si nunca) |

### Efecto cascada en el pivot de Analyzer

Para el pivot (rows = Componente, columns = Fecha, values = SUM de Balance),
Domo **no** deja usar el campo de "Sort" normal del Analyzer en pivot
tables — hay que ordenar con las flechitas junto al encabezado de la fila
(o un Beast Mode puesto directamente en las propiedades de orden del
pivot), no desde la pestaña de Sort general.

1. Agrega `FirstShortageFecha` al pivot (aunque sea oculta/sin mostrar, o
   como una columna extra de valores con agregación MIN).
2. Usa la flecha de orden junto al encabezado de la fila "Componente" y
   ordénalo por `FirstShortageFecha` ascendente.
3. Como es la misma fecha repetida en todas las filas de un mismo
   Componente (viene de un rollup, no cambia por Fecha), el pivot queda
   ordenado por "qué tan pronto se desabastece" cada componente — al leer
   de arriba hacia abajo y de izquierda a derecha vas viendo subir el
   escalón de negativos (el efecto cascada).
4. Los que nunca se desabastecen quedan al final (fecha centinela
   `9999-12-31`).

Con esto, el brick de `domo-brick-clear-to-build` puede simplificarse a **un
solo dataset** (`CTB_Result`): ya no necesita recalcular nada en el
navegador, solo filtra por `BU`, colorea por `CTB` y exporta.

**Pendiente de confirmar**: esta versión todavía no usa `Consumos` (sí
estaba en la versión original que replicaba el SP). Si quieres mostrar
Consumo histórico como columna informativa (no afecta el balance), avisa
para reincorporarlo.
