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
| `Base`    | Decimal | Denominador (solo para `%`; en los demás, 0 o nulo) |
| `Formato` | Texto   | `%`, `$` o `#` |

Una fila por **Planta + Metrico + Fecha** (agrupado por día).

**¿Por qué Valor y Base por separado?** Un porcentaje no se puede sumar ni
promediar entre días: el brick suma `Valor` y `Base` de todos los días del
periodo (año, mes, semana o día) y divide al final. Así el % del mes queda
ponderado por la cantidad real de conteos.

- `%` → `SUM(Valor) / SUM(Base)`
- `$` y `#` → `SUM(Valor)`

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

## Siguientes métricos

Copia el patrón: cada rama termina en las mismas 6 columnas, con los mismos
nombres y tipos, y todas entran a un **Append Rows** → **Output Dataset**
"Tablero Metricos - Consolidado". Para que la fila salga en un orden fijo,
agrega su nombre a `METRIC_ORDER` en `app.js`.
