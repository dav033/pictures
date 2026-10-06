/**
 * Genera biblioteca real de decoraciones desde una carpeta de referencias.
 *
 * Ejecución con gasto: `npx tsx --conditions=react-server scripts/biblioteca/construir-biblioteca-real.ts --ejecutar`
 * Usa una llamada al análisis clásico por imagen. Requiere backend Python local en :8080.
 * Las fotos se convierten a JPG local de hasta 800 px. Nunca se versionan originales.
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { ReferenceBlueprintV2Schema } from "../../src/lib/ia/referencia/reference-blueprint";
import { PlanDecoracionSchema } from "../../src/lib/plan/tipos";
import { resolverPlan } from "../../src/lib/plan/resolver-backend";
import { llamarPythonListaMateriales } from "../../src/lib/ia/nucleo/python-adapter";
import { ListaMaterialesRequestSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { DecoracionSempertexSchema } from "../../src/lib/biblioteca-sempertex/esquemas";
import type { PistaConteo } from "../../src/lib/plan/conteo-referencia";

const ENTRADA = process.env.BIBLIOTECA_REAL_ENTRADA ?? "C:/Users/davidt/Downloads/hola";
const DATOS = path.join(process.cwd(), "data", "biblioteca-real");
const ANALISIS = path.join(DATOS, "analisis");
const FOTOS = path.join(process.cwd(), "public", "biblioteca-sempertex", "referencias");
const EXTENSIONES = new Set([".jpg", ".jpeg", ".webp", ".avif", ".gif"]);

const COLOR_EQUIVALENTE: Readonly<Record<string, string>> = {
  pink: "rosado", rosa: "rosado", rosado: "rosado", fucsia: "fucsia", magenta: "fucsia",
  gold: "dorado", dorado: "dorado", "rose gold": "dorado rosa", "dorado rosa": "dorado rosa",
  black: "negro", negro: "negro", white: "blanco", blanco: "blanco", blue: "azul", azul: "azul",
  navy: "azul", "light blue": "azul", silver: "plateado", plateado: "plateado", plata: "plateado",
  purple: "morado", morado: "morado", violet: "violeta", violeta: "violeta", lilac: "lila", lila: "lila",
  green: "verde", verde: "verde", red: "rojo", rojo: "rojo", yellow: "amarillo", amarillo: "amarillo",
  orange: "naranja", naranja: "naranja", beige: "beige", tan: "beige", brown: "cafe", cafe: "cafe",
  "light brown": "cafe", cream: "crema", crema: "crema", coral: "coral", transparent: "transparente",
};
const TIPO_OFICIAL: Readonly<Record<string, { tipo: string; oficial: string; nombre: string; ubicacion: string; medidas: Record<string, number> }>> = {
  arco: { tipo: "arco", oficial: "arco", nombre: "Arco de globos", ubicacion: "arco_central", medidas: { ancho_m: 2.4, alto_m: 2.2 } },
  semiarco: { tipo: "semiarco", oficial: "semiarco", nombre: "Semiarco orgánico", ubicacion: "fondo_pared", medidas: { ancho_m: 1.7, alto_m: 2.0 } },
  columna: { tipo: "columna", oficial: "columna", nombre: "Columna de globos", ubicacion: "lateral_izquierdo", medidas: { ancho_m: 0.55, alto_m: 2.0 } },
  guirnalda: { tipo: "guirnalda", oficial: "guirnalda", nombre: "Guirnalda orgánica", ubicacion: "fondo_pared", medidas: { largo_m: 2.4 } },
  bouquet: { tipo: "kit", oficial: "bouquet", nombre: "Bouquet de globos", ubicacion: "sobre_mesa_principal", medidas: {} },
  centro_mesa: { tipo: "centro_mesa", oficial: "centro_mesa", nombre: "Centro de mesa con globos", ubicacion: "mesas_invitados", medidas: {} },
};
const FICHAS_CLIENTE = [
  { titulo: "Arco de entrada en blanco y negro", tematica: "Elegante blanco y negro", eventos: ["Cumpleaños", "Graduación", "Fiesta de empresa"], edad: { min: 18, max: 70 } },
  { titulo: "Arco naranja y negro para fiesta de disfraces", tematica: "Infantil naranja y negro", eventos: ["Halloween", "Cumpleaños"], edad: { min: 3, max: 16 } },
  { titulo: "Semiarco azul y plateado con centros de mesa", tematica: "Azul y plateado", eventos: ["Baby shower", "Cumpleaños"], edad: { min: 0, max: 14 } },
  { titulo: "Semiarco selvático de dinosaurios", tematica: "Infantil de dinosaurios", eventos: ["Cumpleaños"], edad: { min: 2, max: 12 } },
  { titulo: "Semiarco rosa palo y dorado", tematica: "Romántico rosa y dorado", eventos: ["Boda", "Cumpleaños"], edad: { min: 18, max: 60 } },
  { titulo: "Columna arcoíris con cinta dorada", tematica: "Infantil colorida", eventos: ["Cumpleaños"], edad: { min: 1, max: 12 } },
  { titulo: "Dos columnas rosa, lila y dorado", tematica: "Rosa y lila", eventos: ["Cumpleaños", "XV años"], edad: { min: 8, max: 25 } },
  { titulo: "Columnas negras y doradas", tematica: "Elegante negro y dorado", eventos: ["Cumpleaños", "Graduación", "Fiesta de empresa"], edad: { min: 18, max: 70 } },
  { titulo: "Guirnalda rosa y dorada de cumpleaños", tematica: "Rosa y dorado", eventos: ["Cumpleaños"], edad: { min: 1, max: 30 } },
  { titulo: "Semiarco azul, blanco y plateado", tematica: "Azul y plateado", eventos: ["Baby shower", "Cumpleaños"], edad: { min: 0, max: 14 } },
  { titulo: "Arco pastel rosa y turquesa", tematica: "Baby shower niña", eventos: ["Baby shower", "Primer cumpleaños"], edad: { min: 0, max: 8 } },
  { titulo: "Semiarco lila y morado", tematica: "Lila y morado", eventos: ["XV años", "Cumpleaños"], edad: { min: 12, max: 30 } },
  { titulo: "Semiarco blanco y oro rosa", tematica: "Romántico rosa y dorado", eventos: ["Boda", "Cumpleaños"], edad: { min: 18, max: 60 } },
  { titulo: "Arco de entrada blanco y negro", tematica: "Elegante blanco y negro", eventos: ["Graduación", "Cumpleaños"], edad: { min: 16, max: 70 } },
  { titulo: "Semiarco rojo, blanco y dorado", tematica: "Infantil colorida", eventos: ["Cumpleaños"], edad: { min: 1, max: 16 } },
  { titulo: "Guirnalda azul para cumpleaños", tematica: "Azul y plateado", eventos: ["Cumpleaños"], edad: { min: 1, max: 16 } },
  { titulo: "Semiarco rosa y champagne", tematica: "Romántico rosa y dorado", eventos: ["Boda", "XV años"], edad: { min: 15, max: 60 } },
  { titulo: "Guirnalda rosa pastel y dorado", tematica: "Baby shower niña", eventos: ["Baby shower", "Primer cumpleaños"], edad: { min: 0, max: 8 } },
  { titulo: "Guirnalda rosa, fucsia y oro rosa", tematica: "Rosa y dorado", eventos: ["Cumpleaños", "XV años"], edad: { min: 12, max: 40 } },
  { titulo: "Semiarco azul ilusión", tematica: "Azul y plateado", eventos: ["Baby shower", "Cumpleaños"], edad: { min: 0, max: 16 } },
] as const;

function exigirEjecucionExplicita(): void {
  if (!process.argv.includes("--ejecutar")) {
    throw new Error("Este script puede llamar servicios de IA con costo. Confirma ejecución pasando --ejecutar.");
  }
}

function nombreSeguro(nombre: string): string {
  return path.basename(nombre, path.extname(nombre))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "referencia";
}

function colorCatalogo(valor: string): string | undefined {
  const normalizado = valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
  return COLOR_EQUIVALENTE[normalizado];
}

function uuidDeterminista(valor: string): string {
  const hex = createHash("sha256").update(valor).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 3) | 8).toString(16);
  const texto = hex.join("");
  return `${texto.slice(0, 8)}-${texto.slice(8, 12)}-${texto.slice(12, 16)}-${texto.slice(16, 20)}-${texto.slice(20)}`;
}

function record(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor) ? valor as Record<string, unknown> : {};
}

async function construirPlanesGuardados(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL falta; no se puede comprobar snapshot ni resolver planes reales.");
  process.env.DATABASE_URL = databaseUrl;
  const { getRagPool } = await import("../../src/lib/rag/db");
  const pool = getRagPool();
  try {
    const consulta = await pool.query<{
      source_snapshot_id: string; product_id: string; variant_id: string; sku: string | null;
      titulo: string; color: string; unidades_paq: number;
    }>(
      `WITH snapshot AS (
         SELECT source_snapshot_id FROM rag_source_snapshots
          WHERE source_kind = 'products_catalog' AND status = 'published'
          ORDER BY published_at DESC NULLS LAST, fetched_at DESC LIMIT 1
       )
       SELECT s.source_snapshot_id, p.product_id, v.variant_id, v.sku, p.title AS titulo,
              v.derived_colors[1] AS color, v.unidades_paq::int AS unidades_paq
         FROM snapshot s
         JOIN catalog_products p ON p.source_snapshot_id = s.source_snapshot_id
         JOIN catalog_variants v ON v.source_snapshot_id = s.source_snapshot_id AND v.product_id = p.product_id
        WHERE p.status = 'ACTIVE' AND p.available = TRUE AND v.available = TRUE
          AND v.currency = 'COP' AND v.price > 0 AND v.unidades_paq = 50 AND v.diam_pulg = 12
          AND cardinality(v.derived_colors) = 1 AND v.title ILIKE 'R-12%'
          AND p.title ILIKE '%Globo Latex Redondo%'
          AND p.title !~* '(2 caras|cumple|bautizo|navidad|love|mami|papa|niña|niño|te amo|corazon|welcome)'
        ORDER BY CASE WHEN p.title ILIKE '%Globo Latex Redondo Fashion%' THEN 0 ELSE 1 END, p.title, v.variant_id`,
    );
    const snapshot = consulta.rows[0]?.source_snapshot_id;
    if (!snapshot) throw new Error("Snapshot publicado de productos no disponible.");
    const porColor = new Map<string, (typeof consulta.rows)[number]>();
    for (const fila of consulta.rows) if (!porColor.has(fila.color)) porColor.set(fila.color, fila);
    const { readdir: leerDirectorio } = await import("node:fs/promises");
    const archivos = (await leerDirectorio(ANALISIS)).filter((nombre) => nombre.endsWith(".json") && !nombre.endsWith(".plan.json")).sort();
    for (const archivo of archivos) {
      const raw = record(JSON.parse(await readFile(path.join(ANALISIS, archivo), "utf8")) as unknown);
      const respuesta = record(raw.respuesta);
      const blueprint = ReferenceBlueprintV2Schema.safeParse(respuesta.blueprint);
      if (!blueprint.success || raw.status !== 200) {
        await writeFile(path.join(ANALISIS, `${String(raw.id)}.plan.json`), `${JSON.stringify({ estado: "descartada", razon: "El analizador no produjo blueprint válido." }, null, 2)}\n`);
        continue;
      }
      const piezas: Array<Record<string, unknown>> = [];
      const descartadas: string[] = [];
      const conteos: PistaConteo[] = [];
      for (const elemento of blueprint.data.elements) {
        if (!elemento.approved || elemento.category !== "balloon_structure") continue;
        const tipoOriginal = elemento.visual_semantics?.structure_type ?? "";
        const tipo = tipoOriginal === "kit" ? (elemento.appearance.shape?.toLowerCase().includes("table") ? "centro_mesa" : "bouquet") : tipoOriginal;
        const ficha = TIPO_OFICIAL[tipo];
        if (!ficha) { descartadas.push(`${elemento.element_id}: estructura ${tipoOriginal || "sin tipo"} no identificable`); continue; }
        const lectura = elemento.appearance.conteo;
        if (!lectura && (tipo === "bouquet" || tipo === "centro_mesa")) { descartadas.push(`${elemento.element_id}: sin conteo para pieza de unidades declaradas`); continue; }
        const coloresBase = (elemento.appearance.measured_colors ?? [])
          .map((color) => ({ color: colorCatalogo(color.color ?? ""), share: color.share }))
          .filter((color): color is { color: string; share: number } => color.color !== undefined && porColor.has(color.color))
          .sort((a, b) => b.share - a.share)
          .slice(0, 3);
        const coloresUnicos = [...new Map(coloresBase.map((color) => [color.color, color])).values()];
        if (!coloresUnicos.length) {
          const fallback = elemento.appearance.observed_colors.map(colorCatalogo).find((color): color is string => color !== undefined && porColor.has(color));
          if (fallback) coloresUnicos.push({ color: fallback, share: 1 });
        }
        if (!coloresUnicos.length) { descartadas.push(`${elemento.element_id}: sin color medido con variante R-12 en snapshot`); continue; }
        const suma = coloresUnicos.reduce((total, item) => total + item.share, 0);
        const materiales = coloresUnicos.map((item, indice) => {
          const variante = porColor.get(item.color)!;
          return { product_id: variante.product_id, variant_id: variante.variant_id, color: item.color, participacion: item.share / suma, rol_material: indice === 0 ? "principal" : indice === 1 ? "secundario" : "acento" };
        });
        const indicePieza = piezas.length + 1;
        const estructuraId = `EST_${String(indicePieza).padStart(2, "0")}_${tipo.toLocaleUpperCase("es")}`;
        piezas.push({
          estructura_id: estructuraId, nombre: ficha.nombre, tipo: ficha.tipo, estructura_oficial: ficha.oficial,
          rol_escena: indicePieza === 1 ? "focal" : "soporte", ubicacion: ficha.ubicacion,
          medidas: ficha.medidas, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales,
          ...(tipo === "bouquet" || tipo === "centro_mesa" ? { unidades_declaradas: lectura ? (lectura.exacto ? Math.max(5, lectura.globos_visibles) : 12) : 12 } : {}),
          referencia_element_id: elemento.element_id,
          colores_referencia: coloresUnicos.map((item) => item.color),
          porque: `Recreación de referencia ${elemento.element_id}, con color y forma observados.`,
        });
        if (lectura && lectura.confianza >= 0.5 && (lectura.exacto || lectura.estimado_total !== null || lectura.racimos !== null)) {
          conteos.push({ ...lectura, referencia_element_id: elemento.element_id });
        }
      }
      if (!piezas.length) {
        await writeFile(path.join(ANALISIS, `${String(raw.id)}.plan.json`), `${JSON.stringify({ estado: "descartada", razon: descartadas.join("; ") || "No hay estructura de globos aprobada." }, null, 2)}\n`);
        continue;
      }
      const nombresColor = [...new Set(piezas.flatMap((pieza) => pieza.colores_referencia as string[]))];
      const paleta = nombresColor.slice(0, 8);
      const plan = PlanDecoracionSchema.parse({
        plan_version: "1.0", plan_id: uuidDeterminista(String(raw.id)),
        concepto: { titulo: String(raw.id), descripcion: "Plan de estructuras y materiales derivado de una decoración de referencia.", paleta, estilo: "orgánico" },
        espacio: { tipo: "fondo de celebración", fuente: "foto" }, estructuras: piezas,
        supuestos: ["Las medidas en metros parten de un tamaño frecuente y se ajustan con la lectura de la foto.", "Se usan globos redondos R-12 disponibles en el snapshot vigente."],
      });
      const productosUsados = new Map<string, Set<string>>();
      for (const pieza of piezas) {
        for (const material of pieza.materiales as Array<{ product_id: string; variant_id: string }>) {
          const variantes = productosUsados.get(material.product_id) ?? new Set<string>();
          variantes.add(material.variant_id);
          productosUsados.set(material.product_id, variantes);
        }
      }
      const requestId = uuidDeterminista(`${String(raw.id)}:request`);
      const resolucion = await resolverPlan({
        plan, allowlist: [...productosUsados].map(([product_id, variant_ids]) => ({ product_id, variant_ids: [...variant_ids] })),
        catalogSnapshotId: snapshot, completarConteos: conteos.length > 0, pistasConteo: conteos,
        requestId, correlationId: requestId,
      });
      const materiales = resolucion.materialEstimate.purchases.map((linea) => ({ variant_id: linea.variant_id, cantidad: linea.design_quantity }));
      const entradaLista = ListaMaterialesRequestSchema.parse({ schema_version: "lista-materiales.v1", materiales });
      const cotizacion = await llamarPythonListaMateriales({ entrada: entradaLista, requestId, correlationId: requestId });
      const resuelto = {
        estado: "resuelto", snapshot, plan_declarado: plan, plan_resuelto: resolucion.resuelto,
        material_estimate: resolucion.materialEstimate, quote: resolucion.cotizacion, lista_materiales: cotizacion,
        descartadas,
      };
      await writeFile(path.join(ANALISIS, `${String(raw.id)}.plan.json`), `${JSON.stringify(resuelto, null, 2)}\n`);
      console.log(`${String(raw.id)}: ${resolucion.resuelto.estructuras.length} piezas, ${resolucion.resuelto.compras.reduce((n, compra) => n + compra.unidades_necesarias, 0)} globos, Python y cotización OK`);
    }
  } finally {
    await pool.end();
  }
  await publicarBibliotecaReal();
}

function pasosDe(tipo: string, patron: string): Array<{ orden: number; texto: string }> {
  const patronTexto = patron ? `Sigue el patrón ${patron} y alterna los colores según la foto.` : "Alterna los colores de la paleta para conservar el balance de la foto.";
  const primero = tipo === "columna" ? "Fija una base pesada y arma el soporte vertical." : tipo === "guirnalda" ? "Marca los puntos de anclaje y prepara la tira de soporte." : tipo === "bouquet" || tipo === "centro_mesa" ? "Prepara el soporte de mesa y asegúralo para que no se vuelque." : "Arma y asegura el soporte con la forma del arco o semiarco.";
  const segundo = tipo === "columna" ? "Infla los globos R-12 y agrúpalos en cuartetos parejos." : tipo === "guirnalda" ? "Infla los globos R-12 y forma grupos compactos de cuatro." : "Infla los globos R-12 con tamaño uniforme.";
  const tercero = tipo === "columna" ? "Monta los grupos desde la base, girando el color en espiral." : tipo === "guirnalda" ? "Sujeta los grupos a la tira y da forma a la curva." : "Distribuye los grupos por toda la estructura.";
  return [
    { orden: 1, texto: primero },
    { orden: 2, texto: segundo },
    { orden: 3, texto: `${tercero} ${patronTexto}` },
    { orden: 4, texto: "Añade los globos de acento y revisa que no queden huecos grandes." },
    { orden: 5, texto: "Asegura cada pieza, comprueba la estabilidad y ajusta la forma antes de recibir a tus invitados." },
  ];
}

async function publicarBibliotecaReal(): Promise<void> {
  const { writeFile: guardar } = await import("node:fs/promises");
  const salida: unknown[] = [];
  const archivos = (await readdir(ANALISIS)).filter((nombre) => nombre.endsWith(".plan.json")).sort();
  for (const archivo of archivos) {
    const planCrudo = record(JSON.parse(await readFile(path.join(ANALISIS, archivo), "utf8")) as unknown);
    if (planCrudo.estado !== "resuelto") continue;
    const idAnalisis = archivo.replace(/\.plan\.json$/, "");
    const indice = Number(/^real-(\d{2})-/.exec(idAnalisis)?.[1] ?? "0") - 1;
    const ficha = FICHAS_CLIENTE[indice];
    if (!ficha) throw new Error(`Falta ficha de cliente para ${idAnalisis}.`);
    const raw = record(JSON.parse(await readFile(path.join(ANALISIS, `${idAnalisis}.json`), "utf8")) as unknown);
    const respuesta = record(raw.respuesta);
    const blueprint = ReferenceBlueprintV2Schema.parse(respuesta.blueprint);
    const planResuelto = record(planCrudo.plan_resuelto);
    const compras = Array.isArray(planResuelto.compras) ? planResuelto.compras.map(record) : [];
    const estructuras = Array.isArray(planResuelto.estructuras) ? planResuelto.estructuras.map(record) : [];
    const materiales = compras.filter((linea) => typeof linea.variant_id === "string" && Number(linea.unidades_necesarias) > 0).map((linea) => ({
      variantId: String(linea.variant_id), sku: typeof linea.sku === "string" ? linea.sku : null,
      cantidad: Number(linea.unidades_necesarias),
      nota: [linea.titulo, linea.tamano_codigo ? String(linea.tamano_codigo) : "R-12", linea.color].filter(Boolean).join(" · "),
    }));
    const piezasPorEstructura = new Map<string, number>();
    for (const estructura of estructuras) {
      const oficial = String(record(estructura.plan).estructura_oficial ?? estructura.estructura_oficial ?? "");
      if (oficial) piezasPorEstructura.set(oficial, (piezasPorEstructura.get(oficial) ?? 0) + Number(estructura.repeticiones ?? 1));
    }
    // Python can return `estructuras` with its declarative piece under `plan`; use that plan field when present.
    if (!piezasPorEstructura.size) {
      const plan = record(planResuelto.plan);
      const declaradas = Array.isArray(plan.estructuras) ? plan.estructuras.map(record) : [];
      for (const estructura of declaradas) {
        const oficial = String(estructura.estructura_oficial ?? "");
        if (oficial) piezasPorEstructura.set(oficial, (piezasPorEstructura.get(oficial) ?? 0) + Number(estructura.repeticiones ?? 1));
      }
    }
    const referenciasDePlan = new Set<string>();
    const planDeclarado = record(planCrudo.plan_declarado);
    for (const pieza of Array.isArray(planDeclarado.estructuras) ? planDeclarado.estructuras.map(record) : []) {
      if (typeof pieza.referencia_element_id === "string") referenciasDePlan.add(pieza.referencia_element_id);
    }
    const paletaMedida = record(respuesta.analisis_color);
    const lecturas = Array.isArray(paletaMedida.piezas) ? paletaMedida.piezas.map(record) : [];
    const hexes = lecturas.filter((pieza) => referenciasDePlan.has(String(pieza.elementId))).flatMap((pieza) =>
      (Array.isArray(pieza.colores) ? pieza.colores.map(record) : []).map((color) => color.hex),
    ).filter((hex): hex is string => typeof hex === "string" && /^#[0-9a-f]{6}$/i.test(hex));
    const coloresPlan = [...new Set(hexes)].slice(0, 5);
    const paleta = coloresPlan;
    const elementos = blueprint.elements.filter((elemento) => referenciasDePlan.has(elemento.element_id));
    const patron = elementos.map((elemento) => elemento.appearance.patron_color?.modo).find((valor) => valor !== undefined) ?? "orgánico";
    const tipos = new Set(elementos.map((elemento) => elemento.visual_semantics?.structure_type ?? "globos"));
    const pasos = pasosDe(tipos.has("columna") ? "columna" : tipos.has("guirnalda") ? "guirnalda" : "arco", patron);
    const fuente = typeof raw.fuente === "string" ? raw.fuente : `${idAnalisis}.jpg`;
    const fotoUrl = `/biblioteca-sempertex/referencias/${idAnalisis}.jpg`;
    const piezas = [...piezasPorEstructura].map(([estructura, cantidad]) => ({ estructura, cantidad }));
    const decoracion = DecoracionSempertexSchema.parse({
      id: `deco-real-${idAnalisis.slice("real-".length)}`, origen: "referencia_real", titulo: ficha.titulo, tematica: ficha.tematica,
      eventos: [...ficha.eventos], edad: ficha.edad,
      fotos: [{ url: fotoUrl, fuente, licencia: "referencia_web_sin_licencia" }], video: null,
      piezas, materiales, pasos, shopifyHandle: null, ...(paleta.length ? { paleta } : {}), fotoRepresentativa: true,
    });
    salida.push(decoracion);
  }
  if (salida.length !== FICHAS_CLIENTE.length) throw new Error(`Biblioteca incompleta: ${salida.length}/${FICHAS_CLIENTE.length} resoluciones publicables.`);
  const destino = path.join(process.cwd(), "src", "lib", "biblioteca-sempertex", "decoraciones.json");
  const existentes: unknown = JSON.parse(await readFile(destino, "utf8"));
  const otros = Array.isArray(existentes) ? existentes.filter((dato) => record(dato).origen !== "referencia_real") : [];
  await guardar(destino, `${JSON.stringify([...otros, ...salida], null, 2)}\n`);
  console.log(`Publicadas ${salida.length} decoraciones reales; ${otros.length} entradas previas preservadas.`);
}

async function main(): Promise<void> {
  exigirEjecucionExplicita();
  for (const archivo of [".env.local", ".env"]) if (existsSync(archivo)) process.loadEnvFile(archivo);
  const databaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  process.env.PYTHON_BACKEND_URL = "http://127.0.0.1:8080";
  await mkdir(ANALISIS, { recursive: true });
  await mkdir(FOTOS, { recursive: true });

  const nombres = (await readdir(ENTRADA, { withFileTypes: true }))
    .filter((entrada) => entrada.isFile() && EXTENSIONES.has(path.extname(entrada.name).toLocaleLowerCase("en")))
    .map((entrada) => entrada.name)
    .sort((a, b) => a.localeCompare(b, "es"));
  const { POST } = await import("../../src/app/api/references/analyze/route");
  const resultados: Array<{ id: string; fuente: string; estado: string }> = [];
  for (const [indice, fuente] of nombres.entries()) {
    const id = `real-${String(indice + 1).padStart(2, "0")}-${nombreSeguro(fuente)}`;
    const salidaFoto = path.join(FOTOS, `${id}.jpg`);
    const original = await readFile(path.join(ENTRADA, fuente));
    const metadatosOriginales = await sharp(original, { animated: false }).metadata();
    const { data: jpeg, info } = await sharp(original, { animated: false })
      .rotate()
      .resize(800, 800, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    await writeFile(salidaFoto, jpeg);

    const imagen = {
      base64: jpeg.toString("base64"),
      mime: "image/jpeg",
      ancho: info.width,
      alto: info.height,
      originalAncho: metadatosOriginales.width ?? info.width,
      originalAlto: metadatosOriginales.height ?? info.height,
    };
    const response = await POST(new Request("http://localhost/api/references/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ images: [imagen], sin_cache: true, proveedor: "gemini" }),
    }));
    const cuerpo: unknown = await response.json();
    await writeFile(path.join(ANALISIS, `${id}.json`), `${JSON.stringify({ id, fuente, imagen_local: `/biblioteca-sempertex/referencias/${id}.jpg`, status: response.status, respuesta: cuerpo }, null, 2)}\n`);
    const estado = response.ok ? "analizada" : `error-${response.status}`;
    resultados.push({ id, fuente, estado });
    console.log(`${id}: ${estado}`);
  }
  await writeFile(path.join(DATOS, "manifiesto.json"), `${JSON.stringify({ version: 1, entrada: "carpeta local privada; solo nombres de archivo", imagenes: resultados }, null, 2)}\n`);
  if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
  await construirPlanesGuardados();
  console.log(`Procesadas ${resultados.length} imágenes en serie. Blueprints, planes y cotizaciones guardados.`);
}

async function ejecutar(): Promise<void> {
  exigirEjecucionExplicita();
  if (process.argv.includes("--solo-resolver")) {
    for (const archivo of [".env.local", ".env"]) if (existsSync(archivo)) process.loadEnvFile(archivo);
    process.env.PYTHON_BACKEND_URL = "http://127.0.0.1:8080";
    await construirPlanesGuardados();
    return;
  }
  if (process.argv.includes("--solo-publicar")) {
    await publicarBibliotecaReal();
    return;
  }
  await main();
}

void ejecutar().catch((error: unknown) => {
  const dato = record(error);
  const detalles = Object.fromEntries(["name", "code", "status", "domainCode", "domainDetails"].filter((clave) => dato[clave] !== undefined).map((clave) => [clave, dato[clave]]));
  console.error(Object.keys(detalles).length ? JSON.stringify(detalles) : error instanceof Error ? error.message : "Error desconocido al construir biblioteca real.");
  process.exitCode = 1;
});
