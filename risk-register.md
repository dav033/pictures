# Risk register

| ID | Riesgo | Probabilidad | Impacto | Mitigación | Estado |
|---|---|---:|---:|---|---|
| R-001 | Dataset sin derechos suficientes | media | crítico | licencia por archivo + aprobación legal | abierto |
| R-002 | PII en imágenes o EXIF | media | alto | sanitización, quarantine, no entrenar clientes | abierto |
| R-003 | Proveedor no permite borrado/retención requerida | media | crítico | verificar términos antes de cuenta | abierto |
| R-004 | Coste excede presupuesto | media | alto | límites dev, idempotencia, alertas y kill switch | abierto |
| R-005 | LoRA sobreajusta o memoriza | media | alto | split por escena, prompts no vistos, revisión humana | abierto |
| R-006 | Cambio de licencia del modelo base | baja | crítico | registrar versión/licencia por release | abierto |
| R-007 | Webhook duplicado o falsificado | media | alto | firma, replay protection e idempotencia | abierto |
| R-008 | Artefacto no tiene rollback | baja | crítico | hash, alias approved/previous y runbook | abierto |
| R-009 | Exposición accidental de clave | baja | crítico | secret manager, CI secret scan, no screenshots | abierto |
