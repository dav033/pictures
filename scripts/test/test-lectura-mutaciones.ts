/**
 * Cada campo de la lectura que el libro de destinos (`lectura-destinos.ts`) dice que consume el compilador CAMBIA lo que se
 * compila cuando se modifica. Sin coste ni red. El libro es una declaración; esta prueba la verifica: de cada hoja con
 * «compilar» se arma una lectura completa de su pieza, se cambia ese campo (según su tipo en el esquema) y se exige que la
 * ESCENA salga distinta (un cambio que solo toca una nota no cuenta: esos campos van como «nota» y se exige que cambien las notas). Si un campo se anuncia como consumido y no lo es, falla aquí con su nombre.
 *
 * Algunos campos solo cuentan en ciertas condiciones, y la prueba las pone (`CONDICIONES`): `tamanos` solo cuando no hay `mezcla`;
 * el diámetro de un escalón solo si el escalón no nombra su formato; el hex de un color solo si su nombre no está en la tabla;
 * el texto de un fondo, solo en un letrero; el acabado de un fondo, en los pedestales.
 *
 * Los que van solo al agente (`prompt`) se prueban aparte, mirando la línea que ve el modelo.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-lectura-mutaciones.ts
 */
import assert from "node:assert/strict";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { ESQUEMA_LECTURA_FOTO, LecturaFotoSchema, type LecturaFoto, type PiezaLeida } from "../../src/lib/globos3d/lectura-foto";
import { lineaDePiezaLeida, resumenParaAgente, type Modelado } from "../../src/lib/globos3d/modelar-desde-foto";
import { DESTINOS } from "./lectura-destinos";

let pruebas = 0;
const fallos: string[] = [];
const prueba = (nombre: string, fn: () => void) => { try { fn(); } catch (error) { fallos.push(`${nombre}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`); } pruebas += 1; };

type Nodo = { type?: string; items?: Nodo; properties?: Record<string, Nodo & { const?: string }>; oneOf?: Nodo[]; anyOf?: Nodo[]; enum?: unknown[]; minimum?: number; maximum?: number; pattern?: string };

function hojas(n: Nodo, ruta: string, salida: Map<string, Nodo>): void {
  const variantes = n.oneOf ?? n.anyOf;
  if (variantes) {
    const reales = variantes.filter((v) => v.type !== "null");
    if (reales.length === 1) return hojas(reales[0]!, ruta, salida);
    for (const v of reales) { const tipo = v.properties?.tipo?.const; hojas(v, tipo ? `${ruta}<${tipo}>` : ruta, salida); }
    return;
  }
  if (n.type === "array" && n.items) return hojas(n.items, `${ruta}[]`, salida);
  if (n.type === "object" && n.properties) { for (const [k, v] of Object.entries(n.properties)) hojas(v, ruta ? `${ruta}.${k}` : k, salida); return; }
  salida.set(ruta, n);
}
const NODOS = new Map<string, Nodo>();
hojas(ESQUEMA_LECTURA_FOTO as Nodo, "", NODOS);

// ----------------------------------------------------------------------------------------------------------
// Las lecturas completas (una pieza de cada tipo, con todos sus campos)
// ----------------------------------------------------------------------------------------------------------

const DORADO = { nombre: "dorado", hex: "#D4AF37", peso: 60, acabado: "cromado" as const };
const BLANCO = { nombre: "blanco", hex: "#F5F5F5", peso: 40, acabado: "mate" as const };
const MEZCLA = { gigantes: 8, grandes: 22, medianos: 48, chicos: 22, diametroGigante: 0.4, diametroGrande: 0.24, diametroMediano: 0.17, diametroChico: 0.08, formatoGigante: "R-36" as const, formatoGrande: "R-18" as const, formatoMediano: "R-12" as const, formatoChico: "R-5" as const };

const RAIZ: Omit<LecturaFoto, "piezas"> = { resumen: "prueba", aspecto: 1.2, escala: { altoImagenCm: 150, referencia: "prueba" }, pisoY: 0.85, sala: { pared: "#e8e0d0", piso: "#c9b79c" } };

const COMPLETAS: Readonly<Record<PiezaLeida["tipo"], PiezaLeida>> = {
  guirnalda_organica: {
    tipo: "guirnalda_organica", racimos: 0.4, tamanos: {}, mezcla: MEZCLA, colores: [DORADO, BLANCO], follaje: ["monstera"], nota: "un tramo tapado",
    puntos: [
      { x: 0.3, y: 0.6, grosor: 0.26, mezcla: { grandes: 10, medianos: 70, chicos: 20 } }, { x: 0.4, y: 0.4, grosor: 0.28, mezcla: { gigantes: 20, grandes: 20, medianos: 40, chicos: 20 } },
      { x: 0.5, y: 0.32, grosor: 0.3, dominante: "dorado" }, { x: 0.6, y: 0.4, grosor: 0.28 }, { x: 0.7, y: 0.6, grosor: 0.26 },
    ],
    coloresPorEscalon: [{ escalon: "gigantes", pesos: [100, 0] }, { escalon: "chicos", pesos: [30, 70] }],
    anclas: [{ x: 0.42, y: 0.42, escalon: "gigantes", color: "blanco", diametro: 0.4 }, { x: 0.58, y: 0.42, escalon: "grandes", color: "dorado", diametro: 0.24 }],
  },
  columna_organica: { tipo: "columna_organica", forma: "racimos", x: 0.2, yBase: 0.85, yArriba: 0.35, ancho: 0.25, grosor: 0.2, tamanos: {}, mezcla: MEZCLA, racimos: 0.4, colores: [DORADO, BLANCO], nota: "se corta arriba" },
  racimo_piso: { tipo: "racimo_piso", anclas: [{ x: 0.5, y: 0.88, escalon: "gigantes", color: "blanco", diametro: 0.4 }, { x: 0.45, y: 0.9, escalon: "grandes", color: "dorado", diametro: 0.24 }], x: 0.5, yPie: 0.97, yArriba: 0.8, ancho: 0.3, tamanos: {}, mezcla: MEZCLA, racimos: 0.5, coloresPorEscalon: [{ escalon: "chicos", pesos: [100, 0] }], colores: [DORADO, BLANCO], nota: "más cerca de la cámara" },
  columna_clasica: { tipo: "columna_clasica", x: 0.2, yBase: 0.85, yArriba: 0.4, colores: [DORADO, BLANCO], nota: "dos colores" },
  guirnalda_clasica: { tipo: "guirnalda_clasica", x1: 0.2, x2: 0.8, y: 0.3, caida: 0.1, colores: [DORADO, BLANCO], nota: "cuelga" },
  globo: { tipo: "globo", x: 0.5, y: 0.5, diametro: 0.2, en: "aire", colores: [DORADO], nota: "suelto" },
  ramo_helio: { tipo: "ramo_helio", x: 0.5, yBase: 0.85, yArriba: 0.4, cantidad: 4, colores: [DORADO, BLANCO], nota: "atado" },
  decoracion: { tipo: "decoracion", id: "orbe_flecos_dorado", x: 0.5, y: 0.5, cantidad: 2, colores: [DORADO], nota: "dos orbes" },
  metalizado: { tipo: "metalizado", texto: "LOVE", cursiva: false, x: 0.5, y: 0.5, alto: 0.2, colores: [DORADO], nota: "foil" },
  fondo: { tipo: "fondo", id: "panel_redondo", x: 0.5, yBase: 0.85, ancho: 0.5, alto: 0.5, texto: "Hola", colorTexto: "negro", acabadoTexto: "cromado", cantidad: 3, colores: [DORADO, BLANCO], nota: "panel" },
  otro: { tipo: "otro", descripcion: "una torta de tres pisos" },
};

type Variante = { id: "nada" | "sin_mezcla" | "sin_formatos" | "nombre_desconocido" | "letrero" | "pedestales" | "lentejuelas" | "sin_gigantes" | "silla" | "juego"; prepara: (p: PiezaLeida) => void };
const VARIANTES: Readonly<Record<Variante["id"], Variante["prepara"]>> = {
  nada: () => undefined,
  /** `tamanos` solo cuenta sin `mezcla`. */
  sin_mezcla: (p) => { if ("mezcla" in p) { delete p.mezcla; (p as { tamanos: Record<string, number> }).tamanos = { "R-36": 5, "R-24": 15, "R-18": 10, "R-12": 40, "R-9": 10, "R-5": 20 }; } },
  /** El diámetro de un escalón solo manda si el escalón no nombra su formato. */
  sin_formatos: (p) => { if ("mezcla" in p && p.mezcla) { delete p.mezcla.formatoGigante; delete p.mezcla.formatoGrande; delete p.mezcla.formatoMediano; delete p.mezcla.formatoChico; } },
  /** El hex solo manda si el nombre del color no está en la tabla (se busca el más parecido). */
  nombre_desconocido: (p) => { if ("colores" in p) p.colores.forEach((c, i) => { c.nombre = `color de fantasía ${i}`; c.acabado = "mate"; }); },
  letrero: (p) => { if (p.tipo === "fondo") p.id = "letrero"; },
  pedestales: (p) => { if (p.tipo === "fondo") p.id = "pedestales"; },
  /** Con gigantes en la mezcla, el cuerpo no baja de lo que piden (R-36: ~1,1 m): el grosor leído solo manda sin ellos. */
  sin_gigantes: (p) => {
    if ("mezcla" in p && p.mezcla) { p.mezcla.gigantes = 0; delete p.mezcla.diametroGigante; delete p.mezcla.formatoGigante; p.mezcla.medianos += 8; }
    if (p.tipo === "guirnalda_organica") { p.puntos.forEach((q) => { if (q.mezcla) { q.mezcla.medianos += q.mezcla.gigantes ?? 0; delete q.mezcla.gigantes; } }); delete p.anclas; delete p.coloresPorEscalon; }
  },
  /** El panel redondo solo usa su alto (es un círculo): el ancho cuenta en los fondos que son rectángulos. */
  lentejuelas: (p) => { if (p.tipo === "fondo") p.id = "lentejuelas"; },
  /** Las cajas solo cuentan en un juego de pedestales: cada cuerpo detectado se arma en su sitio. */
  juego: (p) => { if (p.tipo === "fondo") { p.id = "pedestales"; p.cajas = [{ x: 0.3, yBase: 0.9, ancho: 0.3, alto: 0.3 }, { x: 0.55, yBase: 0.95, ancho: 0.3, alto: 0.35 }]; } },
  /** `cantidad` solo cuenta en los muebles de piso (varios iguales en fila): un panel es uno solo. */
  silla: (p) => { if (p.tipo === "fondo") p.id = "silla_tiffany"; },
};

/** Las condiciones en que cuenta cada hoja que no cuenta siempre (por su ruta sin el `piezas[]<tipo>.`). */
function condicionDe(ruta: string): Variante["id"] {
  if (/[.]tamanos[.]/.test(ruta)) return "sin_mezcla";
  if (/\.mezcla\.diametro/.test(ruta)) return "sin_formatos";
  if (/\.colores\[\]\.hex$/.test(ruta) && !ruta.includes("<fondo>")) return "nombre_desconocido";
  if (ruta === "piezas[]<fondo>.texto") return "letrero";
  if (ruta === "piezas[]<fondo>.colores[].acabado") return "pedestales";
  if (ruta === "piezas[]<fondo>.ancho") return "lentejuelas";
  if (ruta === "piezas[]<fondo>.cantidad") return "silla";
  if (ruta.startsWith("piezas[]<fondo>.cajas[]")) return "juego";
  if (ruta === "piezas[]<guirnalda_organica>.puntos[].grosor" || ruta === "piezas[]<columna_organica>.grosor") return "sin_gigantes";
  return "nada";
}

// ----------------------------------------------------------------------------------------------------------
// Cambiar una hoja
// ----------------------------------------------------------------------------------------------------------

/** Los pasos de una ruta dentro de la pieza: `puntos[].mezcla.grandes` → ["puntos", 1, "mezcla", "grandes"]. */
function pasos(ruta: string): Array<string | number> {
  const resto = ruta.replace(/^piezas\[\]<[a-z_]+>\./, "");
  return resto.split(".").flatMap((t) => (t.endsWith("[]") ? [t.slice(0, -2), t.startsWith("puntos") ? 1 : 0] : [t]));
}

const OTRO_HEX = (hex: string) => (hex.toLowerCase() === "#808080" ? "#204060" : "#808080");

/** Un valor distinto y válido para la hoja (según su tipo en el esquema y, donde hace falta, lo que la distingue). */
function otroValor(ruta: string, actual: unknown, nodo: Nodo): unknown {
  const campo = ruta.split(".").pop()!.replace("[]", "");
  if (ruta.endsWith("colores[].nombre")) return actual === "dorado" ? "plata" : "dorado";
  if (ruta.endsWith("colores[].acabado")) return actual === "cromado" ? "mate" : "cromado";
  if (campo === "color" || campo === "dominante") return actual === "dorado" ? "blanco" : "dorado";
  if (campo === "follaje") return "palma";
  if (campo === "colorTexto") return actual === "negro" ? "dorado" : "negro";
  if (campo === "texto" || campo === "descripcion" || campo === "nota" || campo === "resumen") return `${String(actual)} otra`;
  if (campo === "id" && ruta.includes("<decoracion>")) return "racimo_uvas_dorado";
  if (campo === "caida") return 0.25;
  if (nodo.type === "boolean") return !(actual as boolean);
  if (nodo.enum) { const i = nodo.enum.indexOf(actual); return nodo.enum[(i + 1) % nodo.enum.length]; }
  if (nodo.pattern) return OTRO_HEX(String(actual));
  if (nodo.type === "number" || nodo.type === "integer") {
    const v = actual as number, min = nodo.minimum ?? -Infinity, max = nodo.maximum ?? Infinity;
    // Los diámetros pasan a otro formato solo si cambian lo bastante.
    const factores = campo.startsWith("diametro") ? [2.3, 0.45] : campo === "grosor" ? [2.2, 0.7] : campo === "ancho" ? [1.4, 0.7] : [0.7, 1.4];
    for (const f of factores) { const n = nodo.type === "integer" ? Math.round(v * f) : Math.round(v * f * 1000) / 1000; if (n !== v && n >= min && n <= max) return n; }
    const n = nodo.type === "integer" ? v + 1 : v + 0.1;
    return n <= max ? n : v - (nodo.type === "integer" ? 1 : 0.1);
  }
  throw new Error(`sin forma de cambiar ${ruta}`);
}

function colocar(pieza: unknown, ruta: string, nodo: Nodo): void {
  const camino = pasos(ruta);
  let actual = pieza as Record<string | number, unknown>;
  for (const p of camino.slice(0, -1)) actual = actual[p] as Record<string | number, unknown>;
  const ultimo = camino[camino.length - 1]!;
  actual[ultimo] = otroValor(ruta, actual[ultimo], nodo);
}

const huella = (l: LecturaFoto) => {
  const valida = LecturaFotoSchema.safeParse(l);
  assert.ok(valida.success, valida.success ? "" : valida.error.issues.slice(0, 2).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const c = compilarLectura(valida.data);
  return { escena: JSON.stringify(c.escena), notas: JSON.stringify({ notas: c.notas, omitidas: c.omitidas }) };
};
type Huella = ReturnType<typeof huella>;

const lecturaDe = (pieza: PiezaLeida, variante: Variante["id"]): LecturaFoto => {
  const p = structuredClone(pieza);
  VARIANTES[variante](p);
  return { ...structuredClone(RAIZ), piezas: [p] };
};
const base = new Map<string, Huella>();
const huellaBase = (tipo: PiezaLeida["tipo"], variante: Variante["id"]) => {
  const k = `${tipo}|${variante}`;
  if (!base.has(k)) base.set(k, huella(lecturaDe(COMPLETAS[tipo], variante)));
  return base.get(k)!;
};

// ----------------------------------------------------------------------------------------------------------
// Una prueba por hoja que dice «compilar»
// ----------------------------------------------------------------------------------------------------------

type Destinos = (typeof DESTINOS)[keyof typeof DESTINOS];
const consume = (d: Destinos, quien: string) => !("ignorado" in d) && (d as readonly string[]).includes(quien);
/** Lo que se compara según el destino: la ESCENA para «compilar»; las notas y las piezas omitidas para «nota». */
const parteDe = (ruta: string): keyof Huella => (consume(DESTINOS[ruta as keyof typeof DESTINOS], "compilar") ? "escena" : "notas");
const hojasAProbar = Object.entries(DESTINOS).filter(([, d]) => consume(d, "compilar") || consume(d, "nota")).map(([ruta]) => ruta);

console.log(`Mutación de ${hojasAProbar.length} campos declarados como consumidos por el compilador (la escena) o por sus notas`);
for (const ruta of hojasAProbar) {
  if (ruta.endsWith(".tipo")) continue; // el discriminante: sin él la pieza no se arma (lo prueban todas las demás)
  const tipo = ruta.match(/^piezas\[\]<([a-z_]+)>/)?.[1] as PiezaLeida["tipo"] | undefined;
  const nodo = NODOS.get(ruta);
  assert.ok(nodo, `${ruta}: no está en el esquema`);
  const variante = condicionDe(ruta);
  prueba(ruta, () => {
    if (tipo === undefined) {
      const l = { ...structuredClone(RAIZ), piezas: [structuredClone(COMPLETAS.guirnalda_organica), structuredClone(COMPLETAS.fondo)] };
      const antes = huella(l);
      const camino = ruta.split(".");
      let a = l as unknown as Record<string, unknown>;
      for (const p of camino.slice(0, -1)) a = a[p] as Record<string, unknown>;
      a[camino[camino.length - 1]!] = otroValor(ruta, a[camino[camino.length - 1]!], nodo);
      assert.notEqual(huella(l)[parteDe(ruta)], antes[parteDe(ruta)], `${ruta}: cambiarlo no cambia ${parteDe(ruta) === "escena" ? "la escena" : "las notas"}`);
      return;
    }
    const l = lecturaDe(COMPLETAS[tipo], variante);
    colocar(l.piezas[0], ruta, nodo);
    assert.notEqual(huella(l)[parteDe(ruta)], huellaBase(tipo, variante)[parteDe(ruta)], `${ruta}: cambiarlo no cambia ${parteDe(ruta) === "escena" ? "la escena" : "las notas"}`);
  });
}
assert.deepEqual(fallos, [], `campos que el libro dice consumidos y no cambian lo compilado:\n  ${fallos.join("\n  ")}`);
console.log(`  ✓ ${pruebas} campos cambian la escena o las notas, según su destino`);

// Lo ignorado de verdad se ignora: si cambiarlo cambia lo compilado, el libro está desactualizado.
for (const [ruta, d] of Object.entries(DESTINOS)) {
  if (!("ignorado" in d)) continue;
  const tipo = ruta.match(/^piezas\[\]<([a-z_]+)>/)![1] as PiezaLeida["tipo"];
  prueba(`ignorado: ${ruta}`, () => {
    const l = lecturaDe(COMPLETAS[tipo], "nada");
    colocar(l.piezas[0], ruta, NODOS.get(ruta)!);
    const antes = huellaBase(tipo, "nada"), despues = huella(l);
    assert.ok(despues.escena === antes.escena && despues.notas === antes.notas, `${ruta}: está declarado ignorado y cambia lo compilado`);
  });
}
assert.deepEqual(fallos, [], `el libro está desactualizado: ${fallos.join(" | ")}`);

// ----------------------------------------------------------------------------------------------------------
// Lo que ve el agente
// ----------------------------------------------------------------------------------------------------------

console.log("Lo que ve el agente");
const alto = RAIZ.escala.altoImagenCm;
const consumeAgente = (d: (typeof DESTINOS)[keyof typeof DESTINOS]) => !("ignorado" in d) && (d as readonly string[]).includes("prompt");
const hojasDelAgente = Object.entries(DESTINOS).filter(([, d]) => consumeAgente(d)).map(([ruta]) => ruta).filter((r) => r !== "resumen" && r !== "escala.referencia" && !r.endsWith(".tipo"));
let delAgente = 0;
for (const ruta of hojasDelAgente) {
  const tipo = ruta.match(/^piezas\[\]<([a-z_]+)>/)?.[1] as PiezaLeida["tipo"];
  const nodo = NODOS.get(ruta)!;
  const antes = structuredClone(COMPLETAS[tipo]);
  const despues = structuredClone(COMPLETAS[tipo]);
  colocar(despues, ruta, nodo);
  assert.notEqual(lineaDePiezaLeida(despues, 0, alto), lineaDePiezaLeida(antes, 0, alto), `${ruta}: no cambia lo que ve el agente`);
  delAgente++;
}
const modelado = (l: LecturaFoto) => ({ lectura: l, omitidas: [], descartadas: [], notas: [], plantillas: [] }) as unknown as Modelado;
const l0 = lecturaDe(COMPLETAS.guirnalda_organica, "nada");
prueba("resumen y escala.referencia", () => {
  const l1 = { ...structuredClone(l0), resumen: "otro resumen", escala: { ...l0.escala, referencia: "otra referencia" } };
  const a = resumenParaAgente(modelado(l0), "listo"), b = resumenParaAgente(modelado(l1), "listo");
  assert.ok(b.includes("otro resumen") && b.includes("otra referencia") && !a.includes("otro resumen"));
});
console.log(`  ✓ ${delAgente + 1} campos cambian lo que ve el agente`);

console.log(`test-lectura-mutaciones: ${pruebas} pruebas ok`);
