-- Deja preparado el slot reservado para el nuevo LoRA de fidelidad de producto.
-- No lo activa por sí solo: el resolvedor exige corrida terminada, pesos
-- respaldados, URL del proveedor y evaluación aprobada.

UPDATE lora_mode_slots
   SET display_name = 'Producto Sempertex v007',
       enforce_dataset_allowlist = TRUE,
       lora_scale = 0.8,
       enabled = TRUE,
       updated_at = now()
 WHERE slug = 'training_1';
