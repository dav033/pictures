import { ThinkingLevel, type Content, type Part } from "@google/genai";
import { z } from "zod";
import { getGeminiClient, MODELO_CHAT } from "@/lib/gemini";
import { conRegistro, decidir } from "@/lib/registro/servidor";
import { DECLARACIONES_ESCENA, MAX_NODOS, TIPOS_PIEZA, aplicarHerramienta, idsDeEscena } from "@/lib/globos3d/herramientas-escena";
import { seccionVocabularioEscena } from "@/lib/globos3d/prompt-escena";
import type { Colocacion, Escena } from "@/lib/globos3d/escena";
import type { Pieza } from "@/lib/globos3d/piezas";

/**
 * Taller 3D → «Pídele a la IA»: el usuario escribe en lenguaje natural («un arco orgánico rosado y dorado de 3 m,
 * dos columnas blancas a los lados…») y Gemini (solo texto + herramientas: aquí NUNCA genera imágenes) arma o
 * cambia la escena llamando a las herramientas de `herramientas-escena.ts`. CRUD: suma o cambia lo pedido sin
 * rehacer lo demás. Hasta 8 vueltas del modelo con herramientas por mensaje (y 24 llamadas en total), tope de 60
 * mensajes por hora por instancia. Cada herramienta aplicada (o rechazada) y la respuesta final quedan con
 * `decidir(...)` en el registro de la conversación; la llamada al modelo la audita `getGeminiClient`.
 */

const MAX_PASOS = 8;
const MAX_LLAMADAS = 24;
const TOPE_POR_HORA = 60;
let ventana = { desde: Date.now(), usadas: 0 };

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Numero = z.number().finite();
const Vec = z.object({ x: Numero, y: Numero, z: Numero });

const ColocacionSchema: z.ZodType<Colocacion> = z.discriminatedUnion("en", [
  z.object({ en: z.literal("piso"), xCm: Numero, zCm: Numero, giroGrados: Numero }),
  z.object({ en: z.literal("pared"), pared: z.enum(["fondo", "izquierda", "derecha"]), aLoLargoCm: Numero, alturaCm: Numero }),
  z.object({ en: z.literal("techo"), xCm: Numero, zCm: Numero, cuelgaCm: Numero, giroGrados: Numero, volteada: z.boolean() }),
  z.object({ en: z.literal("ancla"), padreId: z.string().min(1).max(80), ancla: Numero, cada: Numero, giroGrados: Numero, omitir: z.array(Numero).max(400).optional() }),
  z.object({ en: z.literal("libre"), xCm: Numero, yCm: Numero, zCm: Numero, giroGrados: Numero }),
  z.object({ en: z.literal("sobre"), padreId: z.string().min(1).max(80), puntoCm: Vec, normal: Vec, giroGrados: Numero }),
]);

/**
 * La pieza la arma el taller (que ya valida sus datos al armar): aquí basta con que sea un objeto de un tipo conocido.
 * Todos los tipos: una escena con formas, letras, metalizados, murales, techo o árboles (las de la biblioteca) también vale.
 */
const PiezaSchema = z.custom<Pieza>((v) => typeof v === "object" && v !== null && (TIPOS_PIEZA as readonly unknown[]).includes((v as { tipo?: unknown }).tipo), "Pieza desconocida");

const EscenaSchema: z.ZodType<Escena> = z.object({
  sala: z.object({
    anchoCm: Numero.min(100).max(3000), fondoCm: Numero.min(100).max(3000), altoCm: Numero.min(100).max(1500),
    tonos: z.object({ piso: Hex, paredes: Hex, techo: Hex }),
    mostrar: z.object({ piso: z.boolean(), fondo: z.boolean(), laterales: z.boolean(), techo: z.boolean() }),
  }),
  nodos: z.array(z.object({ id: z.string().min(1).max(80), nombre: z.string().max(120), pieza: PiezaSchema, colocacion: ColocacionSchema })).max(MAX_NODOS),
});

const CuerpoSchema = z.object({
  escena: EscenaSchema,
  mensaje: z.string().trim().min(1).max(1000),
  historial: z.array(z.object({ rol: z.enum(["usuario", "asistente"]), texto: z.string().max(1500) })).max(8).default([]),
}).strict();

const SISTEMA = `Eres el asistente del taller 3D de decoración con globos Sempertex. Armas y cambias la escena SOLO con las herramientas; no generas imágenes.
Sala (cm): x de izquierda (−) a derecha (+) desde el centro; z de fondo (−) a frente (+); la pared del fondo está en z = −fondo/2. Lo que va delante de la pared del fondo suele ir a z ≈ −fondo/2 + 100.

QUÉ ES CADA COSA (no las confundas):
- «columna» a secas = columna (clásica de cuartetos, lisa). «columna orgánica» (o «de varios tamaños», «tipo burbuja», «inclinada/torcida») = columna_organica. «columna irregular» = trazo_organico con silueta columna_recta; «columna de forma libre/rara/de racimos/en S» = trazo_organico con silueta columna_racimos, columna_s o columna_inclinada.
- Guirnalda orgánica con forma (que cruza arriba y baja por un lado, en esquina, medio arco, asimétrica, como la de una foto) = trazo_organico con su silueta (o puntos); con hojas o flores de tela: follaje («monstera», «palma», «helecho», «eucalipto», «hoja_seca dorada», «rosa»). Lo mismo: «guirnalda orgánica» = guirnalda_organica (la guirnalda a secas es la clásica de cuartetos), «arco orgánico» = arco_organico, «semiarco» = semiarco_organico, «aro» = aro_organico, «marco» = marco_organico.
- También creas de cero: pared_trenzas, forma (figura corazon/estrella/nube/castillo… rellena, esfera o cono), letras (texto), metalizado (foil: número, letras, corazón, estrella…), mural, techo, arbol (palmera), globo suelto, decoracion (flor, moño, estrella). Cada una con sus parámetros: alto_cm, ancho_cm, grosor_cm, inclinacion_cm, colores (con acabado: «rojo metal», «verde reflex»), pesos (proporción de cada color en lo orgánico), tamanos (al CREAR: los R-24, R-18, R-12, R-9, R-5 que se mezclan), flores.
- Biblioteca: «toma/usa X de la biblioteca», «como la idea Y», «la columna con flores de la biblioteca» → buscar_en_biblioteca y luego insertar_de_biblioteca con el id elegido (queda como piezas normales); si además pide cambios («más alto», «en dorado», «con flores»), cámbiala después con cambiar_pieza sobre el id principal que devuelve. Si hay varias que encajan, usa la primera que coincida con lo pedido y dilo.
EDICIÓN PRECISA DE LO ORGÁNICO (arco, columna, guirnalda, semiarco, aro, marco y trazo orgánicos, y los orgánicos de la biblioteca): «más R-24», «más globos grandes», «menos globos chicos», «quita los R-5», «un 40 % de R-18», «que tenga 6 R-24», «los R-24 solo abajo», «que los grandes sean azules», «más tupida», «más abultada» → ajustar_tamanos con el id. Grandes = R-24 (y R-36), medianos = R-18 y R-12, chicos = R-9 y R-5. NO uses cambiar_pieza con tamanos para eso (reemplaza toda la mezcla) y NUNCA contestes un pedido de tamaños cambiando solo colores. ver_escena dice cuántos globos hay de cada tamaño y color: míralo antes; ajustar_tamanos devuelve cuántos había y cuántos hay (antes → ahora): dile al usuario esos números, y si engrosó el cuerpo para que quepan, dilo. Si vuelve a pedir «más», vuelve a llamarla con mas.
Decoraciones EN un punto de una estructura (la estructura es un lienzo): poner_sobre con padre_id + altura_cm desde el piso + lado (frente, izquierda, derecha, atras) o angulo_grados alrededor + x_cm a lo ancho (en un arco las patas están en ±ancho/2). Para llevar una que ya existe a otro punto: mover_sobre (si está repetida en varias anclas, indica copia). separar_copia saca UNA copia de un reparto. agregar_pieza con donde.en = "ancla" solo para repartir muchas iguales a lo largo de una pieza.
Colores: código Sempertex o nombre («rosado pastel», «dorado»). Si una herramienta responde error, corrige con su sugerencia y reintenta una vez.

${seccionVocabularioEscena()}

REGLAS:
- Es CRUD: «agrega X» suma con agregar_pieza; no quites ni rehagas lo que no se pidió. usar_preset solo si piden empezar de cero con una escena de partida.
- NUNCA crees piezas que no se pidieron. Si el pedido es solo de color («cámbiame todo a rojo y verde», «ponlo en dorado», «cambia el rosado por azul») SOLO recolorea: recolorear_escena (todas, o las de ids) o cambiar_pieza con colores en una sola pieza. Jamás agregues piezas para «mostrar» colores.
- Corrección = REEMPLAZO en la misma vuelta: si el usuario corrige lo que hiciste («no normales, orgánicas», «no, la quería de malla»), usa reemplazar_pieza en cada pieza a corregir (mismo sitio, mismos colores) — nunca la quites sin poner la buena. Si ya la quitaste en un turno anterior, vuelve a ponerla del tipo correcto donde estaba. Mira el historial para saber qué hiciste.
- Antes de cambiar, mover, girar, duplicar, reemplazar o quitar algo que ya existe, llama ver_escena.
- No encimes piezas: si el sitio pedido ya está ocupado (ver_escena da x, z), corre la nueva al lado; si es evidente que va EN LUGAR de la que está, usa reemplazar_pieza (o quita la vieja si la nueva viene de la biblioteca). Al insertar de la biblioteca pasa «donde» desde el principio en vez de moverla después.
- «A los lados» de un arco de ancho A: x = ±(A/2 + 75) (más cerca rozan sus patas), a la misma z del arco. Todo dentro de la sala.
- Pregunta solo si falta algo esencial que no puedas suponer; si no, supón valores razonables.
- Al terminar, responde en español en 1 a 3 frases cortas qué hiciste (y lo que no se pudo).`;

type Accion = { herramienta: string; resumen: string; consulta: boolean };

const corto = (t: string, n = 220) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** Texto visible de una respuesta (sin las partes de pensamiento ni el getter `.text`, que avisa si hay funciones). */
function textoDe(contenido: Content | undefined): string {
  return (contenido?.parts ?? []).filter((p) => typeof p.text === "string" && p.thought !== true).map((p) => p.text).join("").trim();
}

export const POST = conRegistro("/api/escena-ia", atenderPOST, { vista: "3d" });

async function atenderPOST(request: Request) {
  let cuerpo: unknown;
  try { cuerpo = await request.json(); } catch { return Response.json({ error: "El pedido no llegó en un formato válido." }, { status: 400 }); }
  const validado = CuerpoSchema.safeParse(cuerpo);
  if (!validado.success) return Response.json({ error: "El pedido o la escena no cumplen el formato." }, { status: 400 });
  const { escena: inicial, mensaje, historial } = validado.data;

  if (Date.now() - ventana.desde > 3_600_000) ventana = { desde: Date.now(), usadas: 0 };
  if (ventana.usadas >= TOPE_POR_HORA) {
    decidir("regla:escena_ia_tope", "tope de mensajes por hora del asistente de escena", { usadas: ventana.usadas, tope: TOPE_POR_HORA });
    return Response.json({ error: `Se alcanzó el límite de ${TOPE_POR_HORA} pedidos por hora a la IA de la escena. Inténtalo más tarde.` }, { status: 429 });
  }

  const cliente = getGeminiClient("escena_ia");
  if (!cliente) return Response.json({ error: "La IA no está configurada en este servidor." }, { status: 503 });
  ventana.usadas += 1;

  const contents: Content[] = [
    ...historial.map((h): Content => ({ role: h.rol === "usuario" ? "user" : "model", parts: [{ text: h.texto }] })),
    { role: "user", parts: [{ text: `${mensaje}\n\n[Piezas que ya hay: ${idsDeEscena(inicial)}]` }] },
  ];
  let escena = inicial;
  const acciones: Accion[] = [];
  const tokens = { entrada: 0, salida: 0, pensamiento: 0 };
  let pasos = 0, llamadas = 0, respuesta = "", cortado = false;

  try {
    for (;;) {
      const r = await cliente.models.generateContent({
        model: MODELO_CHAT,
        contents,
        config: { systemInstruction: SISTEMA, tools: [{ functionDeclarations: [...DECLARACIONES_ESCENA] }], thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, abortSignal: request.signal },
      });
      tokens.entrada += r.usageMetadata?.promptTokenCount ?? 0;
      tokens.salida += r.usageMetadata?.candidatesTokenCount ?? 0;
      tokens.pensamiento += r.usageMetadata?.thoughtsTokenCount ?? 0;
      const contenido = r.candidates?.[0]?.content;
      const funciones = (contenido?.parts ?? []).flatMap((p) => (p.functionCall ? [p.functionCall] : []));
      if (!funciones.length) { respuesta = textoDe(contenido); break; }
      if (pasos >= MAX_PASOS) { cortado = true; respuesta = textoDe(contenido); break; }
      pasos += 1;
      // El turno del modelo va tal cual (con sus firmas de pensamiento): Gemini lo exige en la vuelta siguiente.
      contents.push(contenido ?? { role: "model", parts: funciones.map((functionCall): Part => ({ functionCall })) });
      const respuestas: Part[] = [];
      for (const llamada of funciones) {
        const nombre = llamada.name ?? "";
        llamadas += 1;
        const hecho = llamadas > MAX_LLAMADAS
          ? { ok: false as const, escena, error: `Tope de ${MAX_LLAMADAS} herramientas por mensaje: no se aplicó.` }
          : aplicarHerramienta(escena, nombre, llamada.args ?? {});
        decidir("herramienta:escena_ia", `aplicar ${nombre} a la escena del taller 3D`, hecho.ok ? { ok: true, resumen: hecho.resumen, piezas: hecho.escena.nodos.length } : { ok: false, error: hecho.error }, { entrada: { herramienta: nombre, argumentos: llamada.args ?? {}, paso: pasos } });
        if (hecho.ok) {
          escena = hecho.escena;
          acciones.push({ herramienta: nombre, resumen: hecho.consulta ? corto(hecho.resumen.split("\n")[0] ?? hecho.resumen, 140) : corto(hecho.resumen, 400), consulta: hecho.consulta });
        }
        respuestas.push({ functionResponse: { name: nombre, ...(llamada.id ? { id: llamada.id } : {}), response: hecho.ok ? { resultado: hecho.resumen } : { error: hecho.error } } });
      }
      contents.push({ role: "user", parts: respuestas });
    }
  } catch (error) {
    const texto = error instanceof Error ? error.message : String(error);
    const cuota = /429|RESOURCE_EXHAUSTED|quota/i.test(texto);
    decidir("modelo:escena_ia", "el asistente de escena no pudo terminar", { error: corto(texto, 300), pasos, llamadas, acciones }, { entrada: { mensaje } });
    if (acciones.some((a) => !a.consulta)) {
      // Lo ya aplicado se devuelve: el usuario puede deshacerlo con un clic.
      return Response.json({ escena, respuesta: "La IA se cortó a mitad de camino; esto es lo que alcanzó a hacer.", acciones });
    }
    return Response.json({ error: cuota ? "La IA no tiene cuota disponible ahora. Inténtalo en un rato." : "No pude hablar con la IA ahora. Vuelve a intentarlo." }, { status: cuota ? 429 : 502 });
  }

  const cambios = acciones.filter((a) => !a.consulta);
  if (cortado) respuesta = `${respuesta ? `${respuesta} ` : ""}Llegué al tope de ${MAX_PASOS} pasos: revisa lo hecho y pídeme lo que falte.`;
  if (!respuesta) respuesta = cambios.length ? `Listo: ${cambios.length} cambio${cambios.length > 1 ? "s" : ""} en la escena.` : "No hice cambios.";
  // Estimación con precios de Gemini Flash (US$0,50 por millón de entrada, US$3 por millón de salida y pensamiento).
  const costeEstimadoUsd = Math.round(((tokens.entrada * 0.5 + (tokens.salida + tokens.pensamiento) * 3) / 1e6) * 1e5) / 1e5;
  decidir("modelo:escena_ia", "respuesta final del asistente de escena", {
    respuesta, acciones, pasos, llamadas, cortado, tokens, costeEstimadoUsd, modelo: MODELO_CHAT,
    piezasAntes: inicial.nodos.length, piezasDespues: escena.nodos.length, ids: escena.nodos.map((n) => n.id),
  }, { entrada: { mensaje, historial: historial.length } });
  return Response.json({ escena, respuesta, acciones });
}
