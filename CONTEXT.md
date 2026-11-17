# Seguimiento de órdenes de compra

Vocabulario del proceso de emisión y seguimiento de órdenes de compra de GIMED.

## Órdenes

**Orden de compra**:
Documento emitido a un proveedor que agrupa hasta siete conceptos solicitados y conserva un número dentro del consecutivo correspondiente.

**Renglón de orden**:
Concepto individual solicitado dentro de una orden de compra, con su propia cantidad y seguimiento de entrega.

**Renglón de producto**:
Producto solicitado dentro de una OC, con su cantidad, precio y materiales de empaque. Sus entregas previstas o recibidas se distinguen mediante lotes de producto.

**Orden de producto (OC)**:
Orden de compra cuyos renglones solicitan productos a un maquilador. OC es su prefijo de identificación en la aplicación.

**Orden de material (OCM)**:
Orden de compra cuyos renglones solicitan materiales identificados en el catálogo de materiales. Comparte el prefijo OCM y el grupo de numeración con las órdenes de otros.

**Orden de otros (OCM)**:
Orden de compra de bienes o servicios ocasionales cuyos conceptos se describen directamente en la orden, sin incorporarlos al catálogo de materiales. Usa el prefijo OCM y el mismo grupo de numeración que las órdenes de material.

**Consecutivo de órdenes**:
Secuencia de números del grupo de productos o del grupo compartido por materiales y otros. Un número puede coincidir entre grupos, pero no repetirse dentro de uno.

**Abastecimiento de material**:
Relación entre un renglón de material y un renglón de producto que indica que la compra del material contribuye a abastecer ese producto. La relación no expresa cuántas unidades se asignaron.

**Necesidad de material pendiente**:
Material específico requerido por un renglón de producto en seguimiento de una OC autorizada, cuya compra todavía no está respaldada por un renglón no anulado de una OCM. Corrugado, cinta y sticker se compran para inventario.

**OCM consolidada**:
Orden de material que reúne compras destinadas a renglones de producto de una o varias OC. Cada material conserva sus propios orígenes de abastecimiento.

**Adicional de material**:
Porcentaje que incrementa la cantidad base necesaria de un material al preparar su compra. La cantidad final puede ajustarse antes de emitir la OCM.

## Entregas

**Lote de producto**:
Entrega prevista o recibida de un producto solicitado en una orden; un mismo renglón de producto puede tener varios lotes, cada uno con su propia estimación de batch record.

**Lote inicial**:
Primer lote previsto de un renglón de producto, cuyo número y datos de recepción aún se desconocen.

**Fecha estimada de batch record**:
Fecha prevista para la entrega del batch record de un lote de producto. Distintos lotes del mismo producto pueden tener estimaciones diferentes.

**Recepción física**:
Lote de producto o renglón de material u otros con cantidad recibida mayor que cero o fecha real de recepción presente.

**Cantidad registrada**:
Valor informado de cantidad recibida, incluido cero. Una fecha real sin cantidad conserva la cantidad como no registrada.

**Registro efectivo**:
Renglón o lote no anulado que se considera al consultar el seguimiento. Los cerrados pueden conservar pendientes documentales. Las condiciones conjuntas de un lote se evalúan sobre ese mismo registro.

**Recepción de material**:
Entrega única seguida para cada renglón de una orden de material, sin subdivisión en lotes dentro del sistema.

**Cantidad recibida de material**:
Cantidad entregada y registrada para un renglón de una orden de material; en este proceso corresponde a la cantidad facturada.
_Avoid_: Cantidad facturada como un dato independiente.

## Documentos

**Documento vigente**:
Archivo actual de una clase para un propietario: orden escaneada de una OC u OCM, documento de una factura o certificado de un lote de material. Cada propietario conserva como máximo uno de cada clase; la plantilla de liberación es global y única.

**Reemplazar documento**:
Corregir el archivo vigente y sus metadatos conservando su identidad, propietario y clase.
