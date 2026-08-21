# Investigación de proveedores LoRA

Consulta: 2026-08-13. Solo documentación oficial. No se creó cuenta ni se inició job.

## Matriz

| Candidato | Entrenamiento LoRA | Inferencia/API | Async/webhook | Coste observado | Privacidad/licencia | Riesgo |
|---|---|---|---|---|---|---|
| fal.ai | `flux-lora-fast-training`; captions y máscaras opcionales; salida LoRA | `fal-ai/flux-lora`; múltiples dimensiones, LoRA, negative prompt | Cola y webhook documentados | FLUX.2 trainer v2: `0.0064 × steps`; 1000 pasos = USD 6.40. Inferencia depende del modelo | Página del modelo marca uso comercial; retención, borrado, regiones y términos aún requieren revisión | Dependencia del endpoint y URL de artefacto; política de datos no cerrada |
| Replicate | API de training sobre una versión de modelo; requiere trainer/modelo compatible | Predictions y modelos privados; API HTTP | Webhooks para predictions/training | Cobro por tiempo/hardware; A100 publicado a USD 5.04/h; modelos privados cobran tiempo online salvo fast booting fine-tunes | Modelos privados disponibles; licencia del modelo base y retención deben verificarse por modelo/contrato | Coste idle de modelos privados; selección de trainer afecta reproducibilidad |
| Hugging Face | Jobs ejecuta Diffusers/PEFT/LoRA con GPU y secretos cifrados | Inference Endpoints dedicados para modelos `diffusers`; endpoint privado por defecto | Jobs gestionables; webhook para el servicio final debe implementarse | Jobs por hardware/minuto; Endpoints dedicados por hora, desde ejemplos de USD 0.50/h GPU | Endpoint privado por defecto; repo/dataset y licencia del modelo quedan bajo control de la organización | Mayor operación propia; no hay trainer LoRA de una sola llamada equivalente |

## Evidencia oficial

- [fal.ai FLUX LoRA fast training](https://fal.ai/models/fal-ai/flux-lora-fast-training/api): endpoint de entrenamiento, API key, cola, webhook y salida.
- [fal.ai FLUX LoRA inference](https://fal.ai/docs/model-api-reference/image-generation-api/flux-lora): inferencia con LoRA y parámetros de imagen.
- [fal.ai pricing](https://fal.ai/docs/documentation/model-apis/pricing): unidad de cobro, errores de servidor no cobrados y consulta programática de precios.
- [Replicate training HTTP API](https://replicate.com/docs/reference/http/): creación de training con dataset URL, destino y webhook.
- [Replicate pricing](https://replicate.com/pricing): cobro por hardware/tiempo y modelos privados.
- [Hugging Face Jobs quickstart](https://huggingface.co/docs/hub/en/jobs-quickstart): Jobs de fine-tuning, GPU, timeout y créditos prepago.
- [Hugging Face Diffusers LoRA](https://huggingface.co/docs/diffusers/main/en/training/lora): configuración y artefacto `safetensors`.
- [Hugging Face Inference Endpoints](https://huggingface.co/docs/inference-endpoints/guides/configuration): endpoint privado, autenticación y región/accelerator.
- [Hugging Face pricing](https://huggingface.co/docs/inference-endpoints/pricing): cobro por hora y réplica.

## Decisión provisional

`fal.ai` queda como candidato provisional para un piloto dev por tener endpoint explícito de
entrenamiento FLUX LoRA, output reutilizable y cola/webhook. Esto no es selección aprobada:
faltan términos, retención, borrado, región, licencia exacta del modelo base, coste real con
configuración final y aprobación humana.

Fallback técnico: Hugging Face con entrenamiento Diffusers y Endpoint privado. Replicate queda
como alternativa si la política de privacidad, coste o disponibilidad de fal.ai no cumple.

## Datos no verificados

No se afirma cumplimiento legal, borrado efectivo, residencia regional, SLA, retención exacta ni
licencia comercial del dataset. Verificar en términos y panel del proveedor antes de CP-02.
