import { z } from "zod";
import { conRegistro, decidir } from "@/lib/registro/servidor";
import { resolverConfig, type ConfigModulo } from "@/lib/modulos-estudio/configuracion";
import { servicioRenders } from "@/lib/modulos-estudio/fabrica";
import { TopeFotosError } from "@/lib/modulos-estudio/generador-flux";
import type { CapturaBase, ObjetoImagen } from "@/lib/modulos-estudio/puertos";
import { puedeEscribirCacheModulos } from "@/lib/modulos-estudio/puede-escribir";
import { huellaDeSesion } from "@/lib/modulos-estudio/sesion";
import { CacheCaidoError, FaltaCapturaError, RenderEnCursoError } from "@/lib/modulos-estudio/servicio-renders";

/**
 * Estudio de módulos (REQ-011): el render con IA de un módulo, con caché por clave canónica.
 *
 * - `GET ?tipo=&formato=&colores=015,040`: la imagen guardada (200) o 404 con `{ cache }`: «disponible» (no hay render de
 *   esa combinación todavía) o «no_disponible» (sin base o sin almacén). Nunca llama a nada de pago. Con `&meta=1` responde
 *   siempre JSON `{ encontrada, cache, clave, puedeEscribir, imagen? }`; `imagen` es esta misma ruta con `&v=<huella del
 *   contenido>`: esa URL es inmutable (`max-age` de un año) y deja de servir si el render se descarta o se reemplaza.
 * - `POST { tipo, formatoId?, colores[], captura? }`: acierto → la imagen guardada, sin coste; fallo → FLUX con la captura
 *   3D como base, se guarda y se devuelve. Generar es una ESCRITURA: pasa por `puedeEscribirCacheModulos`.
 * - `DELETE ?tipo=&formato=&colores=`: descarta el render guardado (fila y objeto) para poder generarlo de nuevo; misma puerta.
 * La sesión la exige el proxy de la app, como en el resto de /api. El tope por hora es el mismo del taller 3D.
 */
export const maxDuration = 120;

const COLORES = z.array(z.string().regex(/^[0-9]{3}$/)).min(1).max(6);

const ConsultaSchema = z.object({
  tipo: z.string().min(1).max(20),
  formato: z.string().min(1).max(10).optional(),
  colores: z.string().min(3).max(40).transform((texto) => texto.split(",")).pipe(COLORES),
  v: z.string().regex(/^[0-9a-f]{16}$/).optional(),
  meta: z.literal("1").optional(),
});

const CuerpoSchema = z.object({
  tipo: z.string().min(1).max(20),
  formatoId: z.string().min(1).max(10).optional(),
  colores: COLORES,
  captura: z.string().regex(/^data:image\/(png|jpeg);base64,/).max(12_000_000).optional(),
}).strict();

export const GET = conRegistro("/api/modulos-render", atenderGET, { vista: "3d" });
export const POST = conRegistro("/api/modulos-render", atenderPOST, { vista: "3d" });
export const DELETE = conRegistro("/api/modulos-render", atenderDELETE, { vista: "3d" });

const SOLO_EL_EQUIPO = "Solo el equipo puede generar o descartar renders.";

function configDe(tipo: string, formatoId: string | undefined, colores: string[]): { config: ConfigModulo; avisos: string[] } | Response {
  const resuelta = resolverConfig({ tipo, ...(formatoId ? { formatoId } : {}), colores });
  if (!resuelta.ok) return Response.json({ error: resuelta.errores.join(" "), errores: resuelta.errores }, { status: 400 });
  return { config: resuelta.config, avisos: resuelta.avisos };
}

const aDataUrl = (imagen: ObjetoImagen) => `data:${imagen.mime};base64,${Buffer.from(imagen.bytes).toString("base64")}`;

function leerConsulta(request: Request) {
  const url = new URL(request.url);
  const leida = ConsultaSchema.safeParse({
    tipo: url.searchParams.get("tipo"), formato: url.searchParams.get("formato") ?? undefined, colores: url.searchParams.get("colores"),
    v: url.searchParams.get("v") ?? undefined, meta: url.searchParams.get("meta") ?? undefined,
  });
  if (!leida.success) return Response.json({ error: "Faltan el tipo de módulo o los colores." }, { status: 400 });
  const resuelta = configDe(leida.data.tipo, leida.data.formato, leida.data.colores);
  return resuelta instanceof Response ? resuelta : { ...resuelta, v: leida.data.v, meta: leida.data.meta === "1" };
}

async function atenderGET(request: Request) {
  const consulta = leerConsulta(request);
  if (consulta instanceof Response) return consulta;
  const { config, v, meta } = consulta;
  const puedeEscribir = puedeEscribirCacheModulos(request);
  const hallado = await servicioRenders().consultar(config);
  const cache = hallado.estado === "no_disponible" ? "no_disponible" : "disponible";
  if (meta) {
    const parametros = new URLSearchParams({ tipo: config.tipo, formato: config.formatoId, colores: config.colores.join(",") });
    const imagen = hallado.estado === "hit" ? `/api/modulos-render?${parametros}&v=${hallado.huella}` : undefined;
    return Response.json({ encontrada: hallado.estado === "hit", cache, clave: hallado.clave, puedeEscribir, ...(imagen ? { imagen } : {}) }, { headers: { "cache-control": "no-store" } });
  }
  // Una URL con huella de un render que ya no es ese (descartado o reemplazado) no sirve la imagen nueva con la etiqueta vieja.
  const guardada = hallado.estado === "hit" && (!v || v === hallado.huella) ? await servicioRenders().leer(config, v) : null;
  if (guardada) {
    return new Response(Buffer.from(guardada.imagen.bytes), {
      headers: {
        "content-type": guardada.imagen.mime,
        "cache-control": v ? "private, max-age=31536000, immutable" : "private, no-cache",
        "x-render-clave": guardada.clave,
        "x-render-origen": "cache",
      },
    });
  }
  return Response.json({ encontrada: false, clave: hallado.clave, cache, puedeEscribir, ...(hallado.estado === "no_disponible" ? { motivo: hallado.motivo } : {}) }, { status: 404, headers: { "cache-control": "no-store" } });
}

async function atenderPOST(request: Request) {
  const inicioMs = Date.now();
  let cuerpo: unknown;
  try { cuerpo = await request.json(); } catch { return Response.json({ error: "El pedido no llegó en un formato válido." }, { status: 400 }); }
  const leido = CuerpoSchema.safeParse(cuerpo);
  if (!leido.success) return Response.json({ error: "El módulo, los colores o la captura no cumplen el formato." }, { status: 400 });
  const resuelta = configDe(leido.data.tipo, leido.data.formatoId, leido.data.colores);
  if (resuelta instanceof Response) return resuelta;
  const servicio = servicioRenders();
  const respuestaCache = (r: { clave: string; imagen: ObjetoImagen }) => Response.json({
    origen: "cache", clave: r.clave, imagen: aDataUrl(r.imagen), guardada: true, costeUsd: 0, avisos: resuelta.avisos,
  });

  // Generar paga una imagen: solo el equipo. Leer lo ya guardado por esta vía sigue siendo gratis para cualquiera.
  if (!puedeEscribirCacheModulos(request)) {
    const guardada = await servicio.leer(resuelta.config);
    if (guardada) return respuestaCache(guardada);
    decidir("regla:render_modulo_escritura_cerrada", "un POST de generación sin permiso de escritura", { clave: servicio.clave(resuelta.config) });
    return Response.json({ error: SOLO_EL_EQUIPO, puedeEscribir: false }, { status: 403 });
  }

  const partes = leido.data.captura?.match(/^data:(image\/(?:png|jpeg));base64,([\s\S]*)$/);
  const captura: CapturaBase | null = partes ? { mime: partes[1] as CapturaBase["mime"], base64: partes[2]! } : null;
  try {
    const resultado = await servicio.obtenerOGenerar(resuelta.config, captura, { senal: request.signal, inicioMs, sesion: huellaDeSesion(request) });
    if (resultado.origen === "cache") return respuestaCache(resultado);
    return Response.json({
      origen: "generada", clave: resultado.clave, imagen: aDataUrl(resultado.imagen), guardada: resultado.guardada, costeUsd: resultado.costeUsd,
      avisos: [...resuelta.avisos, ...(resultado.aviso ? [resultado.aviso] : [])],
    });
  } catch (error) {
    if (error instanceof FaltaCapturaError) return Response.json({ error: error.message, requiereCaptura: true }, { status: 409 });
    if (error instanceof RenderEnCursoError) return Response.json({ error: error.message }, { status: 409 });
    if (error instanceof CacheCaidoError) return Response.json({ error: error.message }, { status: 503 });
    if (error instanceof TopeFotosError) return Response.json({ error: error.message }, { status: 429 });
    if (error instanceof DOMException && error.name === "AbortError") return new Response(null, { status: 499 });
    return Response.json({ error: "No pude generar el render ahora. Vuelve a intentarlo en un momento." }, { status: 502 });
  }
}

async function atenderDELETE(request: Request) {
  if (!puedeEscribirCacheModulos(request)) return Response.json({ error: SOLO_EL_EQUIPO, puedeEscribir: false }, { status: 403 });
  const consulta = leerConsulta(request);
  if (consulta instanceof Response) return consulta;
  try {
    const descartado = await servicioRenders().descartar(consulta.config);
    decidir("regla:render_modulo_descartado", descartado ? "render de módulo descartado" : "no había render guardado que descartar", { tipo: consulta.config.tipo, formatoId: consulta.config.formatoId, colores: consulta.config.colores, sesion: huellaDeSesion(request) });
    return Response.json({ descartado });
  } catch (error) {
    if (error instanceof CacheCaidoError) return Response.json({ error: error.message }, { status: 503 });
    return Response.json({ error: "No pude descartar el render ahora." }, { status: 502 });
  }
}
