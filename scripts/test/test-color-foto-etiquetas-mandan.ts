/**
 * Los colores de la foto de referencia: las etiquetas del analizador deciden QUÉ colores tiene cada pieza y la
 * medida en píxeles solo los ORDENA y los PESA (2026-10-05). Una regresión por cada defecto que se probó con
 * las funciones reales antes de arreglarlo:
 *
 * - B1: un neutro medido que nadie nombró (la pared blanca, un fondo negro) se llevaba uno de los tres cupos,
 *   echaba un color real de la pieza y, como referencia Sempertex, la regla 3 cambiaba por él el lila.
 * - B6: el gris medido desaparecía sin sustitución ni aviso (las mismas etiquetas sin medida sí avisaban).
 * - B7: una lectura monocroma con 0,2 de confianza dejaba de un solo color una pieza que tenía tres.
 * - B4: el color de la foto que ninguna pieza compra se avisaba en la primera pieza, no en la que lo muestra.
 * - B2: el prompt daba por pieza tres fuentes de proporción y dos listas de colores.
 * - Y la decisión 2: cuando el globo medido cambia el COLOR de un material, el cliente se entera.
 *
 * Sin red, sin proveedor y sin coste: el resolutor Python es el doble de transporte de siempre.
 *   npx tsx --conditions=react-server scripts/test/test-color-foto-etiquetas-mandan.ts
 */
import assert from "node:assert/strict";
import type { Pool } from "pg";
import type { PythonPatronReferenciaPista } from "../../src/lib/ia/nucleo/python-adapter";
import type { ReferenceBlueprintV2 } from "../../src/lib/ia/referencia/reference-blueprint";
import type { AjusteCobertura, DisponibilidadProducto } from "../../src/lib/plan/cobertura-materiales";
import type { PlanDecoracion } from "../../src/lib/plan/tipos";
import type { ProductoCandidato } from "../../src/lib/rag/chat/buscar";
import { instalarResolutorPythonFalso, prepararEntornoPythonFalso, SNAPSHOT_FALSO, veredictoColoresReferencia } from "../lib/resolutor-python-falso";

prepararEntornoPythonFalso();
// El armado del motor no es el sujeto: sin la bandera, la confirmación no llama a esa ruta del doble.
process.env.ARMADO_ARCO_COLUMNA_V1 = "false";

let casos = 0;
async function caso(nombre: string, prueba: () => void | Promise<void>): Promise<void> {
  try {
    await prueba();
  } catch (error) {
    console.error(`[FAIL] ${nombre}`);
    throw error;
  }
  casos += 1;
  console.log(`[PASS] ${nombre}`);
}

type Apariencia = ReferenceBlueprintV2["elements"][number]["appearance"];
type Medida = { color: string; share: number };
type Referencia = NonNullable<Apariencia["referencias_medidas"]>[number];

function apariencia(observed_colors: string[], extra: Partial<Apariencia> = {}): Apariencia {
  return { observed_colors, resolved_colors: [], color_policy: "match_reference", material: "latex", shape: "pieza", composition: "single uniform material", ...extra } as Apariencia;
}

function elemento(id: string, category: string, ap: Apariencia, bbox = { x: 0.1, y: 0.1, width: 0.4, height: 0.8 }): ReferenceBlueprintV2["elements"][number] {
  return {
    element_id: id, source_image_id: "REF_01", name: `pieza ${id}`, category, scene_role: "midground", detection_confidence: 0.9,
    visible_evidence: "pieza", reference_bbox: bbox, depth_layer: 1, include_policy: "include", approved: true, source_type: "reference_only",
    quantity: { mode: "exact", min: 1, max: 1 }, appearance: ap, relationships: [], uncertainties: [],
  } as unknown as ReferenceBlueprintV2["elements"][number];
}

function blueprintDe(elementos: ReferenceBlueprintV2["elements"], observed: string[] = []): ReferenceBlueprintV2 {
  return {
    schema_version: "2.0", source_images: [{ image_id: "REF_01", approved_roles: ["composition_reference"] }], elements: elementos,
    composition: { focal_point: "mesa", density: "moderate", symmetry: "symmetric", negative_space: [] },
    palette: { observed, priority: [] }, unresolved_decisions: [],
  } as unknown as ReferenceBlueprintV2;
}

function referencia(codigo: string, nombre: string, familia: string, parte: number, familia_fiable = true): Referencia {
  return { codigo, familia, nombre: nombre.split(" ").slice(-1)[0]!, nombre_completo: nombre, parte, familia_fiable };
}

/** La guirnalda de la prueba: blush perlado, dorado cromado y lila, delante de una pared blanca. */
const ETIQUETAS_GUIRNALDA = ["pearl pink", "chrome gold", "lilac"];
const PARED_BLANCA: Medida[] = [{ color: "blanco", share: 0.45 }, { color: "rosado", share: 0.3 }, { color: "dorado", share: 0.2 }, { color: "lila", share: 0.05 }];

async function main(): Promise<void> {
  const colores = await import("../../src/lib/plan/colores-referencia");
  const { aplicarColoresReferencia } = await import("../../src/lib/plan/restricciones");
  const { aplicarReferenciasMedidas, coloresDelAnalizador } = await import("../../src/lib/plan/referencias-medidas");
  const { avisosClienteAjustes } = await import("../../src/lib/plan/cobertura-materiales");
  const { adjuntarPistasPatron } = await import("../../src/lib/ia/amaterasu/patron-referencia");
  const { construirSistema, serializeReferenceBlueprint } = await import("../../src/lib/ia/omoikane/prompt-sistema");
  const { detectarJergaInterna } = await import("../../src/lib/ia/omoikane/jerga-interna");

  await caso("B1 · un neutro medido que nadie nombró no ocupa cupo ni entra en la lista del prompt", () => {
    for (const fondo of ["blanco", "negro"]) {
      const medida = PARED_BLANCA.map((entrada) => (entrada.color === "blanco" ? { ...entrada, color: fondo } : entrada));
      assert.deepEqual(colores.coloresDominantesReferencia({ observed_colors: ETIQUETAS_GUIRNALDA, measured_colors: medida }), ["rosado", "dorado", "lila"], `fondo ${fondo}`);
    }
    const conAcabado = colores.coloresConAcabadoReferencia({ observed_colors: ETIQUETAS_GUIRNALDA, measured_colors: PARED_BLANCA });
    assert.deepEqual(conAcabado.map((item) => [item.color, item.acabado ?? null]), [["rosado", "satin"], ["dorado", "reflex"], ["lila", null]]);
    // El caso que ya estaba bien (2026-10-04) sigue bien: la plata cromada nombrada se queda aunque los
    // píxeles la lean como blanco, y ese blanco no se inventa.
    assert.deepEqual(
      colores.coloresDominantesReferencia({ observed_colors: ["light pink", "chrome silver", "clear"], measured_colors: [{ color: "blanco", share: 0.6 }, { color: "rosado", share: 0.4 }] }),
      ["rosado", "plateado", "transparente"],
    );
  });

  await caso("B6 · el gris medido pasa como por las etiquetas y el resolutor dice que se usó plateado", () => {
    const medido = colores.coloresDominantesReferencia({ observed_colors: ["matte grey", "white"], measured_colors: [{ color: "gris", share: 0.7 }, { color: "blanco", share: 0.2 }] });
    assert.deepEqual(medido, colores.coloresDominantesReferencia(["matte grey", "white"]));
    assert.match(colores.sustitucionesColorReferencia("E1", medido, ["plateado", "blanco"])[0]?.motivo ?? "", /muestra gris, que el catálogo no vende: se usó plateado/);
  });

  await caso("B7 · solo etiquetas nombradas habilitan compras; tonos nombrados y medidos relevantes superan tres", () => {
    const apariencia = {
      observed_colors: ["chrome silver", "satin pink", "pastel lilac", "satin fuchsia", "white", "clear"],
      measured_colors: [
        { color: "plateado", share: 0.35 },
        { color: "rosado", share: 0.3 },
        { color: "lila", share: 0.12 },
        { color: "fucsia", share: 0.04 },
        { color: "blanco", share: 0.01 },
        { color: "gris", share: 0.2 },
      ],
    };
    assert.deepEqual(colores.coloresDominantesReferencia(apariencia), ["plateado", "rosado", "lila", "fucsia", "transparente"]);
    assert.deepEqual(colores.coloresObservadosElemento(apariencia), ["plateado", "rosado", "lila", "fucsia", "blanco", "transparente"]);
  });

  await caso("paleta del cliente · los colores nombrados, en el orden de la medida y con el gris a la vista", () => {
    // La madera de la mesa (cafe) cae en la caja del arco: medida, pero nadie la nombró.
    const arco = elemento("REF_01_E01", "balloon_structure", apariencia(["light pink", "white", "clear"], { measured_colors: [{ color: "cafe", share: 0.5 }, { color: "blanco", share: 0.3 }, { color: "rosado", share: 0.2 }] }), { x: 0, y: 0, width: 0.8, height: 0.8 });
    const columna = elemento("REF_01_E02", "balloon_structure", apariencia(["grey"], { measured_colors: [{ color: "gris", share: 0.9 }] }), { x: 0.8, y: 0, width: 0.2, height: 0.5 });
    // Pesa la parte por el área de la caja: blanco .3 × .64 = .19, rosado .2 × .64 = .13, gris .9 × .1 = .09.
    // El cafe no se nombró y no sale; el transparente, que ningún píxel ve, va detrás.
    assert.deepEqual(colores.coloresFotoCliente(blueprintDe([arco, columna])), ["blanco", "rosado", "gris", "transparente"]);
  });

  await caso("B7 · color_unico solo con una lectura de confianza >= 0,5", () => {
    const pieza = blueprintDe([elemento("REF_01_E01", "balloon_structure", apariencia(["chrome gold", "matte white", "black"]))]);
    const con = (confianza: number) => adjuntarPistasPatron(pieza, [{ element_id: "REF_01_E01", modo: "monocromo", colores: ["dorado"], confianza, tamanos: "un_solo_tamano" } as PythonPatronReferenciaPista]).elements[0]!.appearance;
    const dudosa = con(0.2);
    assert.equal(dudosa.color_unico, undefined, "una monocroma dicha con 0,2 no manda sobre las etiquetas");
    assert.equal(dudosa.tamanos_leidos, "un_solo_tamano", "lo demás de la lectura se queda");
    assert.deepEqual(colores.coloresDominantesReferencia(dudosa), ["dorado", "blanco", "negro"]);
    for (const confianza of [0.5, 0.9]) {
      const firme = con(confianza);
      assert.equal(firme.color_unico, "dorado", `confianza ${confianza}`);
      assert.deepEqual(colores.coloresDominantesReferencia(firme), ["dorado"]);
      // Con la pieza de un solo color, lo nombrado también es ese color: los reflejos no son colores de la pieza.
      assert.deepEqual(colores.coloresNombradosReferencia(firme).map((item) => item.color), ["dorado"]);
    }
  });

  await caso("B7 · una monocroma con motas de otro color no es color_unico (foto de ejemplo 08)", () => {
    // La lectura real del 2026-10-05: «monocromo rosado, motas dorado» para columnas rosas con dorado suelto.
    // Guardada como color_unico, el dorado se perdía entero; ahora deciden las etiquetas.
    const pieza = blueprintDe([elemento("REF_01_E01", "balloon_structure", apariencia(["pearl pink", "chrome gold"]))]);
    const con = (motas: string[]) => adjuntarPistasPatron(pieza, [{ element_id: "REF_01_E01", modo: "monocromo", colores: ["rosado"], motas, confianza: 0.9 } as PythonPatronReferenciaPista]).elements[0]!.appearance;
    const salpicada = con(["dorado"]);
    assert.equal(salpicada.color_unico, undefined, "el dorado salpicado no se pierde");
    assert.deepEqual(colores.coloresDominantesReferencia(salpicada), ["rosado", "dorado"]);
    // Motas del mismo color no cambian nada: sigue siendo una pieza de un solo color.
    assert.equal(con(["rosado"]).color_unico, "rosado");
  });

  await caso("B4 · el color que ninguna pieza compra se avisa en la pieza que lo muestra", () => {
    const arco = elemento("REF_01_E01", "balloon_structure", apariencia(["pink", "white"]));
    const columnas = elemento("REF_01_E02", "balloon_structure", apariencia(["gold", "black", "white", "silver"]));
    const sillas = elemento("REF_01_E03", "furniture", apariencia(["burgundy"]));
    // Cinco colores: la paleta que se enseña al cliente se corta en `MAX_COLORES_FOTO_CLIENTE`.
    const foto = blueprintDe([arco, columnas, sillas], ["pink", "white", "gold", "silver", "burgundy"]);
    const material = (color: string) => ({ product_id: `P-${color}`, color, participacion: 0.5, rol_material: "secundario" });
    const plan = {
      estructuras: [
        { estructura_id: "ARCO", nombre: "Arco", referencia_element_id: "REF_01_E01", materiales: [material("rosado"), material("blanco")] },
        { estructura_id: "COLUMNAS", nombre: "Columnas", referencia_element_id: "REF_01_E02", materiales: [material("dorado"), material("negro"), material("blanco")] },
      ],
    } as unknown as PlanDecoracion;
    const conColores = aplicarColoresReferencia(plan, foto);
    // El plateado (cuarto color de las columnas) va a las columnas. El burdeos de las sillas YA NO va a la
    // primera pieza: un color que solo aporta el escenario no es decoración (decisión del 2026-10-05 escrita
    // en `aplicarColoresReferencia`, restricciones.ts). Esta expectativa decía lo contrario desde antes de esa
    // decisión y la prueba fallaba sola; se corrigió la expectativa, no el código (2026-10-05, noche).
    assert.deepEqual(conColores.estructuras.map((estructura) => [estructura.estructura_id, estructura.colores_referencia]), [
      ["ARCO", ["rosado", "blanco"]],
      ["COLUMNAS", ["dorado", "negro", "blanco", "plateado"]],
    ]);
    assert.ok(!conColores.estructuras.some((estructura) => estructura.colores_referencia?.includes("burdeos")), "el color de las sillas no se le pide a ninguna pieza");
    const avisoColumnas = colores.sustitucionesColorReferencia("COLUMNAS", conColores.estructuras[1]!.colores_referencia!, ["dorado", "negro", "blanco"]);
    assert.deepEqual(avisoColumnas.map((item) => item.pedido), ["plateado"]);
    // Si dos piezas lo muestran y ninguna lo compra, las dos lo avisan: a las dos les falta.
    const dosConPlata = blueprintDe([elemento("REF_01_E01", "balloon_structure", apariencia(["pink", "white", "gold", "silver"])), columnas], ["silver"]);
    assert.deepEqual(aplicarColoresReferencia(plan, dosConPlata).estructuras.map((estructura) => estructura.colores_referencia?.includes("plateado")), [true, true]);
  });

  await caso("decisión 1 · la regla 3 no cambia un color nombrado aunque quede fuera de los tres dominantes", () => {
    const ap = apariencia(["pink", "white", "gold", "silver"], {
      referencias_medidas: [referencia("409", "Satín Rosado", "satin", 0.4), referencia("970", "Reflex Dorado", "reflex", 0.3), referencia("005", "Fashion Blanco", "fashion", 0.2, false)],
    });
    assert.deepEqual(colores.coloresDominantesReferencia(ap), ["rosado", "blanco", "dorado"]);
    assert.deepEqual([...coloresDelAnalizador(ap).keys()], ["rosado", "blanco", "dorado", "plateado"], "los cuatro, con el plateado");
    const producto = (titulo: string, color: string, acabado: string): DisponibilidadProducto => ({ titulo, categoria: "globo_latex", colores: [color], coloresVariante: [color], mezclas: ["clasica"], acabados: [acabado] });
    const disponibles = new Map<string, DisponibilidadProducto>([
      ["p-satin-rosado", producto("B2b Globo Latex Redondo Satin Rosado", "rosado", "satin")],
      ["p-reflex-dorado", producto("B2b Globo Latex Redondo Reflex Dorado", "dorado", "reflex")],
      ["p-reflex-plata", producto("B2b Globo Latex Redondo Reflex Plata", "plateado", "reflex")],
      ["p-fashion-blanco", producto("B2b Globo Latex Redondo Fashion Blanco", "blanco", "fashion")],
    ]);
    const material = (product_id: string, color: string) => ({ product_id, color, participacion: 1 / 3, rol_material: "secundario" });
    const plan = {
      estructuras: [{ estructura_id: "EST_01", nombre: "Guirnalda", tipo: "guirnalda", mezcla: "clasica", referencia_element_id: "REF_01_E01", materiales: [material("p-satin-rosado", "rosado"), material("p-reflex-dorado", "dorado"), material("p-reflex-plata", "plateado")] }],
    } as unknown as PlanDecoracion;
    const resultado = aplicarReferenciasMedidas(plan, blueprintDe([elemento("REF_01_E01", "balloon_structure", ap)]), disponibles);
    assert.equal(resultado.plan.estructuras[0]!.materiales[2]!.product_id, "p-reflex-plata", "antes se cambiaba por el Fashion Blanco libre");
    assert.deepEqual(resultado.ajustes, []);
  });

  await caso("decisión 2 · el cambio de color por el globo medido se le avisa al cliente, y solo si sigue en el plan", () => {
    const nombres = new Map([["EST_01", "Columna rosa y plata"]]);
    const cambio: AjusteCobertura = { tipo: "color_referencia", estructura_id: "EST_01", product_id: "p-reflex-fucsia", despues: "p-satin-rosado", antes: "fucsia", color: "rosado", referencia: "Satín Rosado" };
    const aviso = "En columna rosa y plata los globos de color fucsia van en rosado (Satín Rosado), que es el color que tiene tu foto.";
    // El producto viejo sale del plan a propósito: no apaga el aviso.
    assert.deepEqual(avisosClienteAjustes([cambio], { nombres, materialesFuera: [{ estructura_id: "EST_01", product_id: "p-reflex-fucsia" }] }), [aviso]);
    assert.deepEqual(detectarJergaInterna(aviso), [], aviso);
    // Un cambio de acabado posterior sobre el producto nuevo no lo apaga; que la convergencia saque el
    // producto que quedó, sí: el cliente no puede oír de un rosado que no se cotiza.
    const acabado: AjusteCobertura = { tipo: "acabado_referencia", estructura_id: "EST_01", product_id: "p-satin-rosado", despues: "p-silk-rosado", color: "rosado", acabado: "satin" };
    assert.deepEqual(avisosClienteAjustes([cambio, acabado], { nombres }), [aviso]);
    assert.deepEqual(avisosClienteAjustes([cambio, acabado], { nombres, materialesFuera: [{ estructura_id: "EST_01", product_id: "p-silk-rosado" }] }), []);
    // Un cambio solo de línea (mismo color) sigue sin aviso.
    assert.deepEqual(avisosClienteAjustes([{ ...acabado, product_id: "p-fashion-rosado", despues: "p-satin-rosado" }], { nombres }), []);
  });

  await caso("B2 · el prompt da UNA lista por pieza: cada color una vez, con su parte medida y su globo Sempertex", () => {
    const guirnalda = elemento("REF_01_E01", "balloon_structure", apariencia(ETIQUETAS_GUIRNALDA, {
      measured_colors: PARED_BLANCA,
      composition: "60% pearl pink, 25% chrome gold, 15% lilac accents",
      // Un blueprint analizado antes del cambio todavía trae el Fashion Blanco de la pared.
      referencias_medidas: [referencia("005", "Fashion Blanco", "fashion", 0.4, false), referencia("409", "Satín Rosado", "satin", 0.3), referencia("970", "Reflex Dorado", "reflex", 0.18), referencia("450", "Satín Lila", "satin", 0.12)],
    }));
    const linea = serializeReferenceBlueprint(blueprintDe([guirnalda], ["pink", "gold", "lilac", "white wall", "brown floor"]));
    const lista = /colores de la pieza: (.*?); posición/.exec(linea)?.[1] ?? "";
    assert.equal(lista,
      'rosado satin (visto como "pearl pink"; ~30 % medido, aproximado; globo Sempertex medido: Satín Rosado → busca "globo latex redondo Satín Rosado"), '
      + 'dorado reflex (visto como "chrome gold"; ~20 % medido, aproximado; globo Sempertex medido: Reflex Dorado → busca "globo latex redondo Reflex Dorado"), '
      + 'lila (visto como "lilac"; ~5 % medido, aproximado; globo Sempertex medido: Satín Lila → busca "globo latex redondo Satín Lila")', linea);
    assert.doesNotMatch(linea, /blanco|Fashion Blanco/, "la pared no es un color de la pieza ni un globo medido");
    assert.doesNotMatch(linea, /mezcla de color observada|GLOBOS REALES|compra exactamente/, "una sola fuente de proporción y nada que contradiga al servidor");
    // Sin partes medidas, la mezcla del analizador es la única fuente y sí viaja.
    const sinMedida = elemento("REF_01_E01", "balloon_structure", apariencia(ETIQUETAS_GUIRNALDA, { composition: "60% pearl pink, 25% chrome gold, 15% lilac accents" }));
    assert.match(serializeReferenceBlueprint(blueprintDe([sinMedida])), /colores de la pieza: rosado satin \(visto como "pearl pink"\), dorado reflex \(visto como "chrome gold"\), lila \(visto como "lilac"\); mezcla de color observada: "60% pearl pink/);
    const sistema = construirSistema({ ragEnabled: true, referenceBlueprint: blueprintDe([guirnalda], ["pink", "gold", "white wall"]) });
    assert.match(sistema, /Paleta observada en toda la foto \(incluye el local: paredes, piso y muebles; no es la lista de colores de ninguna pieza\): pink, gold, white wall\./);
    assert.match(sistema, /PROPORCIONES DE LA FOTO: cada pieza trae una sola fuente de proporciones/);
    assert.match(sistema, /COLORES DE LA FOTO: arma cada estructura con los "colores de la pieza" de SU elemento/);
    assert.match(sistema, /COLORES_REFERENCIA_OMITIDOS/, "el rechazo existe en el código y la regla lo sigue describiendo");
    assert.doesNotMatch(sistema, /colores observados|compra exactamente|la tarjeta se los muestra al cliente uno por uno/);
  });

  await caso("decisión 2 · el turno firma el globo medido y el aviso del color llega a avisos_cliente", async () => {
    const { crearEstadoConversacion, crearRegistroHerramientas } = await import("../../src/lib/ia/herramientas/registro-herramientas");
    const columna = elemento("REF_01_E01", "balloon_structure", apariencia(["pastel pink", "chrome silver"], {
      referencias_medidas: [referencia("409", "Satín Rosado", "satin", 0.5), referencia("981", "Reflex Plata", "reflex", 0.3)],
    }));
    const foto = blueprintDe([columna], ["pastel pink", "chrome silver"]);
    const candidato = (productId: string, titulo: string, color: string, acabado: string): ProductoCandidato => ({
      productId, titulo, categoria: "globo_latex", colores: [color], acabados: [acabado], ocasiones: [], disponible: true, imagen: null,
      variantes: [{ variantId: `V-${productId}`, sku: null, titulo: null, precio: 5000, disponible: true, codigoTamano: "R-12", diamPulg: 12, forma: "redondo", colores: [color] }],
    } as unknown as ProductoCandidato);
    const candidatos = [
      candidato("p-reflex-fucsia", "B2b Globo Latex Redondo Reflex Fucsia", "fucsia", "reflex"),
      candidato("p-reflex-plata", "B2b Globo Latex Redondo Reflex Plata", "plateado", "reflex"),
      candidato("p-satin-rosado", "B2b Globo Latex Redondo Satin Rosado", "rosado", "satin"),
    ];
    instalarResolutorPythonFalso({ veredicto: veredictoColoresReferencia });
    const estado = crearEstadoConversacion({}, "Quiero algo así para un cumpleaños", foto);
    estado.ragCatalogSnapshotId = SNAPSHOT_FALSO;
    estado.ragCandidatos = candidatos;
    for (const item of candidatos) {
      estado.ragIdsRecuperados.add(item.productId);
      estado.ragVariantIdsRecuperados.set(item.productId, new Set(item.variantes.map((variante) => variante.variantId)));
    }
    const pool = { query: async () => ({ rows: [] }) } as unknown as Pool;
    const confirmar = crearRegistroHerramientas(estado, { pool, creatividad: 0 }).confirmar_plan_decoracion!;
    const material = (product_id: string, color: string, participacion: number, rol: string) => ({ product_id, color, participacion, rol_material: rol });
    const respuesta = await confirmar({
      concepto: { titulo: "Cumpleaños", descripcion: "Columna de la foto", paleta: ["rosado", "plateado"] },
      espacio: { tipo: "salón", fuente: "supuesto" },
      estructuras: [{
        estructura_id: "EST_01_COLUMNA", nombre: "Columna rosa y plata", tipo: "columna", rol_escena: "focal", ubicacion: "lateral_izquierdo",
        medidas: { alto_m: 2 }, repeticiones: 1, densidad: "media", mezcla: "clasica", referencia_element_id: "REF_01_E01", porque: "Enmarca la mesa.",
        materiales: [material("p-reflex-fucsia", "fucsia", 0.5, "principal"), material("p-reflex-plata", "plateado", 0.5, "secundario")],
      }],
    }, { nombre: "confirmar_plan_decoracion", args: {} }) as Record<string, unknown>;
    assert.equal(respuesta.ok, true, JSON.stringify(respuesta).slice(0, 600));
    assert.deepEqual(estado.planResuelto?.plan.estructuras[0]?.materiales.map((item) => `${item.product_id}:${item.color}`), ["p-satin-rosado:rosado", "p-reflex-plata:plateado"]);
    const avisos = respuesta.avisos_cliente as string[];
    assert.ok(avisos.includes("En columna rosa y plata los globos de color fucsia van en rosado (Satín Rosado), que es el color que tiene tu foto."), avisos.join(" | "));
    for (const aviso of avisos) assert.deepEqual(detectarJergaInterna(aviso), [], aviso);
    assert.match(String(respuesta.accion_requerida), /avisos_cliente[\s\S]*solo los sabrá por ti/, "la tarjeta no enseña estos ajustes: el modelo tiene que decirlos");
  });

  console.log(`\n${casos} casos OK (colores de la foto: las etiquetas mandan, la medida ordena)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
