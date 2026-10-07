/**
 * El cuerpo de /api/generate es el mismo en la vista guiada y en la clásica (`src/lib/generacion/cuerpo-generacion.ts`).
 *
 * Producción, 2026-10-06 (guiada-20261006-215048-bnrhtj): la guiada mandaba solo plan, brief, solicitud y la foto; sin la
 * lectura de la foto (`blueprint`) el servidor generaba dos columnas sueltas en un lienzo vacío y FLUX las unía en un arco.
 * Aquí, para el MISMO plan aprobado de una foto, se arma el cuerpo como lo arma cada vista y se comprueba que llevan los
 * mismos campos con los mismos valores, salvo las diferencias deliberadas (brief y solicitud de cada conversación).
 * Determinista, sin red ni coste. Run: npx tsx scripts/test/test-cuerpo-generacion.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  cantidadesDelPlan,
  cuerpoGeneracion,
  fuentesDelPlan,
  resumenCuerpoGeneracion,
} from "../../src/lib/generacion/cuerpo-generacion";
import { contextoDeGeneracion } from "../../src/lib/estado/generacion-adjuntos";
import { CREATIVIDAD_POR_DEFECTO } from "../../src/lib/ia/escena/creatividad";
import { MENSAJE_SOLO_REFERENCIAS } from "../../src/lib/estado/mensaje-foto-referencia";

let fallos = 0;
function caso(nombre: string, prueba: () => void): void {
  try {
    prueba();
    console.log(`ok   ${nombre}`);
  } catch (error) {
    fallos += 1;
    console.error(`FALLA ${nombre}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

// ── Datos: un plan aprobado de dos columnas que salió de una foto ────────────────────────────────────────────────
const BASE64_FOTO = `FOTO${"x".repeat(4000)}FIN`;
const foto = { base64: BASE64_FOTO, mime: "image/jpeg" };
const plan = {
  plan: {
    concepto: { titulo: "Plata y rosa", descripcion: "Dos columnas orgánicas laterales.", paleta: ["plateado", "blanco", "rosado", "transparente"] },
    estructuras: [
      { estructura_id: "EST_01_COLUMNA", referencia_element_id: "REF_01_E01" },
      { estructura_id: "EST_01_COLUMNA_B", referencia_element_id: "REF_01_E02" },
    ],
  },
  plan_hash: "c1afac184cbe8e206b4b7bb0a94e38e72a91cece938643f1861c4266440aaf3d",
  approval_token: "token-firmado",
  compras: [
    { product_id: "P1", variant_id: "V-PLATA-12", paquetes: 3 },
    { product_id: "P1", variant_id: "V-PLATA-5", paquetes: 1 },
    { product_id: "P2", variant_id: "V-TRANSP-12", paquetes: 1 },
  ],
};
const blueprint = {
  schema_version: "2.0",
  source_images: [{ image_id: "REF_01", aspect_ratio: 1.4925 }],
  elements: [
    { element_id: "REF_01_E01", category: "balloon_structure" },
    { element_id: "REF_01_E02", category: "balloon_structure" },
    { element_id: "REF_01_E03", category: "backdrop" },
    { element_id: "REF_01_E04", category: "other" },
  ],
};
const otraLectura = { ...blueprint, elements: [] };

/** page.tsx → aprobarPlan(plan, mensajeId) → generar(): las mismas entradas que arma la clásica con la propuesta anclada. */
function cuerpoClasica() {
  return cuerpoGeneracion({
    plan,
    productIds: [],
    ragVariantIds: plan.compras.map((compra) => compra.variant_id),
    manualProducts: [],
    productQuantities: {},
    brief: { colores: ["plateado", "rosado"] },
    solicitudUsuario: MENSAJE_SOLO_REFERENCIAS,
    instruccion: "",
    creatividad: CREATIVIDAD_POR_DEFECTO,
    fotoEspacio: null,
    imagenesReferencia: [foto],
    ...contextoDeGeneracion({
      anclado: true,
      blueprintDelMensaje: blueprint,
      blueprintActual: otraLectura,
      fotoEspacioAnclada: null,
      fotoEspacioActual: null,
      aspectoActivo: undefined,
    }),
    escenografiaApagada: [],
    imagenPrevia: null,
  });
}

/** VistaGuiada → verComoQuedaria(mensajeId), con la lectura de la foto del plan (`lecturaDelPlan`). */
function cuerpoGuiada() {
  return cuerpoGeneracion({
    plan,
    ...fuentesDelPlan(plan),
    brief: { tipo_evento: "Cumpleaños", colores: plan.plan.concepto.paleta, estilo: undefined },
    solicitudUsuario: plan.plan.concepto.descripcion,
    imagenesReferencia: [foto],
    blueprint,
  });
}

/** VistaGuiada antes del arreglo, literal: lo que llegó a producción. */
const cuerpoGuiadaAntes = {
  plan,
  planHash: plan.plan_hash,
  brief: { tipo_evento: "Cumpleaños", colores: plan.plan.concepto.paleta, estilo: undefined },
  solicitudUsuario: plan.plan.concepto.descripcion,
  imagenesReferencia: [foto],
};

const camposPresentes = (cuerpo: object) => Object.entries(cuerpo).filter(([, valor]) => valor !== undefined).map(([clave]) => clave).sort();
const comoJson = (valor: unknown) => JSON.parse(JSON.stringify(valor)) as unknown;
/** Diferencias deliberadas entre vistas (ver el comentario de `cuerpoGeneracion`). */
const DELIBERADAS = new Set(["brief", "solicitudUsuario"]);

caso("la guiada y la clásica mandan los mismos campos para el mismo plan", () => {
  assert.deepEqual(camposPresentes(cuerpoGuiada()), camposPresentes(cuerpoClasica()));
});

caso("mismos valores en todo lo que no es deliberadamente de cada conversación", () => {
  const clasica = comoJson(cuerpoClasica()) as Record<string, unknown>;
  const guiada = comoJson(cuerpoGuiada()) as Record<string, unknown>;
  for (const clave of Object.keys(clasica)) {
    if (DELIBERADAS.has(clave)) continue;
    assert.deepEqual(guiada[clave], clasica[clave], `el campo «${clave}» difiere entre vistas`);
  }
  assert.deepEqual(Object.keys(clasica).filter((clave) => DELIBERADAS.has(clave)).sort(), ["brief", "solicitudUsuario"]);
});

caso("la lectura de la foto viaja: blueprint, plan y productos del plan, creatividad por defecto, foto", () => {
  const guiada = cuerpoGuiada();
  assert.equal(guiada.blueprint, blueprint, "sin blueprint el servidor no tiene escenografía, cajas de la foto ni encuadre");
  assert.equal(guiada.planHash, plan.plan_hash);
  assert.deepEqual(guiada.productIds, []);
  assert.deepEqual(guiada.ragVariantIds, ["V-PLATA-12", "V-PLATA-5", "V-TRANSP-12"]);
  assert.deepEqual(guiada.productQuantities, { "V-PLATA-12": 3, "V-PLATA-5": 1, "V-TRANSP-12": 1 });
  assert.equal(guiada.creatividad, CREATIVIDAD_POR_DEFECTO);
  assert.deepEqual(guiada.imagenesReferencia, [foto]);
  assert.equal(guiada.aspecto, undefined, "sin foto del espacio el lienzo lo decide el servidor con el blueprint");
});

caso("el cuerpo de antes (producción) es justo lo que faltaba", () => {
  const faltaban = camposPresentes(cuerpoGuiada()).filter((clave) => !camposPresentes(cuerpoGuiadaAntes).includes(clave));
  assert.deepEqual(faltaban, ["blueprint", "creatividad", "productIds", "productQuantities", "ragVariantIds"]);
});

caso("anclada, la clásica usa la lectura de SU mensaje y no la de la foto actual", () => {
  assert.equal(cuerpoClasica().blueprint, blueprint);
});

caso("con plan, los paquetes del plan ganan; el resto de cantidades de la clásica se conserva", () => {
  const cuerpo = cuerpoGeneracion({ plan, productQuantities: { "V-PLATA-12": 9, "OTRA": 2 }, ragVariantIds: ["V-PLATA-12"] });
  assert.deepEqual(cuerpo.productQuantities, { "V-PLATA-12": 3, OTRA: 2, "V-PLATA-5": 1, "V-TRANSP-12": 1 });
  assert.deepEqual(cantidadesDelPlan({ plan_hash: "h", compras: [{ variant_id: "A", paquetes: "2" }, { variant_id: "B", paquetes: 0 }, { variant_id: "C" }] }), {});
});

caso("fuentes: ids normalizados y las piezas manual- solo en manualProducts", () => {
  const manual = { id: "manual-1", nombre: "Pieza a mano" } as unknown as import("../../src/lib/types").Producto;
  const cuerpo = cuerpoGeneracion({ productIds: ["L1", "V1", "L1", "manual-1"], ragVariantIds: ["V1", "V1"], manualProducts: [manual] });
  assert.deepEqual(cuerpo.productIds, ["L1"]);
  assert.deepEqual(cuerpo.ragVariantIds, ["V1"]);
  assert.deepEqual(cuerpo.manualProducts, [manual]);
  assert.equal(cuerpoGeneracion({}).ragVariantIds, undefined);
  assert.equal(cuerpoGeneracion({}).manualProducts, undefined);
});

caso("ajuste: imagen previa solo con ajuste; revisión solo con imagen previa (como la clásica)", () => {
  const previa = { base64: "PREVIA", mime: "image/png", id: "PREVIOUS_RESULT" };
  const conAmbos = cuerpoGeneracion({ instruccion: "más rosado", imagenPrevia: previa });
  assert.equal(conAmbos.instruccion, "más rosado");
  assert.equal(conAmbos.previousGeneratedImage, previa);
  assert.equal(conAmbos.revisionInstruction, "más rosado");
  const sinPrevia = cuerpoGeneracion({ instruccion: "más rosado", imagenPrevia: null });
  assert.equal(sinPrevia.previousGeneratedImage, undefined);
  assert.equal(sinPrevia.revisionInstruction, undefined);
  const sinAjuste = cuerpoGeneracion({ instruccion: "", imagenPrevia: previa });
  assert.equal(sinAjuste.instruccion, undefined);
  assert.equal(sinAjuste.previousGeneratedImage, undefined);
  assert.equal(sinAjuste.revisionInstruction, undefined);
});

caso("escenografía apagada y foto del espacio con la forma que acepta el servidor", () => {
  const cuerpo = cuerpoGeneracion({ escenografiaApagada: ["REF_01_E04"], fotoEspacio: { base64: "ESPACIO", mime: "image/jpeg", aspecto: "3:2" } as { base64: string; mime: string } });
  assert.deepEqual(cuerpo.escenografia, [{ element_id: "REF_01_E04", visible: false }]);
  assert.deepEqual(cuerpo.fotoEspacio, { base64: "ESPACIO", mime: "image/jpeg" });
  assert.equal(cuerpoGeneracion({ escenografiaApagada: [] }).escenografia, undefined);
});

caso("solo campos que /api/generate acepta (tipo Body) y ninguno retirado", () => {
  const ruta = readFileSync(path.join(process.cwd(), "src/app/api/generate/route.ts"), "utf8");
  const tipoBody = /type Body = \{([\s\S]*?)\n\};/.exec(ruta)?.[1] ?? "";
  const aceptados = new Set([...tipoBody.matchAll(/^\s{2}(\w+)\??:/gm)].map((coincidencia) => coincidencia[1]!));
  assert.ok(aceptados.size > 10, "no se pudo leer el tipo Body de la ruta");
  const completo = cuerpoGeneracion({
    plan, productIds: ["L1"], ragVariantIds: ["V1"], productQuantities: { L1: 1 }, manualProducts: [{ id: "manual-1" } as unknown as import("../../src/lib/types").Producto],
    brief: {}, solicitudUsuario: "s", instruccion: "i", creatividad: 3, fotoEspacio: foto, imagenesReferencia: [foto], blueprint, aspecto: "3:2",
    escenografiaApagada: ["E"], imagenPrevia: foto,
  });
  for (const clave of camposPresentes(completo)) assert.ok(aceptados.has(clave), `/api/generate no declara «${clave}»`);
  for (const retirado of ["usarLora", "loraMode", "loraSelection", "promptFormat", "seed", "previousInteractionId", "interactionId", "proveedor"]) {
    assert.ok(!(retirado in completo), `el cuerpo no debe llevar «${retirado}»`);
  }
});

caso("el resumen para los registros no lleva imágenes y deja comparar las vistas", () => {
  const resumen = resumenCuerpoGeneracion(cuerpoGuiada());
  const texto = JSON.stringify(resumen);
  assert.ok(!texto.includes("FOTO"), "el resumen no puede llevar base64");
  assert.ok(!texto.includes("token-firmado"), "el resumen no lleva el token de aprobación");
  assert.deepEqual(resumen.blueprint, { elementos: 4, estructurasDeGlobos: 2, aspectoFoto: 1.4925 });
  assert.equal(resumen.estructurasConReferencia, 2);
  assert.equal(resumen.ragVariantIds, 3);
  assert.equal(resumen.imagenesReferencia.length, 1);
  assert.equal(resumenCuerpoGeneracion(cuerpoGuiadaAntes).blueprint, null);
  assert.deepEqual(resumenCuerpoGeneracion(cuerpoClasica()).campos, resumen.campos);
});

caso("las dos vistas llaman a /api/generate con el constructor compartido", () => {
  const clasica = readFileSync(path.join(process.cwd(), "src/app/page.tsx"), "utf8");
  const guiada = readFileSync(path.join(process.cwd(), "src/components/guiado/VistaGuiada.tsx"), "utf8");
  assert.match(clasica, /body: JSON\.stringify\(cuerpoGeneracion\(\{/);
  assert.match(guiada, /const cuerpo = cuerpoGeneracion\(\{[\s\S]{0,400}blueprint: widget\.fotoInspiracion \? lecturaDelPlan\(/);
  assert.match(guiada, /fetch\("\/api\/generate", \{[\s\S]{0,160}body: JSON\.stringify\(cuerpo\)/);
  assert.match(guiada, /registrarAccion\("imagen\.pedir", \{ mensajeId, cuerpo: resumenCuerpoGeneracion\(cuerpo\) \}\)/);
});

caso("el plan con foto de la guiada parte del mismo texto que la clásica", () => {
  const clasica = readFileSync(path.join(process.cwd(), "src/app/page.tsx"), "utf8");
  const guiada = readFileSync(path.join(process.cwd(), "src/components/guiado/VistaGuiada.tsx"), "utf8");
  assert.match(clasica, /else if \(hayEstilo\) limpio = MENSAJE_SOLO_REFERENCIAS;/);
  assert.match(guiada, /reintento \? instruccionPlanFoto\(\{ reintento, colores \}\) : `\$\{MENSAJE_SOLO_REFERENCIAS\}\\n\$\{CONFIRMAR_PLAN_FOTO\}`/);
  assert.match(guiada, /creatividad: CREATIVIDAD_POR_DEFECTO,\s+\.\.\.\(imagen \? \{ imagenesReferencia: \[imagen\] \} : \{\}\),\s+referenceBlueprint: referencia\.blueprint,/);
});

if (fallos > 0) {
  console.error(`\n${fallos} caso(s) fallaron.`);
  process.exit(1);
}
console.log("\nCuerpo de generación: guiada = clásica.");
