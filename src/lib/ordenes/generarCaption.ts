// Sin "server-only": este módulo lo usa tanto una API route de Next como un script de
// terminal corrido con tsx fuera de Next -- el paquete "server-only" tira siempre en ese
// segundo caso (no hay bundler de Next de por medio que lo neutralice).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { decodificarTamano } from "../shopify/derivar";
import type { Desglose, FeedbackFoto } from "./tipos";

const TRIGGER_TOKEN = "eventdecor_style_v1";

// El captioning corre sobre el CLI de opencode con un modelo de OpenAI, no sobre el CLI de
// Claude. Overrideables por env para probar otro modelo sin tocar código.
const OPENCODE_MODELO = process.env.OPENCODE_CAPTION_MODEL ?? "openai/gpt-5.6-luna";
// "variant" en opencode = esfuerzo de razonamiento del proveedor. Decidir qué producto de la
// orden se ve DE VERDAD en la foto es la parte cara de este prompt, así que va al máximo.
const OPENCODE_VARIANTE = process.env.OPENCODE_CAPTION_VARIANT ?? "xhigh";
const ETIQUETA_MODELO = OPENCODE_MODELO.split("/").pop() ?? OPENCODE_MODELO;

/**
 * Tamaños reales de globo REDONDO comprados en la orden, agrupados y ordenados por
 * diámetro -- se sacan del código de variante de Shopify (ej. "R-18 / PAQUETE X 6" -> R-18),
 * no de que la IA adivine el tamaño mirando la foto. Solo tiene sentido dárselos a la IA
 * cuando hay 2+ tamaños distintos: es la señal de proporción relativa que pide el plan de
 * entrenamiento (§2.7) -- con un solo tamaño no hay comparación que describir.
 */
function tamanosGloboRedondo(desglose: Desglose): Array<{ codigo: string; diamPulg: number }> {
  const porDiametro = new Map<number, string>();
  for (const linea of desglose.lineas) {
    if (!linea.variante) continue;
    const codigo = linea.variante.split("/")[0]?.trim() ?? "";
    const decodificado = decodificarTamano(codigo);
    if (decodificado?.forma === "redondo" && decodificado.diamPulg !== null) {
      porDiametro.set(decodificado.diamPulg, codigo);
    }
  }
  return [...porDiametro.entries()]
    .sort(([a], [b]) => a - b)
    .map(([diamPulg, codigo]) => ({ codigo, diamPulg }));
}

const SCHEMA = {
  type: "object",
  properties: {
    revision: {
      type: "object",
      properties: {
        es_decoracion: { type: "boolean" },
        decoracion_completa: { type: "boolean" },
        elemento_principal: { type: "string" },
        fidelidad_imagen: { type: "string", enum: ["alta", "media", "baja"] },
        apto_para_entrenamiento: { type: "boolean" },
        productos_representados: {
          type: "array",
          items: {
            type: "object",
            properties: { producto: { type: "string" }, representado: { type: "boolean" } },
            required: ["producto", "representado"],
          },
        },
      },
      required: ["es_decoracion", "decoracion_completa", "elemento_principal", "fidelidad_imagen", "apto_para_entrenamiento", "productos_representados"],
    },
    tipo_estructura: { type: "string" },
    elementos_no_comprados: { type: "array", items: { type: "string" } },
    proporcion_relativa_presente: { type: "boolean" },
    proporcion_relativa_descripcion: { type: "string" },
    caption: { type: "string" },
  },
  required: ["revision", "tipo_estructura", "elementos_no_comprados", "caption"],
};

type RevisionIA = {
  es_decoracion: boolean;
  decoracion_completa: boolean;
  elemento_principal: string;
  fidelidad_imagen: "alta" | "media" | "baja";
  apto_para_entrenamiento: boolean;
  productos_representados: Array<{ producto: string; representado: boolean }>;
};

type DatosGenerados = {
  revision: RevisionIA;
  tipo_estructura: string;
  elementos_no_comprados: string[];
  proporcion_relativa_presente: boolean;
  proporcion_relativa_descripcion: string;
  caption: string;
};

/**
 * Construye el prompt de captioning + auto-revisión en una sola llamada: la IA determina qué
 * productos comprados se ven de verdad en la foto (no todos los de la orden se instalan
 * donde se tomó la foto) y escribe el caption usando solo esos, sin depender de que un humano
 * llene el feedback a mano primero. Si YA hay feedback humano (de una corrección manual desde
 * el modal de "Feedback" / un "Recaption" posterior a eso), se le pasa a la IA como hecho ya
 * confirmado en vez de pedirle que lo vuelva a juzgar.
 */
function construirPrompt(
  fotoPath: string,
  desglose: Desglose,
  feedbackHumano: FeedbackFoto | null,
  tipoEstructuraManual: string | null,
): string {
  const listaCompleta = desglose.lineas
    .map((l) => `- ${l.producto}${l.variante ? ` (${l.variante})` : ""} x${l.cantidad}`)
    .join("\n");

  const tamanos = tamanosGloboRedondo(desglose);
  const seccionTamanos =
    tamanos.length >= 2
      ? `\n\nTamaños REALES de globo redondo confirmados por el pedido (no adivines otros): ${tamanos
          .map((t) => `${t.codigo} = ${t.diamPulg}" de diámetro`)
          .join(", ")}. Si varios de estos se ven mezclados en el mismo cuadro, usalos tal cual en el paso 6 en vez de estimar el tamaño a ojo.

FORMA CANÓNICA DE ESCRIBIR UN TAMAÑO (obligatoria en caption y en proporcion_relativa_descripcion): el código solo, escrito \`R-N\`, es un SKU interno que el modelo de imagen no sabe leer, y el prompt de generación en producción habla en pulgadas ("12-inch round latex balloon"). Así que la PRIMERA vez que menciones cada código en un campo, escribilo glosado: ${tamanos
          .map((t) => `\`${t.codigo} (${t.diamPulg}-inch)\``)
          .join(", ")}. Después de esa primera mención podés repetir el código solo. Nunca uses las formas \`N in\`, \`N inches\` ni \`N"\`: siempre \`N-inch\` con guion.`
      : "";

  const seccionRevision = feedbackHumano
    ? `Un humano ya revisó esta foto y confirmó lo siguiente -- copialo tal cual en el campo "revision" de tu respuesta, no lo vuelvas a juzgar vos:
- es_decoracion: ${feedbackHumano.esDecoracion}
- decoracion_completa: ${feedbackHumano.decoracionCompleta}
- elemento_principal: "${feedbackHumano.elementoPrincipal}"
- fidelidad_imagen: "${feedbackHumano.fidelidadImagen}"
- apto_para_entrenamiento: ${feedbackHumano.aptoParaEntrenamiento}
- productos_representados: ${JSON.stringify(feedbackHumano.productosRepresentados)}
${feedbackHumano.notas ? `- Notas del revisor humano: ${feedbackHumano.notas}` : ""}`
    : `Mirando la foto con cuidado, determiná vos mismo (van en el campo "revision"):
- es_decoracion: ¿esta foto es realmente de una decoración de evento armada? (false si es, por ejemplo, una persona posando con un certificado, un producto suelto sin instalar, o algo no relacionado)
- decoracion_completa: ¿se ve el espacio/instalación completa con varios elementos, o es un recorte/acercamiento parcial de solo una parte?
- elemento_principal: cuál es el elemento o estructura principal que domina la foto (en español, ej. "arco de globos", "columna de globos", "centro de mesa")
- fidelidad_imagen: "alta"/"media"/"baja" según nitidez, iluminación, y qué tan bien se distinguen los materiales
- apto_para_entrenamiento: ¿esta foto sirve para entrenar un modelo de estilo de decoración? (false si sale borrosa, oscura, no es decoración, o no se alcanza a ver ningún material con claridad)
- productos_representados: por CADA producto de la lista de materiales de abajo, marcá true/false según si REALMENTE se alcanza a ver en esta foto -- no asumas que todo lo que compró el cliente aparece acá, muchas veces una orden mezcla varios ambientes o solo una parte se instaló donde se tomó esta foto en particular`;

  return `Vas a analizar una foto real de una decoración de evento con globos Sempertex y escribirle un caption en inglés para un dataset de entrenamiento de un LoRA de estilo.

1. La foto está adjunta a este mismo mensaje (archivo: ${fotoPath}) -- miralá directo, no necesitás herramientas para verla.
2. Esta es la lista COMPLETA de materiales que el cliente compró en esta orden (puede que no todos aparezcan en esta foto puntual):
${listaCompleta}${seccionTamanos}

3. ${seccionRevision}

4. ${
    tipoEstructuraManual
      ? `El tipo de estructura ya fue confirmado por un humano como "${tipoEstructuraManual}" -- usalo tal cual en tipo_estructura, no lo vuelvas a juzgar.`
      : "Identifica el tipo de estructura principal en la foto (arco, semiarco, guirnalda, columna, pared, bouquet, centro_mesa, otro) -- una sola palabra de esa lista, sin texto adicional entre paréntesis."
  }
5. Identifica elementos VISIBLES en la foto que NO están en la lista de materiales (ej. mobiliario del lugar, letreros, mesa, personas, otra decoración) -- estos van en elementos_no_comprados, en inglés corto.
6. Si la foto muestra varios TAMAÑOS de globo mezclados en el mismo cuadro, marca proporcion_relativa_presente=true y describe la comparación usando los tamaños reales confirmados arriba cuando estén disponibles (ej. "R-24 (24-inch) balloons anchor the corners, roughly double the diameter of the R-12 (12-inch) filler balloons between them" en vez de solo "large"/"small" genérico), respetando la forma canónica de tamaños descrita en el paso 2. Si no hay tamaños confirmados en el pedido para esta foto, describí la comparación relativa igual que antes (grande/chico), sin inventar un tamaño en pulgadas que no esté confirmado. Si no aplica, false y descripción vacía.
   NUNCA hables del PEDIDO dentro del texto. El caption y la descripción de proporción se usan
   tal cual como texto de entrenamiento junto a la foto: solo pueden describir lo que se VE.
   Palabras como "confirmed", "the order", "purchased", "not listed", "no confirmed inch sizes
   for this order" son vocabulario de ESTA instrucción, no de la imagen, y ya se filtraron a
   captions reales. Escribí "the R-9 (9-inch) balloons…", nunca "the confirmed R-9 balloons…".
   Si no hay tamaños confirmados, simplemente describí grande/chico y NO expliques por qué.
   NO CALCULES la proporción dividiendo los números que te di. "R-9 es 1.8 veces R-5" es
   aritmética (9÷5), no observación: sale igual aunque la foto muestre otra cosa, y de hecho se
   generó esa misma frase en 16 captions distintos, uno de ellos contradicho por su propia foto
   (los anclajes reales eran varias veces más grandes). Describí la relación que se VE ("los
   racimos chicos entran unas tres veces en los globos que anclan el arco"), o si no la podés
   juzgar a ojo, no la afirmes. Un ratio numérico repetido en muchas fotos no le enseña nada al
   modelo.
   Cuatro errores observados en captions reales que NO debés repetir:
   a) PERSPECTIVA ≠ TAMAÑO. Un globo más cerca de la cámara se ve más grande sin serlo. Si el pedido confirma un solo diámetro redondo, entonces TODOS los globos redondos de la foto son de ese diámetro, por distintos que se vean: decilo explícitamente ("all round balloons are a single R-12 (12-inch) size; the overhead cluster only reads larger because it sits closer to the camera") en vez de describir una diferencia de tamaño que no existe.
   b) NO INVENTES UN GRADIENTE. Frases tipo "progressively smaller toward the top" solo valen si la foto realmente muestra ese degradado ordenado. En una guirnalda orgánica lo normal es que los tamaños estén MEZCLADOS sin orden (grandes tanto en la base como en la corona, racimos chicos como acento suelto) -- si es así, describilo como mezcla orgánica, no como progresión.
7. Escribe caption en inglés, formato: "${TRIGGER_TOKEN}, [descripción de la composición]." Usá ÚNICAMENTE los productos que marcaste con representado=true en el paso 3 (traducidos a inglés natural con su acabado/color -- Fashion = matte solid color, Reflex = glossy chrome/mirror, Silk = satin finish, Pastel Matte = soft pastel matte, Deluxe = premium matte, Metalizado = metallic mylar/foil), más los elementos_no_comprados y la iluminación. No repitas el trigger token en ningún otro lado del caption. No inventes colores, acabados ni productos que no estén confirmados como visibles.

Responde ÚNICAMENTE con un objeto JSON válido según este schema, sin texto alrededor ni bloques de código:
${JSON.stringify(SCHEMA)}`;
}

/**
 * opencode no tiene un equivalente del `--json-schema` del CLI de Claude: `--format json`
 * emite el stream de eventos de la sesión (JSONL), no la respuesta tipada. Así que el schema
 * viaja dentro del prompt y acá se rearma el texto final del assistant desde los eventos
 * `text` -- acumulados por id de part, porque un mismo part puede llegar actualizado más de
 * una vez mientras streamea.
 */
function textoFinalDeEventos(raw: string): string | null {
  const partes = new Map<string, string>();
  for (const linea of raw.split(/\r?\n/)) {
    if (!linea.startsWith("{")) continue;
    try {
      const evento = JSON.parse(linea) as { type?: string; part?: { id?: string; text?: string } };
      if (evento.type === "text" && evento.part?.id && typeof evento.part.text === "string") {
        partes.set(evento.part.id, evento.part.text);
      }
    } catch {
      // Línea truncada o log suelto mezclado en el stream -- se ignora.
    }
  }
  const texto = [...partes.values()].join("").trim();
  return texto || null;
}

/** Recorta el objeto JSON aunque el modelo lo haya envuelto en ```json o en un párrafo. */
function recortarJson(texto: string): string | null {
  const inicio = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (inicio === -1 || fin <= inicio) return null;
  return texto.slice(inicio, fin + 1);
}

/**
 * En Windows npm deja `opencode` en el PATH como .cmd, y Node ya no permite spawnear un .cmd
 * sin `shell: true` -- y con shell de por medio este prompt (multilínea, con comillas y $) se
 * rompe al escapar. Se apunta directo al .exe que ese .cmd invoca por dentro.
 */
function binarioOpencode(): string {
  if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN;
  if (process.platform !== "win32") return "opencode";
  const candidatos = [
    path.join(process.env.APPDATA ?? "", "npm", "node_modules", "opencode-ai", "bin", "opencode.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "opencode", "bin", "opencode.exe"),
  ];
  return candidatos.find((ruta) => existsSync(ruta)) ?? "opencode";
}

function llamarOpencode(prompt: string, fotoPath: string): DatosGenerados | null {
  const args = [
    "run",
    // El mensaje va ANTES de los flags a propósito: `--file` es de tipo array en el parser de
    // opencode y se traga cualquier positional que venga después, tomando el prompt entero
    // como si fuera otro archivo adjunto ("File not found: Vas a analizar...").
    prompt,
    "--model",
    OPENCODE_MODELO,
    "--variant",
    OPENCODE_VARIANTE,
    "--format",
    "json",
    // Agente read-only: la foto ya va adjunta, el modelo no tiene por qué tocar el disco.
    "--agent",
    "plan",
    "--file",
    fotoPath,
  ];

  const resultado = spawnSync(binarioOpencode(), args, { encoding: "utf-8", maxBuffer: 20 * 1024 * 1024 });
  const raw = resultado.stdout || resultado.stderr;
  if (!raw) return null;

  const texto = textoFinalDeEventos(raw);
  if (!texto) return null;
  const json = recortarJson(texto);
  if (!json) return null;
  try {
    return JSON.parse(json) as DatosGenerados;
  } catch {
    return null;
  }
}

export type CaptionGenerada = {
  orden: string;
  foto: string;
  trigger_token: string;
  tipo_estructura: string;
  elementos_no_comprados: string[];
  proporcion_relativa_presente: boolean;
  proporcion_relativa_descripcion: string;
  caption: string;
  caption_status: string;
  source: string;
};

export function generarCaption(
  numeroOrden: string,
  archivoFoto: string,
  fotoPath: string,
  desglose: Desglose,
  feedbackHumano: FeedbackFoto | null,
  tipoEstructuraManual: string | null = null,
): { caption: CaptionGenerada; feedback: FeedbackFoto } {
  const prompt = construirPrompt(fotoPath, desglose, feedbackHumano, tipoEstructuraManual);
  const datos = llamarOpencode(prompt, fotoPath);
  if (!datos) throw new Error(`opencode (${OPENCODE_MODELO}) no devolvió una respuesta válida.`);

  const caption: CaptionGenerada = {
    orden: numeroOrden,
    foto: archivoFoto,
    trigger_token: TRIGGER_TOKEN,
    // Defensivo: aunque el prompt ya le pide a la IA copiar el tipo confirmado tal cual, si
    // hay uno manual no se le deja la última palabra al modelo sobre este campo puntual.
    tipo_estructura: tipoEstructuraManual ?? datos.tipo_estructura,
    elementos_no_comprados: datos.elementos_no_comprados,
    proporcion_relativa_presente: datos.proporcion_relativa_presente,
    proporcion_relativa_descripcion: datos.proporcion_relativa_descripcion,
    caption: datos.caption,
    caption_status: feedbackHumano ? "recaption_con_feedback" : "generado_automatico",
    source: feedbackHumano
      ? `${ETIQUETA_MODELO}-vision+orden-real+feedback-humano`
      : `${ETIQUETA_MODELO}-vision+orden-real+auto-revision`,
  };

  // Con feedback humano de por medio, ese sigue siendo la verdad guardada (la IA solo lo
  // copió en su respuesta) -- no lo pisamos con lo que la IA "cree" que dijo.
  const feedback: FeedbackFoto = feedbackHumano ?? {
    orden: numeroOrden,
    foto: archivoFoto,
    esDecoracion: datos.revision.es_decoracion,
    decoracionCompleta: datos.revision.decoracion_completa,
    elementoPrincipal: datos.revision.elemento_principal,
    fidelidadImagen: datos.revision.fidelidad_imagen,
    productosRepresentados: datos.revision.productos_representados,
    aptoParaEntrenamiento: datos.revision.apto_para_entrenamiento,
    categoria: "no_asignada",
    notas: "",
    revisadoEn: new Date().toISOString(),
    fuente: "ia_automatica",
  };

  return { caption, feedback };
}
