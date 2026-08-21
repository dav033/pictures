# Requisitos — generación de imágenes con LoRA

Estado: `draft`, no aprobado para cuentas, facturación ni producción.
Fecha: 2026-08-13.

## Alcance

Personalizar un modelo base de imagen con un LoRA de estilo de decoración para eventos. El
LoRA debe complementar el catálogo real y el flujo actual de referencias; no convierte una
imagen generada en garantía de inventario.

Casos de uso:

- Visualización de montajes de cumpleaños, bodas y eventos corporativos.
- Preservación de productos del catálogo, colores y composición aprobada.
- Edición de una foto de venue sin cambiar arquitectura fuera de regiones aprobadas.
- Regeneración controlada con el resultado anterior como base.

## Requisitos funcionales medibles

| Área | Requisito provisional | Verificación |
|---|---|---|
| Dataset | Cada imagen debe tener licencia, fuente, hash SHA-256, dimensiones y estado | Manifiesto JSONL + revisión humana |
| Dataset | Cero archivos corruptos y cero duplicados sin decisión explícita | `npm run dataset:validate` |
| Captions | 100 % incluyen sujeto, productos, color, composición, luz, fondo y estilo | Revisión automática + muestra humana |
| Trigger | `eventdecor_style_v1`, único y consistente | Prueba de captions |
| Evaluación | Suite fija con prompts vistos y no vistos antes de elegir LoRA | `eval/prompts/fixed-suite-v001.jsonl` |
| Calidad | Puntaje mínimo provisional: 0.80 con fórmula del plan maestro | `eval/leaderboard-v001.json` |
| Seguridad | API key solo en secret manager; nunca navegador, repositorio, prompt ni log | Escaneo CI + revisión |
| Privacidad | Dataset de entrenamiento privado; sin PII ni fotos de clientes sin autorización | Dataset card + checklist legal |
| Inferencia | API autenticada, jobs idempotentes y resultado con versión base/LoRA | Pruebas de contrato |
| Rollback | Cambio a último LoRA aprobado en menos de 5 minutos | Runbook + simulacro |

## Valores de pilotaje pendientes de aprobación

- Volumen: 20 imágenes/día como hipótesis de dev; producción aún no definida.
- Latencia objetivo: p95 ≤ 90 s por imagen; medir antes de fijar SLO.
- Presupuesto: ≤ USD 0.75 por imagen, incluyendo un retry; validar con calculadora oficial.
- Resolución: 1024 px mínimo; conservar `16:9`, `1:1`, `3:2` y `2:3` sin estirar.
- Regiones: pendiente de definir por responsable.
- Retención: objetivo ≤ 30 días para datasets temporales y URLs; confirmar términos del proveedor.

## No negociables

- No cuenta, pago, aceptación legal, clave, subida externa, entrenamiento ni producción sin aprobación humana.
- No enviar dataset a un segundo proveedor sin aprobación.
- No usar productos de terceros o imágenes sin derechos documentados.
- Elementos `reference_only` nunca entran automáticamente a la cotización.

## Bloqueos para CP-01

1. Falta confirmar volumen, presupuesto, región y retención.
2. Dataset recibido; faltan captions, split reproducible y revisión de 10 imágenes de baja resolución.
3. Falta aprobar proveedor, modelo base y licencia comercial.
4. Falta conservar evidencia interna de autorización y nombrar responsable de aprobación humana.
