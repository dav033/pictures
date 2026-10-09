import { generarConSempertexFlux } from "@/lib/ia/kagutsuchi/flux";
import { aligerarImagenGenerada } from "@/lib/generacion/imagen-liviana";
import { COSTE_FOTO_USD } from "@/lib/globos3d/foto-realista";
import { tomarFotoDeLaHora } from "@/lib/globos3d/tope-fotos-hora";
import { decidir } from "@/lib/registro/servidor";
import { ASPECTO_RENDER, GUIDANCE_RENDER } from "./captura-estudio";
import { promptModuloEstudio } from "./prompt-estudio";
import type { GeneradorRender } from "./puertos";

/**
 * El generador del estudio: FLUX base por `/edit` (nunca Gemini, sin LoRA) con la captura 3D del módulo como imagen base.
 * Cuenta contra el mismo tope por hora que `/api/render-3d-imagen` (`tope-fotos-hora.ts`) y deja la llamada en la
 * auditoría de imágenes (`generarConSempertexFlux` → `auditarGeneracionImagen`) y su decisión en el registro.
 */
export class TopeFotosError extends Error {
  constructor() {
    super("Se alcanzó el límite de imágenes por hora. Inténtalo más tarde.");
    this.name = "TopeFotosError";
  }
}

export const generarRenderFlux: GeneradorRender = async (config, captura, senal) => {
  const toma = tomarFotoDeLaHora();
  if (!toma.ok) {
    decidir("regla:render_modulo_tope", "tope de imágenes por hora: no se genera el render del módulo", { usadas: toma.usadas, tope: toma.tope });
    throw new TopeFotosError();
  }
  const prompt = promptModuloEstudio(config);
  decidir("regla:render_modulo_prompt", "texto e imagen base que van a FLUX desde el estudio de módulos", {
    prompt, largo: prompt.length, tipo: config.tipo, formatoId: config.formatoId, colores: config.colores, bytesCaptura: Math.round((captura.base64.length * 3) / 4),
  });
  const imagen = await generarConSempertexFlux(prompt, ASPECTO_RENDER, [], {
    loras: [],
    guidanceScale: GUIDANCE_RENDER,
    ...(senal ? { signal: senal } : {}),
    telemetria: { superficie: "estudio-modulos" },
    imagenesEdit: [{
      id: "captura-modulo", descripcion: "Captura 3D del módulo: la forma, la cantidad y el color de cada globo que se conservan",
      base64: captura.base64, mime: captura.mime, role: "previous_generated_result", priority: 1, allowed_use: "base que se conserva: forma, cantidades y colores del módulo",
    }],
  });
  const liviana = await aligerarImagenGenerada(imagen);
  return { bytes: new Uint8Array(liviana.bytes), mime: liviana.mime, costeUsd: COSTE_FOTO_USD };
};
