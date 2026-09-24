# Kagutsuchi

Generación y edición del render de producto con LoRA. Nombrado por la
deidad sintoísta del fuego y la forja: da forma a través del fuego, igual
que este paso forja el render físico del producto.

- **Entrada**: caption/prompt del producto ya compilado (`lora-caption-compiler.ts`)
  más las imágenes de referencia y de catálogo.
- **Salida**: `Imagen` generada, o `ProveedorImagenNoDisponibleError` si el
  proveedor rechaza la cuenta (sin saldo o sin acceso).
- **Proveedor / modelo**: [fal.ai](https://fal.ai) — `flux-2/lora` y
  `flux-2/lora/edit` ([sempertex-lora.ts](sempertex-lora.ts)).
- **Consumidor principal**: [api/generate/route.ts](../../../app/api/generate/route.ts),
  que luego pasa el resultado a **Uzume** cuando hay foto del espacio para
  componer sobre ella.
