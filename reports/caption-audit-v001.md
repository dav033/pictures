# Autoauditoría de captions — dataset-decoration-v001

Fecha: 2026-08-13  
Resultado: `corrected_pending_review`  
Correcciones aplicadas: `img-0003`, `img-0013`, `img-0014`.

## Controles automáticos

- JSONL válido: 15/15.
- Correspondencia manifest/captions: 15/15.
- Trigger único `eventdecor_style_v1`: 15/15.
- Licencia declarada: 15/15.
- Splits: `train=9`, `validation=2`, `test=4`.
- Fuga por `scene_group`: no detectada.
- PII, URLs y patrones de secretos: no detectados.
- Longitud: 414–472 caracteres; consistente, pero repetitiva y más larga de lo necesario.
- Campos visuales: color, composición, luz, fondo/venue, estilo y cámara presentes explícita o
  semánticamente en todas las captions.

## Revisión visual

### Correcciones aplicadas

- `img-0003`: se eliminó “castle-themed” y se cambió silla/escalera por estantería blanca A-frame;
  se conservaron coquette y lazos visibles.
- `img-0013`: se eliminó “neon” como afirmación visual y quedó “vivid multicolor”.
- `img-0014`: se describió como instalación navideña y estacional mixta, con colores y props visibles.

### P3 — mejora no bloqueante

1. Captions repiten la misma cola (“commercial…”, cámara, estilo). No bloquea LoRA, pero se puede
   compactar para reducir ruido y reforzar detalles distintivos.

## Decisión

Dataset estructuralmente listo. Captions corregidas, pero siguen en `draft_visual_review` hasta
revisión humana de muestra. No iniciar training aún.
