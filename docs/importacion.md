# Importación de catálogos

Un Excel XLSX puede contener una o más hojas con estos nombres y encabezados. Para CSV UTF-8 se carga una sola tabla por archivo. Colocar los encabezados en la primera fila.

| Hoja | Encabezados |
|---|---|
| proveedores | nit, digito_verf, nombre_largo, nombre_corto, es_maquila, es_materiales, activo |
| categorias | nombre_categoria, iva |
| tipos_materiales | tipo_material |
| materiales | codigo_maia, tipo_material, nombre_material |
| productos | nombre_producto, nit_maquilador, categoria, unidades_lote, activo, codigo_barras |

Formatear NIT, dígitos de verificación y códigos como texto en Excel. Usar Sí/No para booleanos. Completar proveedores, categorías y tipos antes de productos y materiales si llegan en CSV separados. En un libro se procesan automáticamente en orden de dependencia. El código MAIA tiene tres dígitos. Corrugado puede quedar vacío. El código de barras de un producto puede quedar vacío hasta que esté asignado. GIMED debe revisar el código asignado antes de emitir.

```powershell
node --env-file=.env --import tsx scripts/importar.ts catalogos.xlsx
node --env-file=.env --import tsx scripts/importar.ts catalogos.xlsx --apply
node --env-file=.env --import tsx scripts/importar.ts proveedores.csv --tabla=proveedores
```

La primera ejecución valida y reporta errores. Agregar `--punto-y-coma` para CSV separados por punto y coma. Con `--apply`, una sola transacción guarda los cambios y el identificador de carga. El hash evita duplicar una carga ya confirmada. El importador usa las claves descritas en el archivo y valida referencias. La salida operativa añade un importador de órdenes históricas después de acordar fuente, mapeo y conciliación de máximos OC/OCM, importes, lotes, facturas y objetos.

Después de una carga histórica validada, usar `node --env-file=.env --import tsx scripts/reconciliar-consecutivos.ts` para revisar los máximos por grupo y repetir con `--apply` para elevar la base cuando corresponda.
