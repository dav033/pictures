/**
 * Arreglos de raíz del banco de fotos de ejemplo (línea base 2026-10-06, 6/10 clásica y 4/10 guiada). Sin red, sin
 * proveedores ni Python: cada caso prueba la regla pura que corrige un defecto del banco.
 *
 * 1. Talla inexistente (foto 04): la escalera de diámetros llega al 36 y el globo de la punta sin talla se quita.
 * 2. «catalog color» (09, 10): un material sin color toma el del producto.
 * 3. Pasteles (06, 09): el texto de FLUX sigue al producto comprado y un tono pastel no se compra vivo.
 * 4. Vino y oro rosa (07): otro producto del mismo color con los tamaños; «rose gold» con el rosa delante.
 * 5. Proporción (01, 02): la medida no manda cuando pone delante un neutro que la lectura no.
 * 6. Cintas (10): las cintas dichas dentro de una pieza salen como escenografía.
 *
 * Run: npx tsx scripts/test/test-banco-color-talla.ts
 */
import assert from "node:assert/strict";
import { mezclasCompatiblesConDiametros, reglasMezclas } from "../../src/lib/plan/mezclas";
import { ajustarCoberturaPlan, aplicarAcabadoReferencia, busquedasDeAcabado, busquedasDeMismoColor, coloresSinTamanos, type DisponibilidadProducto } from "../../src/lib/plan/cobertura-materiales";
import { sinCoronaSinCobertura } from "../../src/lib/ia/herramientas/convergencia-plan";
import { esReferenciaPastel, esReferenciaViva, referenciaDelCatalogo, referenciaDelTitulo } from "../../src/lib/plan/referencia-sempertex";
import { colorDeReferencia, colorVisible } from "../../src/lib/ia/kagutsuchi/vocabulario-base";
import { acabadosObservadosDeMateriales, coloresConAcabadoReferencia, partesDeColorPieza } from "../../src/lib/plan/colores-referencia";
import { conCintasDeLasPiezas } from "../../src/lib/ia/referencia/cintas-de-pieza";
import { sustitucionesCliente } from "../../src/lib/plan/presentacion-cliente";
import type { PlanDecoracion } from "../../src/lib/plan/tipos";
import type { ReferenceBlueprintV2 } from "../../src/lib/ia/referencia/reference-blueprint";

let casos = 0;
function ok(nombre: string): void {
  casos += 1;
  console.log(`ok ${casos} - ${nombre}`);
}

type Estructura = PlanDecoracion["estructuras"][number];
type Material = Estructura["materiales"][number];

function estructura(parcial: Partial<Estructura> & { materiales: Material[] }): Estructura {
  return {
    estructura_id: "EST_01_ARCO",
    nombre: "Arco orgánico",
    tipo: "arco",
    rol_escena: "focal",
    ubicacion: "arco_central",
    medidas: {},
    repeticiones: 1,
    densidad: "media",
    mezcla: "organica_fina",
    porque: "Marco principal.",
    ...parcial,
  } as Estructura;
}

function plan(estructuras: Estructura[]): PlanDecoracion {
  return { plan_version: "1.0", plan_id: "p", concepto: { titulo: "t", descripcion: "d", paleta: [] }, estructuras, supuestos: [] } as unknown as PlanDecoracion;
}

const TODAS = [5, 9, 12, 18, 24];
function producto(titulo: string, colores: string[], diametros: number[], acabados: string[]): DisponibilidadProducto {
  return { titulo, categoria: "globo_latex", colores, coloresVariante: colores, mezclas: mezclasCompatiblesConDiametros(diametros), acabados };
}

// ── 1. Talla inexistente ────────────────────────────────────────────────────────────────────────────────────────
{
  const reglas = reglasMezclas();
  assert.deepEqual(reglas.diametros_estandar, [5, 9, 12, 18, 24, 36]);
  assert.deepEqual(reglas.sustituciones_admisibles["36"], [24]);
  // Ninguna mezcla cambia de cobertura: el 36 no lo pide ninguna, solo lo sirve el 24 (y al revés).
  assert.deepEqual(mezclasCompatiblesConDiametros(TODAS), ["clasica", "organica_fina", "organica_gruesa", "solo_grandes"]);
  ok("la escalera de diámetros llega al 36 y el R-36 se sirve con el R-24");

  const armado = {
    version: "armado-columna-organica.v1",
    origen: "referencia",
    forma: { altoM: 1.8, inclinacionM: 0, serpenteoM: 0, ondulacion: 0.2, suelo: true, persona: true },
    volumen: { grosorPatasM: 1.1, grosorCimaM: 0.935, irregularidad: 0.55, relleno: 0.9, racimo: 5, salientes: 0.55 },
    tamanos: { mezcla: { 5: 0, 9: 25, 12: 45, 18: 20, 24: 10, 36: 0 }, grandesAbajo: 0.4, inflado: 1, variacion: 0.1 },
    colores: { paleta: [{ material: 0, peso: 100, acabado: "cromado", rol: "normal" }], reparto: "azar", mezcla: 0.5 },
    adornos: { follaje: 0.6, flores: 0 },
    aspecto: { brillo: 0.6, sombra: 0.2, contorno: 0.8, profundidad: 0.5, semilla: 6 },
    corona: { activa: true, tamano: 24, material: 0 },
  };
  const columna = estructura({
    estructura_id: "EST_01_COLUMNA", nombre: "Columna orgánica dorada", tipo: "columna",
    materiales: [{ product_id: "dorado", color: "dorado", acabado: "reflex", participacion: 1, rol_material: "principal" }],
    armado_columna_organica: armado,
  } as unknown as Partial<Estructura> & { materiales: Material[] });
  const sinCorona = sinCoronaSinCobertura(plan([columna]), [{ estructura_id: "EST_01_COLUMNA", product_id: "dorado", tamano: "R-36" }]);
  assert.equal(sinCorona.cambiado, true);
  assert.equal(sinCorona.plan.estructuras[0]!.armado_columna_organica?.corona.activa, false);
  assert.match(sinCorona.avisos[0]!, /dorado de 36" para el globo grande de la punta de columna orgánica dorada/);
  // Una talla de la mezcla no es la del globo de la punta: eso lo arregla la mezcla o el producto.
  assert.equal(sinCoronaSinCobertura(plan([columna]), [{ estructura_id: "EST_01_COLUMNA", product_id: "dorado", tamano: "R-12" }]).cambiado, false);
  ok("con el Python de producción, el globo de la punta sin talla sale y la columna converge con aviso");

  const textos = sustitucionesCliente([{ estructura_id: "EST_01_COLUMNA", pedido: "R-36", entregado: "R-24" }], new Map([["EST_01_COLUMNA", "la columna orgánica dorada"]]));
  assert.equal(textos.length, 1);
  assert.match(textos[0]!, /la columna orgánica dorada.*36.*24/);
  ok("la talla más cercana se le dice al cliente");
}

// ── 2. «catalog color» ──────────────────────────────────────────────────────────────────────────────────────────
{
  const disponibilidad = new Map([
    ["gris", producto("B2b Globo Latex Redondo Fashion Gris", ["gris"], TODAS, ["fashion"])],
    ["duo", producto("B2b Globo Latex Redondo Duo Plata", ["plateado", "blanco"], TODAS, [])],
  ]);
  const { plan: ajustado, ajustes } = ajustarCoberturaPlan(plan([estructura({ materiales: [
    { product_id: "gris", participacion: 0.6, rol_material: "principal" },
    { product_id: "duo", participacion: 0.4, rol_material: "secundario" },
  ] })]), disponibilidad);
  assert.equal(ajustado.estructuras[0]!.materiales[0]!.color, "gris");
  assert.equal(ajustado.estructuras[0]!.materiales[1]!.color, undefined, "un producto de dos colores no elige uno");
  assert.deepEqual(ajustes, [{ tipo: "color_catalogo", estructura_id: "EST_01_ARCO", product_id: "gris", color: "gris" }]);
  ok("un material sin color toma el del producto de un solo color");
}

// ── 3. Pasteles ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const pastel = referenciaDelTitulo("B2b Globo Latex Redondo Pastel Mate Azul", "soft matte");
  assert.equal(pastel?.codigo, "640");
  assert.equal(referenciaDelTitulo("B2b Globo Latex Redondo Fashion Azul", "soft matte")?.codigo, "040");
  assert.equal(referenciaDelTitulo("B2b Globo Latex Redondo Reflex Dorado Rosa", null)?.codigo, "968");
  // La familia que la tienda antepone al tono compuesto no es otro tono (foto 10: «Azul Turquesa Profundo»).
  assert.equal(referenciaDelTitulo("B2b Globo Latex Redondo Fashion Azul Turquesa Profundo", null)?.codigo, "035");
  assert.equal(referenciaDelTitulo("B2b Globo Latex Redondo Duo Rosa Azul", null), null);
  const texto = colorDeReferencia(pastel!);
  assert.doesNotMatch(texto, /vivid|cyan/);
  assert.match(texto, /pale blue \(#A3D1ED\)/i);
  assert.match(colorDeReferencia(referenciaDelCatalogo("azul", "fashion")!), /vivid cyan blue/);
  assert.equal(esReferenciaViva(pastel!), false);
  assert.equal(esReferenciaViva(referenciaDelCatalogo("azul", "fashion")!), true);
  ok("el texto de FLUX dice el azul del producto comprado: un Pastel Mate Azul es «pale blue», no «vivid cyan»");

  const blueprint = {
    elements: [{
      element_id: "REF_01_E01", approved: true,
      appearance: { observed_colors: ["matte light blue", "matte white", "chrome gold"] },
    }],
  } as unknown as ReferenceBlueprintV2;
  const arco = estructura({ referencia_element_id: "REF_01_E01", materiales: [
    { product_id: "azul", color: "azul", participacion: 0.5, rol_material: "principal" },
    { product_id: "blanco", color: "blanco", participacion: 0.5, rol_material: "secundario" },
  ] } as Partial<Estructura> & { materiales: Material[] });
  const esperados = acabadosObservadosDeMateriales([arco], blueprint);
  assert.deepEqual(esperados.find((item) => item.product_id === "azul")?.acabado, "pastel");
  const conFashion = new Map([
    ["azul", producto("B2b Globo Latex Redondo Fashion Azul", ["azul"], TODAS, ["fashion", "mate"])],
    ["blanco", producto("B2b Globo Latex Redondo Fashion Blanco", ["blanco"], TODAS, ["fashion", "mate"])],
  ]);
  assert.deepEqual(busquedasDeAcabado(plan([arco]), esperados, conFashion), ["globo latex redondo pastel mate azul"]);
  const conPastel = new Map([...conFashion, ["azul-pastel", producto("B2b Globo Latex Redondo Pastel Mate Azul", ["azul"], TODAS, ["mate"])]]);
  const cambiado = aplicarAcabadoReferencia(plan([arco]), esperados, conPastel);
  assert.equal(cambiado.plan.estructuras[0]!.materiales[0]!.product_id, "azul-pastel");
  assert.equal(cambiado.ajustes[0]?.tipo, "acabado_referencia");
  // Un rosa que ya es claro (Fashion Rosado) cumple el pastel: no se toca.
  const rosado = estructura({ referencia_element_id: "REF_01_E01", materiales: [{ product_id: "rosado", color: "azul", participacion: 1, rol_material: "principal" }] } as Partial<Estructura> & { materiales: Material[] });
  const claro = aplicarAcabadoReferencia(plan([rosado]), [{ estructura_id: "EST_01_ARCO", product_id: "rosado", acabado: "pastel" }], new Map([["rosado", producto("B2b Globo Latex Redondo Fashion Rosado", ["rosado"], TODAS, ["fashion"])]]));
  assert.deepEqual(claro.ajustes, []);
  // «No vivo» no basta: un azul naval tampoco es pastel (banco de fotos 09, segunda corrida).
  const naval = estructura({ referencia_element_id: "REF_01_E01", materiales: [{ product_id: "naval", color: "azul", participacion: 1, rol_material: "principal" }] } as Partial<Estructura> & { materiales: Material[] });
  const sinNaval = aplicarAcabadoReferencia(plan([naval]), [{ estructura_id: "EST_01_ARCO", product_id: "naval", acabado: "pastel" }], new Map([
    ["naval", producto("B2b Globo Latex Redondo Fashion Azul Naval", ["azul"], TODAS, ["fashion", "mate"])],
    ["azul-pastel", producto("B2b Globo Latex Redondo Pastel Mate Azul", ["azul"], TODAS, ["mate"])],
  ]));
  assert.equal(sinNaval.plan.estructuras[0]!.materiales[0]!.product_id, "azul-pastel");
  assert.equal(esReferenciaPastel(referenciaDelTitulo("B2b Globo Latex Redondo Fashion Azul Naval", null)!), false);
  assert.equal(esReferenciaPastel(referenciaDelTitulo("B2b Globo Latex Redondo Neon Naranja", null)!), false);
  assert.equal(esReferenciaPastel(referenciaDelTitulo("B2b Globo Latex Redondo Fashion Durazno", null)!), true);
  ok("un tono pastel de la foto no se compra en un color vivo ni oscuro: el Fashion Azul o el Azul Naval cambian por el Pastel Mate Azul");
}

// ── 4. Vino y oro rosa ──────────────────────────────────────────────────────────────────────────────────────────
{
  const vinotinto = producto("B2b Globo Latex Redondo Metal Vinotinto", ["burdeos"], [9], ["metal"]);
  const merlot = producto("B2b Globo Latex Redondo Fashion Merlot", ["burdeos"], TODAS, ["fashion"]);
  const plata = producto("B2b Globo Latex Redondo Reflex Plata", ["plateado"], TODAS, ["reflex"]);
  const arco = estructura({ materiales: [
    { product_id: "plata", color: "plateado", acabado: "reflex", participacion: 0.6, rol_material: "principal" },
    { product_id: "vinotinto", color: "burdeos", participacion: 0.4, rol_material: "secundario" },
  ] });
  // Sin el Merlot en el turno: el servidor lo pide al catálogo por color y lo busca por su título.
  const turno = new Map([["plata", plata], ["vinotinto", vinotinto]]);
  const faltan = coloresSinTamanos(plan([arco]), turno);
  assert.deepEqual(faltan, [{ color: "burdeos", mezclas: ["organica_fina", "organica_gruesa"] }]);
  const catalogo = new Map([["burdeos", [
    { product_id: "vinotinto", titulo: "B2b Globo Latex Redondo Metal Vinotinto", diametros: [9] },
    { product_id: "merlot", titulo: "B2b Globo Latex Redondo Fashion Merlot", diametros: TODAS },
  ]]]);
  assert.deepEqual(busquedasDeMismoColor(faltan, catalogo, turno), ["globo latex redondo fashion merlot"]);
  // Aunque el modelo deje el material sin color (guiada de la foto 07): el color es el del producto.
  const sinColor = estructura({ materiales: [{ ...arco.materiales[0]! }, { product_id: "vinotinto", participacion: 0.4, rol_material: "secundario" }] });
  assert.deepEqual(coloresSinTamanos(plan([sinColor]), turno), faltan);
  // Con el Merlot en el turno: el vino se compra como Merlot en vez de quitarse.
  const { plan: ajustado, ajustes } = ajustarCoberturaPlan(plan([arco]), new Map([...turno, ["merlot", merlot]]));
  assert.deepEqual(ajustado.estructuras[0]!.materiales.map((material) => material.product_id), ["plata", "merlot"]);
  assert.equal(ajustado.estructuras[0]!.mezcla, "organica_fina");
  assert.ok(ajustes.some((ajuste) => ajuste.tipo === "producto_mismo_color" && ajuste.despues === "merlot"));
  assert.ok(!ajustes.some((ajuste) => ajuste.tipo === "material_quitado"));
  // Sin ningún burdeos que la arme, se quita con aviso, como antes.
  const sinMerlot = ajustarCoberturaPlan(plan([arco]), turno);
  assert.ok(sinMerlot.ajustes.some((ajuste) => ajuste.tipo === "material_quitado" && ajuste.color === "burdeos"));
  ok("el vino se busca como tal: un burdeos sin tamaños se cambia por el Fashion Merlot del catálogo");

  assert.equal(colorDeReferencia(referenciaDelCatalogo("dorado rosa", "reflex")!), "pink rose gold");
  assert.equal(colorVisible("rose gold"), "pink rose gold");
  assert.equal(colorVisible("pink rose gold"), "pink rose gold");
  ok("el oro rosa llega a FLUX como «pink rose gold», con el rosa delante");
}

// ── 5. Proporción ───────────────────────────────────────────────────────────────────────────────────────────────
{
  // Foto 02 (clásica de la línea base): la caja mide los paneles crema como beige.
  const foto02 = {
    observed_colors: ["matte light pink", "chrome gold", "matte dusty rose", "matte sand", "matte white"],
    measured_colors: [{ color: "beige", share: 0.4353 }, { color: "blanco", share: 0.2796 }, { color: "rosado", share: 0.1724 }],
    patron_color: { modo: "bloques", colores: ["rosado", "dorado", "rosado", "beige"], pesos: [35, 25, 25, 15], confianza: 0.92 },
  };
  const partes02 = partesDeColorPieza(foto02);
  assert.equal(partes02.fuente, "disposicion");
  assert.deepEqual(partes02.partes.map((parte) => parte.color), ["rosado", "dorado", "beige"]);
  assert.equal(coloresConAcabadoReferencia(foto02)[0]?.color, "rosado");
  // Foto 01: el blanco perlado bajo luz morada se mide plata.
  const foto01 = {
    observed_colors: ["matte pastel pink", "chrome silver", "pearl white", "clear"],
    measured_colors: [{ color: "plateado", share: 0.5703 }, { color: "blanco", share: 0.2659 }, { color: "rosado", share: 0.0983 }],
    patron_color: { modo: "aleatorio", colores: ["rosado", "plateado", "blanco"], pesos: [50, 30, 20], confianza: 0.9 },
  };
  assert.equal(partesDeColorPieza(foto01).partes[0]?.color, "rosado");
  // Cuando la medida pone delante un color con tono, manda la medida aunque la lectura no coincida.
  const coral = { ...foto01, observed_colors: ["matte coral", "matte pink"], measured_colors: [{ color: "coral", share: 0.5 }, { color: "rosado", share: 0.3 }], patron_color: { modo: "aleatorio", colores: ["rosado", "coral"], pesos: [60, 40], confianza: 0.9 } };
  assert.equal(partesDeColorPieza(coral).fuente, "medida");
  // Y con una lectura poco segura, también.
  assert.equal(partesDeColorPieza({ ...foto02, patron_color: { ...foto02.patron_color, confianza: 0.3 } }).fuente, "medida");
  // Y con una lectura que habla de otros colores (menos del 60 % de su peso en los nombrados): foto 09.
  const foto09 = {
    observed_colors: ["matte pastel orange", "matte mint green", "matte pastel blue", "chrome gold", "matte grey"],
    measured_colors: [{ color: "gris", share: 0.5378 }, { color: "menta", share: 0.1242 }, { color: "dorado", share: 0.0751 }],
    patron_color: { modo: "aleatorio", colores: ["rosado", "blanco", "azul", "dorado"], pesos: [40, 30, 15, 15], confianza: 0.9 },
  };
  assert.equal(partesDeColorPieza(foto09).fuente, "medida");
  ok("la proporción no sigue a un neutro que la medida pone delante y la lectura de la disposición no");
}

// ── 6. Cintas ───────────────────────────────────────────────────────────────────────────────────────────────────
{
  const techo = {
    element_id: "REF_01_E01", source_image_id: "REF_01", name: "ceiling_balloon_installation_01", category: "balloon_structure",
    scene_role: "midground", detection_confidence: 0.98,
    visible_evidence: "Dense organic mass of balloons hung overhead featuring orange streamer ribbons hanging underneath.",
    reference_bbox: { x: 0, y: 0, width: 1, height: 1 }, depth_layer: 2, include_policy: "include", approved: true, source_type: "reference_only",
    quantity: { mode: "exact", min: 1, max: 1 },
    appearance: { observed_colors: ["matte orange"], resolved_colors: [], color_policy: "adapt_to_event_palette", material: "latex", shape: "cloud", composition: "single uniform material" },
    relationships: [], uncertainties: [], visual_semantics: { structure_type: "guirnalda", placement: "techo", design_role: "focal", repetition_group: "REF_01_E01", density: "lujosa" },
  };
  const blueprint = { schema_version: "2.0", source_images: [], elements: [techo], composition: {}, palette: { observed: [], priority: [] }, unresolved_decisions: [] } as unknown as ReferenceBlueprintV2;
  const conCintas = conCintasDeLasPiezas(blueprint);
  assert.equal(conCintas.elements.length, 2);
  assert.equal(conCintas.elements[1]!.name, "hanging ribbon streamers");
  assert.equal(conCintas.elements[1]!.category, "other");
  // Una lectura que ya trae las cintas como elemento no se toca.
  assert.equal(conCintasDeLasPiezas(conCintas).elements.length, 2);
  // Las cintas de un bouquet de helio son su armado, no escenografía.
  const bouquet = { ...techo, visual_semantics: { ...techo.visual_semantics, structure_type: "kit" } };
  assert.equal(conCintasDeLasPiezas({ ...blueprint, elements: [bouquet] } as unknown as ReferenceBlueprintV2).elements.length, 1);
  ok("las cintas que la lectura dijo dentro del techo de globos salen como escenografía");
}

console.log(`\n${casos} casos ok`);
