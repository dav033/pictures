# ADR 0003: extracción reproducible del servicio AI API en Etapa 4

- Estado: aceptada para preparación local; cutover externo bloqueado.
- Fecha: 2026-09-07.

## Problema

La base FastAPI de Etapa 3 vive en `services/ai-api/`, pero la decisión
arquitectónica apunta a un repositorio hermano `demo-decoracion-api/`. En este
checkout no existe esa carpeta ni hay autorización visible para crearla,
publicarla o conectar sus secretos y base de datos.

## Decisión

Mantener `services/ai-api/` como fuente local y preparar extracción reproducible
con `scripts/extract-ai-api.ps1`. La extracción exige:

- destino explícito fuera de este checkout;
- `-Authorized` entregado por quien administra el repositorio destino;
- destino inexistente o vacío, sin sobrescritura;
- copia de `services/ai-api/` a `services/ai-api/` y de `contracts/` a
  `contracts/`, conservando rutas que usa el generador Pydantic;
- manifiesto de origen y commit, sin secretos ni `DATABASE_URL`.

El script ejecuta preflight por defecto. Sin autorización, solo informa el gate
y no crea `demo-decoracion-api/`.

## Alternativas descartadas

- Crear `demo-decoracion-api/` automáticamente: inventaría destino y propiedad.
- Copiar el servicio a `services/image-api/`: esa carpeta no es el destino
  arquitectónico y no resuelve ownership.
- Aplanar el servicio en otro layout: rompería las rutas relativas del
  generador y dificultaría comparar la extracción con la fuente.
- Copiar secretos o archivos `.env`: riesgo de fuga y no son parte del artefacto
  reproducible.

## Consecuencias

- La Etapa 4 puede validar localmente el artefacto sin tráfico externo.
- El repo hermano debe aceptar explícitamente el layout y revisar el manifiesto.
- La extracción no despliega, no aplica SQL y no habilita Python.
- Next sigue siendo fachada, autoridad comercial y rollback inmediato.

## Gates externos

Antes de extraer en un destino real deben existir, por escrito y en el entorno
autorizado:

1. propietario y ruta/repositorio `demo-decoracion-api`;
2. gestor de secretos con `INTERNAL_HMAC_SECRET` de al menos 32 bytes y
   rotación acordada;
3. destino de ejecución, imagen/runtime y permisos de health/readiness;
4. base PostgreSQL desechable autorizada para aplicar la DDL de
   `scripts/migrations/020_operational_idempotency.sql`;
5. adaptador Next por endpoint con HMAC, IDs, hash, scopes, nonce,
   idempotencia y errores estables;
6. observabilidad y rollback verificados en staging.

## Rollback

No se cambia tráfico para extraer. Antes de cualquier activación, apagar
`PYTHON_BACKEND_ENABLED` o activar `PYTHON_BACKEND_KILL_SWITCH`; el segundo
siempre gana. Mantener rutas legacy Next hasta validar replay, conflicto,
errores, límites y rollback controlado.
