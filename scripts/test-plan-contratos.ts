import assert from "node:assert/strict";
import { PlanDecoracionSchema, PlanDecoracion1_1Schema, PropCatalogoSchema } from "../src/lib/plan/tipos";
import { validarRestriccionesPlan } from "../src/lib/plan/restricciones";

const id = "11111111-1111-4111-8111-111111111111";
const estructura = {
  estructura_id: "EST_01_ARCO",
  nombre: "Arco focal",
  tipo: "arco",
  rol_escena: "focal",
  ubicacion: "arco_central",
  medidas: { ancho_m: 3, alto_m: 2.4 },
  repeticiones: 1,
  densidad: "media",
  mezcla: "organica_fina",
  materiales: [{ product_id: "P-1", color: "rojo", participacion: 1, rol_material: "principal" }],
  porque: "Punto focal de las fotos.",
} as const;
const base = {
  plan_version: "1.0",
  plan_id: id,
  concepto: { titulo: "Fiesta", descripcion: "Instalación focal.", paleta: ["rojo"] },
  espacio: { tipo: "salón", fuente: "supuesto" },
  estructuras: [estructura],
  supuestos: [],
};

assert.equal(PlanDecoracionSchema.safeParse(base).success, true);
assert.equal(PlanDecoracionSchema.safeParse({ ...base, estructuras: [{ ...estructura, materiales: [{ ...estructura.materiales[0], participacion: 0.9 }] }] }).success, false);
assert.equal(PlanDecoracionSchema.safeParse({ ...base, estructuras: [{ ...estructura, estructura_id: "EST_01_ARCO", ubicacion: "arco_central", tipo: "backdrop", unidades_declaradas: 1, materiales: [{ product_id: "P-1", variant_id: "V-1", participacion: 1, rol_material: "principal" }] }] }).success, false);
assert.equal(PlanDecoracionSchema.safeParse({ ...base, estructuras: [{ ...estructura, tipo: "backdrop", ubicacion: "fondo_pared", unidades_declaradas: 1, materiales: [{ product_id: "P-1", variant_id: "V-1", participacion: 1, rol_material: "principal" }] }] }).success, true);
assert.equal(PlanDecoracionSchema.safeParse({ ...base, estructuras: [{ ...estructura, estructura_id: "EST_01_ARCO", rol_escena: "soporte" }] }).success, false);
assert.equal(PlanDecoracionSchema.safeParse({ ...base, estructuras: [{ ...estructura, tipo: "centro_mesa", ubicacion: "fondo_pared", medidas: { ancho_m: 0.4, alto_m: 0.5 } }] }).success, false);
assert.equal(PlanDecoracionSchema.safeParse({ ...base, estructuras: [{ ...estructura, unidades_declaradas: 4 }] }).success, false);
assert.equal(PlanDecoracionSchema.safeParse({ ...base, estructuras: [{ ...estructura, repeticiones: 25 }] }).success, false);
assert.equal(PlanDecoracionSchema.safeParse({ ...base, estructuras: [{ ...estructura, estructura_id: "EST_01_ARCO", materiales: [{ ...estructura.materiales[0], tamano: "R-12" }] }] }).success, false);
assert.equal(PlanDecoracionSchema.safeParse({ ...base, estructuras: [{ ...estructura, ubicacion: "fondo_pared" }, { ...estructura, estructura_id: "EST_02_ARCO", ubicacion: "fondo_pared" }] }).success, false);
assert.equal(PlanDecoracionSchema.safeParse({ ...base, estructuras: [{ ...estructura, estructura_id: "EST_01_ARCO" }, { ...estructura, estructura_id: "EST_01_ARCO" }] }).success, false);
assert.equal(PlanDecoracionSchema.safeParse({ ...base, materiales: [{ product_id: "P-1" }] }).success, false);
const restriccionesAcabado = {
  acabados: [{ valor: "satin", procedencia: "explicito", texto_original: "acabado satin", polaridad: "obligatorio" }],
};
const planSatin = PlanDecoracionSchema.parse({
  ...base,
  restricciones: restriccionesAcabado,
  estructuras: [{ ...estructura, materiales: [{ ...estructura.materiales[0], acabado: "satin" }] }],
});
assert.deepEqual(validarRestriccionesPlan(planSatin, planSatin.restricciones!), []);
const planSinSatin = PlanDecoracionSchema.parse({ ...base, restricciones: restriccionesAcabado });
assert.match(validarRestriccionesPlan(planSinSatin, planSinSatin.restricciones!).join(" | "), /acabado explícito satin/);

console.log("[PASS] contratos de PlanDecoracion — 12 reglas de validación");

// ---------------------------------------------------------------------------
// Plan 1.1 (PLAN-COMPOSICION-RICA-V001.md §11.1): escultura con BOM exacto,
// anclas con evidencia, relaciones físicas y props de catálogo.
// ---------------------------------------------------------------------------

const idV11 = "22222222-2222-4222-8222-222222222222";

const anclaPuerta = {
  ancla_id: "ANC_PUERTA",
  tipo: "puerta",
  procedencia: "cliente",
  evidencia: "El cliente pidió enmarcar la puerta principal.",
};

const guirnaldaPuerta = {
  estructura_id: "EST_01_GUIRNALDA",
  nombre: "Guirnalda de puerta",
  tipo: "guirnalda",
  rol_escena: "focal",
  ubicacion: "entrada",
  medidas: { ancho_m: 2, alto_m: 2.5 },
  repeticiones: 1,
  densidad: "media",
  mezcla: "organica_fina",
  materiales: [{ product_id: "P-GLOBO", participacion: 1, rol_material: "principal" }],
  porque: "Enmarca la puerta principal con la guirnalda.",
  relaciones_fisicas: [{ relacion: "enmarcar", target: { kind: "ancla_espacio", id: "ANC_PUERTA" }, prioridad: "primaria" }],
} as const;

const materialesArana = [
  { product_id: "P-GLOBO-NEGRO", variant_id: "V-NEGRO-R12", rol_material: "principal", unidades_por_instancia: 12, parte_ids: ["cuerpo"] },
  { product_id: "P-GLOBO-NEGRO-MODELAR", variant_id: "V-NEGRO-MODELAR", rol_material: "secundario", unidades_por_instancia: 8, parte_ids: ["patas"] },
  { product_id: "P-GLOBO-BLANCO", variant_id: "V-BLANCO-R5", rol_material: "acento", unidades_por_instancia: 2, parte_ids: ["ojos"] },
  { product_id: "P-GLOBO-NEGRO-R5", variant_id: "V-NEGRO-R5", rol_material: "acento", unidades_por_instancia: 2, parte_ids: ["ojos"] },
];

const partesArana = [
  { parte_id: "cuerpo", funcion: "volumen_principal", descriptor_perceptual_en: "a round black balloon body", variant_ids: ["V-NEGRO-R12"] },
  { parte_id: "patas", funcion: "extremidad", descriptor_perceptual_en: "long curved black balloon legs", variant_ids: ["V-NEGRO-MODELAR"] },
  { parte_id: "ojos", funcion: "detalle", descriptor_perceptual_en: "small white and black balloon eyes", variant_ids: ["V-BLANCO-R5", "V-NEGRO-R5"] },
];

const esculturaArana = {
  estructura_id: "EST_02_ARANA",
  nombre: "Escultura de araña",
  tipo: "escultura",
  rol_escena: "acento",
  ubicacion: "esquina",
  medidas: {},
  repeticiones: 1,
  densidad: "media",
  mezcla: "organica_gruesa",
  materiales: materialesArana,
  escultura_visual: {
    categoria_sujeto: "animal",
    sujeto: "araña",
    descripcion_perceptual_en: "a balloon spider sculpture with a round black body and curved black legs",
    partes: partesArana,
  },
  porque: "Escultura temática montada en la esquina de la entrada.",
  relaciones_fisicas: [{ relacion: "montar_sobre", target: { kind: "elemento_plan", id: "EST_01_GUIRNALDA" }, prioridad: "primaria" }],
} as const;

const baseV11 = {
  plan_version: "1.1",
  plan_id: idV11,
  concepto: { titulo: "Halloween", descripcion: "Puerta enmarcada con araña.", paleta: ["negro"] },
  espacio: { tipo: "porche", fuente: "cliente", anclas: [anclaPuerta] },
  estructuras: [guirnaldaPuerta, esculturaArana],
  supuestos: [],
};

// Escultura válida con cuatro variantes de BOM y partes ligadas.
assert.equal(PlanDecoracion1_1Schema.safeParse(baseV11).success, true, "el plan 1.1 base (guirnalda + escultura de araña) debe ser válido");

// Rechazo de componente sin variant_id.
assert.equal(
  PlanDecoracion1_1Schema.safeParse({
    ...baseV11,
    estructuras: [guirnaldaPuerta, { ...esculturaArana, materiales: [{ ...materialesArana[0], variant_id: undefined }, ...materialesArana.slice(1)] }],
  }).success,
  false,
  "un material de escultura sin variant_id debe fallar",
);

// Rechazo de componente sin unidades por instancia.
assert.equal(
  PlanDecoracion1_1Schema.safeParse({
    ...baseV11,
    estructuras: [guirnaldaPuerta, { ...esculturaArana, materiales: [{ ...materialesArana[0], unidades_por_instancia: undefined }, ...materialesArana.slice(1)] }],
  }).success,
  false,
  "un material de escultura sin unidades_por_instancia debe fallar",
);

// Rechazo de parte sin variante en el BOM (referencia una variante que no existe entre los materiales).
assert.equal(
  PlanDecoracion1_1Schema.safeParse({
    ...baseV11,
    estructuras: [guirnaldaPuerta, {
      ...esculturaArana,
      escultura_visual: { ...esculturaArana.escultura_visual, partes: [...partesArana, { parte_id: "base", funcion: "base", descriptor_perceptual_en: "a wide balloon base", variant_ids: ["V-INEXISTENTE"] }] },
    }],
  }).success,
  false,
  "una parte que referencia una variante fuera del BOM debe fallar",
);

// Rechazo de variante del BOM que ninguna parte usa.
assert.equal(
  PlanDecoracion1_1Schema.safeParse({
    ...baseV11,
    estructuras: [guirnaldaPuerta, {
      ...esculturaArana,
      materiales: [...materialesArana, { product_id: "P-GLOBO-EXTRA", variant_id: "V-EXTRA-SIN-USAR", rol_material: "acento", unidades_por_instancia: 1 }],
    }],
  }).success,
  false,
  "una variante del BOM que ninguna parte usa debe fallar",
);

// Rechazo de ancla con procedencia "supuesto" — no es una procedencia válida.
assert.equal(
  PlanDecoracion1_1Schema.safeParse({ ...baseV11, espacio: { ...baseV11.espacio, anclas: [{ ...anclaPuerta, procedencia: "supuesto" }] } }).success,
  false,
  "un ancla con procedencia supuesto debe fallar",
);

// Rechazo de target inexistente (ancla que no está declarada en espacio.anclas).
assert.equal(
  PlanDecoracion1_1Schema.safeParse({
    ...baseV11,
    estructuras: [{ ...guirnaldaPuerta, relaciones_fisicas: [{ relacion: "enmarcar", target: { kind: "ancla_espacio", id: "ANC_NO_EXISTE" }, prioridad: "primaria" }] }, esculturaArana],
  }).success,
  false,
  "una relación que apunta a un ancla inexistente debe fallar",
);

// Rechazo de dos relaciones primarias en el mismo elemento.
assert.equal(
  PlanDecoracion1_1Schema.safeParse({
    ...baseV11,
    estructuras: [{
      ...guirnaldaPuerta,
      relaciones_fisicas: [
        { relacion: "enmarcar", target: { kind: "ancla_espacio", id: "ANC_PUERTA" }, prioridad: "primaria" },
        { relacion: "trepar_por", target: { kind: "ancla_espacio", id: "ANC_PUERTA" }, prioridad: "primaria" },
      ],
    }, esculturaArana],
  }).success,
  false,
  "dos relaciones primarias en un mismo elemento deben fallar",
);

// Rechazo de ciclo de profundidad entre dos elementos del plan.
const cicloA = { ...guirnaldaPuerta, estructura_id: "EST_03_CICLO_A", relaciones_fisicas: [{ relacion: "conectar_con", target: { kind: "elemento_plan", id: "EST_04_CICLO_B" }, prioridad: "primaria" }] };
const cicloB = { ...guirnaldaPuerta, estructura_id: "EST_04_CICLO_B", ubicacion: "vegetacion", relaciones_fisicas: [{ relacion: "conectar_con", target: { kind: "elemento_plan", id: "EST_03_CICLO_A" }, prioridad: "primaria" }] };
assert.equal(
  PlanDecoracion1_1Schema.safeParse({ ...baseV11, estructuras: [cicloA, cicloB] }).success,
  false,
  "un ciclo de profundidad entre dos elementos debe fallar",
);

// Prop válido, sin campos visuales libres (nombre/color/material/descripcion_visual no existen en el schema).
const propValido = {
  prop_id: "PROP_CALABAZA",
  product_id: "P-CALABAZA",
  variant_id: "V-CALABAZA-TALLADA",
  unidades_declaradas: 3,
  rol_escena: "acento",
  ubicacion: "entrada",
  relaciones_fisicas: [],
  porque: "Props temáticos alrededor de la puerta.",
};
assert.equal(PropCatalogoSchema.safeParse(propValido).success, true, "un prop de catálogo bien formado debe ser válido");
assert.equal(PropCatalogoSchema.safeParse({ ...propValido, nombre: "Calabaza tallada" }).success, false, "un prop no acepta un campo nombre escrito por el LLM");
assert.equal(PropCatalogoSchema.safeParse({ ...propValido, color: "naranja" }).success, false, "un prop no acepta un campo color escrito por el LLM");
assert.equal(PropCatalogoSchema.safeParse({ ...propValido, descripcion_visual: "una calabaza tallada" }).success, false, "un prop no acepta descripcion_visual escrita por el LLM");
assert.equal(
  PlanDecoracion1_1Schema.safeParse({ ...baseV11, props_catalogo: [propValido] }).success,
  true,
  "un plan 1.1 con un prop de catálogo válido debe pasar",
);

// Plan 1.0 no acepta campos 1.1 (el schema es .strict() y no los declara).
assert.equal(PlanDecoracionSchema.safeParse({ ...base, props_catalogo: [] }).success, false, "un plan 1.0 no debe aceptar props_catalogo");
assert.equal(PlanDecoracionSchema.safeParse({ ...base, espacio: { ...base.espacio, anclas: [] } }).success, false, "un plan 1.0 no debe aceptar espacio.anclas");
assert.equal(
  PlanDecoracionSchema.safeParse({ ...base, estructuras: [{ ...estructura, relaciones_fisicas: [] }] }).success,
  false,
  "una estructura de plan 1.0 no debe aceptar relaciones_fisicas",
);

// Plan 1.1 no usa arco_central: esa ubicación queda reservada a Plan 1.0.
assert.equal(
  PlanDecoracion1_1Schema.safeParse({ ...baseV11, estructuras: [{ ...guirnaldaPuerta, ubicacion: "arco_central" }, esculturaArana] }).success,
  false,
  "un plan 1.1 no debe aceptar la ubicación arco_central",
);

console.log("[PASS] contratos de PlanDecoracion 1.1 — escultura, anclas, relaciones físicas y props de catálogo");
