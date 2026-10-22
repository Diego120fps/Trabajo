# ETL "Tablero Metricos - Consolidado"

Un solo Magic ETL que convierte cada dataset de métrico al mismo formato y
los une con **Append Rows**. El brick lee únicamente la salida de este ETL.

## Columnas de salida (iguales en todos los métricos)

| Columna   | Tipo    | Qué lleva |
|-----------|---------|-----------|
| `Planta`  | Texto   | PLATAFORMA, AMP, CALLE 2, ... |
| `Metrico` | Texto   | Nombre de la fila en el tablero, ej. `Accuracy` |
| `Fecha`   | Fecha   | Día (sin hora) |
| `Valor`   | Decimal | Numerador, o el valor tal cual para `$` y `#` |
| `Base`    | Decimal | Denominador. Vacío/0 = el brick solo suma `Valor` |
| `Formato` | Texto   | `%`, `$`, `#` o `d` (días); solo cambia cómo se muestra |

Una fila por **Planta + Metrico + Fecha** (agrupado por día).

**¿Por qué Valor y Base por separado?** Un porcentaje no se puede sumar ni
promediar entre días: el brick suma `Valor` y `Base` de todos los días del
periodo (año, mes, semana o día) y divide al final. Así el % del mes queda
ponderado por la cantidad real de conteos.

- Con `Base` → `SUM(Valor) / SUM(Base)` (%, días de inventario, o el
  promedio de una foto diaria usando `Base = 1`)
- Sin `Base` → `SUM(Valor)` (flujos: costo, piezas, documentos)

## Rama 1: Accuracy

Input: **JDE 9.0 - View - Inventory Cycle Counts**

1. **Add Formula**
   - `Planta`:
     ```sql
     CASE
       WHEN TRIM(`ITEM_BRANCH_PLANT`) IN ('1221','2300') THEN 'PLATAFORMA'
       WHEN TRIM(`ITEM_BRANCH_PLANT`) = '2200' THEN 'AMP'
       WHEN TRIM(`ITEM_BRANCH_PLANT`) = '2190' THEN 'CALLE 2'
     END
     ```
     (`TRIM` por si JDE trae el Branch/Plant con espacios a la izquierda.)
   - `Delta`: `` `CCD_Total_Prim_Qty_on_Hand` - `CCD_Physical_Quantity` ``
   - `Fecha`: ``DATE(`CCD_Count_Date`)``
2. **Filter Rows**: `Planta` *is not null* (descarta las demás plantas).
3. **Add Formula**
   - `Valor`: `CASE WHEN `Delta` = 0 THEN 1 ELSE 0 END`
   - `Base`: `CASE WHEN `Delta` IS NULL THEN 0 ELSE 1 END`
     (equivale a `SUM(Delta = 0) + SUM(Delta <> 0)` de la fórmula original)
4. **Group By** `Planta`, `Fecha` → `Valor` = Sum of `Valor`, `Base` = Sum of `Base`.
5. **Add Constants**: `Metrico` = `Accuracy`, `Formato` = `%`.
6. **Select Columns**: `Planta`, `Metrico`, `Fecha`, `Valor`, `Base`, `Formato`.

## Rama 2: Capacidad (tile SQL dentro del Magic ETL)

Inputs conectados al tile SQL: `reference_layoutwh`, `InventoryHistoryGDL`.
Sin comentarios `--` (el tile junta todo en una línea y comentaría el resto)
y sin `CAST(... AS DECIMAL(p,s))` (no lo acepta). `COUNT` ya regresa entero,
igual que la suma de 1/0 de Accuracy, así que el Append recibe el mismo tipo.

```sql
SELECT
    inv.Planta,
    'Capacidad' AS Metrico,
    inv.Fecha,
    COUNT(DISTINCT inv.Localidad) AS Valor,
    MAX(tot.Total) AS Base,
    '%' AS Formato
FROM (
    SELECT
        DATE(i.`UPDATED_TIMESTAMP`) AS Fecha,
        CASE
            WHEN TRIM(i.`ILOC_BRANCH_PLANT`) IN ('1221','2300') THEN 'PLATAFORMA'
            WHEN TRIM(i.`ILOC_BRANCH_PLANT`) = '2200' THEN 'AMP'
            WHEN TRIM(i.`ILOC_BRANCH_PLANT`) = '2190' THEN 'CALLE 2'
        END AS Planta,
        i.`ILOC_LOCATION` AS Localidad
    FROM `InventoryHistoryGDL` i
) inv
JOIN `reference_layoutwh` l
    ON l.`Localidad` = inv.Localidad
   AND l.`BU` = inv.Planta
JOIN (
    SELECT `BU` AS Planta, COUNT(DISTINCT `Localidad`) AS Total
    FROM `reference_layoutwh`
    WHERE `BU` IN ('PLATAFORMA','AMP','CALLE 2')
    GROUP BY `BU`
) tot
    ON tot.Planta = inv.Planta
WHERE inv.Planta IS NOT NULL
GROUP BY inv.Planta, inv.Fecha
```

- El JOIN contra el layout hace que solo cuenten localidades que existen en
  él (nunca pasa de 100%).
- `tot.Total` es el total de localidades del layout por planta; no depende
  de la fecha (con el LEFT JOIN original las vacías quedaban con Fecha nula).
- Si el histórico trae renglones con existencia 0, agrega
  `WHERE <cantidad_en_mano> > 0` dentro del subquery `inv`.

Capacidad es una foto del día (no un flujo): en el tablero, el día muestra
la ocupación de ese día y la semana / mes / año muestran la **ocupación
promedio** del periodo (localidades ocupadas-día / localidades totales-día).

## Rama 3: Days of Supply + Inventario $ (borrador, faltan datos)

Fórmula por planta y día:

    Days of Supply = Inventario $ del día / Consumo diario promedio $
    Consumo diario promedio $ = Consumo $ de los últimos N días / N

Se usa $ (no piezas) porque a nivel planta no se pueden sumar piezas de
items con distinta unidad de medida.

**Datos necesarios**
1. Inventario diario por item y planta (foto de cada día): cantidad en mano
   y costo unitario (o el valor ya calculado). ¿Lo trae `InventoryHistoryGDL`?
2. Consumo: movimientos de salida del Item Ledger (F4111, el dataset del
   pivote: `ilmcu`, `iltrdj`, `ildct`, `ilpaid`). Falta definir qué tipos de
   documento (`ildct`) cuentan como consumo.
3. N = ventana del promedio (ej. 30 o 90 días naturales).
4. Calendario (ej. dataset "Domo Dimensions - calendar") para tener un
   renglón por día aunque no haya consumo, antes de la ventana móvil.

**Pasos (Magic ETL)**
1. Inventario: Group By `Planta`, `Fecha` → `Inventario` = SUM(cantidad × costo).
2. Consumo: Filter `ildct` in (tipos de consumo); `Planta` desde `ilmcu`
   (en blanco = 1221); `Fecha` desde `iltrdj` juliano; `Consumo` = ABS(`ilpaid`) / 100;
   Group By `Planta`, `Fecha`.
3. Cross join Planta × calendario, Left Join del consumo, nulos → 0.
4. Rank & Window: SUM(`Consumo`) de los N renglones anteriores (incluye el
   día) por `Planta` ordenado por `Fecha` → `ConsumoN`.
5. Join (inner) con inventario por `Planta`, `Fecha`.
6. Dos salidas que entran al Append:
   - `Metrico` = `Days of Supply`, `Formato` = `d`, `Valor` = `Inventario`,
     `Base` = `ConsumoN` / N
   - `Metrico` = `Inventario`, `Formato` = `$`, `Valor` = `Inventario`, `Base` = 1

En el tablero: el día muestra los días de ese día; semana / mes / año
muestran inventario promedio / consumo diario promedio del periodo.
Inventario $ muestra el promedio diario del periodo (no la suma).

## Siguientes métricos

Copia el patrón: cada rama termina en las mismas 6 columnas, con los mismos
nombres y tipos, y todas entran a un **Append Rows** → **Output Dataset**
"Tablero Metricos - Consolidado". Para que la fila salga en un orden fijo,
agrega su nombre a `METRIC_ORDER` en `app.js`.
