# Fixtures de contratos de fuente

Estos JSON son sintéticos y deliberadamente no contienen IDs reales, clientes,
órdenes reales ni payloads descargados. Solo ejercitan el contrato camelCase /
GID del CDN, ACTIVE/DRAFT, precios no positivos, disponibilidad separada del
inventario, imagen URL y el envoltorio GraphQL de órdenes.

Fuentes auditadas (no se guardan aquí):

- `https://cdn.shopify.com/s/files/1/0983/2752/7703/files/products_catalog.json?v=1779763986`
- `https://cdn.shopify.com/s/files/1/0983/2752/7703/files/order_data.json?v=1779763985de`

El snapshot remoto se valida en memoria. El único artefacto persistible que el
validador puede emitir es un manifest con URL, status, bytes, timestamp, hash y
conteos; nunca IDs, `customer.id`, órdenes, line items o el body crudo.
