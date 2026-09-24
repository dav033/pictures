# Uzume

Composición final: funde el producto generado por Kagutsuchi sobre la foto
real del espacio del cliente. Nombrada por la diosa sintoísta del amanecer,
la danza y la fiesta — famosa por su actuación festiva que atrajo a
Amaterasu fuera de la cueva —, igual que esta IA entrega la escena de
decoración festiva ya montada.

- **Entrada**: imagen del producto (de Kagutsuchi) + foto del espacio del
  cliente.
- **Salida**: `Imagen` final compuesta.
- **Proveedor / modelo**: Google Gemini, `MODELO_IMAGEN`
  (`gemini-3.1-flash-image`, ver [gemini.ts](../../gemini.ts)).
- **Archivos propios**: [imagen.ts](imagen.ts) (`crearImagenGemini`, el
  puerto de imagen de Gemini) y [lora-gemini-composition.ts](lora-gemini-composition.ts)
  (el prompt e inputs que fusionan LoRA + Gemini).
- **Consumidor principal**: [api/generate/route.ts](../../../app/api/generate/route.ts),
  cuando hay foto del espacio (pipeline `lora_gemini`). `registro.ts` la
  carga dinámicamente como uno de los proveedores de imagen disponibles.
