-- v007 se evalúa y se usará a escala 0.8; a 0.3 el LoRA queda infraactivado.
-- rollback: UPDATE lora_mode_slots SET lora_scale = 0.8 WHERE slug = 'training_1'; La escala anterior está confirmada como 0.8 por 015/017; no se recupera el updated_at previo, así que confirmar que no hubo cambios posteriores.
UPDATE lora_mode_slots
   SET lora_scale = 0.8,
       updated_at = now()
 WHERE slug = 'training_1';
