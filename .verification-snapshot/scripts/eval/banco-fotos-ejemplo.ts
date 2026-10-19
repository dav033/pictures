/**
 * Banco de calidad con las 10 fotos de ejemplo de la vista clásica («¿No tienes foto? Prueba con una de estas»).
 *
 * Pedido del dueño (2026-10-06): «estas deben ser el punto de calidad; si salen bien más de la mitad consistentemente,
 * entonces todo está bien». Para cada foto y cada vista el arnés hace lo MISMO que hace esa vista en el navegador, contra
 * el servidor local (:3010) y por HTTP:
 *   (a) lee la foto con /api/references/analyze,
 *   (b) arma el plan con /api/chat (clásica: el envío automático de la foto; guiada: «Sí, armémoslo»),
 *   (c) genera la imagen con /api/generate con el cuerpo que manda cada vista (`cuerpoGeneracion`),
 *   (d) guarda lectura, plan resumido, cuerpo sin base64, prompt final (del registro del servidor), imagen y registro.
 * Cada caso lleva su propio x-conversacion-id (`banco-<sello>-<foto>-<vista>-r<n>`): se lee también con
 * `npm run registros -- conversaciones --origen local --conversacion <id>`.
 *
 * El juicio NO lo pone el arnés: lo pone una persona o un paso con visión mirando `comparar/*.jpg` con la RÚBRICA fija de
 * abajo, en `notas.json` de la carpeta de la corrida. `informe` lo cuenta (% «bien» por vista) y pone al lado de cada foto
 * las diferencias entre las dos vistas en cada etapa (lectura, plan, cuerpo de generate, prompt).
 *
 * PAGA (Gemini y fal): lectura ≈ US$0,02, plan ≈ US$0,02–0,05, imagen FLUX.2 base ≈ US$0,04 (US$0,012 por megapíxel
 * procesado, entrada + salida). `--tope-usd` (1,50 por defecto) cuenta lecturas + imágenes; el plan se informa aparte.
 * Ni LoRA ni Gemini generan imagen: la imagen la hace siempre el servidor (FLUX base).
 *
 * Uso (desde la raíz del proyecto, con el dev server en :3010):
 *   npx tsx scripts/eval/banco-fotos-ejemplo.ts correr [--vistas clasica,guiada] [--repeticiones 1] [--fotos 01,05]
 *       [--tope-usd 1.5] [--concurrencia 2] [--salida <dir>] [--base http://localhost:3010] [--registros data/registros]
 *   npx tsx scripts/eval/banco-fotos-ejemplo.ts revisar                      (sin gastar: servidor, espejos, saldo de fal)
 *   npx tsx scripts/eval/banco-fotos-ejemplo.ts comparar <carpeta-corrida>   (rehace los mosaicos de juicio)
 *   npx tsx scripts/eval/banco-fotos-ejemplo.ts informe <carpeta-corrida>    (lee notas.json → informe.md)
 *
 * ESPEJOS: lo que cada vista manda está copiado aquí de `src/app/page.tsx` (clásica) y `VistaGuiada.tsx` (guiada) con los
 * mismos módulos compartidos (`cuerpoGeneracion`, `adaptarAnalisisReferencia`, `instruccionPlanFoto`…). Lo que vive
 * dentro de los componentes (el saludo de la clásica, `CONFIRMAR_PLAN_FOTO`) se lee del fuente en cada corrida, y
 * `anclasDeLasVistas` avisa si una vista dejó de mandar lo que este espejo supone: entonces hay que revisar el espejo.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import sharp from "sharp";
import { z } from "zod";
import { cuerpoGeneracion, fuentesDelPlan, resumenCuerpoGeneracion, type ResumenCuerpoGeneracion } from "@/lib/generacion/cuerpo-generacion";
import { adaptarAnalisisReferencia } from "@/lib/ia/guiado/adaptar-analisis-referencia";
import { briefChatGuiado, defectoPlanGuiado, instruccionPlanFoto } from "@/lib/ia/guiado/instruccion-plan";
import { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/referencia/reference-blueprint";
import { MANIFIESTO_REFERENCIAS_EJEMPLO, type FotoEjemplo } from "@/lib/referencias-ejemplo/manifiesto";
import { MENSAJE_SOLO_REFERENCIAS } from "@/lib/estado/mensaje-foto-referencia";
import { CREATIVIDAD_POR_DEFECTO } from "@/lib/ia/escena/creatividad";
import { CALIDAD_REFERENCIA, LADO_MAXIMO_REFERENCIA } from "@/lib/imagen-cliente/preparar-foto";
import type { Brief } from "@/lib/types";

// ── Rúbrica fija del juez ───────────────────────────────────────────────────────────────────────────────────────────

export const RUBRICA = {
  version: "banco-fotos.v1",
  pregunta: "Comparando la imagen generada con su foto de ejemplo: ¿la aprobaría un decorador de globos como «esto es lo de la foto»?",
  criterios: [
    { id: "piezas", texto: "Las mismas piezas de globos que la foto (tipo y cantidad) y separadas si en la foto van separadas: dos columnas no pueden salir como un arco, fundidas ni como una sola; un arco no puede salir partido." },
    { id: "forma", texto: "Cada pieza con la forma de la foto: columna recta u orgánica, arco completo o medio arco, guirnalda, altura relativa, inclinación, relleno." },
    { id: "colores", texto: "Los colores y acabados de la foto: todos los colores principales presentes, ninguno ajeno dominante; cromado, perlado, mate, pastel, transparente o con confeti como en la foto." },
    { id: "proporcion", texto: "Proporción y escala parecidas: tamaño de las piezas frente al espacio y a los muebles; tamaños de globo mezclados si la foto los mezcla." },
    { id: "sin_inventos", texto: "Sin elementos inventados: ninguna estructura de globos, letrero, número o figura que la foto no tenga (el mobiliario y el fondo de la foto sí pueden estar)." },
    { id: "realismo", texto: "Se ve como una decoración real de globos de látex: sin globos derretidos, deformes, flotando sin soporte ni artefactos graves." },
  ],
  escala: {
    ok: "cumple",
    leve: "se nota la diferencia, pero un decorador lo aceptaría",
    falla: "un decorador no lo aceptaría",
  },
  regla: "«bien» = ningún criterio en «falla». Un caso que no llegó a imagen (lectura, plan o generate fallidos, o plan que la vista no deja aprobar) cuenta como «no».",
} as const;

type IdCriterio = (typeof RUBRICA.criterios)[number]["id"];
const IDS_CRITERIOS = RUBRICA.criterios.map((criterio) => criterio.id) as IdCriterio[];
const NivelSchema = z.enum(["ok", "leve", "falla"]);
const NotaSchema = z.object({
  piezas: NivelSchema,
  forma: NivelSchema,
  colores: NivelSchema,
  proporcion: NivelSchema,
  sin_inventos: NivelSchema,
  realismo: NivelSchema,
  motivo: z.string().min(1),
}).strict();
const NotasSchema = z.object({
  rubrica: z.literal(RUBRICA.version),
  juez: z.string().min(1),
  fecha: z.string().min(1),
  notas: z.record(z.string(), NotaSchema),
}).strict();
type Nota = z.infer<typeof NotaSchema>;

function veredictoDe(nota: Nota): "bien" | "no" {
  return IDS_CRITERIOS.some((criterio) => nota[criterio] === "falla") ? "no" : "bien";
}

// ── Opciones ────────────────────────────────────────────────────────────────────────────────────────────────────────

const VISTAS = ["clasica", "guiada"] as const;
type Vista = (typeof VISTAS)[number];

const RAIZ_PROYECTO = process.cwd();
const RUTA_FOTOS = path.join(RAIZ_PROYECTO, "public", "referencias-ejemplo");
const LIMITE_LECTURA_MS = 170_000;
const LIMITE_PLAN_MS = 180_000;
const LIMITE_IMAGEN_MS = 200_000;
/** Lo que se reserva del tope al empezar un caso, antes de saber lo que costó (lectura + imagen). */
const RESERVA_CASO_USD = 0.07;
/** fal FLUX.2 base /edit y text-to-image: US$ por megapíxel procesado (API de precios de fal, 2026-10-06). */
const FAL_USD_POR_MP = 0.012;

function bandera(nombre: string): string | undefined {
  const indice = process.argv.indexOf(`--${nombre}`);
  return indice >= 0 ? process.argv[indice + 1] : undefined;
}

function sello(): string {
  const ahora = new Date();
  const dos = (valor: number) => String(valor).padStart(2, "0");
  return `${ahora.getFullYear()}${dos(ahora.getMonth() + 1)}${dos(ahora.getDate())}-${dos(ahora.getHours())}${dos(ahora.getMinutes())}${dos(ahora.getSeconds())}`;
}

/** Las fotos pedidas por id («ejemplo-05», «05» o «5»), en el orden del manifiesto. */
function fotosPedidas(valor: string | undefined): FotoEjemplo[] {
  const todas = MANIFIESTO_REFERENCIAS_EJEMPLO.fotos;
  if (!valor || valor === "todas") return todas;
  const pedidas = new Set(valor.split(",").map((parte) => `ejemplo-${parte.trim().replace(/^ejemplo-/, "").padStart(2, "0")}`));
  const elegidas = todas.filter((foto) => pedidas.has(foto.id));
  if (elegidas.length !== pedidas.size) throw new Error(`Fotos desconocidas en --fotos ${valor}. Válidas: ${todas.map((foto) => foto.id).join(", ")}`);
  return elegidas;
}

// ── Utilidades ──────────────────────────────────────────────────────────────────────────────────────────────────────

type Registro = Record<string, unknown>;

function esRegistro(valor: unknown): valor is Registro {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function lista(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : [];
}

function texto(valor: unknown): string | undefined {
  return typeof valor === "string" ? valor : undefined;
}

function numero(valor: unknown): number | undefined {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : undefined;
}

function escribirJson(archivo: string, datos: unknown): void {
  writeFileSync(archivo, `${JSON.stringify(datos, null, 1)}\n`);
}

function leerJson(archivo: string): unknown {
  return JSON.parse(readFileSync(archivo, "utf8")) as unknown;
}

function sha(datos: string | Buffer): string {
  return createHash("sha256").update(datos).digest("hex");
}

/** Cualquier base64 largo (fotos, imágenes) se cambia por su tamaño y su huella: los cuerpos se guardan sin fotos. */
function sinBase64(valor: unknown): unknown {
  if (typeof valor === "string") {
    if (valor.length > 400 && /^(?:data:[^,]+,)?[A-Za-z0-9+/=\s]+$/.test(valor.slice(0, 2000))) {
      return `<base64 ${Math.round((valor.length * 3) / 4 / 1024)} KB sha256 ${sha(valor).slice(0, 12)}>`;
    }
    return valor;
  }
  if (Array.isArray(valor)) return valor.map(sinBase64);
  if (esRegistro(valor)) return Object.fromEntries(Object.entries(valor).map(([clave, dato]) => [clave, sinBase64(dato)]));
  return valor;
}

/** Node no usa el almacén de certificados de Windows: sin esto, el saldo de fal falla por el proxy TLS corporativo. */
function usarCertificadosDelSistema(): void {
  try {
    tls.setDefaultCACertificates([...tls.getCACertificates("default"), ...tls.getCACertificates("system")]);
  } catch {
    // Node sin esa API: el saldo de fal sale null y el gasto queda solo estimado.
  }
}

function leerEnvLocal(clave: string): string | undefined {
  if (process.env[clave]) return process.env[clave];
  const archivo = path.join(RAIZ_PROYECTO, ".env.local");
  if (!existsSync(archivo)) return undefined;
  const encontrado = readFileSync(archivo, "utf8").match(new RegExp(`^${clave}=(.*)$`, "m"));
  return encontrado?.[1]?.trim().replace(/^"|"$/g, "") || undefined;
}

/** Saldo de fal (US$). Sirve de control del gasto real; otros agentes pueden gastar a la vez. Nunca imprime la llave. */
async function saldoFal(): Promise<number | null> {
  const llave = leerEnvLocal("FAL_KEY");
  if (!llave) return null;
  try {
    const respuesta = await fetch("https://rest.alpha.fal.ai/billing/user_balance", { headers: { Authorization: `Key ${llave}` }, signal: AbortSignal.timeout(20_000) });
    if (!respuesta.ok) return null;
    const valor = Number(await respuesta.text());
    return Number.isFinite(valor) ? valor : null;
  } catch {
    return null;
  }
}

// ── Espejos de las vistas: lo que vive dentro de los componentes se lee del fuente ─────────────────────────────────

type Anclas = { saludoClasica: string; confirmarPlanFoto: string; avisos: string[]; huellas: Record<string, string> };

/**
 * Lee del fuente de cada vista lo que no se puede importar (constantes de componentes React) y comprueba que las vistas
 * sigan mandando lo que este espejo copia. Cada ancla que falta es un aviso en la corrida: el espejo puede estar viejo.
 */
function anclasDeLasVistas(): Anclas {
  const archivoClasica = path.join(RAIZ_PROYECTO, "src", "app", "page.tsx");
  const archivoGuiada = path.join(RAIZ_PROYECTO, "src", "components", "guiado", "VistaGuiada.tsx");
  const clasica = readFileSync(archivoClasica, "utf8");
  const guiada = readFileSync(archivoGuiada, "utf8");
  const avisos: string[] = [];
  const saludo = clasica.match(/const SALUDO: Mensaje = \{[\s\S]*?content:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  if (!saludo) avisos.push("page.tsx: no encontré el SALUDO; la clásica lo manda como primer mensaje del historial.");
  const confirmar = guiada.match(/const CONFIRMAR_PLAN_FOTO = "((?:[^"\\]|\\.)*)"/)?.[1];
  if (!confirmar) avisos.push("VistaGuiada.tsx: no encontré CONFIRMAR_PLAN_FOTO.");
  const esperadasClasica: Array<[string, string]> = [
    ["useState<Mensaje[]>([SALUDO])", "el historial de la clásica ya no empieza con el saludo"],
    ["messages: nuevos.map(({ role, content }) => ({ role, content }))", "la clásica ya no manda el historial así a /api/chat"],
    ["referenceBlueprint: referenceDraftRef.current?.blueprint ?? referenceDraft?.blueprint", "la clásica ya no manda la lectura a /api/chat"],
    ["body: JSON.stringify(cuerpoGeneracion({", "la clásica ya no arma /api/generate con cuerpoGeneracion"],
    ["imagenDeFotoEjemplo(foto)", "la foto de ejemplo ya no viaja sin recomprimir"],
  ];
  const esperadasGuiada: Array<[string, string]> = [
    ["`${MENSAJE_SOLO_REFERENCIAS}\\n${CONFIRMAR_PLAN_FOTO}`", "el primer intento del plan de la foto cambió de texto"],
    ["instruccionPlanFoto({ reintento, colores })", "el reintento del plan de la foto cambió"],
    ["brief: briefChatGuiado(colores)", "el brief del plan de la foto cambió"],
    ["piezasIndividuales: true", "la guiada ya no pide piezas individuales"],
    ["brief: { tipo_evento: brief.evento, colores: plan.plan.concepto.paleta, estilo: brief.tematica }", "el brief de /api/generate de la guiada cambió"],
    ["solicitudUsuario: plan.plan.concepto.descripcion", "la solicitud de /api/generate de la guiada cambió"],
    ["blueprint: widget.fotoInspiracion ? lecturaDelPlan(mensajes, mensajeId)?.blueprint : undefined", "la lectura que va a /api/generate desde la guiada cambió"],
    ["await prepararFotoReferencia(archivo)", "la guiada ya no prepara la foto con prepararFotoReferencia"],
  ];
  for (const [ancla, aviso] of esperadasClasica) if (!clasica.includes(ancla)) avisos.push(`page.tsx: ${aviso}.`);
  for (const [ancla, aviso] of esperadasGuiada) if (!guiada.includes(ancla)) avisos.push(`VistaGuiada.tsx: ${aviso}.`);
  return {
    saludoClasica: saludo ? JSON.parse(`"${saludo}"`) as string : "¡Hola! Soy el asistente de decoración. Cuéntame qué evento estás planeando y te armo una propuesta. En cualquier momento puedes tocar, agregar o quitar piezas tú mismo.",
    confirmarPlanFoto: confirmar ? JSON.parse(`"${confirmar}"`) as string : "Confirma el plan con confirmar_plan_decoracion en este mismo turno, sin preguntarme nada.",
    avisos,
    huellas: { "src/app/page.tsx": sha(clasica).slice(0, 16), "src/components/guiado/VistaGuiada.tsx": sha(guiada).slice(0, 16) },
  };
}

// ── HTTP contra el servidor local ───────────────────────────────────────────────────────────────────────────────────

type Contexto = { base: string; conversacion: string; vista: Vista };
type RespuestaHttp = { estado: number; ms: number; texto: string };

/**
 * Un 500 con la página HTML de Next es el dev server recompilando (otro agente editando el árbol): la ruta ni llegó a
 * ejecutarse, así que no se pagó nada y se reintenta. Un 500 JSON de la ruta es un fallo real y se queda.
 */
const REINTENTOS_COMPILACION = 5;
const ESPERA_COMPILACION_MS = 20_000;

async function post(contexto: Contexto, ruta: string, cuerpo: unknown, limiteMs: number): Promise<RespuestaHttp> {
  const inicio = Date.now();
  for (let intento = 1; ; intento += 1) {
    const respuesta = await fetch(`${contexto.base}${ruta}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-conversacion-id": contexto.conversacion, "x-vista": contexto.vista },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(limiteMs),
    });
    const contenido = await respuesta.text();
    const paginaDeError = respuesta.status >= 500 && /^\s*<!DOCTYPE html/i.test(contenido);
    if (!paginaDeError || intento >= REINTENTOS_COMPILACION) return { estado: respuesta.status, ms: Date.now() - inicio, texto: contenido };
    console.warn(`  ${contexto.conversacion}: ${ruta} devolvió la página de error de Next (¿recompilando?); reintento ${intento} en ${ESPERA_COMPILACION_MS / 1000} s`);
    await new Promise((resolver) => setTimeout(resolver, ESPERA_COMPILACION_MS));
  }
}

function jsonSeguro(contenido: string): unknown {
  try {
    return JSON.parse(contenido) as unknown;
  } catch {
    return { no_json: contenido.slice(0, 2000) };
  }
}

type ResultadoChat = { estado: number; ms: number; fin: Registro | null; error: Registro | null; herramientas: string[] };

/** /api/chat responde SSE: el «fin» trae reply, brief, plan, cotización y la lectura usada. */
async function pedirChat(contexto: Contexto, cuerpo: Registro): Promise<ResultadoChat> {
  const respuesta = await post(contexto, "/api/chat", cuerpo, LIMITE_PLAN_MS);
  let fin: Registro | null = null;
  let error: Registro | null = null;
  const herramientas: string[] = [];
  if (respuesta.estado !== 200) return { estado: respuesta.estado, ms: respuesta.ms, fin, error: { http: respuesta.estado, cuerpo: jsonSeguro(respuesta.texto) }, herramientas };
  for (const bloque of respuesta.texto.split("\n\n")) {
    const datos = bloque.split("\n").filter((linea) => linea.startsWith("data: ")).map((linea) => linea.slice(6)).join("");
    if (!datos) continue;
    const evento = jsonSeguro(datos);
    if (!esRegistro(evento)) continue;
    if (evento.type === "herramienta" && evento.estado === "lista") herramientas.push(`${String(evento.nombre)}${evento.ok === false ? ":fallo" : ""}`);
    if (evento.type === "fin") fin = evento;
    if (evento.type === "error") error = evento;
  }
  if (!fin && !error) error = { sin_fin: true, inicio: respuesta.texto.slice(0, 500) };
  return { estado: respuesta.estado, ms: respuesta.ms, fin, error, herramientas };
}

// ── Registro del servidor (prompt final, decisiones y gasto) ───────────────────────────────────────────────────────

type LineaRegistro = { tipo: string; ruta?: string; datos: Registro };

function lineasDeConversacion(raizRegistros: string, conversacion: string): { lineas: LineaRegistro[]; crudo: string } {
  const carpeta = path.join(raizRegistros, "conversaciones");
  if (!existsSync(carpeta)) return { lineas: [], crudo: "" };
  const partes: string[] = [];
  for (const dia of readdirSync(carpeta).sort()) {
    const archivo = path.join(carpeta, dia, `${conversacion}.jsonl`);
    if (existsSync(archivo)) partes.push(readFileSync(archivo, "utf8"));
  }
  const crudo = partes.join("");
  const lineas = crudo.split("\n").filter((linea) => linea.trim()).flatMap((linea): LineaRegistro[] => {
    const dato = jsonSeguro(linea);
    if (!esRegistro(dato) || typeof dato.tipo !== "string") return [];
    return [{ tipo: dato.tipo, ruta: texto(dato.ruta), datos: esRegistro(dato.datos) ? dato.datos : {} }];
  });
  return { lineas, crudo };
}

function decision(lineas: LineaRegistro[], quien: string, ruta?: string): unknown {
  const encontrada = [...lineas].reverse().find((linea) => linea.tipo === "decision" && linea.datos.quien === quien && (!ruta || linea.ruta === ruta));
  return encontrada?.datos.resultado;
}

type PrecioTokens = { entrada: number; salida: number; cacheado: number };

function preciosGemini(): Record<string, PrecioTokens> {
  const archivo = path.join(RAIZ_PROYECTO, "eval", "estructuras", "precios", "2026-09-15.json");
  const precios: Record<string, PrecioTokens> = { "gemini-3.6-flash": { entrada: 0.75, salida: 3.75, cacheado: 0.075 } };
  if (!existsSync(archivo)) return precios;
  const tabla = leerJson(archivo);
  const ahora = Date.now();
  for (const precio of lista(esRegistro(tabla) ? tabla.precios : [])) {
    if (!esRegistro(precio)) continue;
    const desde = Date.parse(texto(precio.vigente_desde) ?? "");
    const hasta = precio.vigente_hasta === null ? Infinity : Date.parse(texto(precio.vigente_hasta) ?? "");
    const modelo = texto(precio.modelo);
    if (!modelo || !(desde <= ahora && ahora < hasta)) continue;
    precios[modelo] = { entrada: numero(precio.precio_entrada) ?? 0, salida: numero(precio.precio_salida) ?? 0, cacheado: numero(precio.precio_cacheado) ?? 0 };
  }
  return precios;
}

const PRECIOS_GEMINI = preciosGemini();

type Gasto = { lectura: number; plan: number; imagen: number; otros: number; llamadasIa: number; imagenes: number; modelosSinPrecio: string[] };

/** Gasto ESTIMADO de un caso a partir de su registro: tokens de cada respuesta de IA y megapíxeles de cada imagen. */
function gastoDeRegistro(lineas: LineaRegistro[]): Gasto {
  const gasto: Gasto = { lectura: 0, plan: 0, imagen: 0, otros: 0, llamadasIa: 0, imagenes: 0, modelosSinPrecio: [] };
  for (const linea of lineas) {
    if (linea.tipo === "respuesta_ia") {
      const tokens = esRegistro(linea.datos.tokens) ? linea.datos.tokens : {};
      const modelo = texto(linea.datos.modelo) ?? "?";
      const precio = PRECIOS_GEMINI[modelo] ?? PRECIOS_GEMINI["gemini-3.6-flash"]!;
      if (!PRECIOS_GEMINI[modelo] && !gasto.modelosSinPrecio.includes(modelo)) gasto.modelosSinPrecio.push(modelo);
      const entrada = numero(tokens.entrada) ?? 0;
      const cacheados = numero(tokens.cacheados) ?? 0;
      const salida = (numero(tokens.salida) ?? 0) + (numero(tokens.pensamiento) ?? 0);
      const usd = (Math.max(0, entrada - cacheados) * precio.entrada + cacheados * precio.cacheado + salida * precio.salida) / 1e6;
      gasto.llamadasIa += 1;
      if (linea.ruta === "/api/references/analyze") gasto.lectura += usd;
      else if (linea.ruta === "/api/chat") gasto.plan += usd;
      else gasto.otros += usd;
    }
    if (linea.tipo === "imagen") {
      const parametros = esRegistro(linea.datos.parametros) ? linea.datos.parametros : {};
      const tamano = esRegistro(parametros.imageSize) ? parametros.imageSize : {};
      const megapixeles = ((numero(tamano.width) ?? 1536) * (numero(tamano.height) ?? 1024)) / 1e6;
      // Cada imagen de entrada se cuenta del tamaño de la salida (fal cobra los megapíxeles procesados de entrada y salida).
      const entradas = lista(linea.datos.referencias).length;
      gasto.imagen += Math.ceil(megapixeles) * FAL_USD_POR_MP + entradas * megapixeles * FAL_USD_POR_MP;
      gasto.imagenes += 1;
    }
  }
  return gasto;
}

// ── Resúmenes para comparar etapas ─────────────────────────────────────────────────────────────────────────────────

type Blueprint = z.infer<typeof ReferenceBlueprintV2Schema>;

/** Las piezas de globos aprobadas de una lectura: tipo, cantidad, grupo, ubicación y colores leídos. */
function piezasDeLectura(blueprint: Blueprint | null): string[] {
  if (!blueprint) return [];
  return blueprint.elements
    .filter((elemento) => elemento.approved && elemento.category === "balloon_structure")
    .map((elemento) => {
      const tipo = elemento.visual_semantics?.structure_type ?? "?";
      const cantidad = elemento.quantity_semantics === "physical_instances" ? elemento.quantity.max : 1;
      const grupo = elemento.visual_semantics?.repetition_group;
      const ubicacion = elemento.visual_semantics?.placement;
      const colores = elemento.appearance.observed_colors.join(", ");
      return `${elemento.element_id} ${tipo}×${cantidad}${grupo ? ` grupo=${grupo}` : ""}${ubicacion ? ` @${ubicacion}` : ""} [${colores}]`;
    });
}

type ResumenPlan = {
  plan_hash: string | null;
  concepto: unknown;
  estructuras: Array<Record<string, unknown>>;
  compras: string[];
  comercial: unknown;
  sin_cobertura: number;
};

function resumirPlan(plan: unknown): ResumenPlan | null {
  if (!esRegistro(plan) || !esRegistro(plan.plan)) return null;
  const interno = plan.plan;
  return {
    plan_hash: texto(plan.plan_hash) ?? null,
    concepto: interno.concepto ?? null,
    estructuras: lista(interno.estructuras).filter(esRegistro).map((estructura) => ({
      id: estructura.estructura_id,
      nombre: estructura.nombre,
      oficial: estructura.estructura_oficial,
      tipo: estructura.tipo,
      repeticiones: estructura.repeticiones,
      ubicacion: estructura.ubicacion,
      referencia: estructura.referencia_element_id,
      medidas: estructura.medidas,
      densidad: estructura.densidad,
      mezcla: estructura.mezcla,
      materiales: lista(estructura.materiales).filter(esRegistro).map((material) => `${String(material.color)}/${String(material.acabado ?? "-")}:${String(material.participacion)}`),
      colores_referencia: estructura.colores_referencia,
      patron: estructura.patron_color ? JSON.stringify(estructura.patron_color).slice(0, 240) : undefined,
    })),
    compras: lista(plan.compras).filter(esRegistro).map((compra) => `${String(compra.titulo ?? compra.variant_id)} ×${String(compra.paquetes)}`),
    comercial: plan.comercial ?? null,
    sin_cobertura: lista(plan.sin_cobertura).length,
  };
}

/** Una línea por estructura, para comparar planes de un vistazo. */
function lineasPlan(resumen: ResumenPlan | null): string[] {
  if (!resumen) return [];
  return resumen.estructuras.map((estructura) => `${String(estructura.oficial ?? estructura.tipo)}×${String(estructura.repeticiones ?? 1)} «${String(estructura.nombre)}» @${String(estructura.ubicacion)} ref=${String(estructura.referencia ?? "-")} ${(Array.isArray(estructura.materiales) ? estructura.materiales : []).join(" ")}`);
}

// ── Un caso: una foto por una vista ────────────────────────────────────────────────────────────────────────────────

type Etapa = "lectura" | "plan" | "aprobacion" | "imagen" | "lista";

type ResultadoCaso = {
  caso: string;
  foto: string;
  titulo: string;
  vista: Vista;
  repeticion: number;
  conversacion: string;
  carpeta: string;
  /** Hasta dónde llegó: «lista» = hay imagen. */
  etapa: Etapa;
  error: string | null;
  lectura: { estado: number; ms: number; piezas: string[]; frase: string | null; colores: string[] } | null;
  plan: { intentos: number; ms: number; lineas: string[]; paleta: unknown; defecto: string | null; reply: string } | null;
  generate: { estado: number; ms: number; resumenCuerpo: ResumenCuerpoGeneracion; prompt: string | null; ancho: number | null; alto: number | null } | null;
  imagen: string | null;
  gasto: Gasto;
};

type Opciones = { base: string; raizRegistros: string; carpeta: string; sello: string; anclas: Anclas };

async function fotoParaVista(foto: FotoEjemplo, vista: Vista): Promise<{ base64: string; mime: "image/jpeg"; bytes: Buffer }> {
  const crudo = readFileSync(path.join(RUTA_FOTOS, foto.archivo));
  // La clásica manda la foto de la galería tal cual (`imagenDeFotoEjemplo`). La guiada recibe un archivo subido y lo
  // prepara como `prepararFotoReferencia` en el navegador: rotación EXIF, lado mayor 1800 px y JPEG 0,9 (aquí con sharp;
  // el JPEG del canvas del navegador no es byte a byte el mismo, pero sí la misma imagen).
  const bytes = vista === "clasica"
    ? crudo
    : await sharp(crudo).rotate().resize({ width: LADO_MAXIMO_REFERENCIA, height: LADO_MAXIMO_REFERENCIA, fit: "inside", withoutEnlargement: true }).jpeg({ quality: Math.round(CALIDAD_REFERENCIA * 100) }).toBuffer();
  return { base64: bytes.toString("base64"), mime: "image/jpeg", bytes };
}

async function correrCaso(foto: FotoEjemplo, vista: Vista, repeticion: number, opciones: Opciones): Promise<ResultadoCaso> {
  const corto = foto.id.replace("ejemplo-", "ej");
  const conversacion = `banco-${opciones.sello}-${corto}-${vista}-r${repeticion}`;
  const carpeta = path.join(opciones.carpeta, foto.id, `${vista}-r${repeticion}`);
  mkdirSync(carpeta, { recursive: true });
  const contexto: Contexto = { base: opciones.base, conversacion, vista };
  const resultado: ResultadoCaso = {
    caso: `${foto.id}/${vista}/r${repeticion}`, foto: foto.id, titulo: foto.titulo, vista, repeticion, conversacion, carpeta,
    etapa: "lectura", error: null, lectura: null, plan: null, generate: null, imagen: null,
    gasto: { lectura: 0, plan: 0, imagen: 0, otros: 0, llamadasIa: 0, imagenes: 0, modelosSinPrecio: [] },
  };
  try {
    const imagen = await fotoParaVista(foto, vista);
    writeFileSync(path.join(carpeta, "foto-enviada.jpg"), imagen.bytes);
    const referencia = { base64: imagen.base64, mime: imagen.mime };

    // (a) Lectura. Clásica: ReferenceAnalysisController ({ images, proveedor }) con las medidas del manifiesto.
    // Guiada: analizarFoto ({ images: [imagen] }) y adaptarAnalisisReferencia para la frase y los colores del brief.
    const cuerpoLectura = vista === "clasica"
      ? { images: [{ ...referencia, ancho: foto.ancho, alto: foto.alto, originalAncho: foto.ancho, originalAlto: foto.alto }], proveedor: "gemini" }
      : { images: [referencia] };
    const lectura = await post(contexto, "/api/references/analyze", cuerpoLectura, LIMITE_LECTURA_MS);
    const respuestaLectura = jsonSeguro(lectura.texto);
    const blueprintCrudo = esRegistro(respuestaLectura) ? ReferenceBlueprintV2Schema.safeParse(respuestaLectura.blueprint) : null;
    const blueprint: Blueprint | null = lectura.estado === 200 && blueprintCrudo?.success ? blueprintCrudo.data : null;
    const guiada = vista === "guiada" && lectura.estado === 200 ? adaptarAnalisisReferencia(respuestaLectura) : null;
    // La frase que vería el cliente de la guiada; en la clásica, la misma adaptación solo para comparar los colores.
    const comoGuiada = lectura.estado === 200 ? adaptarAnalisisReferencia(respuestaLectura) : null;
    escribirJson(path.join(carpeta, "lectura.json"), { estado: lectura.estado, ms: lectura.ms, cuerpoEnviado: sinBase64(cuerpoLectura), respuesta: respuestaLectura, adaptada: comoGuiada ? { frase: comoGuiada.frase, colores: comoGuiada.colores, piezas: comoGuiada.piezas } : null });
    resultado.lectura = { estado: lectura.estado, ms: lectura.ms, piezas: piezasDeLectura(blueprint), frase: comoGuiada?.frase ?? null, colores: comoGuiada?.colores.map((color) => color.nombre) ?? [] };
    if (vista === "guiada" && !guiada) {
      // La guiada sin lectura dice «No pude distinguir bien los detalles» y sigue sin plan de la foto.
      throw new Error(`lectura sin piezas para la guiada (HTTP ${lectura.estado})`);
    }
    if (vista === "clasica" && !blueprint) {
      // La clásica muestra el error del análisis y el turno sale sin la lectura: se sigue igual que ella.
      resultado.error = `lectura fallida (HTTP ${lectura.estado}); el plan sale sin lectura, como en la clásica`;
    }

    // (b) Plan.
    resultado.etapa = "plan";
    let cuerpoGenerate: Registro;
    if (vista === "clasica") {
      // page.tsx enviar(""): historial con el saludo + MENSAJE_SOLO_REFERENCIAS, sin schema_version (el servidor lo normaliza).
      const cuerpoPlan: Registro = {
        messages: [{ role: "assistant", content: opciones.anclas.saludoClasica }, { role: "user", content: MENSAJE_SOLO_REFERENCIAS }],
        brief: {},
        proveedor: "gemini",
        imagenesReferencia: [referencia],
        ...(blueprint ? { referenceBlueprint: blueprint } : {}),
        creatividad: CREATIVIDAD_POR_DEFECTO,
      };
      const chat = await pedirChat(contexto, cuerpoPlan);
      escribirJson(path.join(carpeta, "plan.json"), { intentos: [{ cuerpoEnviado: sinBase64(cuerpoPlan), estado: chat.estado, ms: chat.ms, herramientas: chat.herramientas, error: chat.error, fin: chat.fin }] });
      const resumen = resumirPlan(chat.fin?.plan);
      escribirJson(path.join(carpeta, "plan-resumen.json"), resumen);
      resultado.plan = { intentos: 1, ms: chat.ms, lineas: lineasPlan(resumen), paleta: esRegistro(resumen?.concepto) ? resumen.concepto.paleta : null, defecto: null, reply: texto(chat.fin?.reply)?.slice(0, 600) ?? "" };
      const plan = z.object({ plan_hash: z.string(), compras: z.array(z.object({ variant_id: z.string() }).passthrough()) }).passthrough().safeParse(chat.fin?.plan);
      if (!plan.success) throw new Error(chat.error ? `plan con error: ${JSON.stringify(chat.error).slice(0, 300)}` : "la clásica no recibió plan en el primer turno (respondió sin propuesta)");
      const planParaGenerar = plan.data;
      // aprobarPlan: la clásica no deja aprobar un plan que excede el presupuesto o tiene piezas sin cobertura.
      resultado.etapa = "aprobacion";
      const comercial = esRegistro(planParaGenerar.comercial) ? planParaGenerar.comercial : {};
      if (comercial.estado === "PRESUPUESTO_EXCEDIDO" || lista(planParaGenerar.sin_cobertura).length > 0) {
        throw new Error(`la clásica no deja aprobar este plan (${String(comercial.estado)}, sin cobertura: ${lista(planParaGenerar.sin_cobertura).length})`);
      }
      // generar(): con plan, productIds [] y las variantes de sus compras; cantidades de ragValidados y de la selección de
      // la IA (el plan gana en las suyas); brief del «fin»; solicitud = el texto del turno; lectura del mensaje anclado.
      const fin = chat.fin ?? {};
      const cantidades: Record<string, number> = {};
      for (const validado of lista(fin.ragValidados)) if (esRegistro(validado) && typeof validado.variantId === "string") cantidades[validado.variantId] = numero(validado.cantidad) ?? 1;
      for (const producto of lista(fin.seleccionIA)) if (esRegistro(producto) && typeof producto.id === "string") cantidades[producto.id] = numero(producto.paquetes) ?? 1;
      cuerpoGenerate = cuerpoGeneracion({
        plan: planParaGenerar,
        productIds: [],
        ragVariantIds: planParaGenerar.compras.map((compra) => compra.variant_id),
        manualProducts: [],
        productQuantities: cantidades,
        brief: (esRegistro(fin.brief) ? fin.brief : {}) as Brief,
        solicitudUsuario: MENSAJE_SOLO_REFERENCIAS,
        instruccion: "",
        creatividad: CREATIVIDAD_POR_DEFECTO,
        fotoEspacio: null,
        imagenesReferencia: [referencia],
        // El mensaje guarda la lectura que devolvió el «fin» tal cual; sin ella, la del panel (`referenceDraftRef`).
        blueprint: fin.referenceBlueprint ?? blueprint ?? undefined,
        aspecto: undefined,
        escenografiaApagada: [],
        imagenPrevia: null,
      });
    } else {
      // VistaGuiada.aceptarPlanFoto → ejecutarPlan: intento 1 con el texto de la clásica + confirmar; si el plan no llega
      // confirmado o trae un defecto (`defectoPlanGuiado`), un reintento con `instruccionPlanFoto`; si el reintento no da
      // un plan, se queda el primero.
      const lecturaGuiada = guiada!;
      const colores = lecturaGuiada.colores.map((color) => color.nombre);
      const armar = (reintento: boolean): Registro => ({
        schema_version: "chat.v1",
        messages: [{ role: "user", content: reintento ? instruccionPlanFoto({ reintento, colores }) : `${MENSAJE_SOLO_REFERENCIAS}\n${opciones.anclas.confirmarPlanFoto}` }],
        brief: briefChatGuiado(colores),
        creatividad: CREATIVIDAD_POR_DEFECTO,
        imagenesReferencia: [referencia],
        referenceBlueprint: lecturaGuiada.blueprint,
        piezasIndividuales: true,
      });
      const intentos: Registro[] = [];
      let elegido: z.infer<typeof PlanGuiadoSchema> | null = null;
      let respaldo: z.infer<typeof PlanGuiadoSchema> | null = null;
      let defecto: string | null = null;
      let msPlan = 0;
      let reply = "";
      for (const reintento of [false, true]) {
        const cuerpoPlan = armar(reintento);
        const chat = await pedirChat(contexto, cuerpoPlan);
        msPlan += chat.ms;
        const plan = PlanGuiadoSchema.safeParse(chat.fin?.plan);
        const defectoIntento = plan.success && !reintento ? defectoPlanGuiado(plan.data, chat.fin?.cotizacion) : null;
        intentos.push({ reintento, cuerpoEnviado: sinBase64(cuerpoPlan), estado: chat.estado, ms: chat.ms, herramientas: chat.herramientas, error: chat.error, planValido: plan.success, defecto: defectoIntento, fin: chat.fin });
        reply = texto(chat.fin?.reply)?.slice(0, 600) ?? reply;
        if (plan.success && !defectoIntento) { elegido = plan.data; break; }
        if (plan.success) { respaldo = plan.data; defecto = defectoIntento; }
      }
      elegido ??= respaldo;
      escribirJson(path.join(carpeta, "plan.json"), { intentos });
      const resumen = resumirPlan(elegido);
      escribirJson(path.join(carpeta, "plan-resumen.json"), resumen);
      resultado.plan = { intentos: intentos.length, ms: msPlan, lineas: lineasPlan(resumen), paleta: elegido?.plan.concepto.paleta ?? null, defecto, reply };
      if (!elegido) throw new Error("la guiada no recibió un plan confirmado en ninguno de los dos intentos");
      resultado.etapa = "aprobacion";
      // verComoQuedaria: el brief de la conversación guiada (vacío en el camino de la foto) con la paleta del plan, la
      // descripción del plan como solicitud, la foto preparada y la lectura de la que salió el plan.
      cuerpoGenerate = cuerpoGeneracion({
        plan: elegido,
        ...fuentesDelPlan(elegido),
        brief: { tipo_evento: undefined, colores: elegido.plan.concepto.paleta, estilo: undefined },
        solicitudUsuario: elegido.plan.concepto.descripcion,
        imagenesReferencia: [referencia],
        blueprint: lecturaGuiada.blueprint,
      });
    }

    // (c) Imagen.
    resultado.etapa = "imagen";
    const resumenCuerpo = resumenCuerpoGeneracion(cuerpoGenerate);
    escribirJson(path.join(carpeta, "cuerpo-generate.json"), sinBase64(cuerpoGenerate));
    const generate = await post(contexto, "/api/generate", cuerpoGenerate, LIMITE_IMAGEN_MS);
    const respuestaGenerate = jsonSeguro(generate.texto);
    const datosGenerate = esRegistro(respuestaGenerate) ? respuestaGenerate : {};
    escribirJson(path.join(carpeta, "generate-respuesta.json"), sinBase64({ ...datosGenerate, imagen: texto(datosGenerate.imagen) ? "<imagen guardada aparte>" : undefined }));
    resultado.generate = { estado: generate.estado, ms: generate.ms, resumenCuerpo, prompt: texto(datosGenerate.prompt) ?? null, ancho: null, alto: null };
    const dataUrl = texto(datosGenerate.imagen);
    if (generate.estado !== 200 || !dataUrl) throw new Error(`/api/generate HTTP ${generate.estado}: ${JSON.stringify(datosGenerate.ui_error ?? datosGenerate.error ?? "").slice(0, 300)}`);
    const [cabecera, base64] = dataUrl.split(",", 2);
    const extension = cabecera?.includes("png") ? "png" : cabecera?.includes("webp") ? "webp" : "jpg";
    const archivoImagen = path.join(carpeta, `imagen.${extension}`);
    const bytesImagen = Buffer.from(base64 ?? "", "base64");
    writeFileSync(archivoImagen, bytesImagen);
    const meta = await sharp(bytesImagen).metadata();
    resultado.generate.ancho = meta.width ?? null;
    resultado.generate.alto = meta.height ?? null;
    resultado.imagen = archivoImagen;
    resultado.etapa = "lista";
  } catch (causa) {
    resultado.error = causa instanceof Error ? causa.message : String(causa);
  }

  // (d) Registro del servidor: prompt final que fue a FLUX, decisiones de /api/generate y gasto.
  await new Promise((resolver) => setTimeout(resolver, 1500));
  const { lineas, crudo } = lineasDeConversacion(opciones.raizRegistros, conversacion);
  if (crudo) writeFileSync(path.join(carpeta, "registro.jsonl"), crudo);
  const promptFlux = decision(lineas, "regla:prompt_flux", "/api/generate");
  const promptFinal = esRegistro(promptFlux) ? texto(promptFlux.promptFinal) ?? null : null;
  writeFileSync(path.join(carpeta, "prompt.txt"), [
    `# Prompt final enviado a FLUX (registro: regla:prompt_flux)\n${promptFinal ?? "(no está en el registro)"}`,
    `# Prompt de la respuesta de /api/generate\n${resultado.generate?.prompt ?? "(sin respuesta)"}`,
  ].join("\n\n"));
  escribirJson(path.join(carpeta, "generate-decisiones.json"), {
    cuerpo: decision(lineas, "regla:cuerpo_generacion", "/api/generate") ?? null,
    plan_resuelto: decision(lineas, "regla:plan_resuelto_generacion", "/api/generate") ?? null,
    escena: decision(lineas, "regla:escena_aprobada", "/api/generate") ?? null,
    creatividad: decision(lineas, "regla:creatividad_generacion", "/api/generate") ?? null,
    prompt_flux: promptFlux ?? null,
    lectura_colores: decision(lineas, "regla:lectura_foto.colores", "/api/references/analyze") ?? null,
    lectura_config: decision(lineas, "regla:config_lectura_foto", "/api/references/analyze") ?? null,
  });
  if (resultado.generate && promptFinal) resultado.generate.prompt = promptFinal;
  resultado.gasto = gastoDeRegistro(lineas);
  escribirJson(path.join(carpeta, "caso.json"), resultado);
  return resultado;
}

// ── Mosaicos para el juez ──────────────────────────────────────────────────────────────────────────────────────────

const ALTO_MOSAICO = 460;

function escaparXml(valor: string): string {
  return valor.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function azulejo(archivo: string | null, etiqueta: string): Promise<{ buffer: Buffer; ancho: number }> {
  const banda = 34;
  let cuerpo: Buffer;
  let ancho: number;
  if (archivo && existsSync(archivo)) {
    cuerpo = await sharp(archivo).resize({ height: ALTO_MOSAICO }).jpeg({ quality: 88 }).toBuffer();
    ancho = (await sharp(cuerpo).metadata()).width ?? ALTO_MOSAICO;
  } else {
    ancho = Math.round(ALTO_MOSAICO * 1.5);
    cuerpo = await sharp({ create: { width: ancho, height: ALTO_MOSAICO, channels: 3, background: "#d4d4d4" } })
      .composite([{ input: Buffer.from(`<svg width="${ancho}" height="${ALTO_MOSAICO}"><text x="50%" y="50%" font-family="Arial" font-size="26" text-anchor="middle" fill="#444">sin imagen</text></svg>`), top: 0, left: 0 }])
      .jpeg().toBuffer();
  }
  const etiquetaSvg = Buffer.from(`<svg width="${ancho}" height="${banda}"><rect width="100%" height="100%" fill="#111"/><text x="10" y="23" font-family="Arial" font-size="18" fill="#fff">${escaparXml(etiqueta)}</text></svg>`);
  const buffer = await sharp({ create: { width: ancho, height: ALTO_MOSAICO + banda, channels: 3, background: "#ffffff" } })
    .composite([{ input: etiquetaSvg, top: 0, left: 0 }, { input: cuerpo, top: banda, left: 0 }])
    .jpeg({ quality: 88 }).toBuffer();
  return { buffer, ancho };
}

async function mosaicos(carpetaCorrida: string, resultados: ResultadoCaso[]): Promise<string[]> {
  const salida = path.join(carpetaCorrida, "comparar");
  mkdirSync(salida, { recursive: true });
  const claves = [...new Set(resultados.map((resultado) => `${resultado.foto}|${resultado.repeticion}`))];
  const archivos: string[] = [];
  for (const clave of claves) {
    const [fotoId, repeticion] = clave.split("|") as [string, string];
    const foto = MANIFIESTO_REFERENCIAS_EJEMPLO.fotos.find((item) => item.id === fotoId)!;
    const piezas = [await azulejo(path.join(RUTA_FOTOS, foto.archivo), `FOTO ${foto.id.replace("ejemplo-", "")} · ${foto.titulo}`)];
    for (const vista of VISTAS) {
      const caso = resultados.find((resultado) => resultado.foto === fotoId && resultado.vista === vista && String(resultado.repeticion) === repeticion);
      if (!caso) continue;
      piezas.push(await azulejo(caso.imagen, `${vista.toUpperCase()} r${repeticion}${caso.etapa === "lista" ? "" : ` · paró en ${caso.etapa}`}`));
    }
    const separacion = 10;
    const ancho = piezas.reduce((total, pieza) => total + pieza.ancho, 0) + separacion * (piezas.length - 1);
    let izquierda = 0;
    const capas = piezas.map((pieza) => {
      const capa = { input: pieza.buffer, top: 0, left: izquierda };
      izquierda += pieza.ancho + separacion;
      return capa;
    });
    const archivo = path.join(salida, `${fotoId}-r${repeticion}.jpg`);
    await sharp({ create: { width: ancho, height: ALTO_MOSAICO + 34, channels: 3, background: "#ffffff" } }).composite(capas).jpeg({ quality: 86 }).toFile(archivo);
    archivos.push(archivo);
  }
  return archivos;
}

function escribirGuiaJuez(carpetaCorrida: string, resultados: ResultadoCaso[], archivosMosaico: string[]): void {
  const lineas = [
    `# Juicio del banco (${RUBRICA.version})`,
    "",
    RUBRICA.pregunta,
    "",
    "Criterios (cada uno ok | leve | falla):",
    ...RUBRICA.criterios.map((criterio) => `- **${criterio.id}**: ${criterio.texto}`),
    "",
    `Escala: ok = ${RUBRICA.escala.ok}; leve = ${RUBRICA.escala.leve}; falla = ${RUBRICA.escala.falla}.`,
    `Regla: ${RUBRICA.regla}`,
    "",
    "Mosaicos (foto | clásica | guiada):",
    ...archivosMosaico.map((archivo) => `- ${archivo}`),
    "",
    "Copia `notas.plantilla.json` a `notas.json`, rellena cada caso que tenga imagen y corre `informe`.",
  ];
  writeFileSync(path.join(carpetaCorrida, "juicio.md"), `${lineas.join("\n")}\n`);
  const plantilla = {
    rubrica: RUBRICA.version,
    juez: "",
    fecha: new Date().toISOString().slice(0, 10),
    notas: Object.fromEntries(resultados.filter((resultado) => resultado.etapa === "lista").map((resultado) => [resultado.caso, { piezas: "ok", forma: "ok", colores: "ok", proporcion: "ok", sin_inventos: "ok", realismo: "ok", motivo: "" }])),
  };
  escribirJson(path.join(carpetaCorrida, "notas.plantilla.json"), plantilla);
}

// ── correr ─────────────────────────────────────────────────────────────────────────────────────────────────────────

async function correr(): Promise<void> {
  usarCertificadosDelSistema();
  const vistas = (bandera("vistas") ?? "clasica,guiada").split(",").map((vista) => vista.trim()).filter(Boolean);
  for (const vista of vistas) if (!VISTAS.includes(vista as Vista)) throw new Error(`--vistas solo admite ${VISTAS.join(", ")}`);
  const repeticiones = Number(bandera("repeticiones") ?? "1");
  const tope = Number(bandera("tope-usd") ?? "1.5");
  const concurrencia = Math.max(1, Number(bandera("concurrencia") ?? "2"));
  const base = bandera("base") ?? "http://localhost:3010";
  const raizRegistros = path.resolve(bandera("registros") ?? path.join(RAIZ_PROYECTO, "data", "registros"));
  const raizSalida = path.resolve(bandera("salida") ?? path.join(os.tmpdir(), "banco-fotos-ejemplo"));
  if (!Number.isInteger(repeticiones) || repeticiones < 1) throw new Error("--repeticiones debe ser un entero ≥ 1");
  if (!Number.isFinite(tope) || tope <= 0) throw new Error("--tope-usd debe ser un número > 0");
  const fotos = fotosPedidas(bandera("fotos"));
  const salud = await fetch(`${base}/api/ia/salud`, { signal: AbortSignal.timeout(15_000) }).then((respuesta) => respuesta.status).catch(() => 0);
  if (salud !== 200) throw new Error(`El servidor ${base} no responde (/api/ia/salud → ${salud}). Este arnés no lo arranca.`);

  const marca = sello();
  const carpeta = path.join(raizSalida, marca);
  mkdirSync(carpeta, { recursive: true });
  const anclas = anclasDeLasVistas();
  for (const aviso of anclas.avisos) console.warn(`AVISO espejo: ${aviso}`);
  const saldoInicial = await saldoFal();
  const casos = fotos.flatMap((foto) => Array.from({ length: repeticiones }, (_, indice) => indice + 1).flatMap((repeticion) => vistas.map((vista) => ({ foto, vista: vista as Vista, repeticion }))));
  const comando = `npx tsx scripts/eval/banco-fotos-ejemplo.ts correr ${process.argv.slice(3).join(" ")}`.trim();
  console.log(`Corrida ${marca}: ${casos.length} casos (${fotos.length} fotos × ${vistas.join("+")} × ${repeticiones}), tope US$${tope} en lecturas + imágenes → ${carpeta}`);
  escribirJson(path.join(carpeta, "corrida.json"), { sello: marca, comando, base, vistas, repeticiones, tope_usd: tope, fotos: fotos.map((foto) => foto.id), anclas, saldo_fal_inicial: saldoInicial, estado: "corriendo" });

  const opciones: Opciones = { base, raizRegistros, carpeta, sello: marca, anclas };
  const resultados: ResultadoCaso[] = [];
  const omitidos: string[] = [];
  let gastado = 0;
  let reservado = 0;
  const cola = [...casos];
  async function trabajador(): Promise<void> {
    for (let siguiente = cola.shift(); siguiente; siguiente = cola.shift()) {
      const { foto, vista, repeticion } = siguiente;
      const id = `${foto.id}/${vista}/r${repeticion}`;
      if (gastado + reservado + RESERVA_CASO_USD > tope) {
        omitidos.push(id);
        console.warn(`omitido por el tope: ${id} (gastado US$${gastado.toFixed(3)}, en curso US$${reservado.toFixed(3)})`);
        continue;
      }
      reservado += RESERVA_CASO_USD;
      const inicio = Date.now();
      const resultado = await correrCaso(foto, vista, repeticion, opciones);
      reservado -= RESERVA_CASO_USD;
      gastado += resultado.gasto.lectura + resultado.gasto.imagen;
      resultados.push(resultado);
      console.log(`${id}: ${resultado.etapa}${resultado.error ? ` · ${resultado.error.slice(0, 160)}` : ""} · ${Math.round((Date.now() - inicio) / 1000)} s · lectura+imagen US$${(resultado.gasto.lectura + resultado.gasto.imagen).toFixed(3)} (acumulado US$${gastado.toFixed(3)})`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrencia, casos.length) }, () => trabajador()));
  resultados.sort((a, b) => a.caso.localeCompare(b.caso));
  const saldoFinal = await saldoFal();
  const total = (clave: keyof Pick<Gasto, "lectura" | "plan" | "imagen" | "otros">) => Math.round(resultados.reduce((suma, resultado) => suma + resultado.gasto[clave], 0) * 10_000) / 10_000;
  const gasto = { lecturas_usd: total("lectura"), planes_usd: total("plan"), imagenes_usd: total("imagen"), otros_usd: total("otros"), tope_cuenta_usd: Math.round((total("lectura") + total("imagen")) * 10_000) / 10_000, imagenes: resultados.reduce((suma, resultado) => suma + resultado.gasto.imagenes, 0), saldo_fal_inicial: saldoInicial, saldo_fal_final: saldoFinal, delta_saldo_fal: saldoInicial !== null && saldoFinal !== null ? Math.round((saldoInicial - saldoFinal) * 10_000) / 10_000 : null };
  const archivosMosaico = await mosaicos(carpeta, resultados);
  escribirGuiaJuez(carpeta, resultados, archivosMosaico);
  escribirJson(path.join(carpeta, "corrida.json"), { sello: marca, comando, base, vistas, repeticiones, tope_usd: tope, fotos: fotos.map((foto) => foto.id), anclas, estado: "terminada", omitidos_por_tope: omitidos, gasto, resultados });
  console.log(`\nListo: ${resultados.filter((resultado) => resultado.etapa === "lista").length}/${casos.length} con imagen. Gasto estimado: lecturas US$${gasto.lecturas_usd}, imágenes US$${gasto.imagenes_usd} (fal: saldo ${saldoInicial ?? "?"} → ${saldoFinal ?? "?"}), planes US$${gasto.planes_usd}, otros US$${gasto.otros_usd}.`);
  console.log(`Juicio: ${path.join(carpeta, "juicio.md")}`);
}

// ── informe ────────────────────────────────────────────────────────────────────────────────────────────────────────

type CorridaGuardada = { sello: string; comando: string; resultados: ResultadoCaso[]; gasto: Record<string, unknown>; omitidos_por_tope: string[]; anclas: Anclas };

function leerCorrida(carpeta: string): CorridaGuardada {
  const datos = leerJson(path.join(carpeta, "corrida.json"));
  if (!esRegistro(datos) || !Array.isArray(datos.resultados)) throw new Error(`${carpeta}/corrida.json no es una corrida terminada.`);
  return datos as unknown as CorridaGuardada;
}

function diferencias(a: readonly string[], b: readonly string[]): { soloA: string[]; soloB: string[] } {
  return { soloA: a.filter((item) => !b.includes(item)), soloB: b.filter((item) => !a.includes(item)) };
}

/** Lo que cambia entre la clásica y la guiada de la misma foto, etapa por etapa (para la causa de una diferencia). */
function diferenciasPorEtapa(clasica: ResultadoCaso, guiada: ResultadoCaso): string[] {
  const salida: string[] = [];
  const piezas = diferencias(clasica.lectura?.piezas.map((pieza) => pieza.replace(/^\S+ /, "")) ?? [], guiada.lectura?.piezas.map((pieza) => pieza.replace(/^\S+ /, "")) ?? []);
  salida.push(`- **lectura**: clásica ${clasica.lectura?.piezas.length ?? 0} pieza(s), guiada ${guiada.lectura?.piezas.length ?? 0}. Colores (adaptados) clásica [${clasica.lectura?.colores.join(", ") ?? ""}] · guiada [${guiada.lectura?.colores.join(", ") ?? ""}]${piezas.soloA.length || piezas.soloB.length ? `\n  - solo clásica: ${piezas.soloA.join(" | ") || "—"}\n  - solo guiada: ${piezas.soloB.join(" | ") || "—"}` : " · mismas piezas"}`);
  const planes = diferencias(clasica.plan?.lineas ?? [], guiada.plan?.lineas ?? []);
  salida.push(`- **plan**: clásica ${clasica.plan?.lineas.length ?? 0} estructura(s), guiada ${guiada.plan?.lineas.length ?? 0} (intentos ${guiada.plan?.intentos ?? 0}${guiada.plan?.defecto ? `, defecto: ${guiada.plan.defecto}` : ""}). Paleta clásica ${JSON.stringify(clasica.plan?.paleta ?? null)} · guiada ${JSON.stringify(guiada.plan?.paleta ?? null)}${planes.soloA.length || planes.soloB.length ? `\n  - solo clásica: ${planes.soloA.join(" | ") || "—"}\n  - solo guiada: ${planes.soloB.join(" | ") || "—"}` : " · mismas estructuras"}`);
  const cuerpoA = clasica.generate?.resumenCuerpo;
  const cuerpoB = guiada.generate?.resumenCuerpo;
  if (cuerpoA && cuerpoB) {
    const campos = diferencias(cuerpoA.campos, cuerpoB.campos);
    const distintos = (Object.keys(cuerpoA) as Array<keyof ResumenCuerpoGeneracion>).filter((clave) => clave !== "campos" && clave !== "planHash" && JSON.stringify(cuerpoA[clave]) !== JSON.stringify(cuerpoB[clave]));
    salida.push(`- **cuerpo de generate**: campos solo clásica [${campos.soloA.join(", ")}] · solo guiada [${campos.soloB.join(", ")}]; valores distintos: ${distintos.map((clave) => `${clave} (${JSON.stringify(cuerpoA[clave])} → ${JSON.stringify(cuerpoB[clave])})`).join("; ") || "ninguno"}`);
  } else {
    salida.push(`- **cuerpo de generate**: ${cuerpoA ? "" : "la clásica no llegó a generate. "}${cuerpoB ? "" : "la guiada no llegó a generate."}`);
  }
  const promptA = clasica.generate?.prompt ?? "";
  const promptB = guiada.generate?.prompt ?? "";
  salida.push(`- **prompt**: clásica ${promptA.length} car. · guiada ${promptB.length} car.${promptA && promptB ? `\n  - clásica: ${promptA.slice(0, 420)}…\n  - guiada: ${promptB.slice(0, 420)}…` : ""}`);
  return salida;
}

function informe(carpeta: string): void {
  const corrida = leerCorrida(carpeta);
  const archivoNotas = path.join(carpeta, "notas.json");
  const notas = existsSync(archivoNotas) ? NotasSchema.parse(leerJson(archivoNotas)) : null;
  const veredicto = (resultado: ResultadoCaso): { valor: "bien" | "no" | "sin juicio"; motivo: string } => {
    if (resultado.etapa !== "lista") return { valor: "no", motivo: `no llegó a imagen (paró en ${resultado.etapa}): ${resultado.error ?? ""}` };
    const nota = notas?.notas[resultado.caso];
    if (!nota) return { valor: "sin juicio", motivo: "" };
    const fallas = IDS_CRITERIOS.filter((criterio) => nota[criterio] === "falla");
    const leves = IDS_CRITERIOS.filter((criterio) => nota[criterio] === "leve");
    return { valor: veredictoDe(nota), motivo: `${fallas.length ? `falla: ${fallas.join(", ")}. ` : ""}${leves.length ? `leve: ${leves.join(", ")}. ` : ""}${nota.motivo}` };
  };
  const lineas: string[] = [`# Banco de fotos de ejemplo · corrida ${corrida.sello}`, "", `Comando: \`${corrida.comando}\``, "", `Rúbrica ${RUBRICA.version}. ${RUBRICA.regla}`, ""];
  if (corrida.anclas.avisos.length) lineas.push("**Avisos del espejo** (la vista cambió desde que se escribió el arnés):", ...corrida.anclas.avisos.map((aviso) => `- ${aviso}`), "");
  const porVista = new Map<Vista, { bien: number; total: number; sinJuicio: number }>();
  for (const resultado of corrida.resultados) {
    const cuenta = porVista.get(resultado.vista) ?? { bien: 0, total: 0, sinJuicio: 0 };
    const { valor } = veredicto(resultado);
    if (valor === "sin juicio") cuenta.sinJuicio += 1;
    else {
      cuenta.total += 1;
      if (valor === "bien") cuenta.bien += 1;
    }
    porVista.set(resultado.vista, cuenta);
  }
  lineas.push("## Resultado", "");
  for (const [vista, cuenta] of porVista) {
    lineas.push(`- **${vista}**: ${cuenta.bien}/${cuenta.total} «bien» = ${cuenta.total ? Math.round((cuenta.bien / cuenta.total) * 100) : 0} %${cuenta.sinJuicio ? ` (${cuenta.sinJuicio} sin juicio)` : ""} → ${cuenta.total && cuenta.bien / cuenta.total > 0.5 ? "pasa el listón del dueño (> 50 %)" : "no pasa el listón del dueño (> 50 %)"}`);
  }
  if (corrida.omitidos_por_tope.length) lineas.push(`- Omitidos por el tope: ${corrida.omitidos_por_tope.join(", ")}`);
  lineas.push("", "## Por foto", "", "| Foto | Rep | Clásica | Motivo clásica | Guiada | Motivo guiada |", "|---|---|---|---|---|---|");
  const claves = [...new Set(corrida.resultados.map((resultado) => `${resultado.foto}|${resultado.repeticion}`))];
  for (const clave of claves) {
    const [fotoId, repeticion] = clave.split("|") as [string, string];
    const de = (vista: Vista) => corrida.resultados.find((resultado) => resultado.foto === fotoId && resultado.vista === vista && String(resultado.repeticion) === repeticion);
    const celda = (resultado: ResultadoCaso | undefined) => (resultado ? veredicto(resultado) : { valor: "—", motivo: "" });
    const clasica = celda(de("clasica"));
    const guiada = celda(de("guiada"));
    const titulo = de("clasica")?.titulo ?? de("guiada")?.titulo ?? "";
    lineas.push(`| ${fotoId.replace("ejemplo-", "")} ${titulo} | ${repeticion} | ${clasica.valor} | ${clasica.motivo.replace(/\|/g, "/")} | ${guiada.valor} | ${guiada.motivo.replace(/\|/g, "/")} |`);
  }
  lineas.push("", "## Diferencias por etapa (clásica → guiada)", "");
  for (const clave of claves) {
    const [fotoId, repeticion] = clave.split("|") as [string, string];
    const clasica = corrida.resultados.find((resultado) => resultado.foto === fotoId && resultado.vista === "clasica" && String(resultado.repeticion) === repeticion);
    const guiada = corrida.resultados.find((resultado) => resultado.foto === fotoId && resultado.vista === "guiada" && String(resultado.repeticion) === repeticion);
    if (!clasica || !guiada) continue;
    const peor = veredicto(clasica).valor === "bien" && veredicto(guiada).valor === "no";
    lineas.push(`### ${fotoId} r${repeticion}${peor ? " · la guiada sale PEOR" : ""}`, ...diferenciasPorEtapa(clasica, guiada), "");
  }
  lineas.push("## Gasto", "", "```json", JSON.stringify(corrida.gasto, null, 1), "```", "", "## Imágenes", "", ...corrida.resultados.map((resultado) => `- ${resultado.caso}: ${resultado.imagen ?? "(sin imagen)"}`), "");
  const archivo = path.join(carpeta, "informe.md");
  writeFileSync(archivo, `${lineas.join("\n")}\n`);
  console.log(lineas.join("\n"));
  console.log(`\nInforme: ${archivo}`);
}

// ── main ───────────────────────────────────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [modo, carpeta] = process.argv.slice(2);
  if (modo === "correr") return correr();
  if (modo === "comparar" && carpeta) {
    const corrida = leerCorrida(path.resolve(carpeta));
    const archivos = await mosaicos(path.resolve(carpeta), corrida.resultados);
    escribirGuiaJuez(path.resolve(carpeta), corrida.resultados, archivos);
    console.log(archivos.join("\n"));
    return;
  }
  if (modo === "informe" && carpeta) return informe(path.resolve(carpeta));
  if (modo === "revisar") {
    // Sin gastar: servidor, espejos de las vistas, saldo de fal y la foto que mandaría cada vista.
    usarCertificadosDelSistema();
    const base = bandera("base") ?? "http://localhost:3010";
    const salud = await fetch(`${base}/api/ia/salud`, { signal: AbortSignal.timeout(15_000) }).then((respuesta) => respuesta.status).catch(() => 0);
    const anclas = anclasDeLasVistas();
    console.log(`servidor ${base}: ${salud === 200 ? "ok" : `NO responde (${salud})`}`);
    console.log(`saldo fal: ${(await saldoFal()) ?? "no disponible"}`);
    console.log(`espejos: ${anclas.avisos.length ? anclas.avisos.join(" | ") : "sin avisos"} · saludo «${anclas.saludoClasica.slice(0, 40)}…» · confirmar «${anclas.confirmarPlanFoto}»`);
    for (const foto of fotosPedidas(bandera("fotos"))) {
      const clasica = await fotoParaVista(foto, "clasica");
      const guiada = await fotoParaVista(foto, "guiada");
      const meta = await sharp(guiada.bytes).metadata();
      console.log(`${foto.id} ${foto.titulo}: clásica ${Math.round(clasica.bytes.length / 1024)} KB (cruda) · guiada ${Math.round(guiada.bytes.length / 1024)} KB ${meta.width}×${meta.height}`);
    }
    return;
  }
  console.log("Uso: npx tsx scripts/eval/banco-fotos-ejemplo.ts correr|comparar <carpeta>|informe <carpeta> (ver la cabecera del archivo).");
  process.exitCode = 1;
}

main().catch((causa: unknown) => {
  console.error(causa instanceof Error ? causa.message : causa);
  process.exitCode = 1;
});
