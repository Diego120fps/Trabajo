# Brick: Comentarios por SKU (AppDB + ETL join)

App tipo "brick" (código pegado en App Studio) para agregar comentarios a
registros de un dataset primario, guardándolos en una colección AppDB y
mostrándolos en una tabla ya unida (join) con el dataset primario.

## Cómo funciona

1. **Dataset primario**: tu dataset existente (SKU, Categoría, etc.), sin tocar.
2. **Colección AppDB `comentarios_sku`**: la crea esta misma app la primera
   vez que corre (función `ensureCollection` en `app.js`), con las columnas
   `sku, categoria, issue, comentarios, fecha_guardado`. Cada "Guardar" en el
   formulario inserta un documento **nuevo** (no sobreescribe), así queda un
   historial completo por SKU.
3. **Dataset espejo de la colección**: al crear una colección AppDB con
   `schema` (columnas tipadas), Domo genera automáticamente un dataset de
   solo lectura con esos mismos documentos, visible en *Data Center*. Ese es
   el dataset que se usa del lado del ETL para el join (no se escribe
   directo a un dataset "comentarios", se escribe a AppDB y Domo lo
   sincroniza).
4. **ETL (Magic ETL)**: se hace *fuera* de este brick, en Domo:
   - Input 1: dataset primario.
   - Input 2: dataset espejo de `comentarios_sku`.
   - Tile **Join**: `LEFT JOIN` primario → comentarios por `sku`.
   - Como puede haber varios comentarios por SKU (es un historial), agrega
     un tile **Rank & Window**: `PARTITION BY sku`, `ORDER BY fecha_guardado DESC`,
     y luego un **Filter** `rank = 1`, para quedarte con el comentario más
     reciente por SKU.
   - Output: dataset unido (el que usa este brick).
5. **Este brick**: lee el dataset unido (`dataset[0]`) y lo pinta en la
   tabla. Al hacer clic en una fila, abre el panel lateral con SKU/Categoría
   (solo lectura) + desplegable de Issue + comentario libre. Al guardar:
   - Inserta el documento en AppDB.
   - Actualiza la fila en pantalla al instante (no espera a que corra el
     ETL, que es por horario, no en tiempo real).
   - Recarga el historial de esa SKU consultando AppDB directamente.

## Configuración a ajustar en `app.js`

- `FIELD_SKU`, `FIELD_CATEGORIA`, `FIELD_ISSUE`, `FIELD_COMENTARIO`,
  `FIELD_FECHA`: nombres de columna reales en tu dataset unido.
- `EXTRA_COLUMNS`: columnas adicionales del dataset primario que quieras
  mostrar en la tabla.
- `ISSUE_OPTIONS`: catálogo real de issues para el desplegable.
- `COLLECTION_NAME`: nombre de la colección AppDB (por defecto
  `comentarios_sku`).

## Publicar en Domo

1. Domo → **Apps** → **App Studio** → crear app nueva tipo "Code"/brick.
2. Pega el contenido de `index.html`, `app.js` y `style.css` en el editor
   correspondiente.
3. Asigna el **dataset unido** (salida del ETL) en el selector de dataset
   del brick (`datasets[0]`).
4. Publica y agrégalo a una página/card.
5. La primera vez que se abra, la app creará sola la colección AppDB si no
   existe.

## Nota importante sobre la API de AppDB

El código usa las rutas estándar documentadas por Domo para AppDB
(`/domo/datastores/v1/collections/...`, con `domo.get/post` para
crear/consultar colecciones y documentos). No pude verificar estas rutas
contra la documentación en vivo (`domo.com` está bloqueado desde este
entorno), así que **antes de usarlo en producción**:

- Abre la consola del navegador la primera vez que cargue el brick y
  confirma que `ensureCollection` no tira error al crear la colección.
- Si tu instancia de Domo usa una ruta o forma de payload distinta (por
  ejemplo, versiones más nuevas del App Framework), ajusta las constantes
  `COLLECTION_BASE` / `COLLECTION_DOCS` y las funciones `ensureCollection`,
  `saveComment` y `fetchCommentsForSku` en `app.js` según lo que indique
  https://www.domo.com/docs/portal/API-Reference/app-framework-apis/AppDB-API
- Si el endpoint de consulta `.../documents/query` no existe o espera otro
  formato de body, el código ya tiene un *fallback* automático: trae todos
  los documentos de la colección y filtra por SKU en el navegador.
