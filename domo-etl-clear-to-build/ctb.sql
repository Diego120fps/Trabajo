-- Clear to Build (Magic ETL SQL tile)
-- Version simplificada: Plan ya viene a nivel Branch + Componente + Fecha +
-- Cantidad requerida (no hace falta BOM, OPOR ni Consumos). Solo se junta
-- contra Inventario (por Branch + Item) y se calcula el balance corrido
-- (inventario inicial menos la demanda acumulada, de la fecha mas vieja a
-- la mas nueva).
--
-- Alias esperados de los 2 inputs del tile:
--   Plan       -> dataset con CPWF_COMPONENT_BRANCH, CPWF_COMPONENT_2ND_ITEM_NUMBER,
--                  CPWF_UNITS_ORDER_TRANSACTION_QTY_2, CPWF_DATE_REQUESTED
--   Inventory  -> GDLRealTruck.data.Domo_Inventory
--
-- Columnas usadas:
--   Plan.CPWF_COMPONENT_BRANCH             -> Branch/Plant
--   Plan.CPWF_COMPONENT_2ND_ITEM_NUMBER    -> Componente
--   Plan.CPWF_ITEM_NUMBER_SECOND           -> FG (modelo/finished good)
--   Plan.CPWF_UNITS_ORDER_TRANSACTION_QTY_2-> Cantidad requerida
--   Plan.CPWF_DATE_REQUESTED               -> Fecha requerida
--   Inventory.ILOC_BRANCH_PLANT            -> Branch/Plant
--   Inventory.ITEM_NUMBER_SECOND           -> Componente
--   Inventory.ILOC_QTY_ON_HAND             -> Inventario

WITH demand AS (
  -- Demanda por Branch + Componente + Fecha (ya viene explosionada en Plan,
  -- solo se suma por si hay varias filas para la misma combinacion). FG
  -- concatena todos los modelos que comparten ese Componente en esa fecha.
  -- GROUP_CONCAT sin ORDER BY: el tile SQL de Domo no soporta el ORDER BY
  -- opcional dentro de GROUP_CONCAT (da "Syntax error in expression").
  SELECT
    p.CPWF_COMPONENT_BRANCH                      AS BU,
    p.CPWF_COMPONENT_2ND_ITEM_NUMBER             AS Component,
    CAST(p.CPWF_DATE_REQUESTED AS DATE)          AS Fecha,
    SUM(p.CPWF_UNITS_ORDER_TRANSACTION_QTY_2)    AS DemandQty,
    GROUP_CONCAT(DISTINCT p.CPWF_ITEM_NUMBER_SECOND SEPARATOR ', ') AS FG
  FROM Plan p
  WHERE p.CPWF_COMPONENT_2ND_ITEM_NUMBER IS NOT NULL
  GROUP BY
    p.CPWF_COMPONENT_BRANCH,
    p.CPWF_COMPONENT_2ND_ITEM_NUMBER,
    CAST(p.CPWF_DATE_REQUESTED AS DATE)
),

inv_agg AS (
  -- Inventario inicial por Branch + Componente.
  SELECT
    ILOC_BRANCH_PLANT    AS BU,
    ITEM_NUMBER_SECOND   AS Component,
    SUM(ILOC_QTY_ON_HAND) AS InventoryQty
  FROM Inventory
  GROUP BY ILOC_BRANCH_PLANT, ITEM_NUMBER_SECOND
),

base AS (
  -- La demanda manda el grano del resultado; si un Branch+Componente no
  -- tiene fila en Inventario, su inventario inicial se toma como 0.
  SELECT
    d.BU                          AS BU,
    d.Component                  AS Component,
    d.Fecha                       AS Fecha,
    d.FG                          AS FG,
    d.DemandQty                   AS DemandQty,
    COALESCE(i.InventoryQty, 0)   AS InventoryQty
  FROM demand d
  LEFT JOIN inv_agg i
    ON i.BU = d.BU AND i.Component = d.Component
),

calc AS (
  -- Balance corrido: inventario inicial menos la demanda acumulada, de la
  -- fecha mas vieja a la mas nueva, por cada Branch + Componente.
  SELECT
    BU, Component, Fecha, FG, DemandQty, InventoryQty,
    InventoryQty - SUM(DemandQty) OVER (
      PARTITION BY BU, Component
      ORDER BY Fecha
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS Balance
  FROM base
)

SELECT
  BU,
  Component,
  FG,
  Fecha,
  InventoryQty,
  DemandQty,
  Balance,
  CASE WHEN Balance >= 0 THEN 'YES' ELSE 'NO' END AS CTB
FROM calc
ORDER BY BU, Component, Fecha;
