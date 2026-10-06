/**
 * UI-6 (2026-10-05): un centro de mesa de pocos globos contados se compra por unidades declaradas.
 *
 * El conteo de la foto (`conteo_foto.py`) lo declara cuando la foto cuenta exactamente 1 a 3 globos; el
 * esquema del plan tiene que aceptarlo (con `variant_id` por material, como un kit) y seguir rechazando
 * unidades declaradas en cualquier otra pieza geométrica.
 *
 * Determinista y sin red. Run: npx tsx --conditions=react-server scripts/test/test-centro-contado.ts
 */
import assert from "node:assert/strict";
import { esCuentaGeometrica, PlanDecoracionSchema } from "@/lib/plan/tipos";

const material = (extra: Record<string, unknown> = {}) => ({ product_id: "prod-blanco", color: "transparente", participacion: 1, rol_material: "principal", ...extra });
const centro = (extra: Record<string, unknown> = {}) => ({
  estructura_id: "EST_01_CENTRO", nombre: "Centro de mesa", tipo: "centro_mesa", rol_escena: "focal", ubicacion: "sobre_mesa_principal",
  medidas: { ancho_m: 0.4, alto_m: 0.5 }, repeticiones: 1, densidad: "media", mezcla: "organica_fina", porque: "Como en la foto.",
  materiales: [material()], ...extra,
});
const plan = (estructura: Record<string, unknown>) => ({
  plan_version: "1.0", plan_id: "31313131-3131-4313-8313-313131313131",
  concepto: { titulo: "Prueba", descripcion: "Centro.", paleta: ["transparente"] },
  espacio: { tipo: "salon", fuente: "supuesto" }, supuestos: [], estructuras: [estructura],
});

assert.equal(esCuentaGeometrica({ tipo: "centro_mesa" }), true, "sin unidades, un centro de mesa se cuenta por geometría");
assert.equal(esCuentaGeometrica({ tipo: "centro_mesa", unidades_declaradas: 1 }), false, "con unidades es un centro contado");
assert.equal(esCuentaGeometrica({ tipo: "arco", unidades_declaradas: 1 }), true, "solo el centro de mesa puede ser contado");
assert.equal(esCuentaGeometrica({ tipo: "kit", unidades_declaradas: 5 }), false);

const geometrico = PlanDecoracionSchema.safeParse(plan(centro()));
assert.ok(geometrico.success, JSON.stringify(geometrico.error?.issues));
const contado = PlanDecoracionSchema.safeParse(plan(centro({ unidades_declaradas: 1, materiales: [material({ variant_id: "var-blanco-24" })] })));
assert.ok(contado.success, `el centro contado vale: ${JSON.stringify(contado.error?.issues)}`);
const sinVariante = PlanDecoracionSchema.safeParse(plan(centro({ unidades_declaradas: 1 })));
assert.ok(!sinVariante.success && sinVariante.error.issues.some((issue) => issue.message.includes("variant_id")), "un centro contado necesita la variante de cada globo");

console.log("test-centro-contado: OK");
