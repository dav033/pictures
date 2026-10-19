// Sin red: colores de la foto que el plan pierde (comparador clásica-guiada 2026-10-06, B2), su reintento y su aviso en
// la tarjeta, y la salida «Armarlo sin el remate grande» (B1). Plan tomado de guiada-20261006-234732-5yucrk (ej01):
// la lectura dice plata, blanco, rosa y transparente; el plan confirmó plateado, blanco y rosado.
import assert from "node:assert/strict";
import { avisoColoresFoto, coloresFotoFaltantes } from "@/lib/plan/colores-foto-plan";
import { coloresFaltantesPlanGuiado, cuerpoPlanGuiado, defectoPlanGuiado, instruccionPlanFoto } from "@/lib/ia/guiado/instruccion-plan";
import { normalizarPropuestaComposicion } from "@/lib/ia/guiado/propuesta-composicion";
import { lecturaSinRemateGrande, tieneRemateGrande } from "@/lib/ia/guiado/remate-foto";
import { LECTURAS_EJEMPLOS } from "@/lib/ia/amaterasu/lecturas-ejemplos";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";

let casos = 0;
function caso(nombre: string, fn: () => void): void {
  fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
}

const lineas = (colores: string[]) => colores.flatMap((color) => [5, 12, 18].map((diam) => ({ color, diam_pulg: diam, tamano_codigo: `R-${diam}`, unidades: 10, titulo: `Globo ${color} R-${diam}` })));
const planEj01 = {
  plan: {
    concepto: { titulo: "Elegancia en Plata, Blanco y Rosa", paleta: ["plata", "blanco", "rosa", "transparente"] },
    estructuras: [
      { estructura_id: "EST_01_COLUMNA", nombre: "Columna orgánica izquierda", tipo: "columna", estructura_oficial: "columna_asimetrica", repeticiones: 1, referencia_element_id: "REF_01_E01", colores_referencia: ["plateado", "blanco", "rosado", "transparente"] },
      { estructura_id: "EST_01_COLUMNA_B", nombre: "Columna orgánica derecha", tipo: "columna", estructura_oficial: "columna_asimetrica", repeticiones: 1, referencia_element_id: "REF_01_E02", colores_referencia: ["plateado", "rosado", "blanco", "transparente"] },
    ],
  },
  estructuras: [
    { estructura_id: "EST_01_COLUMNA", lineas: lineas(["plateado", "blanco", "rosado"]) },
    { estructura_id: "EST_01_COLUMNA_B", lineas: lineas(["plateado", "blanco", "rosado"]) },
  ],
  sustituciones: [
    { estructura_id: "EST_01_COLUMNA", pedido: "R-24", entregado: "R-18", motivo: "La whitelist no tiene R-24" },
    { estructura_id: "EST_01_COLUMNA", pedido: "transparente", entregado: "plateado, blanco, rosado", motivo: "La foto de referencia muestra transparente y esta pieza no lo lleva: se armó con plateado, blanco y rosado." },
    { estructura_id: "EST_01_COLUMNA_B", pedido: "transparente", entregado: "plateado, blanco, rosado", motivo: "…" },
  ],
};
const conTransparente = {
  ...planEj01,
  estructuras: planEj01.estructuras.map((estructura) => ({ ...estructura, lineas: lineas(["plateado", "blanco", "rosado", "transparente"]) })),
};

caso("el plan de ej01 sin transparente: falta en las dos columnas, con lo que se usó en su lugar", () => {
  assert.deepEqual(coloresFotoFaltantes(planEj01), [{
    color: "transparente",
    piezas: [{ estructura_id: "EST_01_COLUMNA", nombre: "Columna orgánica izquierda" }, { estructura_id: "EST_01_COLUMNA_B", nombre: "Columna orgánica derecha" }],
    entregado: "plateado, blanco, rosado",
  }]);
  assert.deepEqual(coloresFotoFaltantes(conTransparente), []);
});

caso("vino/burdeos (ej07): la lectura dice «burdeos» y una línea «vino» lo cubre; sin línea, falta", () => {
  const arco = (colores: string[]) => ({
    plan: { concepto: { titulo: "x", paleta: [] }, estructuras: [{ estructura_id: "EST_01_ARCO", nombre: "Arco orgánico", referencia_element_id: "REF_01_E01", colores_referencia: ["plateado", "burdeos", "blanco", "rosado"] }] },
    estructuras: [{ estructura_id: "EST_01_ARCO", lineas: lineas(colores) }],
  });
  assert.deepEqual(coloresFotoFaltantes(arco(["plateado", "blanco", "rosado"])).map((faltante) => faltante.color), ["burdeos"]);
  assert.deepEqual(coloresFotoFaltantes(arco(["plateado", "vino", "blanco", "rosado"])), []);
  assert.deepEqual(coloresFotoFaltantes(arco(["plateado", "burdeos", "blanco", "rosado"])), []);
});

caso("un color sin venta lo cubre el que lo representa; sin líneas resueltas no se acusa; los que quitó el cliente no se exigen", () => {
  const gris = { plan: { estructuras: [{ estructura_id: "E1", nombre: "Columna", colores_referencia: ["gris", "blanco"] }] }, estructuras: [{ estructura_id: "E1", lineas: lineas(["plateado", "blanco"]) }] };
  assert.deepEqual(coloresFotoFaltantes(gris), []);
  assert.deepEqual(coloresFotoFaltantes({ plan: { estructuras: [{ estructura_id: "E1", colores_referencia: ["azul"] }] }, estructuras: [] }), []);
  assert.deepEqual(coloresFotoFaltantes(planEj01, { soloEstos: ["Plata", "Rosa", "Blanco"] }), [], "«Otros colores» sin transparente: no se exige");
  assert.equal(coloresFotoFaltantes(planEj01, { soloEstos: ["Transparente"] }).length, 1);
  assert.deepEqual(coloresFotoFaltantes(null), []);
});

caso("defectoPlanGuiado: un color de la foto que el plan no compra gasta el reintento", () => {
  assert.match(defectoPlanGuiado(planEj01) ?? "", /le faltan colores de la foto: transparente \(EST_01_COLUMNA, EST_01_COLUMNA_B\)/);
  assert.equal(defectoPlanGuiado(conTransparente), null);
  assert.equal(defectoPlanGuiado(planEj01, undefined, { coloresPedidos: ["plateado", "blanco", "rosado"] }), null, "el cliente eligió otros colores");
});

caso("el reintento pide cada color que faltó, por estructura_id y con su búsqueda; el primer intento no", () => {
  const faltantes = coloresFaltantesPlanGuiado(planEj01);
  const texto = instruccionPlanFoto({ reintento: true, colores: ["Plata", "Blanco", "Rosa", "Transparente"], faltantes });
  assert.ok(texto.includes("Al plan anterior le faltó el transparente, que la foto sí tiene en EST_01_COLUMNA, EST_01_COLUMNA_B: búscalo aparte con buscar_catalogo_rag («globo redondo cristal»)"), texto);
  assert.ok(texto.includes("Si el catálogo no lo tiene en ningún tamaño, confirma sin él."));
  assert.ok(!/Columna orgánica/.test(texto), "sin nombres de pieza: se leerían como pedido del cliente");
  assert.ok(!instruccionPlanFoto({ reintento: false, faltantes }).includes("le faltó"), "solo en el reintento");
  const propuesta = normalizarPropuestaComposicion({ frase: "x", colores: ["plateado", "blanco", "rosado", "transparente"], piezas: [{ estructura: "columna_asimetrica", cantidad: 2 }] });
  const cuerpo = cuerpoPlanGuiado(propuesta, { reintento: true, faltantes });
  assert.ok(cuerpo.messages[0]!.content.includes("le faltó el transparente"));
  assert.ok(!cuerpoPlanGuiado(propuesta, { reintento: true }).messages[0]!.content.includes("le faltó"));
});

caso("si el color sigue faltando, la tarjeta lo dice en una frase; con la paleta del cliente sin él, no", () => {
  assert.equal(avisoColoresFoto(planEj01), "No encontré globo transparente que sirviera para Columna orgánica izquierda y Columna orgánica derecha; en su lugar usé plateado, blanco y rosado.");
  assert.equal(avisoColoresFoto(conTransparente), null);
  assert.equal(avisoColoresFoto(planEj01, { soloEstos: planEj01.plan.concepto.paleta }), avisoColoresFoto(planEj01), "«plata, rosa, transparente» de la paleta son los del catálogo");
  assert.equal(avisoColoresFoto(planEj01, { soloEstos: ["rojo", "blanco"] }), null);
});

caso("«Armarlo sin el remate grande»: el globo de remate pasa a «ninguno» (no ausente) y la lectura sigue válida", () => {
  const ej04 = LECTURAS_EJEMPLOS.ejemplos.find((ejemplo) => ejemplo.id === "ejemplo-04")!.analisis.blueprint;
  assert.equal(tieneRemateGrande(ej04), false, "la lectura revisada de ej04 no inventa remate");
  // La lectura del banco 232707 (guiada ej04): remate de globo dorado en la columna.
  const conRemate: ReferenceBlueprintV2 = { ...ej04, elements: ej04.elements.map((elemento) => (elemento.category === "balloon_structure" ? { ...elemento, appearance: { ...elemento.appearance, remate_columna: { tipo: "globo" as const, color: "dorado" } } } : elemento)) };
  assert.equal(tieneRemateGrande(conRemate), true);
  const sin = lecturaSinRemateGrande(conRemate);
  assert.equal(tieneRemateGrande(sin), false);
  const columna = sin.elements.find((elemento) => elemento.category === "balloon_structure")!;
  assert.deepEqual(columna.appearance.remate_columna, { tipo: "ninguno" }, "ausente dejaría el remate del motor");
  assert.equal(ReferenceBlueprintV2Schema.safeParse(sin).success, true);
  assert.deepEqual(conRemate.elements.find((elemento) => elemento.category === "balloon_structure")!.appearance.remate_columna, { tipo: "globo", color: "dorado" }, "la lectura del mensaje no cambia");
  const racimo: ReferenceBlueprintV2 = { ...ej04, elements: ej04.elements.map((elemento) => ({ ...elemento, appearance: { ...elemento.appearance, remate_columna: { tipo: "racimo" as const } } })) };
  assert.equal(tieneRemateGrande(racimo), false, "un racimo no es un remate grande");
});

console.log(`\n${casos} casos OK`);
