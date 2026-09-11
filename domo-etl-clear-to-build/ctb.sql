-- Clear to Build (Magic ETL SQL tile)
-- Plan ya viene a nivel Branch + Componente + Fecha + Cantidad requerida
-- (no hace falta BOM ni Consumos). Se junta contra Inventario (por Branch +
-- Item) y contra Opor (ordenes de compra por llegar) y se calcula el
-- balance corrido: inventario inicial + compras acumuladas - demanda
-- acumulada, de la fecha mas vieja a la mas nueva.
--
-- Alias esperados de los 3 inputs del tile:
--   Plan       -> dataset con CPWF_COMPONENT_BRANCH, CPWF_COMPONENT_2ND_ITEM_NUMBER,
--                  CPWF_ITEM_NUMBER_SECOND, CPWF_STOCKING_TYPE,
--                  CPWF_UNITS_ORDER_TRANSACTION_QTY_2, CPWF_DATE_REQUESTED
--   Inventory  -> GDLRealTruck.data.Domo_Inventory
--   Opor       -> dataset con PO_BUSINESS_UNIT, PO_ITEM_NUMBER_SECOND,
--                  PO_DATE_SCHEDULED_PICK, PO_UNITS_PRIMARY_QUANTITY_ORDERED
--
-- Columnas usadas:
--   Plan.CPWF_COMPONENT_BRANCH             -> Branch/Plant
--   Plan.CPWF_COMPONENT_2ND_ITEM_NUMBER    -> Componente
--   Plan.CPWF_ITEM_NUMBER_SECOND           -> FG (modelo/finished good)
--   Plan.CPWF_STOCKING_TYPE                -> Stocking Type del componente
--   Plan.CPWF_UNITS_ORDER_TRANSACTION_QTY_2-> Cantidad requerida
--   Plan.CPWF_DATE_REQUESTED               -> Fecha requerida
--   Inventory.ILOC_BRANCH_PLANT            -> Branch/Plant
--   Inventory.ITEM_NUMBER_SECOND           -> Componente
--   Inventory.ILOC_QTY_ON_HAND             -> Inventario
--   Opor.PO_BUSINESS_UNIT                  -> Branch/Plant
--   Opor.PO_ITEM_NUMBER_SECOND              -> Componente
--   Opor.PO_DATE_SCHEDULED_PICK             -> Fecha esperada de llegada
--   Opor.PO_UNITS_PRIMARY_QUANTITY_ORDERED  -> Cantidad por llegar

WITH fg_rollup AS (
  -- Una fila por Componente: todos los FG que alguna vez comparten ese
  -- componente (en cualquier Branch/Fecha), concatenados por comas, mas su
  -- Stocking Type (CPWF_STOCKING_TYPE). Al calcularse aparte (agrupado SOLO
  -- por Componente) no puede fanear las filas de "demand" -- se le pega
  -- despues con un LEFT JOIN.
  SELECT
    CPWF_COMPONENT_2ND_ITEM_NUMBER AS Component,
    GROUP_CONCAT(DISTINCT CPWF_ITEM_NUMBER_SECOND SEPARATOR ', ') AS FG,
    GROUP_CONCAT(DISTINCT CPWF_STOCKING_TYPE SEPARATOR ', ') AS StockingType
  FROM Plan
  WHERE CPWF_COMPONENT_2ND_ITEM_NUMBER IS NOT NULL
  GROUP BY CPWF_COMPONENT_2ND_ITEM_NUMBER
),

demand AS (
  -- Demanda por Branch + Componente + Fecha (ya viene explosionada en Plan,
  -- solo se suma por si hay varias filas para la misma combinacion).
  SELECT
    p.CPWF_COMPONENT_BRANCH                      AS BU,
    p.CPWF_COMPONENT_2ND_ITEM_NUMBER             AS Component,
    CAST(p.CPWF_DATE_REQUESTED AS DATE)          AS Fecha,
    SUM(p.CPWF_UNITS_ORDER_TRANSACTION_QTY_2)    AS DemandQty
  FROM Plan p
  WHERE p.CPWF_COMPONENT_2ND_ITEM_NUMBER IS NOT NULL
  GROUP BY
    p.CPWF_COMPONENT_BRANCH,
    p.CPWF_COMPONENT_2ND_ITEM_NUMBER,
    CAST(p.CPWF_DATE_REQUESTED AS DATE)
),

opor_agg AS (
  -- Ordenes de compra por llegar, por Branch + Componente + Fecha esperada.
  SELECT
    o.PO_BUSINESS_UNIT                           AS BU,
    o.PO_ITEM_NUMBER_SECOND                      AS Component,
    CAST(o.PO_DATE_SCHEDULED_PICK AS DATE)       AS Fecha,
    SUM(o.PO_UNITS_PRIMARY_QUANTITY_ORDERED)     AS OporQty
  FROM Opor o
  WHERE o.PO_ITEM_NUMBER_SECOND IS NOT NULL
  GROUP BY
    o.PO_BUSINESS_UNIT,
    o.PO_ITEM_NUMBER_SECOND,
    CAST(o.PO_DATE_SCHEDULED_PICK AS DATE)
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

timeline AS (
  -- Todas las fechas relevantes por Branch + Componente: donde hay demanda
  -- O donde hay una orden de compra por llegar. Asi una OPOR que cae en una
  -- fecha sin demanda sigue subiendo el balance ese dia (no se pierde).
  SELECT BU, Component, Fecha FROM demand
  UNION
  SELECT BU, Component, Fecha FROM opor_agg
),

base AS (
  -- El timeline manda el grano del resultado. FG/StockingType se pegan por
  -- Componente (fg_rollup); Inventario se pega por Branch+Componente (es
  -- el mismo valor inicial en todas las fechas de ese grupo).
  SELECT
    t.BU                          AS BU,
    t.Component                  AS Component,
    t.Fecha                       AS Fecha,
    f.FG                          AS FG,
    f.StockingType                AS StockingType,
    COALESCE(d.DemandQty, 0)      AS DemandQty,
    COALESCE(o.OporQty, 0)        AS OporQty,
    COALESCE(i.InventoryQty, 0)  AS InventoryQty
  FROM timeline t
  LEFT JOIN demand d
    ON d.BU = t.BU AND d.Component = t.Component AND d.Fecha = t.Fecha
  LEFT JOIN opor_agg o
    ON o.BU = t.BU AND o.Component = t.Component AND o.Fecha = t.Fecha
  LEFT JOIN inv_agg i
    ON i.BU = t.BU AND i.Component = t.Component
  LEFT JOIN fg_rollup f
    ON f.Component = t.Component
),

calc AS (
  -- Balance corrido: inventario inicial + compras acumuladas - demanda
  -- acumulada, de la fecha mas vieja a la mas nueva, por cada
  -- Branch + Componente.
  SELECT
    BU, Component, Fecha, FG, StockingType, DemandQty, OporQty, InventoryQty,
    InventoryQty + SUM(OporQty - DemandQty) OVER (
      PARTITION BY BU, Component
      ORDER BY Fecha
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS Balance
  FROM base
),

shortage_rollup AS (
  -- Una fila por Branch + Componente: la fecha MAS VIEJA en la que ese
  -- componente se pone en negativo. Sirve para el "efecto cascada" en el
  -- pivot de Analyzer -- ordenar las filas (Componente) por esta fecha hace
  -- que los que se desabastecen primero queden arriba, y a medida que
  -- avanzas por columnas de fecha se ve el escalon de negativos subiendo.
  -- Si nunca se pone negativo, se le pone una fecha centinela muy lejana
  -- para que caiga al final del orden ascendente.
  SELECT
    BU, Component,
    MIN(Fecha) AS FirstShortageFecha
  FROM calc
  WHERE Balance < 0
  GROUP BY BU, Component
)

SELECT
  c.BU,
  c.Component,
  c.FG,
  c.StockingType,
  c.Fecha,
  c.InventoryQty,
  c.OporQty,
  c.DemandQty,
  c.Balance,
  CASE WHEN c.Balance >= 0 THEN 'YES' ELSE 'NO' END AS CTB,
  CASE WHEN c.Balance < 0 THEN 1 ELSE 0 END AS Shortage,
  COALESCE(s.FirstShortageFecha, CAST('9999-12-31' AS DATE)) AS FirstShortageFecha
FROM calc c
LEFT JOIN shortage_rollup s
  ON s.BU = c.BU AND s.Component = c.Component
ORDER BY c.BU, c.Component, c.Fecha;
