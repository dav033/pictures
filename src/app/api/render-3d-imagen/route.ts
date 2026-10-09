import { z } from "zod";
import { conRegistro, decidir } from "@/lib/registro/servidor";
import sharp from "sharp";
import { generarConFluxFiel, generarConSempertexFlux } from "@/lib/ia/kagutsuchi/flux";
import { aligerarImagenGenerada } from "@/lib/generacion/imagen-liviana";
import { AMBIENTE_POR_DEFECTO, MAX_DESCRIPCION, STRENGTH_FIEL_MOBILIARIO, TAMANO_BASE_FIEL, promptRender3d, promptRender3dFiel, usaCaminoFiel, type AmbienteRender } from "@/lib/globos3d/render-ia";
import { TOPE_FOTOS_POR_HORA } from "@/lib/globos3d/foto-realista";

/**
 * Taller 3D → foto con IA. Recibe la captura del visor (JPEG o PNG) y una descripción corta de la decoración, y
 * devuelve una foto realista hecha con FLUX base por `/edit` (la captura es la base que se conserva); si la escena trae mesas y sillas y el lugar
 * es el del visor, por el camino fiel (FLUX.1 imagen-a-imagen con `strength`, que conserva mesas, disposición y cámara). Nada se
 * guarda en el servidor: la imagen vuelve al navegador. Cada llamada cuesta ~US$0,05 en fal; tope por instancia
 * de 30 imágenes por hora para que un clic repetido no dispare el gasto.
 */
const CuerpoSchema = z.object({
  render: z.string().regex(/^data:image\/(png|jpeg);base64,/).max(12_000_000),
  descripcion: z.string().max(MAX_DESCRIPCION * 2),
  ambiente: z.enum(["igual_visor", "salon_elegante", "fiesta_infantil", "boda_jardin", "estudio"]).default(AMBIENTE_POR_DEFECTO),
  aspecto: z.enum(["3:2", "1:1", "2:3", "16:9"]).default("3:2"),
}).strict();

const TOPE_POR_HORA = TOPE_FOTOS_POR_HORA;
let ventana = { desde: Date.now(), usadas: 0 };

export const POST = conRegistro("/api/render-3d-imagen", atenderPOST, { vista: "3d" });

async function atenderPOST(request: Request) {
  let cuerpo: unknown;
  try { cuerpo = await request.json(); } catch { return Response.json({ error: "La captura no llegó en un formato válido." }, { status: 400 }); }
  const validado = CuerpoSchema.safeParse(cuerpo);
  if (!validado.success) return Response.json({ error: "La captura o la descripción no cumplen el formato." }, { status: 400 });
  const { render, descripcion, ambiente, aspecto } = validado.data;

  if (Date.now() - ventana.desde > 3_600_000) ventana = { desde: Date.now(), usadas: 0 };
  if (ventana.usadas >= TOPE_POR_HORA) {
    decidir("regla:render_3d_tope", "tope de imágenes por hora del taller 3D", { usadas: ventana.usadas, tope: TOPE_POR_HORA });
    return Response.json({ error: "Se alcanzó el límite de imágenes por hora. Inténtalo más tarde." }, { status: 429 });
  }

  const partes = render.match(/^data:(image\/(?:png|jpeg));base64,([\s\S]*)$/);
  if (!partes) return Response.json({ error: "La captura no tiene formato válido." }, { status: 400 });
  const fiel = usaCaminoFiel(descripcion, ambiente as AmbienteRender);
  const prompt = fiel ? promptRender3dFiel(descripcion, ambiente as AmbienteRender) : promptRender3d(descripcion, ambiente as AmbienteRender);
  decidir("regla:render_3d_prompt", "texto e imagen base que van a FLUX desde el taller 3D", { prompt, largo: prompt.length, ambiente, aspecto, camino: fiel ? "flux1_i2i_fiel" : "flux2_edit", ...(fiel ? { strength: STRENGTH_FIEL_MOBILIARIO } : {}), bytesCaptura: Math.round((partes[2]!.length * 3) / 4) });

  ventana.usadas += 1;
  try {
    if (fiel) {
      const { ancho, alto } = TAMANO_BASE_FIEL[aspecto];
      const base = await sharp(Buffer.from(partes[2]!, "base64")).resize(ancho, alto, { fit: "fill" }).png().toBuffer();
      const hecha = await generarConFluxFiel(prompt, {
        imagen: { base64: base.toString("base64"), mime: "image/png", ancho, alto }, strength: STRENGTH_FIEL_MOBILIARIO,
        signal: request.signal, telemetria: { superficie: "taller-3d" },
      });
      const liviana = await aligerarImagenGenerada(hecha);
      return Response.json({ imagen: `data:${liviana.mime};base64,${liviana.base64}`, prompt });
    }
    const imagen = await generarConSempertexFlux(prompt, aspecto, [], {
      loras: [],
      guidanceScale: 3.5,
      signal: request.signal,
      telemetria: { superficie: "taller-3d" },
      imagenesEdit: [{
        id: "captura-3d", descripcion: "Captura del taller 3D: la decoración que se conserva", base64: partes[2]!, mime: partes[1]!,
        role: "previous_generated_result", priority: 1, allowed_use: "base que se conserva: forma, cantidades y colores de la decoración",
      }],
    });
    const liviana = await aligerarImagenGenerada(imagen);
    return Response.json({ imagen: `data:${liviana.mime};base64,${liviana.base64}`, prompt });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    decidir("regla:render_3d_error", "FLUX no devolvió la foto del taller 3D", { mensaje: mensaje.slice(0, 300) });
    return Response.json({ error: "No pude generar la foto ahora. Vuelve a intentarlo en un momento." }, { status: 502 });
  }
}
