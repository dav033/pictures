import assert from "node:assert/strict";
import { PlanDecoracionSchema } from "../src/lib/plan/tipos";
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
