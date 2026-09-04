-- v007 se evalúa y se usará a escala 0.8; a 0.3 el LoRA queda infraactivado.
UPDATE lora_mode_slots
   SET lora_scale = 0.8,
       updated_at = now()
 WHERE slug = 'training_1';
