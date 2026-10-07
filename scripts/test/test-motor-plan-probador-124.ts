/**
 * Los hallazgos de motor y plan del probador 124 (producción, 2026-10-07), sin red, sin modelo y sin coste:
 *
 *   3  «Modificar esta pieza» abre con lo que el plan tiene de verdad (pieza-desde-plan.ts, ModificarPieza.tsx): con
 *      el plan exacto de deco-real-07 y las respuestas REALES del motor de columna orgánica para sus dos columnas
 *      (`scripts/fixtures/modificar-pieza-plan/deco-real-07-columnas.json`, generadas con el código del Python del VPS
 *      sin servidor), y con el fixture de columnas (`plan-guiado-columnas-repetidas.json`);
 *   4  decorador «arco orgánico de unos 3 metros»: el arco completo con mezcla orgánica, el editor de arco orgánico,
 *      la medida en la pieza, «Propónme algo» sin volver a preguntar la pieza y el supuesto de medidas sin «no me
 *      diste el tamaño»;
 *   7  foto ejemplo-01: la parte de cada color que ve el cliente es la que recibe el plan (lectura determinista de
 *      `lecturas-ejemplos.json`), y la diferencia entre los globos de la foto y los del plan se dice.
 *
 * Run: npx tsx scripts/test/test-motor-plan-probador-124.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { ReferenceBlueprintV2Schema, type ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import { adaptarAnalisisReferencia } from "@/lib/ia/guiado/adaptar-analisis-referencia";
import { ajustesDePython } from "@/lib/ia/guiado/ajustes-python";
import { contextoClienteGuiado } from "@/lib/ia/guiado/contexto-cliente";
import { hechosDelCliente, piezaOrganicaDelBoton, propuestaConLoPedido } from "@/lib/ia/guiado/hechos-cliente";
import { instruccionPlanGuiado } from "@/lib/ia/guiado/instruccion-plan";
import type { ArmadoColumnaOrganicaV1 } from "@/lib/plan/armado-columna-organica";
import { partesDeColorPieza } from "@/lib/plan/colores-referencia";
import { FalloPlanArmado } from "@/lib/plan/peticion-armado";
import type { VistaArmadoColumnaOrganica } from "@/lib/plan/peticion-armado-columna-organica";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import { mismoArmadoColumnaOrganica } from "@/components/plan/columna-organica/borrador-columna-organica";
import { puedeGuardarColumnaOrganica } from "@/components/plan/columna-organica/guardar-columna-organica";
import { AvisoPiezaPlan, ConfirmarPiezaPlan } from "@/components/guiado/AvisoPiezaPlan";
import { lecturaFoto } from "@/components/guiado/lectura-foto";
import { leyendaDePieza, motorDePieza } from "@/components/guiado/motor-pieza";
import {
  abrirConElPlan,
  cifrasDelPlan,
  compararConPlan,
  conRellenoHacia,
  globosDelConteo,
  sembrarColumnaOrganica,
  type Apertura,
} from "@/components/guiado/pieza-desde-plan";

const RAIZ = process.cwd();
const leer = (ruta: string) => readFileSync(path.join(RAIZ, ruta), "utf8");
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, "\"").replace(/\s+/g, " ").trim();
let casos = 0;
function ok(mensaje: string): void { casos += 1; console.log(`ok ${casos} - ${mensaje}`); }

// ── 3. «Modificar esta pieza» desde el plan ───────────────────────────────────────────────────────────────────────
async function principal(): Promise<void> {
const ID07 = "deco-real-07-eb12910e210c94b6184d025127acce95";
const idea07 = (JSON.parse(leer("src/lib/biblioteca-sempertex/planes-ideas.json")) as { ideas: Record<string, { plan: unknown }> }).ideas[ID07]!;
const crudo07 = JSON.parse(leer("data/biblioteca-real/analisis/real-07-eb12910e210c94b6184d025127acce95.plan.json")) as { plan_resuelto: Record<string, unknown> };
const plan07 = PlanGuiadoSchema.parse({ ...({ ...crudo07.plan_resuelto, plan: idea07.plan } as unknown as PlanResuelto), approval_token: "prueba" });
type Respuesta = VistaArmadoColumnaOrganica;
// Las respuestas del motor en el orden en que abrirConElPlan las pidió: receta, sembrada y (la izquierda) corregida.
const GRABADO = JSON.parse(leer("scripts/fixtures/modificar-pieza-plan/deco-real-07-columnas.json")) as Record<"izquierda" | "derecha", { estructura_id: string; respuestas: Respuesta[] }>;
assert.equal(GRABADO.izquierda.respuestas.length, 3);
assert.equal(GRABADO.derecha.respuestas.length, 2);
const MOTOR = {
  izquierda: { estructura_id: GRABADO.izquierda.estructura_id, receta: GRABADO.izquierda.respuestas[0]!, sembrada: GRABADO.izquierda.respuestas[1]!, corregida: GRABADO.izquierda.respuestas[2]! },
  derecha: { estructura_id: GRABADO.derecha.estructura_id, receta: GRABADO.derecha.respuestas[0]!, sembrada: GRABADO.derecha.respuestas[1]! },
};
const globos = (vista: Respuesta) => globosDelConteo(vista.columna.conteo);
const reparto = (vista: Respuesta) => [...globos(vista).porMaterial.entries()].sort(([a], [b]) => a - b).map(([, cantidad]) => cantidad);

{
  const izquierda = cifrasDelPlan(plan07, MOTOR.izquierda.estructura_id)!;
  assert.equal(izquierda.total, 39);
  assert.deepEqual(izquierda.porMaterial.map((color) => color.globos), [15, 14, 10], "el lila sustituido (Pastel Dusk Lavanda) cuenta para el lila");
  assert.deepEqual(izquierda.porTamano, { 5: 8, 9: 7, 12: 21, 18: 2, 24: 1 });
  assert.deepEqual(izquierda.medidas, { ancho_m: 0.55, alto_m: 2 });
  assert.equal(izquierda.fueraDelMotor, 0);
  const derecha = cifrasDelPlan(plan07, MOTOR.derecha.estructura_id)!;
  assert.equal(derecha.total, 48);
  assert.deepEqual(derecha.porMaterial.map((color) => color.globos), [19, 17, 12]);
  // Reproducción: la receta del motor (lo que abría antes) no es la columna del plan.
  const receta = MOTOR.izquierda.receta;
  assert.equal(globos(receta).total, 48);
  assert.deepEqual(reparto(receta), [19, 17, 12]);
  assert.ok(receta.columna.ancho_m > 1.1, `ancho de la receta ${receta.columna.ancho_m}`);
  assert.ok(!globos(receta).tamanos.includes(9), "la receta no lleva 9″");
  ok("3: las cifras de cada columna salen del plan (39 = 15/14/10 y 48 = 19/17/12, 0,55 × 2 m, 5-24″); la receta de antes daba 48 globos, 1,14 m y sin 9″");
}

{
  const cifras = cifrasDelPlan(plan07, MOTOR.izquierda.estructura_id)!;
  const receta = MOTOR.izquierda.receta;
  const siembra = sembrarColumnaOrganica(receta.armado, cifras, receta.limites);
  // Lo que se le mandó al motor es exactamente lo que siembra el editor (la fixture es la respuesta real a ese armado).
  assert.deepEqual(siembra.armado, MOTOR.izquierda.sembrada.armado);
  assert.equal(siembra.armado.forma.altoM, 2);
  assert.equal(siembra.armado.volumen.grosorPatasM, 0.55);
  // Todos los tamaños, con 0 los que el plan no usa: el motor completa un tamaño no nombrado con su peso de partida.
  assert.deepEqual(siembra.armado.tamanos.mezcla, { 5: 21, 9: 18, 12: 54, 18: 5, 24: 3, 36: 0 });
  assert.deepEqual(siembra.armado.colores.paleta.map((color) => [color.material, color.peso]), [[0, 38], [1, 36], [2, 26]]);
  assert.deepEqual(siembra.desdeElPlan, ["volumen.grosorPatasM", "volumen.grosorCimaM", "tamanos.mezcla", "colores.paleta"], "el alto ya lo trae la receta (el del plan)");
  // La receta del motor se conserva en lo que el plan no dice (forma, adornos, aspecto, acabados).
  assert.equal(siembra.armado.forma.inclinacionM, receta.armado.forma.inclinacionM);
  assert.deepEqual(siembra.armado.aspecto, receta.armado.aspecto);
  const sembrada = MOTOR.izquierda.sembrada;
  assert.ok(globos(sembrada).tamanos.includes(9), "con la mezcla del plan el dibujo lleva 9″");
  assert.ok(sembrada.columna.grosor_base_m < 0.6, `grosor de la base ${sembrada.columna.grosor_base_m}`);
  const corregido = conRellenoHacia(siembra.armado, globos(sembrada).total, cifras.total);
  assert.deepEqual(corregido, MOTOR.izquierda.corregida.armado, "la corrección de lo lleno es la que dibujó el motor");
  assert.equal(conRellenoHacia(siembra.armado, 40, 39), null, "dentro de la tolerancia no se pide otro dibujo");
  ok("3: la receta se siembra con el alto, el grosor, la mezcla (con 9″) y el peso de cada color del plan; lo lleno se corrige una vez hacia su total");
}

/** El motor de mentira: devuelve la respuesta real que corresponde al armado pedido. */
function motorDeFixture(lado: { receta: Respuesta; sembrada: Respuesta; corregida?: Respuesta }, fallarSembrada?: unknown) {
  const pedidos: Array<ArmadoColumnaOrganicaV1 | null> = [];
  const pedir = async (armado: ArmadoColumnaOrganicaV1 | null): Promise<Respuesta> => {
    pedidos.push(armado);
    if (armado === null) return lado.receta;
    if (mismoArmadoColumnaOrganica(armado, lado.sembrada.armado)) { if (fallarSembrada) throw fallarSembrada; return lado.sembrada; }
    if (lado.corregida && mismoArmadoColumnaOrganica(armado, lado.corregida.armado)) return lado.corregida;
    throw new Error(`armado inesperado: ${JSON.stringify(armado.volumen)}`);
  };
  return { pedir, pedidos };
}

async function abrir(estructuraId: string, lado: { receta: Respuesta; sembrada: Respuesta; corregida?: Respuesta }, fallarSembrada?: unknown): Promise<{ apertura: Apertura<Respuesta>; pedidos: Array<ArmadoColumnaOrganicaV1 | null> }> {
  const cifras = cifrasDelPlan(plan07, estructuraId)!;
  const motor = motorDeFixture(lado, fallarSembrada);
  const apertura = await abrirConElPlan<ArmadoColumnaOrganicaV1, Respuesta>({
    pedir: motor.pedir,
    sembrar: (receta) => sembrarColumnaOrganica(receta.armado, cifras, receta.limites),
    globos: (vista) => globos(vista).total,
    corregir: conRellenoHacia,
    objetivo: cifras.total,
    esCancelacion: (error) => error instanceof DOMException && error.name === "AbortError",
  });
  return { apertura, pedidos: motor.pedidos };
}

const leyenda07 = leyendaDePieza(plan07, MOTOR.izquierda.estructura_id);

await (async () => {
  const { apertura, pedidos } = await abrir(MOTOR.izquierda.estructura_id, MOTOR.izquierda);
  assert.equal(apertura.origen, "plan");
  assert.equal(apertura.pedidos, 3);
  assert.equal(pedidos[0], null, "primero la receta (el armado completo y los rangos del motor)");
  assert.equal(apertura.vista, MOTOR.izquierda.corregida, "se queda el dibujo más cercano al plan");
  assert.equal(apertura.globosDibujo, 37);
  assert.deepEqual(reparto(apertura.vista), [14, 13, 10]);
  const cifras = cifrasDelPlan(plan07, MOTOR.izquierda.estructura_id)!;
  const comparacion = compararConPlan(cifras, globos(apertura.vista));
  assert.equal(comparacion.exacta, false);
  // Abrir y cerrar, o guardar sin tocar nada, no cambia el plan: el borrador ES el armado con que abrió y sin cambios no
  // se ofrece Guardar (ModificarPieza: `armado={guardado ?? estado.inicial.vista.armado}`).
  const sinCambios = !mismoArmadoColumnaOrganica(apertura.vista.armado, apertura.vista.armado);
  const guardar = puedeGuardarColumnaOrganica({ estado: { borrador: "listo", error: null }, hayCambios: sinCambios, guardando: false, ocupado: false });
  assert.deepEqual(guardar, { puede: false, motivo: "Todavía no cambiaste nada.", tipo: "nada" });
  // Lo que ve el cliente: en qué se aparta y que su plan no cambia mientras no guarde.
  const aviso = texto(renderToStaticMarkup(createElement(AvisoPiezaPlan, { comparacion, origen: "plan", pieza: "la columna orgánica izquierda", leyenda: leyenda07, hayCambios: false, fueraDelMotor: 0 })));
  assert.match(aviso, /El dibujo se parece a tu plan, pero no es idéntico/);
  // El lila se nombra como se compra (Pastel Dusk Lavanda → «Lavanda pastel»), con la leyenda de la pieza.
  assert.match(aviso, /Tu plan: 39 globos \(Rosado 15 · Lavanda pastel 14 · Dorado cromado 10\)/, aviso);
  assert.match(aviso, /El dibujo: 37 globos \(Rosado 14 · Lavanda pastel 13 · Dorado cromado 10\)/, aviso);
  assert.match(aviso, /Tamaños: tu plan lleva de 5, 9, 12, 18 y 24″; el dibujo, de 5, 9, 12 y 18″\./);
  assert.match(aviso, /Tu plan no cambia mientras no guardes\. Si guardas un cambio, la columna orgánica izquierda se queda con los globos del dibujo\./);
  const conCambio = texto(renderToStaticMarkup(createElement(AvisoPiezaPlan, { comparacion: compararConPlan(cifras, globos(MOTOR.izquierda.receta)), origen: "plan", pieza: "la columna orgánica izquierda", leyenda: leyenda07, hayCambios: true, fueraDelMotor: 0 })));
  assert.match(conCambio, /Si guardas, la columna orgánica izquierda pasa de 39 globos a 48 globos/);
  const pregunta = texto(renderToStaticMarkup(createElement(ConfirmarPiezaPlan, { pieza: "la columna orgánica izquierda", antes: 39, despues: compararConPlan(cifras, globos(MOTOR.izquierda.receta)).dibujo, leyenda: leyenda07, onGuardar: () => {}, onSeguir: () => {} })));
  assert.match(pregunta, /¿Guardo la columna orgánica izquierda con 48 globos\? Tu plan tiene 39 globos\./);
  assert.match(pregunta, /Sí, guardar con 48 globos/);
  assert.match(pregunta, /Seguir editando/);
  ok("3: la columna izquierda abre con 37 globos (14/13/10) frente a 39 del plan, lo dice y pregunta antes de reescribirla; sin cambios no se guarda");
})();

await (async () => {
  const { apertura } = await abrir(MOTOR.derecha.estructura_id, MOTOR.derecha);
  assert.equal(apertura.origen, "plan");
  assert.equal(apertura.pedidos, 2, "ya está dentro de la tolerancia: no se corrige");
  const cifras = cifrasDelPlan(plan07, MOTOR.derecha.estructura_id)!;
  const comparacion = compararConPlan(cifras, globos(apertura.vista));
  assert.equal(comparacion.exacta, true, JSON.stringify(comparacion));
  const aviso = texto(renderToStaticMarkup(createElement(AvisoPiezaPlan, { comparacion, origen: "plan", pieza: "la columna orgánica derecha", leyenda: leyenda07, hayCambios: false, fueraDelMotor: 0 })));
  assert.match(aviso, /El dibujo lleva lo mismo que tu plan: 48 globos \(Rosado 19 · Lavanda pastel 17 · Dorado cromado 12\)\./, aviso);
  ok("3: la columna derecha abre exactamente como el plan (48 = 19/17/12) y lo dice");
})();

await (async () => {
  const rechazo = new FalloPlanArmado("Ese armado no se puede hacer.", { armadoInvalido: true, motivo: "grosor_alto" });
  const { apertura } = await abrir(MOTOR.izquierda.estructura_id, MOTOR.izquierda, rechazo);
  assert.equal(apertura.origen, "receta");
  assert.equal(apertura.motivo, "rechazo");
  assert.equal(apertura.vista, MOTOR.izquierda.receta);
  const cifras = cifrasDelPlan(plan07, MOTOR.izquierda.estructura_id)!;
  const aviso = texto(renderToStaticMarkup(createElement(AvisoPiezaPlan, { comparacion: compararConPlan(cifras, globos(apertura.vista)), origen: "receta", pieza: "la columna orgánica izquierda", leyenda: leyenda07, hayCambios: false, fueraDelMotor: 0 })));
  assert.match(aviso, /No pude dibujar la columna orgánica izquierda con las medidas y los globos de tu plan/);
  assert.match(aviso, /Ves el diseño base del editor\. Tu plan: 39 globos/);
  const cancelada = new DOMException("cancelada", "AbortError");
  await assert.rejects(abrir(MOTOR.izquierda.estructura_id, MOTOR.izquierda, cancelada), (error: unknown) => error === cancelada);
  ok("3: si el motor no acepta las cifras del plan, abre con su diseño base y lo dice; una cancelación se relanza");
})();

{
  // El fixture de columnas: piezas con armado guardado (no hay aviso ni pregunta) y una columna repetida 2 veces.
  const columnas = PlanGuiadoSchema.parse(JSON.parse(leer("scripts/test/fixtures/plan-guiado-columnas-repetidas.json")));
  const columna = cifrasDelPlan(columnas, "EST_02_COLUMNA")!;
  assert.equal(columna.total, 36, "72 globos en 2 columnas iguales: 36 por pieza, como cuenta el motor");
  const semiarco = cifrasDelPlan(columnas, "EST_01_SEMIARCO_ASIMETRICO")!;
  assert.equal(semiarco.total, 79);
  for (const estructura of columnas.plan.estructuras) {
    const motor = motorDePieza(estructura);
    assert.ok(motor?.tipo === "motor" && motor.armado !== null, `${estructura.estructura_id} abre con su armado guardado (sin sembrar ni preguntar)`);
  }
  const modificar = leer("src/components/guiado/ModificarPieza.tsx");
  assert.equal((modificar.match(/armado=\{guardado \?\? estado\.inicial\.vista\.armado\}/g) ?? []).length, 5, "los cinco editores abren con el armado del dibujo inicial");
  assert.equal((modificar.match(/abrirPieza<Armado/g) ?? []).length, 5, "los cinco motores abren por abrirPieza");
  assert.match(modificar, /if \(sinArmado && cifras && dibujo && !compararConPlan\(cifras, dibujo\)\.exacta\)/, "guardar pregunta antes de reescribir una pieza sin armado");
  assert.match(modificar, /registrar\("pieza\.modificar_desde_plan"/);
  assert.match(modificar, /registrar\("pieza\.modificar_confirmar"/);
  ok("3: fixture de columnas: cifras por pieza (36 de 72 con 2 repeticiones); con armado guardado no se siembra ni se pregunta");
}

// ── 4. Decorador: «arco orgánico de unos 3 metros» ────────────────────────────────────────────────────────────────
{
  const pedido = "Soy decorador, un cliente me pide un arco orgánico de unos 3 metros en blanco y dorado para una boda y necesito cotizarle";
  const hechos = hechosDelCliente([pedido]);
  assert.deepEqual(hechos.estructura, { id: "arco", texto: "arco orgánico", organica: true });
  assert.equal(hechos.medida?.metros, 3);
  // «Propónme algo» con la pieza ya dicha: la vista la manda como el botón de pieza individual, sin preguntar.
  const vista = leer("src/components/guiado/VistaGuiada.tsx");
  assert.match(vista, /PROPONME_LOCAL\.test\(limpio\)\) \{[\s\S]{0,400}if \(proponerPiezaConocida\("proponme"\)\) return;/, "«Propónme algo» no pregunta «¿completa o individual?» si ya se sabe la pieza");
  assert.match(vista, /if \(tipo === "completa"\)[^\n]*\n\s*if \(proponerPiezaConocida\("tipo"\)\) return;/, "«Pieza individual» no pregunta «¿Qué pieza?» si ya se sabe");
  assert.match(vista, /void enviar\(`Propónme una pieza individual: \$\{etiqueta\}\.`, \{ alcance: "individual", pieza: pedida\.id \}\);/);
  assert.match(vista, /if \(!pedida \|\| planVigente \|\| otraPiezaRef\.current\) return false;/, "con un plan a la vista o tras «Elegir otra pieza» se pregunta como siempre");
  assert.match(vista, /etiqueta: "Elegir otra pieza", onElegir: \(\) => \{ setFallo\(null\); otraPiezaRef\.current = true;/);
  const etiqueta = `${hechos.estructura!.texto.charAt(0).toLocaleUpperCase("es")}${hechos.estructura!.texto.slice(1)}`;
  assert.deepEqual(piezaOrganicaDelBoton(`Propónme una pieza individual: ${etiqueta}.`, "arco"), { id: "arco", texto: "Arco orgánico", organica: true }, "el servidor lee lo orgánico de esa etiqueta");
  // La medida va a la pieza (el ancho del arco) aunque la pieza la fije el botón.
  const { piezas } = propuestaConLoPedido([{ estructura: "arco", cantidad: 1 }], { estructura: hechos.estructura!, medida: hechos.medida! }, { individual: true, conservarPieza: true });
  assert.deepEqual(piezas, [{ estructura: "arco", cantidad: 1, medidas: { ancho_m: 3 } }]);
  // La instrucción del plan: el arco completo (nunca arco_asimetrico), su medida y su mezcla orgánica dicha en la pieza.
  const cliente = contextoClienteGuiado({ evento: "Boda", tematica: "Blanco y dorado", estructura: hechos.estructura!, medida: hechos.medida! }, [pedido]);
  assert.deepEqual(cliente.organicas, ["arco"]);
  const instruccion = instruccionPlanGuiado({ frase: "Arco orgánico blanco y dorado.", colores: ["blanco", "dorado"], piezas }, { cliente });
  assert.match(instruccion, /- Arco \(estructura_oficial: arco; [^\n]*medidas: ancho_m 3; mezcla: organica_fina/, instruccion);
  assert.ok(!/arco_asimetrico/.test(instruccion), "nunca el arco asimétrico si no lo pidió");
  assert.match(instruccion, /Mezcla de tamaños: en Arco mezcla al menos 3 tamaños/);
  assert.match(instruccion, /Las piezas que traen medidas son las que el cliente eligió: usa EXACTAMENTE esas medidas/);
  // Una columna orgánica oficial ya mezcla tamaños por su oficial: no se le añade la línea.
  const columna = instruccionPlanGuiado({ frase: "Columna.", colores: ["rosado"], piezas: [{ estructura: "columna_asimetrica", cantidad: 1 }] }, { cliente: { organicas: ["columna_asimetrica"] } });
  assert.ok(!/mezcla: organica_fina/.test(columna));
  ok("4: «arco orgánico de unos 3 m» → arco completo de 3 m con mezcla orgánica dicha en la pieza; «Propónme algo» no vuelve a preguntar la pieza");
}

{
  // El plan sale «arco» con mezcla orgánica: se dibuja y se edita con el motor de arco orgánico, no con el de patrón.
  const organico = motorDePieza({ tipo: "arco", estructura_oficial: "arco", mezcla: "organica_fina" });
  assert.deepEqual(organico, { tipo: "motor", campo: "armado_arco_organico", ruta: "/api/plan-armado-arco-organico", armado: null });
  const grueso = motorDePieza({ tipo: "arco", estructura_oficial: "arco", mezcla: "organica_gruesa" });
  assert.equal(grueso?.tipo === "motor" ? grueso.campo : null, "armado_arco_organico");
  const clasico = motorDePieza({ tipo: "arco", estructura_oficial: "arco", mezcla: "clasica" });
  assert.equal(clasico?.tipo === "motor" ? clasico.campo : null, "armado_arco", "las ideas de arco clásico siguen con el editor de patrón");
  const guardado = motorDePieza({ tipo: "arco", estructura_oficial: "arco", mezcla: "organica_fina", armado_arco: { version: "x" } });
  assert.equal(guardado?.tipo === "motor" ? guardado.campo : null, "armado_arco", "un armado guardado manda");
  // «Ajustes que hice»: el ancho lo dio el cliente; solo el alto es el estándar.
  const plan = {
    plan: { estructuras: [{ estructura_id: "EST_01_ARCO", nombre: "Arco principal", estructura_oficial: "arco", tipo: "arco" }], supuestos: ["medidas asumidas para arco: 3 m × 2.4 m — no nos diste el tamaño del espacio"] },
    original_request: "Soy decorador, un cliente me pide un arco orgánico de unos 3 metros en blanco y dorado para una boda y necesito cotizarle.",
  };
  const textos = ajustesDePython(plan).map((ajuste) => ajuste.texto);
  assert.deepEqual(textos, ["Para el arco principal usé la medida que me diste y completé con la estándar lo que no me dijiste: queda de 3 m × 2,4 m."], textos.join(" | "));
  const sinMedida = ajustesDePython({ ...plan, original_request: "Quiero un arco blanco y dorado para una boda." }).map((ajuste) => ajuste.texto);
  assert.deepEqual(sinMedida, ["Usé medidas estándar para arco (3 m × 2,4 m) porque no me diste el tamaño del espacio."]);
  ok("4: arco con mezcla orgánica → editor de arco orgánico; «Ajustes que hice» ya no dice «no me diste el tamaño» si lo dio");
}

// ── 7. Foto ejemplo-01: lo que ve el cliente es lo que recibe el plan ─────────────────────────────────────────────
{
  const datos = JSON.parse(leer("src/lib/ia/amaterasu/lecturas-ejemplos.json")) as { ejemplos: Array<{ id: string; analisis: { blueprint: unknown; lecturasCrudas: Record<string, { patron_color?: Record<string, unknown>; conteo?: Record<string, unknown> }> } }> };
  const ejemplo = datos.ejemplos.find((item) => item.id === "ejemplo-01")!;
  const base = ReferenceBlueprintV2Schema.parse(ejemplo.analisis.blueprint);
  // Las lecturas de la disposición y del conteo como las deja `adjuntarLecturaUnica` (Python solo las valida).
  const blueprint: ReferenceBlueprintV2 = ReferenceBlueprintV2Schema.parse({
    ...base,
    elements: base.elements.map((elemento) => {
      const crudas = ejemplo.analisis.lecturasCrudas[elemento.element_id];
      if (!crudas) return elemento;
      const { tamanos: _tamanos, ...patron } = crudas.patron_color ?? {};
      void _tamanos;
      return { ...elemento, appearance: { ...elemento.appearance, ...(crudas.patron_color ? { patron_color: patron } : {}), ...(crudas.conteo ? { conteo: { ...crudas.conteo, largo_relativo: null, alto_relativo: null } } : {}) } };
    }),
  });
  const izquierda = blueprint.elements.find((elemento) => elemento.element_id === "REF_01_E03")!;
  assert.deepEqual(izquierda.appearance.measured_colors?.map((medido) => medido.color), ["plateado", "blanco", "rosado"], "los píxeles ponen delante la plata (57 %)");
  const partes = partesDeColorPieza(izquierda.appearance);
  assert.equal(partes.fuente, "disposicion");
  assert.deepEqual(partes.partes, [{ color: "rosado", share: 0.4 }, { color: "blanco", share: 0.3 }, { color: "plateado", share: 0.3 }]);
  // El prompt del plan lee la parte de cada color de esa misma función.
  assert.match(leer("src/lib/ia/omoikane/prompt-sistema.ts"), /const reparto = partesDeColorPieza\(apariencia\);/);
  const referencia = adaptarAnalisisReferencia({ blueprint })!;
  const lectura = lecturaFoto(referencia.blueprint)!;
  const [colIzquierda, colDerecha] = lectura.piezas;
  assert.deepEqual(colIzquierda!.colores.map((color) => [color.clave, color.parte]), [["rosado", 0.4], ["blanco", 0.3], ["plateado", 0.3], ["transparente", null]], colIzquierda!.colores.map((color) => `${color.nombre} ${color.parte}`).join(", "));
  assert.deepEqual(colDerecha!.colores.map((color) => [color.clave, color.parte]), [["blanco", 0.4], ["plateado", 0.3], ["rosado", 0.3], ["transparente", null]]);
  assert.ok(!colIzquierda!.colores.some((color) => color.parte === 0.5701), "la tarjeta ya no dice «plata cromado 57 %» mientras el plan se arma con rosado 40 %");
  assert.equal(colIzquierda!.globos, "≈ 75 globos (se ven 42)");
  // Python decide los globos con la cuenta de la foto; si el plan queda muy por debajo, la tarjeta lo dice.
  const conteos = {
    plan: { estructuras: [{ estructura_id: "EST_01_COLUMNA_A", nombre: "Columna izquierda", estructura_oficial: "columna_asimetrica", tipo: "columna" }, { estructura_id: "EST_02_COLUMNA_B", nombre: "Columna derecha", estructura_oficial: "columna_asimetrica", tipo: "columna" }], supuestos: [] },
    conteos_referencia: [
      { estructura_id: "EST_01_COLUMNA_A", referencia_element_id: "REF_01_E03", decision: "sin_ajuste_posible", globos_foto: 75, globos_antes: 44, globos_despues: 44, cambios: [], motivo: "x" },
      { estructura_id: "EST_02_COLUMNA_B", referencia_element_id: "REF_01_E04", decision: "coincide", globos_foto: 46, globos_antes: 44, globos_despues: 44, cambios: [], motivo: "x" },
    ],
  };
  assert.deepEqual(ajustesDePython(conteos).map((ajuste) => ajuste.texto), ["En la foto, la columna izquierda lleva unos 75 globos; en tu plan lleva 44 con las medidas que tomé de la foto. Si la quieres igual de llena, pídela más grande."]);
  assert.deepEqual(ajustesDePython({ ...conteos, conteos_referencia: [{ ...conteos.conteos_referencia[0]!, globos_foto: 50 }] }), [], "dentro de la tolerancia (±15 %) no se dice nada");
  ok("7: ejemplo-01: la tarjeta muestra rosado 40 / blanco 30 / plata 30 (lo que recibe el plan), no plata 57 %; los ≈ 75 globos que el plan no alcanza se dicen");
}

}

principal().then(() => {
  console.log(`\n${casos} casos en verde`);
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

