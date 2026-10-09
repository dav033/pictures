import { FunctionCallingConfigMode, ThinkingLevel, type Content, type Part } from "@google/genai";
import { z } from "zod";
import { getGeminiClient, MODELO_CHAT } from "@/lib/gemini";
import { conRegistro, decidir } from "@/lib/registro/servidor";
import { DECLARACIONES_ESCENA, MAX_NODOS, idsDeEscena } from "@/lib/globos3d/herramientas-escena";
import { EscenaSchema } from "@/lib/globos3d/esquema-escena";
import { aplicarHerramientaAsincrona } from "@/lib/globos3d/escena-ia-biblioteca";
import { seccionVocabularioEscena } from "@/lib/globos3d/prompt-escena";
import { REGLAS_AGENTE, SeleccionSchema, seleccionValida, textoSeleccion } from "@/lib/globos3d/escena-ia-agente";
import { PREGUNTAR_USUARIO, preguntaDe, type PreguntaUsuario } from "@/lib/globos3d/herramientas-escena-extra";
import { verificarCambios } from "@/lib/globos3d/verificacion-escena";
import { tomarCupoEscenaIA, TOPE_POR_HORA } from "@/lib/globos3d/cupo-escena-ia";
import { FotoCuerpoSchema, REGLAS_FOTO, aplicarModeladoDeFoto, prepararFotoAdjunta, type FotoPreparada } from "@/lib/globos3d/escena-ia-foto";
import { MODELAR_DESDE_FOTO } from "@/lib/globos3d/herramientas-escena-foto";
import { MAX_PASOS_REFINAR, RefinarCuerpoSchema, REPORTAR_COMPARACION, aplicarReporte, declaracionesDeRefinado, prepararRefinado, reglasDeRonda } from "@/lib/globos3d/refinado/ronda-servidor";
import { decidirRonda, type ReporteComparacion } from "@/lib/globos3d/refinado/ronda";
import { encuadreDeLectura } from "@/lib/globos3d/encuadre-foto";
import { modelarFotoReal } from "@/lib/taller/modelar-foto-real";
import { normalizarFotoA } from "@/lib/taller/normalizar-foto";
import { TIPO_NDJSON, responderEnFlujo, type EventoFlujo } from "@/lib/globos3d/flujo-escena-ia";

/**
 * Taller 3D → «Pídele a la IA»: el usuario escribe en lenguaje natural («un arco orgánico rosado y dorado de 3 m,
 * dos columnas blancas a los lados…») y Gemini (solo texto + herramientas: aquí NUNCA genera imágenes) arma o
 * cambia la escena llamando a las herramientas de `herramientas-escena.ts`. CRUD: suma o cambia lo pedido sin
 * rehacer lo demás. Hasta 12 vueltas del modelo con herramientas por mensaje (y 40 llamadas en total), tope de 60
 * mensajes por hora por instancia (compartido con /api/escena-desde-foto). Con una foto adjunta (`foto`) la lee la IA de
 * visión y la arma la escena antes de que hable el modelo (escena-ia-foto.ts). Cada herramienta aplicada (o rechazada) y la respuesta final quedan con
 * `decidir(...)` en el registro de la conversación; la llamada al modelo la audita `getGeminiClient`.
 *
 * Refinado (REQ-001 paso 9, refinado/ronda-servidor.ts): tras armar la escena desde una foto, el navegador captura la escena 3D con
 * la cámara de la foto y la manda de vuelta con `refinar` (foto + captura + lectura + ronda, a lo más 2): el modelo compara
 * las dos imágenes, reporta las diferencias (reportar_comparacion) y las corrige con las herramientas de siempre; la
 * respuesta dice si hace falta otra ronda. Cada ronda queda en el registro con `decidir`.
 *
 * Agente (2026-10-08, escena-ia-agente.ts): con el pedido viaja la pieza elegida en el editor (`seleccion`); el modelo
 * puede preguntar (preguntar_usuario corta el turno y devuelve `pregunta` con opciones para botones); tras cada
 * vuelta que cambia la escena recibe una verificación automática (piezas y globos por formato antes → después,
 * verificacion-escena.ts) para que corrija y diga números reales.
 *
 * Avance en vivo (D-021, flujo-escena-ia.ts): con `Accept: application/x-ndjson` la respuesta va línea a línea (fase, un `paso` por
 * herramienta aplicada y un `final` con el mismo JSON de siempre); sin la cabecera, el JSON único de siempre. El corte del navegador
 * (`request.signal`, «Detener») ya llega al modelo.
 */

const MAX_PASOS = 12;
const MAX_LLAMADAS = 40;

const CuerpoSchema = z.object({
  escena: EscenaSchema,
  mensaje: z.string().trim().min(1).max(1000),
  historial: z.array(z.object({ rol: z.enum(["usuario", "asistente"]), texto: z.string().max(1500) })).max(8).default([]),
  seleccion: SeleccionSchema,
  /** Foto de una decoración adjunta en la barra de la IA, ya reducida por el navegador. */
  foto: FotoCuerpoSchema.optional(),
  /** Una ronda de comparación con la foto (la escena que llega es la de la ronda anterior). */
  refinar: RefinarCuerpoSchema.optional(),
}).strict().refine((c) => !(c.foto && c.refinar), "foto y refinar no van juntos");

const SISTEMA = `Eres el asistente del taller 3D de decoración con globos Sempertex. Armas y cambias la escena SOLO con las herramientas; no generas imágenes.
Sala (cm): x de izquierda (−) a derecha (+) desde el centro; z de fondo (−) a frente (+); la pared del fondo está en z = −fondo/2. Lo que va delante de la pared del fondo suele ir a z ≈ −fondo/2 + 100.

QUÉ ES CADA COSA (no las confundas):
- «columna» a secas = columna (clásica de cuartetos, lisa). «columna orgánica» (o «de varios tamaños», «tipo burbuja», «inclinada/torcida») = columna_organica. «columna irregular» = trazo_organico con silueta columna_recta; «columna de forma libre/rara/de racimos/en S» = trazo_organico con silueta columna_racimos, columna_s o columna_inclinada.
- Guirnalda orgánica con forma (que cruza arriba y baja por un lado, en esquina, medio arco, asimétrica, como la de una foto) = trazo_organico con su silueta (o puntos); con hojas o flores de tela: follaje («monstera», «palma», «helecho», «eucalipto», «hoja_seca dorada», «pampa beige» para las plumas de pampa, «rosa»). Lo mismo: «guirnalda orgánica» = guirnalda_organica (la guirnalda a secas es la clásica de cuartetos), «arco orgánico» = arco_organico, «semiarco» = semiarco_organico, «aro» = aro_organico, «marco» = marco_organico.
- También creas de cero: pared_trenzas, forma (figura corazon/estrella/nube/castillo… rellena, esfera o cono), letras (texto), metalizado (foil: número, letras, corazón, estrella…), mural, techo, arbol (palmera), globo suelto, decoracion (flor, moño, estrella). Cada una con sus parámetros: alto_cm, ancho_cm, grosor_cm, inclinacion_cm, colores (con acabado: «rojo metal», «verde reflex»), pesos (proporción de cada color en lo orgánico), tamanos (al CREAR: los R-24, R-18, R-12, R-9, R-5 que se mezclan), flores.
- Biblioteca: «toma/usa X de la biblioteca», «como la idea Y», «la columna con flores de la biblioteca» → buscar_en_biblioteca y luego insertar_de_biblioteca con el id elegido (queda como piezas normales). buscar_en_biblioteca filtra también por celebracion, tematica, formato (R-24…), parte, alto_cm/ancho_cm aproximados y fuente (referencias_dueno, ideas_sempertex, revista_celebra, bases_organicas): úsalos cuando el pedido los diga, y si no sale nada, quita los de formato, parte o medidas; si además pide cambios («más alto», «en dorado», «con flores»), cámbiala después con cambiar_pieza sobre el id principal que devuelve. Si hay varias que encajan, usa la primera que coincida con lo pedido y dilo.
EDICIÓN PRECISA DE LO ORGÁNICO (arco, columna, guirnalda, semiarco, aro, marco y trazo orgánicos, y los orgánicos de la biblioteca): «más R-24», «más globos grandes», «menos globos chicos», «quita los R-5», «un 40 % de R-18», «que tenga 6 R-24», «los R-24 solo abajo», «que los grandes sean azules», «más tupida», «más abultada» → ajustar_tamanos con el id. Grandes = R-24 (y R-36), medianos = R-18 y R-12, chicos = R-9 y R-5. NO uses cambiar_pieza con tamanos para eso (reemplaza toda la mezcla) y NUNCA contestes un pedido de tamaños cambiando solo colores. ver_escena dice cuántos globos hay de cada tamaño y color: míralo antes; ajustar_tamanos devuelve cuántos había y cuántos hay (antes → ahora): dile al usuario esos números, y si engrosó el cuerpo para que quepan, dilo. Si vuelve a pedir «más», vuelve a llamarla con mas.
Decoraciones EN un punto de una estructura (la estructura es un lienzo): poner_sobre con padre_id + altura_cm desde el piso + lado (frente, izquierda, derecha, atras) o angulo_grados alrededor + x_cm a lo ancho (en un arco las patas están en ±ancho/2). Para llevar una que ya existe a otro punto: mover_sobre (si está repetida en varias anclas, indica copia). separar_copia saca UNA copia de un reparto. agregar_pieza con donde.en = "ancla" solo para repartir muchas iguales a lo largo de una pieza.
Colores: código Sempertex o nombre («rosado pastel», «dorado»). Si una herramienta responde error, corrige con su sugerencia y reintenta una vez.

${seccionVocabularioEscena()}

REGLAS:
- Dos modos. EDITAR lo que hay («agrega X», «cámbiale el color», «muévela», «quita la columna») es CRUD: suma o cambia solo lo pedido, sin quitar ni rehacer nada; usar_preset solo si piden empezar de cero con una plantilla. DISEÑAR algo nuevo («hazme una decoración de safari», «un cumpleaños de Frozen», «decora para una graduación», «un evento») es otra cosa: diseña desde cero con la composición que pide el tema, NO repitas arco + dos columnas + guirnalda para todo (ver EVENTOS Y SALONES). Si la sala está vacía, la diseñas completa; si ya tiene piezas (también las de una plantilla que el usuario eligió), lo nuevo se SUMA a lo suyo sin quitarlo ni recolorearlo, y lo dices en la respuesta (si quiere empezar de cero, que lo pida: usar_preset o quitar). Nunca contestes «hazme una decoración» solo recoloreando lo que ya había.
- NUNCA crees piezas que no se pidieron. Si el pedido es solo de color («cámbiame todo a rojo y verde», «ponlo en dorado», «cambia el rosado por azul») SOLO recolorea: recolorear_escena (todas, o las de ids) o cambiar_pieza con colores en una sola pieza. Jamás agregues piezas para «mostrar» colores.
- Corrección = REEMPLAZO en la misma vuelta: si el usuario corrige lo que hiciste («no normales, orgánicas», «no, la quería de malla»), usa reemplazar_pieza en cada pieza a corregir (mismo sitio, mismos colores) — nunca la quites sin poner la buena. Si ya la quitaste en un turno anterior, vuelve a ponerla del tipo correcto donde estaba. Mira el historial para saber qué hiciste.
- Antes de cambiar, mover, girar, duplicar, reemplazar o quitar algo que ya existe, llama ver_escena.
- No encimes piezas: si el sitio pedido ya está ocupado (ver_escena da x, z), corre la nueva al lado; si es evidente que va EN LUGAR de la que está, usa reemplazar_pieza (o quita la vieja si la nueva viene de la biblioteca). Al insertar de la biblioteca pasa «donde» desde el principio en vez de moverla después.
- «A los lados» de un arco de ancho A: x = ±(A/2 + 75) (más cerca rozan sus patas), a la misma z del arco. Todo dentro de la sala.
- EVENTOS Y SALONES y DECORACIONES TEMÁTICAS NUEVAS («una boda», «XV años», «el salón completo», «solo la decoración de safari», «un rincón de postres»): PRIMERO planificar_evento, una sola llamada, con tematica (el tema) y texto (el nombre o número) si los dicen. Arma la sala del tamaño que haga falta, las mesas con sillas en cuadrícula, mesa principal, pista, postres, la entrada, un centro de mesa en cada mesa y el techo de la pista, y un fondo de fotos cuya composición sale del tema (palmeras, castillo, pared con letras de foil, semiarco con racimos, mural, aro con ramos, columnas con globos en el techo, guirnalda a lo ancho; el arco con columnas es solo una) más 1 a 3 ideas de la biblioteca ya incluidas, con los colores pedidos: NO pongas mesas, sillas, centros ni techo uno por uno ni busques ideas aparte salvo que pidan más. Su alcance: solo_decoracion (sin mesas), rincon o salon. «M mesas de N» = mesas M + sillas_por_mesa N (el aforo es M × N); «mesas de N personas» a secas = sillas_por_mesa N (en planificar_evento, armar_salon, o ajustar_salon si el salón ya está armado): las mesas salen de invitados ÷ N y el resumen dice cuántas sillas lleva cada una. «Dame otra opción» = el mismo planificar_evento con reemplazar true: pasa a la opción siguiente sola (el resumen dice en cuál va). Luego ver_escena y afina con las herramientas chicas.
- Un salón ya armado (piezas «salon-…») se cambia con ajustar_salon (más o menos invitados: las mesas nuevas reciben solas el centro de las demás; otro tipo de mesa, otras medidas, una zona que falta), mover_zona (la pista, los postres…) y quitar_zona; sus centros y techo se afinan con cambiar_centros, decorar_mesas y techo_por_zona; nunca lo rehagas ni quites piezas del usuario. Solo la mesa de postres o un rincón suelto: armar_salon con invitados 0 y zonas.
- Pregunta solo si falta algo esencial que no puedas suponer; si no, supón valores razonables.
- Al terminar, responde en español en 1 a 3 frases cortas qué hiciste (y lo que no se pudo).`;

type Accion = { herramienta: string; resumen: string; consulta: boolean };

/** Estimación con precios de Gemini Flash (US$0,50 por millón de entrada, US$3 por millón de salida y pensamiento) más la lectura de la foto, si la hubo. */
const costeUsd = (tokens: { entrada: number; salida: number; pensamiento: number }, lecturaUsd = 0): number =>
  Math.round((((tokens.entrada * 0.5 + (tokens.salida + tokens.pensamiento) * 3) / 1e6) + lecturaUsd) * 1e5) / 1e5;

const corto = (t: string, n = 220) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** Texto visible de una respuesta (sin las partes de pensamiento ni el getter `.text`, que avisa si hay funciones). */
function textoDe(contenido: Content | undefined): string {
  return (contenido?.parts ?? []).filter((p) => typeof p.text === "string" && p.thought !== true).map((p) => p.text).join("").trim();
}

export const POST = conRegistro("/api/escena-ia", atenderPOST, { vista: "3d" });

type Avisar = (evento: EventoFlujo) => void;

/** Con `Accept: application/x-ndjson`, la misma respuesta en flujo; si no, el JSON único. */
async function atenderPOST(request: Request) {
  if (!(request.headers.get("accept") ?? "").includes(TIPO_NDJSON)) return procesarPedido(request);
  return responderEnFlujo({
    procesar: (avisar) => procesarPedido(request, avisar),
    alFallo: (error) => decidir("modelo:escena_ia", "el flujo del asistente de escena falló", { error: corto(error instanceof Error ? error.message : String(error), 300) }),
    // La respuesta HTTP del flujo es siempre 200: el estado de verdad (cupo, 4xx, 5xx) queda en el registro.
    alTerminar: (estado) => { if (estado >= 400) decidir("regla:escena_ia_flujo", "el flujo del asistente de escena terminó con error", { estado }); },
  });
}

async function procesarPedido(request: Request, avisar?: Avisar): Promise<Response> {
  let cuerpo: unknown;
  try { cuerpo = await request.json(); } catch { return Response.json({ error: "El pedido no llegó en un formato válido." }, { status: 400 }); }
  const validado = CuerpoSchema.safeParse(cuerpo);
  if (!validado.success) return Response.json({ error: "El pedido o la escena no cumplen el formato." }, { status: 400 });
  const { escena: inicial, mensaje, historial, seleccion, foto, refinar } = validado.data;

  const cliente = getGeminiClient("escena_ia");
  if (!cliente) return Response.json({ error: "La IA no está configurada en este servidor." }, { status: 503 });
  if (!tomarCupoEscenaIA()) {
    return Response.json({ error: `Se alcanzó el límite de ${TOPE_POR_HORA} pedidos por hora a la IA de la escena. Inténtalo más tarde.` }, { status: 429 });
  }

  // Foto adjunta: se lee (visión), se compila y, con la sala vacía, se arma antes de que hable el modelo.
  let adjunta: FotoPreparada | null = null;
  const acciones: Accion[] = [];
  if (foto) {
    avisar?.({ tipo: "fase", fase: "leyendo_foto" });
    const preparada = await prepararFotoAdjunta(foto, inicial, { normalizar: normalizarFotoA, modelar: modelarFotoReal }, MAX_NODOS, request.signal);
    if (!preparada.ok) {
      decidir("modelo:escena_ia", "no se pudo leer la foto adjunta", { error: preparada.error, estado: preparada.status }, { entrada: { mensaje } });
      return Response.json({ error: preparada.error }, { status: preparada.status });
    }
    adjunta = preparada;
    if (preparada.resumenAccion) {
      acciones.push({ herramienta: MODELAR_DESDE_FOTO, resumen: preparada.resumenAccion, consulta: false });
      decidir("herramienta:escena_ia", "aplicar modelar_desde_foto a la escena del taller 3D (sala vacía)", { ok: true, resumen: preparada.resumenAccion, piezas: preparada.escena.nodos.length }, { entrada: { herramienta: MODELAR_DESDE_FOTO, argumentos: { modo: "reemplazar" }, paso: 0 } });
    }
  }
  // Ronda de refinado: la foto y la captura entran juntas en el primer mensaje del modelo.
  const reportes: ReporteComparacion[] = [];
  let partesRefinar: Part[] | null = null;
  if (refinar) {
    const preparado = await prepararRefinado(refinar, inicial, normalizarFotoA);
    if (!preparado.ok) {
      decidir("modelo:escena_ia", "no se pudo preparar la comparación con la foto", { error: preparado.error, estado: preparado.status, ronda: refinar.ronda }, { entrada: { mensaje } });
      return Response.json({ error: preparado.error }, { status: preparado.status });
    }
    partesRefinar = preparado.partes;
  }
  const base = adjunta?.escena ?? inicial;
  const textoUsuario = [mensaje, "", textoSeleccion(inicial, seleccion), `[Piezas que ya hay: ${idsDeEscena(base)}]`, adjunta?.texto ?? ""].filter((l, i) => i < 2 || l).join("\n");
  const contents: Content[] = partesRefinar ? [{ role: "user", parts: partesRefinar }] : [
    ...historial.map((h): Content => ({ role: h.rol === "usuario" ? "user" : "model", parts: [{ text: h.texto }] })),
    { role: "user", parts: adjunta ? [{ text: textoUsuario }, adjunta.imagen] : [{ text: textoUsuario }] },
  ];
  const declaraciones = refinar ? declaracionesDeRefinado(DECLARACIONES_ESCENA)
    : adjunta ? DECLARACIONES_ESCENA : DECLARACIONES_ESCENA.filter((d) => d.name !== MODELAR_DESDE_FOTO);
  // Con foto y la sala ya con piezas, el primer paso del modelo TIENE que ser aplicar la foto (o preguntar): si no, armaba la decoración por su cuenta con agregar_pieza y quedaba abajo de la pared.
  const forzarFoto = Boolean(adjunta && !adjunta.aplicada);
  const maxPasos = refinar ? MAX_PASOS_REFINAR : MAX_PASOS;
  const reglasExtra = adjunta ? `\n\n${REGLAS_FOTO}` : refinar ? `\n\n${reglasDeRonda(refinar.ronda)}` : "";
  if (seleccion) decidir("regla:escena_ia_seleccion", "pieza elegida en el editor que viaja con el pedido", { seleccion, valida: seleccionValida(inicial, seleccion) });
  let escena = base;
  const tokens = { entrada: 0, salida: 0, pensamiento: 0 };
  let pasos = 0, llamadas = 0, respuesta = "", cortado = false;
  let pregunta: PreguntaUsuario | null = null;

  try {
    for (;;) {
      avisar?.({ tipo: "fase", fase: "pensando" });
      const r = await cliente.models.generateContent({
        model: MODELO_CHAT,
        contents,
        config: { systemInstruction: `${SISTEMA}\n\n${REGLAS_AGENTE}${reglasExtra}`, tools: [{ functionDeclarations: [...declaraciones] }], ...(forzarFoto && pasos === 0 ? { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [MODELAR_DESDE_FOTO, PREGUNTAR_USUARIO] } } } : {}), thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, abortSignal: request.signal },
      });
      tokens.entrada += r.usageMetadata?.promptTokenCount ?? 0;
      tokens.salida += r.usageMetadata?.candidatesTokenCount ?? 0;
      tokens.pensamiento += r.usageMetadata?.thoughtsTokenCount ?? 0;
      const contenido = r.candidates?.[0]?.content;
      const funciones = (contenido?.parts ?? []).flatMap((p) => (p.functionCall ? [p.functionCall] : []));
      if (!funciones.length) { respuesta = textoDe(contenido); break; }
      if (pasos >= maxPasos) { cortado = true; respuesta = textoDe(contenido); break; }
      pasos += 1;
      // El turno del modelo va tal cual (con sus firmas de pensamiento): Gemini lo exige en la vuelta siguiente.
      contents.push(contenido ?? { role: "model", parts: funciones.map((functionCall): Part => ({ functionCall })) });
      const respuestas: Part[] = [];
      const antesDelPaso = escena;
      let ultimoCambio = -1;
      for (const llamada of funciones) {
        const nombre = llamada.name ?? "";
        llamadas += 1;
        // `buscar_en_biblioteca` va por la búsqueda de la biblioteca (async, con TALLER_RAG_ENABLED); el resto, síncrono como siempre.
        const { resultado: hecho, busqueda } = llamadas > MAX_LLAMADAS
          ? { resultado: { ok: false as const, escena, error: `Tope de ${MAX_LLAMADAS} herramientas por mensaje: no se aplicó.` }, busqueda: null }
          : nombre === MODELAR_DESDE_FOTO
            ? { resultado: aplicarModeladoDeFoto(escena, adjunta, llamada.args, MAX_NODOS), busqueda: null }
            : nombre === REPORTAR_COMPARACION && refinar
              ? { resultado: aplicarReporte(escena, llamada.args, reportes), busqueda: null }
              : await aplicarHerramientaAsincrona(escena, nombre, llamada.args ?? {});
        decidir("herramienta:escena_ia", `aplicar ${nombre} a la escena del taller 3D`, hecho.ok ? { ok: true, resumen: hecho.resumen, piezas: hecho.escena.nodos.length, ...(busqueda ? { busqueda: { fuente: busqueda.fuente, ids: busqueda.ids, motivo: busqueda.motivo ?? null } } : {}) } : { ok: false, error: hecho.error }, { entrada: { herramienta: nombre, argumentos: llamada.args ?? {}, paso: pasos, ...(busqueda?.entrada ? { busqueda: busqueda.entrada } : {}) } });
        avisar?.({ tipo: "paso", n: llamadas, herramienta: nombre, resumen: corto((hecho.ok ? hecho.resumen : hecho.error).split("\n")[0] ?? "", 140), consulta: hecho.ok && hecho.consulta, ok: hecho.ok });
        if (hecho.ok) {
          escena = hecho.escena;
          acciones.push({ herramienta: nombre, resumen: hecho.consulta ? corto(hecho.resumen.split("\n")[0] ?? hecho.resumen, 140) : corto(hecho.resumen, 400), consulta: hecho.consulta });
          if (!hecho.consulta) ultimoCambio = respuestas.length;
          // Preguntar termina el turno: lo que venía después en esta vuelta no se aplica.
          if (nombre === PREGUNTAR_USUARIO) { pregunta = preguntaDe(llamada.args); break; }
        }
        respuestas.push({ functionResponse: { name: nombre, ...(llamada.id ? { id: llamada.id } : {}), response: hecho.ok ? { resultado: hecho.resumen } : { error: hecho.error } } });
      }
      if (pregunta) { respuesta = pregunta.pregunta; break; }
      // Verificación automática: lo que de verdad cambió en esta vuelta, junto a la última herramienta que cambió algo.
      const verificacion = escena !== antesDelPaso ? verificarCambios(antesDelPaso, escena) : "";
      const destino = respuestas[ultimoCambio]?.functionResponse;
      if (verificacion && destino) {
        destino.response = { ...destino.response, verificacion };
        decidir("regla:escena_ia_verificacion", "verificación automática que recibe el modelo tras sus cambios", { verificacion, paso: pasos });
      }
      contents.push({ role: "user", parts: respuestas });
    }
  } catch (error) {
    const texto = error instanceof Error ? error.message : String(error);
    const cuota = /429|RESOURCE_EXHAUSTED|quota/i.test(texto);
    decidir("modelo:escena_ia", "el asistente de escena no pudo terminar", { error: corto(texto, 300), pasos, llamadas, acciones }, { entrada: { mensaje } });
    if (acciones.some((a) => !a.consulta)) {
      // Lo ya aplicado se devuelve: el usuario puede deshacerlo con un clic.
      return Response.json({ escena, respuesta: "La IA se cortó a mitad de camino; esto es lo que alcanzó a hacer.", acciones, uso: { pasos, llamadas, costeEstimadoUsd: costeUsd(tokens, adjunta?.modelado.uso.costeEstimadoUsd ?? 0) } });
    }
    return Response.json({ error: cuota ? "La IA no tiene cuota disponible ahora. Inténtalo en un rato." : "No pude hablar con la IA ahora. Vuelve a intentarlo." }, { status: cuota ? 429 : 502 });
  }

  const cambios = acciones.filter((a) => !a.consulta);
  if (cortado) respuesta = `${respuesta ? `${respuesta} ` : ""}Llegué al tope de ${maxPasos} pasos: revisa lo hecho y pídeme lo que falte.`;
  if (!respuesta) respuesta = cambios.length ? `Listo: ${cambios.length} cambio${cambios.length > 1 ? "s" : ""} en la escena.` : "No hice cambios.";
  const costeLecturaUsd = adjunta?.modelado.uso.costeEstimadoUsd ?? 0;
  const costeEstimadoUsd = costeUsd(tokens, costeLecturaUsd);
  const ronda = refinar ? decidirRonda(refinar.ronda, reportes, cambios.length) : null;
  if (ronda) decidir("regla:escena_ia_refinar", "ronda de comparación con la foto", { ...ronda, reportes: reportes.length });
  decidir("modelo:escena_ia", "respuesta final del asistente de escena", {
    respuesta, acciones, pasos, llamadas, cortado, tokens, costeEstimadoUsd, modelo: MODELO_CHAT, pregunta,
    refinar: ronda,
    foto: adjunta ? { piezasLeidas: adjunta.modelado.lectura.piezas.length, aplicadaSola: adjunta.aplicada, plantillas: adjunta.modelado.plantillas.map((p) => p.id), costeLecturaUsd } : null,
    piezasAntes: inicial.nodos.length, piezasDespues: escena.nodos.length, ids: escena.nodos.map((n) => n.id),
  }, { entrada: { mensaje, historial: historial.length, seleccion: seleccion?.id ?? null } });
  return Response.json({ escena, respuesta, acciones, ...(pregunta ? { pregunta: { texto: pregunta.pregunta, opciones: pregunta.opciones } } : {}), ...(adjunta ? { foto: { plantillas: adjunta.modelado.plantillas, notas: adjunta.modelado.notas, omitidas: adjunta.modelado.omitidas, aplicada: adjunta.aplicada || acciones.some((a) => a.herramienta === MODELAR_DESDE_FOTO), lectura: adjunta.modelado.lectura, encuadre: encuadreDeLectura(adjunta.modelado.lectura) } } : {}), ...(ronda ? { refinar: ronda } : {}), uso: { pasos, llamadas, costeEstimadoUsd } });
}
