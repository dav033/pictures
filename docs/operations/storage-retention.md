# Storage y retención

## Reglas

- Buckets separados por `dev`, `staging` y `prod`.
- Acceso público desactivado; cifrado requerido.
- URLs firmadas con TTL corto; no devolver rutas internas.
- Raw es inmutable durante una versión; sanitized y manifests son reproducibles.
- Quarantine se conserva hasta decisión humana y luego sigue el procedimiento de borrado aprobado.
- Logs no contienen API keys, base64, PII, imágenes privadas ni tokens de sesión.

## Pendientes

Proveedor de storage, región, lifecycle, retención exacta, acceso del proveedor de inferencia y
procedimiento de borrado verificable. Ningún bucket externo fue creado.
