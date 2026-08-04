# Clear to Build (Domo Brick)

Réplica en un brick "blank" del stored procedure `dbo.SP_CTBPlan` (rama `@kind = 1`,
Inventario/CTB Plan). Cada tabla del SP es un dataset de Domo; el cálculo del
balance corrido (que en el SP usa cursores) se hace en el navegador.

## Configuración en Domo

Al crear el brick a partir del template "blank", agrega los datasets **en este
orden exacto** (botón de la esquina inferior izquierda del editor):

| # | Dataset Domo                              | Tabla en el SP              |
|---|--------------------------------------------|------------------------------|
| 0 | `GDLRealTruck.data.Domo_Inventory`          | Inventario                   |
| 1 | `GDLRealTruck.data.opor`                    | OPOR                         |
| 2 | `GDLRealTruck.data.Consumos`                | Consumos (`Do Ty = 'IM'`)    |
| 3 | `GDLRealTruck.data.PlanCTB`                 | Plan de producción           |
| 4 | `GDLRealTruck.data.Domo_BillOfMaterial`     | BOM                          |

Si el orden no coincide, ajusta los índices `DS_INVENTORY`, `DS_OPOR`,
`DS_CONSUMOS`, `DS_PLAN`, `DS_BOM` al inicio de `app.js`.

Si algún dataset usa nombres de columna distintos a los del SP, ajusta las
constantes `FIELD_*` al inicio de `app.js` (mismo patrón que
`domo-brick-branch-item-pivot`).

## Lógica replicada

1. **Inventario**: suma `ILOC_QTY_ON_HAND` por `ITEM_NUMBER_SECOND`, filtrado
   por `ITEM_BRANCH_PLANT = @bu`.
2. **OPOR**: suma `primary_Qty` por `Item_Number` + fecha (`DATE_REQUESTED_HEADER`),
   filtrado por `ORDER_BUSINESS_UNIT = @bu`.
3. **Consumos**: suma `Trans QTY` por `2nd Item Number`, filtrado por
   `Business Unit = @bu` y `Do Ty = 'IM'` (sin fecha, igual que el SP).
4. **Demanda**: el plan de producción (`PlanCTB`, **sin** filtro de `@bu`,
   igual que el SP) se explota contra el BOM (`Domo_BillOfMaterial`) —
   `DemandQty = COMPONENT_QUANTITY * qty` — agrupando por componente y fecha.
   El BOM solo se consulta filtrado por los modelos presentes en el plan (no
   se descarga completo).
5. **Balance corrido**: por cada componente, ordenado por fecha, se repite el
   cursor del SP:
   `Balance = InventarioInicial + OPOR − Demanda`, y el balance de cada fecha
   se vuelve el inventario inicial de la siguiente. `CTB = 'YES'` si
   `Balance >= 0`, si no `'NO'`.
6. **Orden final**: `CTB, Fecha, ABS(Balance) DESC`, igual que el `SELECT`
   final del SP.

`ConsumoQty` se calcula y se muestra en la tabla (a diferencia del SP, donde
la columna queda comentada en el `SELECT` final), pero **no** participa en el
cálculo del balance — el SP tampoco la usa para eso.

## Notas de implementación

- Se evita `groupby` + suma de la Data API de Domo para las agregaciones
  (Inventario/OPOR/Consumos): en datasets grandes puede samplear/truncar en
  vez de escanear todo. En su lugar se pagina con `fetchAllRows` y se suma en
  el navegador (mismo patrón que `domo-brick-branch-item-pivot`).
- El campo Business Unit / Plant se autocompleta con los valores distintos de
  `ITEM_BRANCH_PLANT` en Inventario, pero acepta cualquier valor escrito a mano.
- El resultado se puede filtrar por componente/FG y exportar a CSV (Excel).
