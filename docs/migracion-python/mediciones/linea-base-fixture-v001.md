# Línea base IA — fixture v001

Fecha: 2026-09-08  
Fuente: fixture sintético versionado  
Proveedor pagado: no  
Base remota: no

| Escenario | Referencia histórica real | p50 del fixture | Interpretación |
|---|---:|---:|---|
| Parser default | 4.478 ms, n=12 | 4.478 ms | Solo calibración |
| Parser `MINIMAL` | 1.263 ms, n=12 | 1.263 ms | Solo calibración |
| Chat `medium` | 14.047 ms, n=7 | 14.047 ms | Solo calibración |
| Chat `low` | 7.166 ms, n=7 | 7.166 ms | Solo calibración |

Estas coincidencias no son una reproducción de la API real. Validar el criterio
±15% real requiere llamadas pagadas y telemetría instrumentada; no se ejecutaron.
El detalle por turno, tokens, imágenes y costes sale con `npm run ia:bench`.
