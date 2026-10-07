/**
 * La lectura de la foto de inspiración, ordenada para la ficha de «Esto es lo que veo en tu foto»
 * (`src/components/guiado/lectura-foto.ts`) y su pintado (`ReferenciaInspiracion`): piezas SIEMPRE individuales
 * con nombre propio, recuadros numerados, colores con su acabado y su globo Sempertex medido, tamaños por clase,
 * conteo y remate. Sin red, sin modelo, sin coste.
 *
 * Run: npx tsx scripts/test/test-lectura-foto.ts
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { adaptarAnalisisReferencia } from "@/lib/ia/guiado/adaptar-analisis-referencia";
import { lecturaFoto, unirConY } from "@/components/guiado/lectura-foto";
import { colorLeido, familiaSempertex } from "@/components/guiado/color-globo";
import { ReferenciaInspiracion } from "@/components/guiado/ReferenciaInspiracion";

type Extra = Record<string, unknown>;

const elemento = (id: string, x: number, ancho: number, extra: { tipo?: string; ubicacion?: string; apariencia?: Extra; cantidad?: number; categoria?: string; nombre?: string; confianza?: number } = {}) => ({
  element_id: id, source_image_id: "REF_01", name: extra.nombre ?? id, category: extra.categoria ?? "balloon_structure", scene_role: "midground",
  detection_confidence: extra.confianza ?? 0.95, visible_evidence: "pieza de globos", reference_bbox: { x, y: 0.05, width: ancho, height: 0.8 },
  depth_layer: 2, include_policy: "include", approved: true, source_type: "reference_only",
  quantity: { mode: "exact", min: extra.cantidad ?? 1, max: extra.cantidad ?? 1 }, quantity_semantics: "physical_instances",
  ...(extra.categoria && extra.categoria !== "balloon_structure" ? {} : {
    visual_semantics: { structure_type: extra.tipo ?? "columna", placement: extra.ubicacion ?? "piso_frontal", design_role: "focal", repetition_group: id, density: "lujosa" },
  }),
  appearance: { observed_colors: ["chrome silver"], resolved_colors: [], color_policy: "adapt_to_event_palette", material: "latex", shape: "tall dense column", composition: "mixta", ...extra.apariencia },
  relationships: [], uncertainties: [],
});

const blueprint = (elementos: unknown[]) => ({
  blueprint: {
    schema_version: "2.0", source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"], aspect_ratio: 1.4925 }],
    elements: elementos,
    composition: { focal_point: "globos", density: "dense", symmetry: "asymmetric", negative_space: [] },
    palette: { observed: ["soft pink", "chrome silver"], priority: ["soft pink", "chrome silver"] }, unresolved_decisions: [],
  },
});

// La foto del dueño (2026-10-06): dos columnas orgánicas inclinadas, plata cromado con blanco perlado y rosa, más un
// fondo, una mesa y flores que no son de globos. Los datos son los de la lectura real (foto-usuario-analisis.json).
const izquierda = elemento("REF_01_E01", 0.02, 0.341, {
  nombre: "Left organic balloon garland half arch", ubicacion: "lateral_izquierdo",
  apariencia: {
    observed_colors: ["chrome silver", "pearl white", "soft pink", "clear"],
    measured_colors: [{ color: "plateado", share: 0.649 }, { color: "blanco", share: 0.2435 }, { color: "rosado", share: 0.0711 }],
    referencias_medidas: [{ codigo: "981", familia: "reflex", nombre: "Plata", nombre_completo: "Reflex Plata", parte: 0.2939, familia_fiable: true }],
    tamanos_leidos: "chicos_con_pocos_grandes",
    conteo: { globos_visibles: 45, exacto: false, estimado_total: null, racimos: null, globos_por_racimo: null, por_tamano: [{ clase: "chico", proporcion: 0.3 }, { clase: "mediano", proporcion: 0.5 }, { clase: "grande", proporcion: 0.2 }], largo_relativo: null, alto_relativo: null, confianza: 0.85 },
    armado_guirnalda: { soporte: "pared", forma: "curva", puntos_de_anclaje: 3, sentido_curva: "arriba", flecha_relativa: 0.036, desnivel_relativo: null, racimos_visibles: 20, unidad_racimo: "cuarteto", colores_por_racimo: ["plateado", "blanco", "rosado"], relleno: null, remates: [{ clase: "metalizado", color: "plateado", posicion: "extremo_izq" }], confianza: 0.85 },
    inclinacion: 0.22,
  },
});
const derecha = elemento("REF_01_E02", 0.544, 0.308, {
  nombre: "Right organic balloon garland half arch", ubicacion: "lateral_derecho",
  apariencia: {
    observed_colors: ["chrome silver", "pearl white", "soft pink", "clear"],
    measured_colors: [{ color: "plateado", share: 0.7016 }, { color: "rosado", share: 0.1306 }],
    referencias_medidas: [
      { codigo: "981", familia: "reflex", nombre: "Plata", nombre_completo: "Reflex Plata", parte: 0.4851, familia_fiable: true },
      { codigo: "806", familia: "silk", nombre: "Blanco Nácar", nombre_completo: "Silk Blanco Nácar", parte: 0.129, familia_fiable: true },
      { codigo: "409", familia: "satin", nombre: "Rosado", nombre_completo: "Satín Rosado", parte: 0.05, familia_fiable: false },
    ],
    inclinacion: -0.22,
  },
});
const crudo = blueprint([
  derecha, izquierda,
  elemento("REF_01_E03", 0.2, 0.6, { categoria: "backdrop" }),
  elemento("REF_01_E04", 0.4, 0.2, { categoria: "other" }),
  elemento("REF_01_E05", 0.7, 0.2, { categoria: "floral" }),
]);
const referencia = adaptarAnalisisReferencia(crudo);
assert.ok(referencia, "la lectura de la foto del dueño se adapta");
const lectura = lecturaFoto(referencia.blueprint);
assert.ok(lectura);

// Piezas individuales, numeradas de izquierda a derecha, con nombre propio y su recuadro.
assert.deepEqual(lectura.piezas.map((pieza) => [pieza.numero, pieza.nombre]), [[1, "Columna izquierda"], [2, "Columna derecha"]]);
assert.deepEqual(lectura.cajas.map((caja) => [caja.numeros, caja.nombre, caja.x]), [[[1], "Columna izquierda", 0.02], [[2], "Columna derecha", 0.544]]);
const [uno, dos] = lectura.piezas;
assert.equal(uno!.tipo, "Columna orgánica");
assert.deepEqual(uno!.detalles, ["inclinada hacia la derecha", "muy llena"], "«a la izquierda» sobra: el nombre ya lo dice");
assert.deepEqual(dos!.detalles, ["inclinada hacia la izquierda", "muy llena"]);
assert.equal(uno!.medidas, null, "la lectura no trae metros: no se inventan");
assert.equal(uno!.globos, "≈ 45 globos a la vista");
assert.equal(dos!.globos, null, "sin conteo, sin cifra");
assert.equal(lectura.globosVisibles, 45);

// Colores con su acabado, su parte medida y el globo Sempertex que se midió (solo con familia fiable).
assert.deepEqual(uno!.colores.map((color) => [color.nombre, color.acabado, color.parte, color.sempertex?.nombre ?? null]), [
  ["plata cromado", "reflex", 0.649, "Reflex Plata"],
  ["blanco perlado", "perlado", 0.2435, null],
  ["rosa pastel", "pastel", 0.0711, null],
  ["transparente", "cristal", null, null],
]);
const blancoDerecha = dos!.colores.find((color) => color.clave === "blanco");
assert.equal(blancoDerecha?.sempertex?.nombre, "Silk Blanco Nácar");
assert.equal(blancoDerecha?.sempertex?.codigo, "806");
assert.equal(blancoDerecha?.parte, 0.129, "sin parte medida por color, la de la referencia Sempertex");
assert.ok(!dos!.colores.some((color) => color.sempertex?.codigo === "409"), "una familia no fiable no se muestra como producto");

// Tamaños por clase (las pulgadas son las del conteo) y el remate leído.
assert.deepEqual(uno!.tamanos.map((tamano) => [tamano.etiqueta, tamano.pulgadas, tamano.proporcion]), [["Chicos", "5–9″", 0.3], ["Medianos", "12″", 0.5], ["Grandes", "18–24″", 0.2]]);
assert.equal(uno!.tamanosFrase, null);
assert.deepEqual(uno!.remates, ["Globo metalizado plata en el extremo izquierdo"]);
assert.equal(uno!.confianza, "alta");
assert.deepEqual(lectura.otros, ["un fondo", "otros objetos", "flores"]);
assert.equal(unirConY(lectura.otros), "un fondo, otros objetos y flores");

// Una pareja leída como UN elemento con 2 instancias se muestra como dos piezas (mismo recuadro).
const pareja = lecturaFoto(adaptarAnalisisReferencia(blueprint([elemento("par", 0.1, 0.8, { cantidad: 2, ubicacion: "entrada" })]))!.blueprint);
assert.ok(pareja);
assert.deepEqual(pareja.piezas.map((pieza) => [pieza.numero, pieza.nombre, pieza.caja]), [[1, "Columna izquierda", 0], [2, "Columna derecha", 0]]);
assert.deepEqual(pareja.cajas.map((caja) => [caja.numeros, caja.nombre]), [[[1, 2], "Columna izquierda y Columna derecha"]]);
assert.equal(pareja.piezas[1]!.globos, null, "el conteo de la pareja no se reparte ni se repite");

// Tres columnas se numeran; un medio arco con lado concuerda en masculino; el arco no lleva lado.
const varias = lecturaFoto(adaptarAnalisisReferencia(blueprint([
  elemento("c1", 0.6, 0.1), elemento("c2", 0.1, 0.1), elemento("c3", 0.35, 0.1),
  elemento("arco", 0.2, 0.6, { tipo: "arco", ubicacion: "fondo_pared" }),
  elemento("s1", 0.0, 0.1, { tipo: "semiarco" }), elemento("s2", 0.85, 0.1, { tipo: "semiarco" }),
]))!.blueprint);
assert.ok(varias);
assert.deepEqual(varias.piezas.map((pieza) => pieza.nombre), ["Medio arco izquierdo", "Columna 1", "Columna 2", "Arco", "Columna 3", "Medio arco derecho"]);
assert.ok(varias.piezas.find((pieza) => pieza.nombre === "Arco")!.detalles.includes("contra la pared del fondo"));

// Sin reparto por tamaño, la frase de la lectura; confianza baja dicha como tal.
const sinReparto = lecturaFoto(adaptarAnalisisReferencia(blueprint([elemento("g", 0.1, 0.3, { tipo: "guirnalda", confianza: 0.4, apariencia: { tamanos_leidos: "casi_todos_gigantes", observed_colors: ["rose gold", "matte black", "clear with confetti"] } })]))!.blueprint);
assert.ok(sinReparto);
assert.equal(sinReparto.piezas[0]!.tamanosFrase, "Casi todos gigantes (36″)");
assert.equal(sinReparto.piezas[0]!.confianza, "baja");
assert.deepEqual(sinReparto.piezas[0]!.colores.map((color) => color.nombre), ["oro rosa", "negro mate", "transparente con confeti"]);

// Traducciones de color y familias Sempertex.
assert.equal(colorLeido("navy blue")?.nombre, "azul marino");
assert.equal(colorLeido("metallic gold")?.acabado, "metalizado");
assert.equal(colorLeido("xyz"), null, "sin color reconocible no se inventa uno");
assert.equal(familiaSempertex("B2b Globo Latex Redondo Pastel Matte Azul — R-12")?.nombre, "Pastel Matte");
assert.equal(familiaSempertex("Silk Blanco Nácar")?.cliente, "perlado");

// El pintado: recuadros rotulados, fichas con nombre, Sempertex, tamaños y el botón con el número de piezas.
const html = renderToStaticMarkup(createElement(ReferenciaInspiracion, { miniatura: "data:image/jpeg;base64,AAAA", referencia, onArmar: () => undefined, onVerIdeas: () => undefined }));
const texto = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
for (const visible of [
  // La frase dice lo que el plan lee de la foto, con acabados y el transparente (antes: «en plata, blanco y rosa»).
  "Veo dos columnas en plata cromado, rosa pastel, blanco perlado y transparente.", "Columna izquierda", "Columna derecha", "Columna orgánica · inclinada hacia la derecha · muy llena",
  "≈ 45 globos a la vista", "Plata cromado", "65%", "Sempertex Reflex Plata · 981", "Sempertex Silk Blanco Nácar · 806",
  "Grandes 18–24″", "Lleva globos más grandes que 12″.", "Globo metalizado plata en el extremo izquierdo",
  "También veo un fondo, otros objetos y flores", "Sí, arma mi plan con estas 2 piezas", "Prefiero ver ideas parecidas",
]) assert.ok(texto.includes(visible), `Falta en la ficha: «${visible}» en ${texto}`);
assert.equal((html.match(/aria-pressed=/g) ?? []).length, 2, "una ficha accionable por pieza");
const historial = renderToStaticMarkup(createElement(ReferenciaInspiracion, { miniatura: "data:image/jpeg;base64,AAAA", referencia, activo: false, onArmar: () => undefined }));
assert.ok(!historial.includes("Sí, arma mi plan"), "en el historial no hay botones");
for (const jerga of ["undefined", "null", "NaN", "balloon", "chrome", "REF_01"]) assert.ok(!texto.includes(jerga), `No debe verse «${jerga}»`);

console.log(`test-lectura-foto: ${lectura.piezas.map((pieza) => `${pieza.numero} ${pieza.nombre} (${pieza.colores.map((color) => color.nombre).join(", ")})`).join(" · ")}; pareja → 2 piezas; 3 columnas numeradas; pintado con Sempertex y tamaños`);
