# Clear to Build (Magic ETL)

Versión simplificada: `Plan` ya viene a nivel **Branch + Componente + Fecha +
Cantidad requerida** (no hace falta BOM, OPOR ni Consumos). El Dataflow solo
junta `Plan` contra `Inventory` (por Branch + Item) y calcula el balance
corrido — inventario inicial menos la demanda acumulada, de la fecha más
vieja a la más nueva, por cada Branch + Componente.

## Cómo armarlo en Magic ETL

1. Crea un nuevo Dataflow (Magic ETL 2.0).
2. Agrega los 2 datasets como inputs:
   - El dataset con la demanda ya explosionada (columnas `CPWF_COMPONENT_BRANCH`,
     `CPWF_COMPONENT_2ND_ITEM_NUMBER`, `CPWF_UNITS_ORDER_TRANSACTION_QTY_2`,
     `CPWF_DATE_REQUESTED`).
   - `GDLRealTruck.data.Domo_Inventory`
3. Agrega un tile **SQL** (categoría Utility) y conéctale los 2 inputs.
   Dentro del tile, renombra cada input con el alias que usa `ctb.sql`:
   `Plan`, `Inventory`.
4. Pega el contenido de [`ctb.sql`](./ctb.sql) en el tile.
5. Conecta la salida del tile a un tile **Output** y nómbralo, por ejemplo,
   `CTB_Result`.
6. Programa el Dataflow con el mismo schedule (o uno posterior) al de los 2
   datasets de entrada, para que siempre corra con datos frescos.

## Columnas usadas

| Dataset | Columna | Significado |
|---|---|---|
| Plan | `CPWF_COMPONENT_BRANCH` | Branch/Plant |
| Plan | `CPWF_COMPONENT_2ND_ITEM_NUMBER` | Componente |
| Plan | `CPWF_ITEM_NUMBER_SECOND` | FG (modelo/finished good) |
| Plan | `CPWF_UNITS_ORDER_TRANSACTION_QTY_2` | Cantidad requerida |
| Plan | `CPWF_DATE_REQUESTED` | Fecha requerida |
| Inventory | `ILOC_BRANCH_PLANT` | Branch/Plant |
| Inventory | `ITEM_NUMBER_SECOND` | Componente |
| Inventory | `ILOC_QTY_ON_HAND` | Inventario |

Si tus datasets en Domo usan otros nombres, ajústalos directamente en
`ctb.sql`.

## Notas

- **Grano del resultado**: lo define `Plan` — un Branch+Componente que tiene
  inventario pero ninguna demanda no aparece en el resultado (no hay nada
  que proyectar para él). Un Branch+Componente con demanda pero sin fila en
  Inventario toma inventario inicial = 0.
- **Tipo de fecha**: si `CPWF_DATE_REQUESTED` ya viene como `DATE`, el
  `CAST(... AS DATE)` es redundante pero inofensivo; si viene como texto en
  otro formato, puede que necesites `STR_TO_DATE` en vez de `CAST`.
- **Orden final**: quedó `BU, Component, Fecha` (lectura cronológica por
  componente). Si prefieres priorizar primero los que tienen desabasto
  (`CTB = 'NO'`), cambia el `ORDER BY` final a `CTB, Fecha, ABS(Balance) DESC`.

## Resultado

El dataset `CTB_Result` queda con una fila por `BU + Component + Fecha`:

| Columna | Significado |
|---|---|
| `BU` | Branch/Plant |
| `Component` | Componente |
| `FG` | Modelos (`CPWF_ITEM_NUMBER_SECOND`) que comparten este componente en esta fecha, concatenados |
| `Fecha` | Fecha requerida |
| `InventoryQty` | Inventario inicial del componente en ese Branch |
| `DemandQty` | Cantidad requerida en esa fecha |
| `Balance` | Balance corrido (`InventoryQty` inicial − acumulado de `DemandQty`) |
| `CTB` | `'YES'` si `Balance >= 0`, si no `'NO'` |

Con esto, el brick de `domo-brick-clear-to-build` puede simplificarse a **un
solo dataset** (`CTB_Result`): ya no necesita recalcular nada en el
navegador, solo filtra por `BU`, colorea por `CTB` y exporta.

**Pendiente de confirmar**: esta versión ya no usa `Opor` ni `Consumos` (los
que sí estaban en la versión anterior, replicando el SP original). Si
todavía quieres sumar OPOR como entrada adicional de inventario (o mostrar
Consumo histórico como columna informativa), avisa para reincorporarlos.
