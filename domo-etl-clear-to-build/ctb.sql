-- Clear to Build (Magic ETL SQL tile)
-- Reemplaza el cursor del SP dbo.SP_CTBPlan (@kind = 1) con una funcion de
-- ventana. Correr para TODOS los Business Unit / Plant a la vez (a
-- diferencia del SP, que corre por @bu) para que el dataset de salida sirva
-- para cualquier planta sin necesidad de un parametro en vivo.
--
-- Alias esperados de los 4 inputs del tile (renombra los inputs del tile con
-- estos alias, o ajusta los nombres en el FROM/JOIN de abajo). Ya NO se usa
-- el dataset BOM: Plan viene pre-explosionado a nivel componente, con su
-- propia columna de FG y de componente, asi que no hace falta ningun join
-- ni desenrollar el BOM multinivel.
--   Inventory  -> GDLRealTruck.data.Domo_Inventory
--   Opor       -> GDLRealTruck.data.opor
--   Consumos   -> GDLRealTruck.data.Consumos
--   Plan       -> GDLRealTruck.data.PlanCTB (ya explosionado por componente)
--
-- Verifica los nombres/tipos de columna contra tus datasets reales antes de
-- correr (mismos nombres que en domo-brick-clear-to-build/app.js). Si una
-- columna trae espacios usa backticks, ej. `2nd Item Number`.
--
-- Columnas de Plan usadas aqui:
--   PARENT_ITEM                          -> FG (modelo)
--   CPWF_COMPONENT_2ND_ITEM_NUMBER       -> Componente
--   CPWF_DATE_REQUESTED                  -> Fecha
--   CPWF_UNITS_ORDER_TRANSACTION_QTY     -> Demanda del componente (ya no se
--                                            multiplica por ningun ratio de BOM)

WITH demand AS (
  -- Paso 4-6 del brick: agrega la demanda YA EXPLOSIONADA por componente que
  -- trae Plan directamente (sin join contra BOM). DemandQty y FG agregados
  -- por Component + Fecha.
  SELECT
    p.CPWF_COMPONENT_2ND_ITEM_NUMBER                           AS Component,
    CAST(p.CPWF_DATE_REQUESTED AS DATE)                        AS Fecha,
    SUM(p.CPWF_UNITS_ORDER_TRANSACTION_QTY)                    AS DemandQty,
    GROUP_CONCAT(DISTINCT p.PARENT_ITEM SEPARATOR ', ') AS FG
  FROM Plan p
  WHERE p.CPWF_COMPONENT_2ND_ITEM_NUMBER IS NOT NULL
  GROUP BY p.CPWF_COMPONENT_2ND_ITEM_NUMBER, CAST(p.CPWF_DATE_REQUESTED AS DATE)
),

inv_agg AS (
  -- Paso 1: inventario por BU + Component.
  SELECT
    ITEM_BRANCH_PLANT                    AS BU,
    ITEM_NUMBER_SECOND                   AS Component,
    SUM(ILOC_QTY_ON_HAND)                AS InventoryQty
  FROM Inventory
  GROUP BY ITEM_BRANCH_PLANT, ITEM_NUMBER_SECOND
),

opor_agg AS (
  -- Paso 2: OPOR por BU + Component + Fecha.
  SELECT
    ORDER_BUSINESS_UNIT                  AS BU,
    Item_Number                          AS Component,
    CAST(DATE_REQUESTED_HEADER AS DATE)  AS Fecha,
    SUM(primary_Qty)                     AS OporQty
  FROM Opor
  GROUP BY ORDER_BUSINESS_UNIT, Item_Number, CAST(DATE_REQUESTED_HEADER AS DATE)
),

cons_agg AS (
  -- Paso 3: consumos (Do Ty = 'IM') por BU + Component. Solo se muestra, no
  -- participa en el balance (igual que el SP).
  SELECT
    `Business Unit`                      AS BU,
    `2nd Item Number`                    AS Component,
    SUM(`Trans QTY`)                     AS ConsumoQty
  FROM Consumos
  WHERE `Do Ty` = 'IM'
  GROUP BY `Business Unit`, `2nd Item Number`
),

bu_list AS (
  -- BUs a evaluar: los que existen en Inventario (mismo criterio que el
  -- autocompletado de BU en el brick actual).
  SELECT DISTINCT BU FROM inv_agg
),

base AS (
  -- Cross join BU x demanda: la demanda es global (no depende del BU, igual
  -- que el SP), asi que cada BU se evalua contra la misma demanda pero con
  -- su propio inventario/OPOR/consumo.
  SELECT
    bu.BU                                AS BU,
    d.FG                                 AS FG,
    d.Component                          AS Component,
    d.Fecha                              AS Fecha,
    COALESCE(i.InventoryQty, 0)          AS InventoryQty,
    COALESCE(o.OporQty, 0)               AS OporQty,
    COALESCE(c.ConsumoQty, 0)            AS ConsumoQty,
    d.DemandQty                          AS DemandQty
  FROM bu_list bu
  CROSS JOIN demand d
  LEFT JOIN inv_agg  i ON i.BU = bu.BU AND i.Component = d.Component
  LEFT JOIN opor_agg o ON o.BU = bu.BU AND o.Component = d.Component AND o.Fecha = d.Fecha
  LEFT JOIN cons_agg c ON c.BU = bu.BU AND c.Component = d.Component
),

calc AS (
  -- Paso 7 del brick (cursor del SP): balance corrido por BU + Component,
  -- ordenado por Fecha. InventoryQty es constante por BU+Component (el
  -- inventario inicial), y se le suma la acumulada de (OPOR - Demanda).
  SELECT
    BU, FG, Component, Fecha, InventoryQty, OporQty, ConsumoQty, DemandQty,
    InventoryQty + SUM(OporQty - DemandQty) OVER (
      PARTITION BY BU, Component
      ORDER BY Fecha
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS Balance
  FROM base
)

-- Orden final: CTB, Fecha, ABS(Balance) DESC (igual que el SELECT final del SP).
SELECT
  BU,
  FG,
  Component,
  Fecha,
  InventoryQty,
  OporQty,
  ConsumoQty,
  DemandQty,
  Balance,
  CASE WHEN Balance >= 0 THEN 'YES' ELSE 'NO' END AS CTB
FROM calc
ORDER BY CTB, Fecha, ABS(Balance) DESC;
