import { z } from "zod";
import { conRegistro } from "@/lib/registro/servidor";
import { resolverConfig, type ConfigModulo } from "@/lib/modulos-estudio/configuracion";
import { servicioRenders } from "@/lib/modulos-estudio/fabrica";
import { TopeFotosError } from "@/lib/modulos-estudio/generador-flux";
import type { CapturaBase, ObjetoImagen } from "@/lib/modulos-estudio/puertos";
import { CacheCaidoError, FaltaCapturaError, RenderEnCursoError } from "@/lib/modulos-estudio/servicio-renders";

/**
 * Estudio de módulos (REQ-011): el render con IA de un módulo, con caché por clave canónica.
 *
 * - `GET ?tipo=&formato=&colores=015,040`: la imagen guardada (200) o 404 con `{ cache }`: «disponible» (no hay render de
 *   esa combinación todavía) o «no_disponible» (sin base o sin almacén). Nunca llama a nada de pago.
 * - `POST { tipo, formatoId?, colores[], captura? }`: acierto → la imagen guardada, sin coste; fallo → FLUX con la captura
 *   3D como base, se guarda y se devuelve. Sin caché disponible el render se genera igual (`guardada: false`).
 * La sesión la exige el proxy de la app, como en el resto de /api. El tope por hora es el mismo del taller 3D.
 */
export const maxDuration = 120;

const COLORES = z.array(z.string().regex(/^[0-9]{3}$/)).min(1).max(6);

const ConsultaSchema = z.object({
  tipo: z.string().min(1).max(20),
  formato: z.string().min(1).max(10).optional(),
  colores: z.string().min(3).max(40).transform((texto) => texto.split(",")).pipe(COLORES),
});

const CuerpoSchema = z.object({
  tipo: z.string().min(1).max(20),
  formatoId: z.string().min(1).max(10).optional(),
  colores: COLORES,
  captura: z.string().regex(/^data:image\/(png|jpeg);base64,/).max(12_000_000).optional(),
}).strict();

export const GET = conRegistro("/api/modulos-render", atenderGET, { vista: "3d" });
export const POST = conRegistro("/api/modulos-render", atenderPOST, { vista: "3d" });

function configDe(tipo: string, formatoId: string | undefined, colores: string[]): { config: ConfigModulo; avisos: string[] } | Response {
  const resuelta = resolverConfig({ tipo, ...(formatoId ? { formatoId } : {}), colores });
  if (!resuelta.ok) return Response.json({ error: resuelta.errores.join(" "), errores: resuelta.errores }, { status: 400 });
  return { config: resuelta.config, avisos: resuelta.avisos };
}

const aDataUrl = (imagen: ObjetoImagen) => `data:${imagen.mime};base64,${Buffer.from(imagen.bytes).toString("base64")}`;

async function atenderGET(request: Request) {
  const url = new URL(request.url);
  const leida = ConsultaSchema.safeParse({ tipo: url.searchParams.get("tipo"), formato: url.searchParams.get("formato") ?? undefined, colores: url.searchParams.get("colores") });
  if (!leida.success) return Response.json({ error: "Faltan el tipo de módulo o los colores." }, { status: 400 });
  const resuelta = configDe(leida.data.tipo, leida.data.formato, leida.data.colores);
  if (resuelta instanceof Response) return resuelta;
  const consulta = await servicioRenders().consultar(resuelta.config);
  if (consulta.estado === "hit") {
    return new Response(Buffer.from(consulta.imagen.bytes), {
      headers: { "content-type": consulta.imagen.mime, "cache-control": "private, max-age=3600", "x-render-clave": consulta.clave, "x-render-origen": "cache" },
    });
  }
  return Response.json(
    { encontrada: false, clave: consulta.clave, cache: consulta.estado === "miss" ? "disponible" : "no_disponible", ...(consulta.estado === "no_disponible" ? { motivo: consulta.motivo } : {}) },
    { status: 404 },
  );
}

async function atenderPOST(request: Request) {
  let cuerpo: unknown;
  try { cuerpo = await request.json(); } catch { return Response.json({ error: "El pedido no llegó en un formato válido." }, { status: 400 }); }
  const leido = CuerpoSchema.safeParse(cuerpo);
  if (!leido.success) return Response.json({ error: "El módulo, los colores o la captura no cumplen el formato." }, { status: 400 });
  const resuelta = configDe(leido.data.tipo, leido.data.formatoId, leido.data.colores);
  if (resuelta instanceof Response) return resuelta;
  const partes = leido.data.captura?.match(/^data:(image\/(?:png|jpeg));base64,([\s\S]*)$/);
  const captura: CapturaBase | null = partes ? { mime: partes[1] as CapturaBase["mime"], base64: partes[2]! } : null;
  try {
    const resultado = await servicioRenders().obtenerOGenerar(resuelta.config, captura, request.signal);
    return Response.json({
      origen: resultado.origen,
      clave: resultado.clave,
      imagen: aDataUrl(resultado.imagen),
      guardada: resultado.origen === "cache" ? true : resultado.guardada,
      costeUsd: resultado.origen === "cache" ? 0 : resultado.costeUsd,
      avisos: [...resuelta.avisos, ...(resultado.origen === "generada" && resultado.aviso ? [resultado.aviso] : [])],
    });
  } catch (error) {
    if (error instanceof FaltaCapturaError) return Response.json({ error: error.message, requiereCaptura: true }, { status: 409 });
    if (error instanceof RenderEnCursoError) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof CacheCaidoError) return Response.json({ error: error.message }, { status: 503 });
    if (error instanceof TopeFotosError) return Response.json({ error: error.message }, { status: 429 });
    return Response.json({ error: "No pude generar el render ahora. Vuelve a intentarlo en un momento." }, { status: 502 });
  }
}
