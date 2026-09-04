import "server-only";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";

/**
 * Estadísticas del dataset de órdenes.
 *
 * El cálculo vive aquí y no en la ruta porque tiene dos consumidores: la ruta
 * `/api/admin/ordenes/estadisticas` cuando la carpeta local existe, y el
 * snapshot (`lib/lora/snapshot.ts`) que se publica al servidor. El servidor no
 * tiene la carpeta de órdenes ni las fotos, así que allí las estadísticas solo
 * pueden venir del snapshot generado en la máquina que sí las tiene.
 */

const RUTA_ORDENES = process.env.ORDENES_DECORACION_DIR ?? "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";

export function rutaOrdenes(): string {
  return RUTA_ORDENES;
}

type LineaDesglose = { producto: string; variante: string | null; sku: string | null; cantidad: number; precioUnitario: number };
type Desglose = { orden: string; cliente: string | null; fecha: string | null; lineas: LineaDesglose[] };
type Caption = {
  tipo_estructura: string;
  elementos_no_comprados: string[];
  proporcion_relativa_presente: boolean;
  caption_status: string;
};
type FeedbackFoto = {
  aptoParaEntrenamiento: boolean;
  fidelidadImagen: "alta" | "media" | "baja";
  fuente: "ia_automatica" | "humano";
  productosRepresentados: Array<{ producto: string; representado: boolean }>;
  categoria?: string;
};

// Vocabulario real de acabados Sempertex, confirmado contra los nombres de producto que
// realmente aparecen en los pedidos (ver derivación en la sesión que agregó esto) -- ordenado
// por especificidad para que "PASTEL MATE"/"PASTEL DUSK" no queden capturados por un patrón
// más genérico.
const ACABADO_REGEX =
  /\b(PASTEL MATE|PASTEL DUSK|LINK-O-LOON|2 CARAS|FASHION|REFLEX|METALIZADO|INFINITY|SATIN|SILK|CRISTAL)\b/i;

function acabadoDe(nombreProducto: string): string | null {
  // Sin este filtro, "vaso metalizado", "cartel metalizado", "mantel pastel dusk" (mercancía
  // de fiesta, no globos) contaminaban el conteo -- confirmado con datos reales: 18 productos
  // no-globo distintos matcheaban el regex de acabado antes de este fix.
  if (!/\bGLOBO\b/i.test(nombreProducto)) return null;
  const m = nombreProducto.match(ACABADO_REGEX);
  return m ? m[1].toUpperCase() : null;
}

type FilaCatalogoPorSku = { producto_id: string; titulo_limpio: string; imagen_principal: string | null };

function catalogoPorSku(sku: string): { id: string; titulo: string; imagen: string | null } | null {
  const fila = getDb()
    .prepare(
      `SELECT p.id AS producto_id, p.titulo_limpio, p.imagen_principal
       FROM shopify_variante v
       JOIN shopify_producto p ON p.id = v.producto_id
       WHERE v.sku = ?
       LIMIT 1`,
    )
    .get(sku) as FilaCatalogoPorSku | undefined;
  return fila ? { id: fila.producto_id, titulo: fila.titulo_limpio, imagen: fila.imagen_principal } : null;
}

// Las inscripciones a cursos ("CURSO BÁSICO...", "CURSO INTERMEDIO...") vienen en el mismo
// desglose de Shopify que los materiales de decoración pero no son productos del catálogo de
// globos -- contarlas como "referencia sin match" o en el valor de materiales ensucia esas
// estadísticas sin aportar nada útil para el dataset.
function esCurso(nombreProducto: string): boolean {
  return /^curso\b/i.test(nombreProducto.trim());
}

export type ReferenciaProducto = {
  clave: string;
  titulo: string;
  imagen: string | null;
  mapeado: boolean;
  vecesReferenciado: number;
  cantidadTotal: number;
};

export type ConteoEtiqueta = { etiqueta: string; cantidad: number };
export type ConteoImagen = { titulo: string; imagen: string | null };
export type Alerta = { nivel: "alta" | "media" | "baja"; categoria: string; titulo: string; detalle: string };

export type EstadisticasOrdenes = {
  ordenesAnalizadas: number;
  totalReferencias: number;
  referenciasMapeadas: number;
  referenciasSinMapear: number;
  productosDistintos: number;
  ranking: ReferenciaProducto[];
  valorTotalMateriales: number;
  fotos: {
    totalFotos: number;
    ordenesConUnaFoto: number;
    ordenesConVariasFotos: number;
  };
  captions: {
    totalCaptions: number;
    editadosAMano: number;
    generadosPorIa: number;
    conProporcionRelativa: number;
  };
  tiposEstructura: ConteoEtiqueta[];
  elementosNoComprados: ConteoEtiqueta[];
  catalogoSinReferencia: ConteoImagen[];
  sinRepresentacionVisual: ReferenciaProducto[];
  acabados: ConteoEtiqueta[];
  categorias: ConteoEtiqueta[];
  revision: {
    aptas: number;
    noAptas: number;
    fidelidadAlta: number;
    fidelidadMedia: number;
    fidelidadBaja: number;
    revisadasPorHumano: number;
    revisadasPorIa: number;
  };
  alertas: Alerta[];
  /** Presente solo cuando los datos vienen de un snapshot y no de la carpeta viva. */
  origen?: "snapshot";
  /** ISO del momento en que se generó el snapshot que produjo estos datos. */
  generadoEn?: string;
};

function contarEn(mapa: Map<string, number>, clave: string): void {
  mapa.set(clave, (mapa.get(clave) ?? 0) + 1);
}

function mapaAConteoOrdenado(mapa: Map<string, number>): ConteoEtiqueta[] {
  return [...mapa.entries()].map(([etiqueta, cantidad]) => ({ etiqueta, cantidad })).sort((a, b) => b.cantidad - a.cantidad);
}

/**
 * Devuelve `null` cuando la carpeta de órdenes no existe en esta máquina; el
 * llamador decide si eso es un error (local) o si debe caer al snapshot
 * (servidor).
 */
export async function calcularEstadisticasOrdenes(): Promise<EstadisticasOrdenes | null> {
  let carpetas: string[];
  try {
    carpetas = (await readdir(RUTA_ORDENES, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return null;
  }

  const porClave = new Map<string, ReferenciaProducto>();
  const tiposEstructura = new Map<string, number>();
  const elementosNoComprados = new Map<string, number>();
  const idsCatalogoReferenciados = new Set<string>();
  const acabados = new Map<string, number>();
  const categorias = new Map<string, number>();
  const clavesConfirmadasVisibles = new Set<string>();

  let aptas = 0;
  let noAptas = 0;
  let fidelidadAlta = 0;
  let fidelidadMedia = 0;
  let fidelidadBaja = 0;
  let revisadasPorHumano = 0;
  let revisadasPorIa = 0;

  let ordenesAnalizadas = 0;
  let totalReferencias = 0;
  let referenciasMapeadas = 0;
  let valorTotalMateriales = 0;

  let totalFotos = 0;
  let ordenesConUnaFoto = 0;
  let ordenesConVariasFotos = 0;

  let totalCaptions = 0;
  let editadosAMano = 0;
  let conProporcionRelativa = 0;

  for (const numero of carpetas) {
    const carpetaOrden = path.join(RUTA_ORDENES, numero);

    let desglose: Desglose;
    try {
      desglose = JSON.parse(await readFile(path.join(carpetaOrden, "desglose.json"), "utf-8"));
    } catch {
      continue;
    }
    ordenesAnalizadas += 1;

    // Puente para cruzar desglose (nombre crudo del producto) con `clave` del ranking
    // (título limpio si mapea al catálogo) dentro de esta misma orden -- productosRepresentados
    // en el feedback usa el nombre crudo, no la `clave`.
    const claveDeProducto = new Map<string, string>();

    for (const linea of desglose.lineas) {
      if (esCurso(linea.producto)) continue;
      totalReferencias += 1;
      valorTotalMateriales += linea.precioUnitario * linea.cantidad;
      const catalogo = linea.sku ? catalogoPorSku(linea.sku) : null;
      if (catalogo) {
        referenciasMapeadas += 1;
        idsCatalogoReferenciados.add(catalogo.id);
      }

      // Agrupar por producto, no por SKU -- un mismo producto tiene un SKU distinto por
      // tamaño/variante (R-9, R-12, R-24...), y lo que se quiere rankear es el producto
      // ("el globo X es el más referenciado"), no cada talla suelta.
      const clave = catalogo?.titulo ?? linea.producto;
      // feedback.productosRepresentados[].producto no es linea.producto solo -- es el mismo
      // texto que se le mostró a la IA en el prompt (nombre + variante pegados, ver
      // `listaCompleta` en generarCaption.ts), y la IA lo devuelve tal cual. Sin este formato
      // exacto el cruce nunca matcheaba nada.
      const claveTexto = `${linea.producto}${linea.variante ? ` (${linea.variante})` : ""}`;
      claveDeProducto.set(claveTexto, clave);
      const existente = porClave.get(clave);
      if (existente) {
        existente.vecesReferenciado += 1;
        existente.cantidadTotal += linea.cantidad;
      } else {
        porClave.set(clave, {
          clave,
          titulo: catalogo?.titulo ?? linea.producto,
          imagen: catalogo?.imagen ?? null,
          mapeado: Boolean(catalogo),
          vecesReferenciado: 1,
          cantidadTotal: linea.cantidad,
        });
      }
    }

    const archivos = await readdir(carpetaOrden).catch(() => [] as string[]);
    const indicesFoto = archivos
      .map((f) => f.match(/^foto-(\d+)\.(jpg|jpeg|png|webp)$/i)?.[1])
      .filter((x): x is string => Boolean(x))
      .map(Number);
    if (indicesFoto.length === 1) ordenesConUnaFoto += 1;
    else if (indicesFoto.length > 1) ordenesConVariasFotos += 1;
    totalFotos += indicesFoto.length;

    for (const indice of indicesFoto) {
      let caption: Caption;
      try {
        caption = JSON.parse(await readFile(path.join(carpetaOrden, `caption-${indice}.json`), "utf-8"));
      } catch {
        continue;
      }
      totalCaptions += 1;
      if (caption.caption_status === "editado_manualmente") editadosAMano += 1;
      if (caption.proporcion_relativa_presente) conProporcionRelativa += 1;
      if (caption.tipo_estructura) contarEn(tiposEstructura, caption.tipo_estructura);
      for (const elemento of caption.elementos_no_comprados ?? []) contarEn(elementosNoComprados, elemento.toLowerCase());

      let feedback: FeedbackFoto | null = null;
      try {
        feedback = JSON.parse(await readFile(path.join(carpetaOrden, `feedback-${indice}.json`), "utf-8"));
      } catch {
        // sin feedback todavía -- no cuenta para apta/fidelidad/acabados, no es un error
      }
      if (feedback) {
        if (feedback.aptoParaEntrenamiento) aptas += 1;
        else noAptas += 1;
        if (feedback.fidelidadImagen === "alta") fidelidadAlta += 1;
        else if (feedback.fidelidadImagen === "media") fidelidadMedia += 1;
        else if (feedback.fidelidadImagen === "baja") fidelidadBaja += 1;
        if (feedback.fuente === "humano") revisadasPorHumano += 1;
        else revisadasPorIa += 1;
        contarEn(categorias, feedback.categoria ?? "no_asignada");

        // Acabado real de lo que efectivamente SE VE en la foto (no de todo lo que trae la
        // orden) -- cruza productosRepresentados=true contra el nombre real del producto en
        // el desglose para sacar el acabado Sempertex (Fashion, Reflex, Metalizado...).
        for (const pr of feedback.productosRepresentados ?? []) {
          if (!pr.representado) continue;
          const acabado = acabadoDe(pr.producto);
          if (acabado) contarEn(acabados, acabado);
          const clave = claveDeProducto.get(pr.producto);
          if (clave) clavesConfirmadasVisibles.add(clave);
        }
      }
    }
  }

  const ranking = [...porClave.values()].sort((a, b) => b.vecesReferenciado - a.vecesReferenciado);

  // Distinto de "sin referencia en el catálogo" (comprado, sin match de SKU) y de "catálogo sin
  // referencia" (nunca comprado): esto es material que SÍ se compró y SÍ matchea al catálogo,
  // pero que ninguna foto confirmó como realmente visible -- se tiene el material en la
  // cotización pero cero señal fotográfica de cómo se ve instalado.
  const sinRepresentacionVisual = ranking.filter((r) => r.mapeado && !clavesConfirmadasVisibles.has(r.clave));

  // Inverso del ranking: productos del catálogo (disponibles para venta) que nunca aparecieron
  // en ningún desglose real -- huecos del dataset, no cosas que se compraron pero no matchearon.
  type FilaProductoCatalogo = { id: string; titulo_limpio: string; imagen_principal: string | null };
  const productosCatalogo = getDb()
    .prepare(`SELECT id, titulo_limpio, imagen_principal FROM shopify_producto WHERE disponible = 1`)
    .all() as FilaProductoCatalogo[];
  const catalogoSinReferencia: ConteoImagen[] = productosCatalogo
    .filter((p) => !idsCatalogoReferenciados.has(p.id))
    .map((p) => ({ titulo: p.titulo_limpio, imagen: p.imagen_principal }))
    .sort((a, b) => a.titulo.localeCompare(b.titulo, "es"));

  const acabadosOrdenados = mapaAConteoOrdenado(acabados);
  const totalAcabados = acabadosOrdenados.reduce((s, a) => s + a.cantidad, 0);
  const tiposEstructuraOrdenados = mapaAConteoOrdenado(tiposEstructura);
  const totalEstructuras = tiposEstructuraOrdenados.reduce((s, t) => s + t.cantidad, 0);
  const totalRevision = aptas + noAptas;

  // Umbrales elegidos a criterio (no hay un estándar externo para esto): el objetivo es
  // avisar de desbalances que un humano recorriendo cientos de fotos no nota fácil, no dar un
  // veredicto exacto. "Baja representación" y "domina el dataset" son las dos caras del mismo
  // problema -- un acabado/estructura casi ausente en un extremo, uno que se comió todo el
  // dataset en el otro.
  const alertas: Alerta[] = [];

  if (totalAcabados > 0) {
    for (const a of acabadosOrdenados) {
      const pct = a.cantidad / totalAcabados;
      if (pct < 0.08) {
        alertas.push({
          nivel: "media",
          categoria: "acabado",
          titulo: `Acabado poco representado: ${a.etiqueta}`,
          detalle: `Solo ${a.cantidad} de ${totalAcabados} menciones confirmadas como visibles (${Math.round(pct * 100)}%). El LoRA puede no aprender bien a reproducir este acabado.`,
        });
      }
      if (pct > 0.55) {
        alertas.push({
          nivel: "media",
          categoria: "acabado",
          titulo: `Acabado sobrerrepresentado: ${a.etiqueta}`,
          detalle: `${Math.round(pct * 100)}% de las menciones de acabado son ${a.etiqueta} -- riesgo de que el LoRA sobreajuste a este acabado en vez de aprender los demás.`,
        });
      }
    }
  }

  if (totalEstructuras > 0) {
    for (const t of tiposEstructuraOrdenados) {
      const pct = t.cantidad / totalEstructuras;
      if (t.cantidad <= 3) {
        alertas.push({
          nivel: "media",
          categoria: "estructura",
          titulo: `Estructura poco representada: ${t.etiqueta}`,
          detalle: `Solo ${t.cantidad} foto(s) con esta estructura -- prácticamente no hay señal para que el LoRA aprenda a componerla bien.`,
        });
      }
      if (pct > 0.4) {
        alertas.push({
          nivel: "baja",
          categoria: "estructura",
          titulo: `Estructura dominante: ${t.etiqueta}`,
          detalle: `${Math.round(pct * 100)}% de las fotos son ${t.etiqueta}. Es razonable si es lo más pedido, pero conviene no dejar que opaque al resto.`,
        });
      }
    }
  }

  if (totalRevision > 0) {
    const pctHumano = revisadasPorHumano / totalRevision;
    if (pctHumano < 0.2) {
      alertas.push({
        nivel: "alta",
        categoria: "revision_humana",
        titulo: "Casi ninguna foto fue revisada por un humano",
        detalle: `Solo ${revisadasPorHumano} de ${totalRevision} (${Math.round(pctHumano * 100)}%) tiene feedback con fuente "humano" -- el resto es juicio automático de la IA sin verificar. El plan de entrenamiento pide revisar a mano una muestra antes de enviar el dataset.`,
      });
    }
    const pctBaja = fidelidadBaja / totalRevision;
    if (pctBaja > 0.1) {
      alertas.push({
        nivel: "media",
        categoria: "fidelidad",
        titulo: "Muchas fotos de fidelidad baja",
        detalle: `${fidelidadBaja} de ${totalRevision} (${Math.round(pctBaja * 100)}%) están marcadas con fidelidad baja (borrosas, oscuras, o difícil distinguir materiales).`,
      });
    }
    const pctApta = aptas / totalRevision;
    if (pctApta < 0.5) {
      alertas.push({
        nivel: "media",
        categoria: "aptas",
        titulo: "Menos de la mitad de las fotos son aptas",
        detalle: `${aptas} de ${totalRevision} (${Math.round(pctApta * 100)}%) están marcadas aptas para entrenamiento -- conviene revisar por qué tantas quedan afuera antes de asumir que el dataset alcanza.`,
      });
    }
  }

  const ordenNivel: Record<Alerta["nivel"], number> = { alta: 0, media: 1, baja: 2 };
  alertas.sort((a, b) => ordenNivel[a.nivel] - ordenNivel[b.nivel]);

  return {
    ordenesAnalizadas,
    totalReferencias,
    referenciasMapeadas,
    referenciasSinMapear: totalReferencias - referenciasMapeadas,
    productosDistintos: ranking.length,
    ranking,
    valorTotalMateriales,
    fotos: { totalFotos, ordenesConUnaFoto, ordenesConVariasFotos },
    captions: {
      totalCaptions,
      editadosAMano,
      generadosPorIa: totalCaptions - editadosAMano,
      conProporcionRelativa,
    },
    tiposEstructura: tiposEstructuraOrdenados,
    elementosNoComprados: mapaAConteoOrdenado(elementosNoComprados).slice(0, 12),
    catalogoSinReferencia,
    sinRepresentacionVisual,
    acabados: acabadosOrdenados,
    categorias: mapaAConteoOrdenado(categorias),
    revision: { aptas, noAptas, fidelidadAlta, fidelidadMedia, fidelidadBaja, revisadasPorHumano, revisadasPorIa },
    alertas,
  };
}
