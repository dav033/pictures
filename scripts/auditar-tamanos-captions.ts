// Auditoría de calidad de TAMAÑOS en los captions del dataset -- la parte que el usuario marcó
// como más crítica de todo el pipeline. El prompt de generarCaption.ts (paso 2: lista completa
// de materiales con su variante tal cual viene de Shopify; paso 6: comparación de proporción
// relativa) nunca debería dejar que la IA invente una medida en pulgadas o un código R-N que no
// venga del pedido real. Este script no re-mira las fotos (no hay presupuesto de visión acá) --
// audita que el TEXTO del caption sea consistente con el pedido real, cruzando cada
// caption-N.json contra el desglose.json completo de la orden (cualquier forma: redondo,
// corazón, Link-O-Loon, modelar T260, y el genérico "N IN" de metalizados/foil):
//
//   1. tamaño_inventado (ALTA): el caption o su proporcion_relativa_descripcion menciona un
//      código R-N o una medida en pulgadas que NO corresponde a NINGÚN producto del pedido --
//      viola la instrucción explícita del prompt de no inventar tamaños.
//   2. posible_omision (INFORMATIVA): el pedido sí tiene 2+ tamaños redondos confirmados y la
//      foto confirma 2+ productos redondos distintos visibles, pero proporcion_relativa_presente
//      quedó en false -- puede ser correcto (que en ESTA foto no se vean mezclados) o un caption
//      que se saltó la comparación; queda para revisión humana, no es un error automático.
//
// Uso: npx tsx scripts/auditar-tamanos-captions.ts [--detalle]

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { decodificarTamano } from "../src/lib/shopify/derivar";
import type { Desglose, FeedbackFoto } from "../src/lib/ordenes/tipos";
import { analizarComparacion } from "./lib/comparacion-tamanos";

const RUTA_ORDENES = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";
const MOSTRAR_DETALLE = process.argv.includes("--detalle");

type Caption = {
  tipo_estructura: string;
  proporcion_relativa_presente?: boolean;
  proporcion_relativa_descripcion?: string;
  caption: string;
};

type TamanoConfirmado = { codigo: string; diamPulg: number };

// Ground truth SOLO de globo redondo -- esto es lo que generarCaption.ts realmente le manda a
// la IA como "tamaños confirmados" en el prompt (paso 6, solo aplica a proporción relativa
// entre globos redondos). Si diverge de tamanosGloboRedondo() ahí, esta parte del audit deja de
// reflejar lo que se le mandó.
function tamanosGloboRedondo(desglose: Desglose): TamanoConfirmado[] {
  const porDiametro = new Map<number, string>();
  for (const linea of desglose.lineas) {
    if (!linea.variante) continue;
    const codigo = linea.variante.split("/")[0]?.trim() ?? "";
    const decodificado = decodificarTamano(codigo);
    if (decodificado?.forma === "redondo" && decodificado.diamPulg !== null) {
      porDiametro.set(decodificado.diamPulg, codigo);
    }
  }
  return [...porDiametro.entries()].sort(([a], [b]) => a - b).map(([diamPulg, codigo]) => ({ codigo, diamPulg }));
}

// Ground truth COMPLETO del pedido (cualquier forma: redondo, corazón, Link-O-Loon, modelar
// T260, y el genérico "N IN" que usan los metalizados/foil y el Globo Burbuja) -- a diferencia
// de tamanosGloboRedondo(), esto es lo que el caption PUEDE mencionar legítimamente porque el
// paso 2 del prompt (listaCompleta) le muestra a la IA el pedido completo con sus variantes tal
// cual, no solo el resumen de globo redondo. Sin esto, un "18 IN" real de un globo metalizado
// (ej. orden #950000009) se marcaba como "inventado" cuando en realidad viene del pedido.
function todasLasMedidasPulgadas(desglose: Desglose): Set<number> {
  const medidas = new Set<number>();
  for (const linea of desglose.lineas) {
    if (!linea.variante) continue;
    const codigo = linea.variante.split("/")[0]?.trim() ?? "";
    const decodificado = decodificarTamano(codigo);
    if (decodificado?.diamPulg !== null && decodificado?.diamPulg !== undefined) medidas.add(decodificado.diamPulg);
    if (decodificado?.largoPulg !== null && decodificado?.largoPulg !== undefined) medidas.add(decodificado.largoPulg);
  }
  return medidas;
}

type Mencion = { texto: string; tipo: "codigo_r" | "pulgadas"; valor: number; indice: number };

function extraerMencionesDeTamano(texto: string): Mencion[] {
  const menciones: Mencion[] = [];
  for (const m of texto.matchAll(/\bR-?\s?(\d{1,3})\b/gi)) {
    menciones.push({ texto: m[0], tipo: "codigo_r", valor: Number(m[1]), indice: m.index ?? 0 });
  }
  for (const m of texto.matchAll(/(\d{1,3})(?:\.\d+)?\s*-?\s*(?:"|inch(?:es)?|in\b|pulgadas?)/gi)) {
    // Excluir globos-número entre comillas (ej. foil number "60" balloon para un cumpleaños 60)
    // -- son una cifra decorativa (edad/año), no una medida de tamaño; se detecta viendo si el
    // caracter justo antes del dígito en el texto original es una comilla de apertura.
    const inicio = m.index ?? 0;
    const precedente = texto.slice(Math.max(0, inicio - 1), inicio);
    if (precedente === '"') continue;
    menciones.push({ texto: m[0], tipo: "pulgadas", valor: Number(m[1]), indice: inicio });
  }
  return menciones;
}

function esMencionConfirmada(mencion: Mencion, redondosConfirmados: TamanoConfirmado[], todasLasMedidas: Set<number>): boolean {
  if (mencion.tipo === "codigo_r") {
    // Un código R-N confirma contra CUALQUIER globo redondo del pedido -- tamanosGloboRedondo()
    // ya devuelve todos los diámetros redondos presentes (sin filtrar por "2+"), así que esto
    // es ground truth completo, no solo lo que entró a la sección de proporción relativa.
    return redondosConfirmados.some((c) => c.diamPulg === mencion.valor);
  }
  return todasLasMedidas.has(mencion.valor);
}

type Violacion = {
  severidad: "ALTA" | "MEDIA" | "INFORMATIVA";
  tipo: string;
  orden: string;
  indice: number;
  detalle: string;
};

async function main(): Promise<void> {
  const carpetas = (await readdir(RUTA_ORDENES, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);

  let captionsEscaneados = 0;
  let conProporcionPresente = 0;
  let conTamanosConfirmadosEnOrden = 0;
  const violaciones: Violacion[] = [];

  for (const numero of carpetas) {
    const carpetaOrden = path.join(RUTA_ORDENES, numero);
    let desglose: Desglose;
    try {
      desglose = JSON.parse(await readFile(path.join(carpetaOrden, "desglose.json"), "utf-8"));
    } catch {
      continue;
    }
    const confirmados = tamanosGloboRedondo(desglose);
    const todasLasMedidas = todasLasMedidasPulgadas(desglose);

    const archivos = await readdir(carpetaOrden).catch(() => [] as string[]);
    const indices = archivos.map((f) => f.match(/^caption-(\d+)\.json$/)?.[1]).filter((x): x is string => Boolean(x)).map(Number);

    for (const indice of indices) {
      let caption: Caption;
      try {
        caption = JSON.parse(await readFile(path.join(carpetaOrden, `caption-${indice}.json`), "utf-8"));
      } catch {
        continue;
      }
      captionsEscaneados += 1;
      if (confirmados.length >= 2) conTamanosConfirmadosEnOrden += 1;
      if (caption.proporcion_relativa_presente) conProporcionPresente += 1;

      const textoCompleto = `${caption.caption ?? ""} ${caption.proporcion_relativa_descripcion ?? ""}`;
      const menciones = extraerMencionesDeTamano(textoCompleto);
      const inventadas = menciones.filter((m) => !esMencionConfirmada(m, confirmados, todasLasMedidas));

      if (inventadas.length > 0) {
        violaciones.push({
          severidad: "ALTA",
          tipo: "tamaño_inventado",
          orden: numero,
          indice,
          detalle: `Menciona ${inventadas.map((m) => m.texto).join(", ")} -- medidas confirmadas en TODO el pedido (cualquier forma): ${todasLasMedidas.size ? [...todasLasMedidas].sort((a, b) => a - b).join(", ") : "ninguna"}. Caption: "${caption.caption}"`,
        });
      }

      // Chequeo 2: comparación de tamaños contradicha por el pedido. Distinto del chequeo 1:
      // aquel busca una MEDIDA que no existe en el pedido; este busca una RELACIÓN entre medidas
      // que el pedido desmiente, sin que se haya inventado ninguna cifra. Ver
      // scripts/lib/comparacion-tamanos.ts y el chequeo visual v001 que lo motivó.
      // `cliente` separa las dos fuentes sin ambigüedad y sin depender del formato del número:
      // las 204 órdenes reales de Shopify lo traen siempre, las 183 entradas del blog lo traen
      // siempre en null. Ver la nota de premisa en analizarComparacion().
      const esPedidoReal = Boolean(desglose.cliente);
      for (const hallazgo of analizarComparacion(textoCompleto, desglose.lineas, { desgloseEnumeraTodo: esPedidoReal })) {
        violaciones.push({
          severidad: "ALTA",
          tipo: hallazgo.regla,
          orden: numero,
          indice,
          detalle: `${hallazgo.detalle}. Proporción: "${caption.proporcion_relativa_descripcion ?? ""}"`,
        });
      }

      // Chequeo 2b: vocabulario de PROCEDENCIA filtrado al texto. El caption se usa tal cual
      // como texto de entrenamiento junto a la foto, así que solo puede describir lo que se ve.
      // "confirmed", "the order", "purchased" son palabras del prompt, no de la imagen -- se
      // encontraron 12 captions reales contaminados así, desde un "(no confirmed inch sizes for
      // this order)" pegado al final hasta un párrafo entero explicando qué no venía en el
      // pedido. Se excluye "catalog"/"invoice" a propósito: hay fotos que SON un flat lay de
      // catálogo o una captura de factura, y ahí la palabra describe la imagen de verdad.
      for (const campo of ["caption", "proporcion_relativa_descripcion"] as const) {
        const valor = caption[campo];
        if (typeof valor !== "string") continue;
        const fuga = valor.match(/\b(?:confirmed|purchased|not listed in the order|the order)\b/i);
        if (!fuga) continue;
        violaciones.push({
          severidad: "ALTA",
          tipo: "meta_comentario",
          orden: numero,
          indice,
          detalle: `El campo "${campo}" habla del pedido en vez de la imagen (dispara en "${fuga[0]}"): "${valor}"`,
        });
      }

      // Chequeo 3: posible omisión -- pedido con 2+ tamaños confirmados, feedback confirma 2+
      // variantes redondas distintas visibles, pero el caption no marcó proporción relativa.
      if (confirmados.length >= 2 && !caption.proporcion_relativa_presente) {
        let feedback: FeedbackFoto | null = null;
        try {
          feedback = JSON.parse(await readFile(path.join(carpetaOrden, `feedback-${indice}.json`), "utf-8"));
        } catch {
          // sin feedback -- no se puede confirmar qué se ve, se salta el chequeo
        }
        if (feedback) {
          const diametrosVisibles = new Set<number>();
          for (const pr of feedback.productosRepresentados ?? []) {
            if (!pr.representado) continue;
            const lineaOrigen = desglose.lineas.find((l) => `${l.producto}${l.variante ? ` (${l.variante})` : ""}` === pr.producto);
            const codigo = lineaOrigen?.variante?.split("/")[0]?.trim();
            const decodificado = codigo ? decodificarTamano(codigo) : null;
            if (decodificado?.forma === "redondo" && decodificado.diamPulg !== null) diametrosVisibles.add(decodificado.diamPulg);
          }
          // Una foto de PAQUETES SIN ABRIR o un flat lay de productos tiene varios tamaños
          // "visibles" en el sentido de que aparecen en el cuadro, pero no hay nada instalado
          // que comparar: no marcar proporción relativa ahí es lo correcto, no una omisión. De
          // los 5 casos que esta regla marcaba, 4 eran exactamente eso (#15151, #17385, #7559,
          // #7953: "paquetes de globos sin inflar"). `esDecoracion` los separa exactamente.
          if (diametrosVisibles.size >= 2 && feedback.esDecoracion !== false) {
            violaciones.push({
              severidad: "INFORMATIVA",
              tipo: "posible_omision",
              orden: numero,
              indice,
              detalle: `Feedback confirma ${diametrosVisibles.size} tamaños redondos distintos visibles (${[...diametrosVisibles].join(", ")}") pero el caption no marcó proporción relativa. Revisar si de verdad se ven mezclados en el cuadro.`,
            });
          }
        }
      }
    }
  }

  const altas = violaciones.filter((v) => v.severidad === "ALTA");
  const info = violaciones.filter((v) => v.severidad === "INFORMATIVA");

  console.log(`Captions escaneados: ${captionsEscaneados}`);
  console.log(`Con proporcion_relativa_presente=true: ${conProporcionPresente}`);
  console.log(`Órdenes con 2+ tamaños redondos confirmados: ${conTamanosConfirmadosEnOrden}`);
  const ETIQUETAS: Record<string, string> = {
    tamaño_inventado: "cita una medida que no está en el pedido",
    inversion_color: "comparación de tamaño invertida respecto del pedido",
    variacion_sin_respaldo: "afirma variación de tamaño con un solo diámetro comprado",
    ratio_calculado: "ratio sacado de dividir los calibres, no de mirar la foto",
    meta_comentario: "habla del pedido en vez de la imagen",
  };
  console.log(`\nViolaciones ALTA: ${altas.length}`);
  for (const [tipo, etiqueta] of Object.entries(ETIQUETAS)) {
    const n = altas.filter((v) => v.tipo === tipo).length;
    console.log(`  ${String(n).padStart(3)}  ${tipo} -- ${etiqueta}`);
  }
  console.log(`Casos INFORMATIVOS (posible omisión, para revisión humana): ${info.length}`);

  for (const v of [...altas, ...(MOSTRAR_DETALLE ? info : [])]) {
    console.log(`\n[${v.severidad}] ${v.tipo} -- orden #${v.orden} foto ${v.indice}`);
    console.log(`  ${v.detalle}`);
  }
  if (!MOSTRAR_DETALLE && info.length > 0) {
    console.log(`\n(${info.length} casos INFORMATIVOS no se imprimieron -- correr con --detalle para verlos)`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
