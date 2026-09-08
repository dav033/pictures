# Inventario LoRA y recuperación

**Corte:** 2026-09-08. **Método:** lectura estática del repositorio y del
filesystem local. No se consultó ninguna base de datos real, no se llamó a
fal.ai, Shopify ni a otro proveedor, y no se ejecutó ninguna sincronización.

## Conclusión ejecutiva

Los pesos entrenados no viajan al EC2. La aplicación conserva una referencia
remota a fal.ai y existen copias locales en `data/lora-backup/` y, para las
corridas registradas por el almacén local, en
`data/lora-artifacts/runs/`. Esas copias están en el mismo filesystem, están
excluidas de Git y no las toca la sincronización SSH. Por eso no hay hoy una
copia verificada e independiente fuera de fal.ai y de ese disco local.

La URL de fal.ai permite recuperar el peso mientras el proveedor conserve el
archivo y la URL siga siendo válida. Si se pierde esa URL o el proveedor la
elimina, perder el último filesystem local conocido implica perder los bytes
exactos: reentrenar con los mismos parámetros no reproduce los mismos pesos
(`scripts/recibir-lora.ts:15-17`). Los conteos actuales de corridas no están
verificados; requieren la consulta de la sección 5 contra la base real.

## 1. Ubicación de cada artefacto

La base de datos conserva referencias, hashes, estados y metadatos, no el
contenido binario. `lora_artifacts` tiene `storage_key`, `provider_url`,
`sha256` y `bytes`, pero no una columna de contenido
(`scripts/migrations/016_lora_specializations.sql:77-93`). El contenido local
lo escribe `artifact-store-local.ts`, cuyo root por defecto es
`data/lora-artifacts` (`src/lib/lora/artifact-store-local.ts:8-10`).

| Artefacto | Dónde vive hoy | Evidencia y límite de recuperación |
|---|---|---|
| Pesos `.safetensors` entrenados | URL en `lora_artifacts.provider_url` y también `lora_training_runs.result_url`; copias locales en `data/lora-backup/*.safetensors` y en `data/lora-artifacts/runs/<run>/weights.safetensors`. El checkout actual contiene, entre otras, las rutas de las corridas registradas `lora-run-v004-1000` y `lora-run-v007-1000`. | `lora_training_runs` registra URL, `weight_storage_key`, SHA y tamaño (`015:120-154`). `recibir-lora.ts` descarga a `data/lora-backup` (`23`, `57-66`). `backfill-lora-registry.ts` y `registrar-lora-v007-fal.ts` escriben además el peso en el almacén local (`backfill:326-334`; `registrar:170-186`). Los binarios locales no están versionados ni replicados. |
| Dataset de imágenes | ZIP y manifiesto en `data/lora-artifacts/datasets/<dataset-id>/`; imágenes fuente en `data/staging/recaption-v004/original` y, para fotos de órdenes, en `ORDENES_DECORACION_DIR`. El snapshot prepara una copia recomprimida de la galería en `data/snapshot/imagenes`. | Las rutas fuente están en `snapshot-imagenes.ts:20-24` y `dataset-v005-view.ts:47-57`. El registro SQL conserva conteos, hashes, `zip_storage_key`, `manifest_storage_key` y metadatos (`015:9-44`, `50-70`). El ZIP local se guarda mediante `artifact-store-local` (`backfill:331`; `registrar:20-23`, `150-158`). La tabla no conserva por sí sola los bytes de las fotos. |
| Captions | Archivos `.txt` en `data/staging/recaption-v004/nuevo` y `data/staging/lora-v007/captions`; también dentro de los ZIP/manifiestos locales. Para el dataset de estructura existe `data/lora-artifacts/datasets/lora-dataset-structure-v001-114/captions.jsonl`. | `dataset-v005-view.ts:49-53`, `231-239` lee captions desde disco. `build-structure-dataset-v001.ts:251-254` guarda un `caption_bundle`. La base guarda `caption_count`, `caption_sha256`, auditoría y estadísticas, no el texto completo (`015:17-24`, `50-68`; `016:15-25`). |
| Metadata de evaluación | Reportes fuente en `reports/lora-debug/`; reportes recibidos también en `data/lora-artifacts/runs/<run>/evaluation-report-*.json`. La base conserva `lora_evaluations.result_snapshot` y `report_storage_key`, además del estado de evaluación de la corrida. | `registrar-evaluacion-product-v007.ts:19-21`, `54-74`, `81-109`; esquema de evaluación en `015:162-178`; tipos de artefacto admitidos en `016:77-93`. El reporte es recuperable desde la base solo si la `storage_key` apunta a un almacén que todavía exista. |
| Registro de corridas y activación | PostgreSQL: `lora_training_runs`, `lora_datasets`, `lora_evaluations`, `lora_mode_slots`, `lora_mode_slot_history` y `lora_jobs`. También hay receipts JSON locales en `data/lora-artifacts/runs/` y procedencias en `data/lora-backup/`. | Tablas y relaciones en `015:9-45`, `120-228` y artefactos especializados en `016:77-150`. `lora_mode_slots.training_run_id` enlaza el modo activo con una corrida (`015:184-205`). La interfaz lista corridas, pero no calcula un conteo total (`src/lib/lora/repository.ts:358-395`). |

### Cómo se usa el peso en producción

El resolver de producción toma `lora_artifacts.provider_url`, exige que el
artefacto sea de tipo `weights`, que su estado sea `backed_up`, que la corrida
esté completada y que la evaluación esté aprobada. Después asigna esa URL a
`path` (`src/lib/lora/mode-resolver.ts:166-213`). El generador no abre un
archivo local: `lorasFor` envía `{ path: lora.path, scale }` a fal.ai
(`src/lib/ia/sempertex-lora.ts:156-176`, `227-229`).

El campo `artifact_status = 'backed_up'` es una constancia en la base, no una
prueba de que exista una segunda copia independiente. La auditoría no encontró
un script que cruce cada fila activa o exitosa contra un archivo local y su
hash. El estado real por corrida queda **no verificado, requiere consulta
contra la base real**.

## 2. Qué sincroniza realmente SSH al EC2

`buildSnapshot()` construye únicamente tres grupos de datos:

- `composicion`, leída del JSON local de composición.
- `datasetGallery`, leída desde las fuentes locales de galería y sus captions.
- `estadisticasOrdenes`, calculada desde la carpeta local de órdenes.

La composición del snapshot está en `src/lib/lora/snapshot.ts:12-29` y la
construcción en `49-55`. El JSON se escribe en
`data/snapshot/lora-estado.json` (`41-43`, `65-74`). La publicación lo copia
por `scp` y `docker cp` al volumen del contenedor
(`src/lib/lora/snapshot.ts:166-177`).

Las imágenes de galería se preparan por separado, se recomprimen y se envían
como un tar a `/app/data/snapshot/imagenes`; no son los originales ni un ZIP
canónico del dataset (`src/lib/lora/snapshot-imagenes.ts:80-123` y
`src/lib/lora/snapshot.ts:104-133`).

### No se sincroniza

`snapshot.ts` no lee ni copia `data/lora-backup`, `data/lora-artifacts`,
`*.safetensors`, los ZIP canónicos, `captions.jsonl`, el registro PostgreSQL,
los reportes de evaluación ni los receipts. Por tanto, SSH no constituye un
backup de pesos, dataset, captions o registro; solo publica el snapshot JSON y
la galería preparada.

Además, el estado local de la última publicación observada es
`data/snapshot/estado-publicacion.json:1-8`, con `ok: false` y el error
`tar: Cannot connect to C: resolve failed`. No hay evidencia local de que el
último snapshot completo haya llegado al EC2. Esto no permite afirmar que el
EC2 tenga una copia íntegra y reciente.

## 3. Pérdida del disco o volumen del EC2

Esta sección supone que PostgreSQL es un servicio separado y sigue disponible.
No se verificó esa topología mediante una conexión real.

| Resultado tras perder EC2 | Artefactos | Motivo |
|---|---|---|
| Recuperable de forma condicionada | Pesos cuyo `provider_url` o `result_url` siga en PostgreSQL o en otro receipt local y cuyo archivo siga disponible en fal.ai. | El runtime vuelve a referenciar la URL remota; fal.ai entrega el peso al usarla. La recuperación depende de la retención del proveedor. |
| Recuperable de forma condicionada | Registro de corridas, estados, hashes y evaluación almacenados en PostgreSQL. | No viven en el volumen Docker según el código revisado; se pueden volver a desplegar si la base independiente permanece intacta. No existe, sin embargo, un backup/restore de esa base verificado en esta fase. |
| No recuperable automáticamente | `data/snapshot/lora-estado.json` y `data/snapshot/imagenes` que solo estuvieran en el volumen EC2. | No existe un pull o restore desde EC2. Se pueden regenerar desde el filesystem local si las fuentes siguen allí y se publica un snapshot nuevo, pero la última publicación no está confirmada como exitosa. |
| No recuperable desde EC2 | `.safetensors`, ZIP completos, bundles de captions y reportes que no estén en el snapshot. | `snapshot.ts` nunca los copia al servidor. |

Perder el volumen EC2 no elimina por sí mismo las copias que siguen en la
máquina local ni las URLs de la base. Sí elimina la comodidad operativa de la
galería y las estadísticas ya materializadas; su recuperación es manual y
depende de que todavía existan las fuentes locales.

## 4. Pérdida de la máquina que ejecutó `recibir-lora.ts`

El script valida el encabezado safetensors, descarga el archivo completo y lo
escribe como `data/lora-backup/sempertex-<etiqueta>.safetensors`; luego escribe
`PROCEDENCIA-<etiqueta>.json` con URL, tamaño, SHA, parámetros y resultado de
evaluación (`scripts/recibir-lora.ts:23-24`, `51-94`). No copia esos archivos al
EC2 ni a Git.

`.gitignore` excluye `/data/*` (`.gitignore:40-56`). La exclusión cubre tanto
`data/lora-backup/` como `data/lora-artifacts/` y `data/snapshot/`. El checkout
actual sí contiene pesos bajo ambos directorios locales, pero no son copias
independientes: están en el mismo disco y no hay evidencia de que se hayan
replicado a otro destino. Por eso la formulación operativa de la auditoría,
"la única copia local conocida" en `data/lora-backup/`, debe entenderse como el
único backup manual identificado; el riesgo material es la ausencia de una
copia verificada fuera de ese filesystem y de fal.ai.

Si se pierde esa máquina:

- La URL de fal.ai, el hash y parte de la procedencia pueden seguir en PostgreSQL o en otro receipt, pero el hash no reconstruye el binario.
- El peso exacto se puede volver a descargar solo si la URL de fal.ai todavía funciona.
- Si fal.ai elimina o hace expirar el objeto y no queda otra copia local, el LoRA exacto queda perdido; reentrenar no lo sustituye bit a bit.
- Los ZIP y captions pueden reconstruirse parcialmente desde Shopify, las fuentes de órdenes o el staging que sobreviva, pero las anotaciones y captions manuales no están garantizados por esas fuentes.

Este es el riesgo más alto encontrado: el control `backed_up` puede estar
marcado en la base aunque todas las copias físicas conocidas estén en un solo
disco no versionado y no sincronizado.

## 5. Consulta SQL pendiente

No se ejecutó esta consulta y no se debe inferir ningún número del repositorio.
No se identificó un script que haga un `COUNT` de `lora_training_runs`; los
helpers actuales listan una ventana de corridas recientes
(`src/lib/lora/repository.ts:358-395`) o consultan alertas recientes
(`397-422`).

Esta es la consulta exacta que debe ejecutar un operador contra la base real:

```sql
SELECT
  COUNT(*) AS total_sin_backup_verificado,
  COUNT(*) FILTER (
    WHERE status IN ('uploading', 'queued', 'running')
  ) AS activas_sin_backup,
  COUNT(*) FILTER (
    WHERE status IN ('succeeded', 'completed')
  ) AS completadas_sin_backup,
  COUNT(*) FILTER (
    WHERE status = 'ready'
  ) AS listas_016_sin_backup
FROM lora_training_runs
WHERE status IN (
    'uploading', 'queued', 'running',
    'succeeded', 'completed', 'ready'
  )
  AND artifact_status IS DISTINCT FROM 'backed_up';
```

La consulta incluye `completed` porque `016_lora_specializations.sql:60-70`
transforma corridas históricas `succeeded` y permite ambos estados. Incluye
`ready` de forma conservadora porque la misma migración lo admite, aunque el
resolver actual considera completadas solo `succeeded` y `completed`
(`src/lib/lora/mode-resolver.ts:83-94`). `IS DISTINCT FROM` también captura
un `artifact_status` nulo, si existiera por datos históricos.

El resultado seguirá siendo un inventario declarativo de la tabla. Para llamar
a un artefacto realmente utilizable en producción también debe existir una fila
`lora_artifacts` de tipo `weights`, con `status = 'backed_up'` y
`provider_url` válida; esa es la comprobación que aplica
`mode-resolver.ts:180-207`. El número real de filas y el cruce físico de hashes
quedan **no verificados, requieren consulta contra la base real y revisión del
filesystem**.

## 6. Riesgos, de mayor a menor

1. **Pérdida de los pesos exactos entrenados.** Un `.safetensors` no se puede reconstruir reentrenando. Las copias conocidas están concentradas en un filesystem local no versionado; el EC2 no las contiene. La única contingencia externa es que fal.ai conserve la URL.
2. **Pérdida de la URL o de la procedencia que permite identificar el peso.** Aunque el binario siga temporalmente en fal.ai, perder el enlace, el SHA, el trigger o la relación corrida-dataset puede impedir volver a seleccionarlo de forma segura. La base y los receipts reducen este riesgo solo mientras sobrevivan.
3. **Pérdida de metadata de evaluación y registro operativo.** Reportes, veredictos, parámetros y asignaciones de slot son costosos de rehacer y pueden provocar activar el peso equivocado. La parte PostgreSQL no está cubierta por un restore verificado en esta fase.
4. **Pérdida de captions, anotaciones y manifiestos.** Los ZIP/manifiestos y fuentes locales ayudan, pero el texto auditado y las decisiones manuales no se derivan siempre de Shopify o de una foto original.
5. **Pérdida de imágenes del dataset.** Es grave para reproducir una corrida, pero algunas fuentes pueden volver a descargarse de Shopify o de la fuente original. Las fotos de órdenes y sus permisos no deben darse por recuperables sin comprobar cada origen.
6. **Pérdida del snapshot de estadísticas y galería del EC2.** Afecta la operación y la inspección, pero es un artefacto derivado que puede regenerarse si sobreviven la base y las fuentes. En el estado observado ni siquiera hay una publicación completa confirmada.
