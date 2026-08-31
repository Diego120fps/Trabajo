-- Clear to Build (Magic ETL SQL tile)
-- Reemplaza el cursor del SP dbo.SP_CTBPlan (@kind = 1) con una funcion de
-- ventana. Correr para TODOS los Business Unit / Plant a la vez (a
-- diferencia del SP, que corre por @bu) para que el dataset de salida sirva
-- para cualquier planta sin necesidad de un parametro en vivo.
--
-- Alias esperados de los 5 inputs del tile (renombra los inputs del tile con
-- estos alias, o ajusta los nombres en el FROM/JOIN de abajo):
--   Inventory  -> GDLRealTruck.data.Domo_Inventory
--   Opor       -> GDLRealTruck.data.opor
--   Consumos   -> GDLRealTruck.data.Consumos
--   Plan       -> GDLRealTruck.data.PlanCTB
--   BOM        -> GDLRealTruck.data.Domo_BillOfMaterial
--
-- Verifica los nombres/tipos de columna contra tus datasets reales antes de
-- correr (mismos nombres que en domo-brick-clear-to-build/app.js). Si una
-- columna trae espacios usa backticks, ej. `2nd Item Number`.
--
-- Plan usa PARENT_ITEM (modelo/FG) y PO_DATE_REQUESTED (fecha) -- ajusta si
-- el nombre real de la columna que hace match contra
-- BOM.FINISHED_GOOD_ITEM_NUMBER no es PARENT_ITEM.
--
-- El BOM es multinivel: un componente puede ser a su vez un subensamble con
-- su propio BOM. El tile SQL de Magic ETL NO soporta CTEs recursivos de
-- forma confiable (WITH RECURSIVE falla en el tile), asi que en vez de
-- recursion real se "desenrolla" el BOM con auto-joins encadenados hasta un
-- numero fijo de niveles (bom_flat abajo). Ajusta NIVELES_BOM si tu
-- estructura real tiene mas profundidad que la cubierta aqui (por defecto
-- 8 niveles) -- ver README para la consulta de validacion.

WITH bom_flat AS (
  -- Desenrolla el BOM multinivel en pares (TopFG, Component-en-cualquier-
  -- nivel, cantidad acumulada = producto de las cantidades del camino).
  -- Si un componente aparece en mas de un nivel/camino para el mismo TopFG,
  -- sus cantidades se suman (explosion estandar de BOM).
  SELECT TopFG, Component, SUM(Qty) AS Qty
  FROM (
    -- Nivel 1
    SELECT
      b1.FINISHED_GOOD_ITEM_NUMBER AS TopFG,
      b1.COMPONENT_ITEM_NUMBER     AS Component,
      b1.COMPONENT_QUANTITY        AS Qty
    FROM BOM b1

    UNION ALL

    -- Nivel 2
    SELECT
      b1.FINISHED_GOOD_ITEM_NUMBER AS TopFG,
      b2.COMPONENT_ITEM_NUMBER     AS Component,
      b1.COMPONENT_QUANTITY * b2.COMPONENT_QUANTITY AS Qty
    FROM BOM b1
    JOIN BOM b2 ON b2.FINISHED_GOOD_ITEM_NUMBER = b1.COMPONENT_ITEM_NUMBER

    UNION ALL

    -- Nivel 3
    SELECT
      b1.FINISHED_GOOD_ITEM_NUMBER AS TopFG,
      b3.COMPONENT_ITEM_NUMBER     AS Component,
      b1.COMPONENT_QUANTITY * b2.COMPONENT_QUANTITY * b3.COMPONENT_QUANTITY AS Qty
    FROM BOM b1
    JOIN BOM b2 ON b2.FINISHED_GOOD_ITEM_NUMBER = b1.COMPONENT_ITEM_NUMBER
    JOIN BOM b3 ON b3.FINISHED_GOOD_ITEM_NUMBER = b2.COMPONENT_ITEM_NUMBER

    UNION ALL

    -- Nivel 4
    SELECT
      b1.FINISHED_GOOD_ITEM_NUMBER AS TopFG,
      b4.COMPONENT_ITEM_NUMBER     AS Component,
      b1.COMPONENT_QUANTITY * b2.COMPONENT_QUANTITY * b3.COMPONENT_QUANTITY * b4.COMPONENT_QUANTITY AS Qty
    FROM BOM b1
    JOIN BOM b2 ON b2.FINISHED_GOOD_ITEM_NUMBER = b1.COMPONENT_ITEM_NUMBER
    JOIN BOM b3 ON b3.FINISHED_GOOD_ITEM_NUMBER = b2.COMPONENT_ITEM_NUMBER
    JOIN BOM b4 ON b4.FINISHED_GOOD_ITEM_NUMBER = b3.COMPONENT_ITEM_NUMBER

    UNION ALL

    -- Nivel 5
    SELECT
      b1.FINISHED_GOOD_ITEM_NUMBER AS TopFG,
      b5.COMPONENT_ITEM_NUMBER     AS Component,
      b1.COMPONENT_QUANTITY * b2.COMPONENT_QUANTITY * b3.COMPONENT_QUANTITY * b4.COMPONENT_QUANTITY * b5.COMPONENT_QUANTITY AS Qty
    FROM BOM b1
    JOIN BOM b2 ON b2.FINISHED_GOOD_ITEM_NUMBER = b1.COMPONENT_ITEM_NUMBER
    JOIN BOM b3 ON b3.FINISHED_GOOD_ITEM_NUMBER = b2.COMPONENT_ITEM_NUMBER
    JOIN BOM b4 ON b4.FINISHED_GOOD_ITEM_NUMBER = b3.COMPONENT_ITEM_NUMBER
    JOIN BOM b5 ON b5.FINISHED_GOOD_ITEM_NUMBER = b4.COMPONENT_ITEM_NUMBER

    UNION ALL

    -- Nivel 6
    SELECT
      b1.FINISHED_GOOD_ITEM_NUMBER AS TopFG,
      b6.COMPONENT_ITEM_NUMBER     AS Component,
      b1.COMPONENT_QUANTITY * b2.COMPONENT_QUANTITY * b3.COMPONENT_QUANTITY * b4.COMPONENT_QUANTITY * b5.COMPONENT_QUANTITY * b6.COMPONENT_QUANTITY AS Qty
    FROM BOM b1
    JOIN BOM b2 ON b2.FINISHED_GOOD_ITEM_NUMBER = b1.COMPONENT_ITEM_NUMBER
    JOIN BOM b3 ON b3.FINISHED_GOOD_ITEM_NUMBER = b2.COMPONENT_ITEM_NUMBER
    JOIN BOM b4 ON b4.FINISHED_GOOD_ITEM_NUMBER = b3.COMPONENT_ITEM_NUMBER
    JOIN BOM b5 ON b5.FINISHED_GOOD_ITEM_NUMBER = b4.COMPONENT_ITEM_NUMBER
    JOIN BOM b6 ON b6.FINISHED_GOOD_ITEM_NUMBER = b5.COMPONENT_ITEM_NUMBER

    UNION ALL

    -- Nivel 7
    SELECT
      b1.FINISHED_GOOD_ITEM_NUMBER AS TopFG,
      b7.COMPONENT_ITEM_NUMBER     AS Component,
      b1.COMPONENT_QUANTITY * b2.COMPONENT_QUANTITY * b3.COMPONENT_QUANTITY * b4.COMPONENT_QUANTITY * b5.COMPONENT_QUANTITY * b6.COMPONENT_QUANTITY * b7.COMPONENT_QUANTITY AS Qty
    FROM BOM b1
    JOIN BOM b2 ON b2.FINISHED_GOOD_ITEM_NUMBER = b1.COMPONENT_ITEM_NUMBER
    JOIN BOM b3 ON b3.FINISHED_GOOD_ITEM_NUMBER = b2.COMPONENT_ITEM_NUMBER
    JOIN BOM b4 ON b4.FINISHED_GOOD_ITEM_NUMBER = b3.COMPONENT_ITEM_NUMBER
    JOIN BOM b5 ON b5.FINISHED_GOOD_ITEM_NUMBER = b4.COMPONENT_ITEM_NUMBER
    JOIN BOM b6 ON b6.FINISHED_GOOD_ITEM_NUMBER = b5.COMPONENT_ITEM_NUMBER
    JOIN BOM b7 ON b7.FINISHED_GOOD_ITEM_NUMBER = b6.COMPONENT_ITEM_NUMBER

    UNION ALL

    -- Nivel 8
    SELECT
      b1.FINISHED_GOOD_ITEM_NUMBER AS TopFG,
      b8.COMPONENT_ITEM_NUMBER     AS Component,
      b1.COMPONENT_QUANTITY * b2.COMPONENT_QUANTITY * b3.COMPONENT_QUANTITY * b4.COMPONENT_QUANTITY * b5.COMPONENT_QUANTITY * b6.COMPONENT_QUANTITY * b7.COMPONENT_QUANTITY * b8.COMPONENT_QUANTITY AS Qty
    FROM BOM b1
    JOIN BOM b2 ON b2.FINISHED_GOOD_ITEM_NUMBER = b1.COMPONENT_ITEM_NUMBER
    JOIN BOM b3 ON b3.FINISHED_GOOD_ITEM_NUMBER = b2.COMPONENT_ITEM_NUMBER
    JOIN BOM b4 ON b4.FINISHED_GOOD_ITEM_NUMBER = b3.COMPONENT_ITEM_NUMBER
    JOIN BOM b5 ON b5.FINISHED_GOOD_ITEM_NUMBER = b4.COMPONENT_ITEM_NUMBER
    JOIN BOM b6 ON b6.FINISHED_GOOD_ITEM_NUMBER = b5.COMPONENT_ITEM_NUMBER
    JOIN BOM b7 ON b7.FINISHED_GOOD_ITEM_NUMBER = b6.COMPONENT_ITEM_NUMBER
    JOIN BOM b8 ON b8.FINISHED_GOOD_ITEM_NUMBER = b7.COMPONENT_ITEM_NUMBER
  ) levels
  WHERE Component IS NOT NULL
  GROUP BY TopFG, Component
),

demand AS (
  -- Paso 4-6 del brick: explota el plan de produccion (SIN filtro de BU,
  -- igual que el SP) contra el BOM YA APLANADO (bom_flat, todos los
  -- niveles). DemandQty y FG agregados por Component + Fecha.
  SELECT
    f.Component                                                AS Component,
    CAST(p.PO_DATE_REQUESTED AS DATE)                          AS Fecha,
    SUM(f.Qty * p.qty)                                         AS DemandQty,
    GROUP_CONCAT(DISTINCT p.PARENT_ITEM ORDER BY p.PARENT_ITEM SEPARATOR ', ') AS FG
  FROM Plan p
  JOIN bom_flat f
    ON f.TopFG = p.PARENT_ITEM
  GROUP BY f.Component, CAST(p.PO_DATE_REQUESTED AS DATE)
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
