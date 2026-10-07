/**
 * Flores de globo de la foto, cableadas de punta a punta (corrector, 2026-10-07: «asegúrate que la cuestión de las flores
 * esté cableada de extremo a extremo … la propiedad llega a un objeto y ese objeto no tiene forma de utilizarla»).
 * Cada caso es un eslabón que estaba roto; sin red, sin Python y sin modelo (US$0):
 *   1. el centro que leyó la foto se buscaba solo en la pieza y se caía en silencio: ahora sale de otra pieza del plan
 *      y, si ningún globo del plan es de ese color, la flor va sin centro CON aviso al cliente;
 *   2. las flores que no salen (ningún globo del color de los pétalos) se le dicen al cliente, que ya las vio prometidas
 *      en la tarjeta de la lectura; una lectura poco fiable no (la tarjeta no la enseñó). En la guiada, cuya tarjeta no
 *      enseña el texto del modelo (`avisos_cliente`), por «Ajustes que hice» (`avisosFloresFotoSinComprar`);
 *   3. los pétalos: la lectura los pide, la validación los guarda, el plan los lleva y la tarjeta los dice (antes toda
 *      flor de foto se cotizaba de 3 pétalos);
 *   4. la forma: un metalizado del color del centro no es el globo de una flor (Python lo dejaba en `sin_cobertura` y la
 *      confirmación rechazaba el plan entero), ni en la foto ni en el chat;
 *   5. «Ajustar mi plan»: la cifra de un color se enseña con sus flores (como el chip de la tarjeta) pero el reparto se
 *      calcula sobre el cuerpo (antes «que lleve 46 blancos» en el aro con flores dejaba 52).
 *
 *   npx tsx scripts/test/test-flores-foto-cableado.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { edicionCantidad, motivoSinCantidad, piezasAjustables } from "@/components/guiado/ajuste/ajuste-plan-guiado";
import { lecturaFoto } from "@/components/guiado/lectura-foto";
import { LECTURA_UNICA_RULES, LECTURA_UNICA_TOOL_SCHEMA } from "@/lib/ia/referencia/lectura-unica";
import { ReferenceBlueprintV2Schema } from "@/lib/ia/referencia/reference-blueprint";
import {
  aplicarFloresDeFoto,
  avisosClienteFloresDeFoto,
  avisosFloresFotoSinComprar,
  edicionFloresDePedido,
  floresDesdeLectura,
  floresLeidasDeCrudo,
  formaDeLineas,
  pedidoFloresDeTexto,
} from "@/lib/plan/flores-pieza";

let fallos = 0;
function caso(nombre: string, prueba: () => void): void {
  try {
    prueba();
    console.log(`ok   ${nombre}`);
  } catch (error) {
    fallos += 1;
    console.error(`FALLA ${nombre}\n${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  }
}

const ARO = { estructura_id: "EST_01_ARO", nombre: "Aro de globos", referencia_element_id: "REF_01_E01", materiales: [{ product_id: "silk-blanco", color: "blanco" }, { product_id: "reflex-dorado", color: "dorado" }, { product_id: "latte", color: "nude" }] };
const COLUMNA = { estructura_id: "EST_02_COLUMNA", nombre: "Columna", referencia_element_id: "REF_01_E02", materiales: [{ product_id: "pastel-amarillo", color: "amarillo" }] };
const nombres = new Map([[ARO.estructura_id, ARO.nombre], [COLUMNA.estructura_id, COLUMNA.nombre]]);
const conFlores = (flores: Record<string, unknown>) => ({ elements: [{ element_id: "REF_01_E01", approved: true, appearance: { flores: { cantidad: 2, confianza: 0.9, ...flores } as never } }] });

caso("1. el centro de la foto sale de otra pieza del plan; sin ningún globo de ese color, la flor va sin centro y se avisa", () => {
  const prestado = aplicarFloresDeFoto({ estructuras: [ARO, COLUMNA] }, conFlores({ color_petalo: "blanco", color_centro: "amarillo" }));
  assert.deepEqual(prestado.aplicadas[0]?.flores.centro, { product_id: "pastel-amarillo", color: "amarillo" }, "el amarillo de la columna (ya en la allowlist firmada)");
  assert.equal(prestado.aplicadas[0]?.centro_omitido, undefined);
  assert.deepEqual(avisosClienteFloresDeFoto(prestado, nombres), []);

  const sinCentro = aplicarFloresDeFoto({ estructuras: [ARO] }, conFlores({ color_petalo: "blanco", color_centro: "amarillo" }));
  assert.equal(sinCentro.aplicadas[0]?.flores.centro, undefined);
  assert.equal(sinCentro.aplicadas[0]?.centro_omitido, "amarillo", "el centro perdido queda dicho, no en silencio");
  assert.deepEqual(avisosClienteFloresDeFoto(sinCentro, nombres), ["Las flores de «Aro de globos» van sin el centro amarillo de tu foto: tu plan no lleva globos amarillo."]);

  // Un centro del mismo color que los pétalos no es un centro perdido (la lectura lo omite así).
  const mismoColor = aplicarFloresDeFoto({ estructuras: [ARO] }, conFlores({ color_petalo: "blanco", color_centro: "blanco" }));
  assert.equal(mismoColor.aplicadas[0]?.centro_omitido, undefined);
});

caso("2. las flores que el plan no puede armar se le dicen al cliente (solo las que la tarjeta prometió)", () => {
  const rosadas = aplicarFloresDeFoto({ estructuras: [ARO] }, conFlores({ color_petalo: "rosado" }));
  assert.equal(rosadas.aplicadas.length, 0);
  assert.equal(rosadas.omitidas.length, 1);
  assert.deepEqual(avisosClienteFloresDeFoto(rosadas, nombres), ["Tu foto tiene 2 flores de globo rosado en «Aro de globos», pero tu plan no lleva globos rosado: va sin esas flores (puedes pedirlas en otro color)."]);
  const dudosas = aplicarFloresDeFoto({ estructuras: [ARO] }, conFlores({ color_petalo: "rosado", confianza: 0.3 }));
  assert.equal(dudosas.omitidas.length, 1);
  assert.deepEqual(avisosClienteFloresDeFoto(dudosas, nombres), [], "una lectura poco fiable no se enseñó en la tarjeta: no se avisa");
});

caso("3. los pétalos de la foto llegan al plan y a la tarjeta de la lectura", () => {
  const flores = (LECTURA_UNICA_TOOL_SCHEMA.properties.flores as { properties: Record<string, unknown> }).properties;
  assert.deepEqual(flores.petalos, { type: "integer", minimum: 3, maximum: 6 }, "la herramienta pide los pétalos");
  assert.match(LECTURA_UNICA_RULES, /petalos = the petal balloons around the center of ONE flower \(3 to 6\)/);
  assert.equal(floresLeidasDeCrudo({ cantidad: 2, petalos: 6, color_petalo: "blanco", confianza: 0.9 })?.petalos, 6);
  assert.equal(floresLeidasDeCrudo({ cantidad: 2, petalos: 9, color_petalo: "blanco", confianza: 0.9 })?.petalos, 6, "se acota al tope");
  assert.equal(floresLeidasDeCrudo({ cantidad: 2, petalos: "seis", color_petalo: "blanco", confianza: 0.9 })?.petalos, undefined, "ilegibles: la flor sigue sin ellos");
  const leidas = floresLeidasDeCrudo({ cantidad: 2, petalos: 6, color_petalo: "blanco", color_centro: "dorado", confianza: 0.9 })!;
  assert.deepEqual(floresDesdeLectura(ARO.materiales, leidas), { cantidad: 2, petalos: 6, petalo: { product_id: "silk-blanco", color: "blanco" }, centro: { product_id: "reflex-dorado", color: "dorado" } }, "2 flores de 6 pétalos, no de 3");

  const ejemplos = JSON.parse(readFileSync("src/lib/ia/amaterasu/lecturas-ejemplos.json", "utf8")).ejemplos;
  const blueprint = structuredClone((Array.isArray(ejemplos) ? ejemplos[0] : Object.values(ejemplos)[0]).analisis.blueprint);
  const elemento = blueprint.elements.find((item: { category: string }) => item.category === "balloon_structure") ?? blueprint.elements[0];
  elemento.appearance.flores = leidas;
  const valido = ReferenceBlueprintV2Schema.safeParse(blueprint);
  assert.equal(valido.success, true, "el blueprint (contrato reference-blueprint.v2) admite los pétalos");
  const detalles = (lecturaFoto(valido.success ? valido.data : blueprint)?.piezas ?? []).flatMap((pieza) => pieza.detalles);
  assert.ok(detalles.includes("con 2 flores de globo blanco de 6 pétalos y centro dorado"), JSON.stringify(detalles));
});

caso("4. una flor nunca sale de un globo que no es redondo, ni en la foto ni en el chat", () => {
  const conEstrella = { ...ARO, materiales: [ARO.materiales[0]!, { product_id: "estrella-dorada", color: "dorado" }, ...ARO.materiales.slice(1)] };
  const forma = (productId: string) => (productId === "estrella-dorada" ? "otra" as const : productId === "latte" ? undefined : "redondo" as const);
  const leidas = { cantidad: 2, color_petalo: "blanco", color_centro: "dorado", confianza: 0.9 };
  assert.equal(floresDesdeLectura(conEstrella.materiales, leidas)?.centro?.product_id, "estrella-dorada", "sin la forma, el primero del color (el fallo)");
  assert.equal(floresDesdeLectura(conEstrella.materiales, leidas, forma)?.centro?.product_id, "reflex-dorado", "con la forma, el látex redondo");
  const foto = aplicarFloresDeFoto({ estructuras: [conEstrella] }, conFlores({ color_petalo: "blanco", color_centro: "dorado" }), forma);
  assert.equal(foto.aplicadas[0]?.flores.centro?.product_id, "reflex-dorado");
  // Un color que solo tiene el metalizado: la flor va sin centro y se avisa (mejor que un plan rechazado entero).
  const soloEstrella = { ...ARO, materiales: [ARO.materiales[0]!, { product_id: "estrella-dorada", color: "dorado" }] };
  const sinCentro = aplicarFloresDeFoto({ estructuras: [soloEstrella] }, conFlores({ color_petalo: "blanco", color_centro: "dorado" }), forma);
  assert.equal(sinCentro.aplicadas[0]?.flores.centro, undefined);
  assert.equal(sinCentro.aplicadas[0]?.centro_omitido, "dorado");

  // Chat: la forma sale de las líneas del cuerpo del plan resuelto (las de las flores no cuentan).
  const formaLineas = formaDeLineas([{ lineas: [
    { product_id: "silk-blanco", forma: "redondo", diam_pulg: 12 },
    { product_id: "estrella-dorada", forma: "estrella", diam_pulg: null },
    { product_id: "reflex-dorado", forma: "redondo", diam_pulg: 5 },
    { product_id: "latte", forma: "redondo", diam_pulg: 5, adorno: "flor" },
  ] }]);
  assert.equal(formaLineas("estrella-dorada"), "otra");
  assert.equal(formaLineas("reflex-dorado"), "redondo");
  assert.equal(formaLineas("latte"), undefined, "una línea de flor no dice la forma del cuerpo");
  const plan = { estructuras: [conEstrella] };
  const ponle = edicionFloresDePedido(plan, "EST_01_ARO", pedidoFloresDeTexto("ponle flores")!, formaLineas);
  assert.ok(ponle.ok);
  assert.equal(ponle.edicion.flores?.centro?.product_id, "reflex-dorado", "el segundo color de la pieza, pero un globo redondo");
  const doradas = edicionFloresDePedido(plan, "EST_01_ARO", pedidoFloresDeTexto("agrega 3 flores doradas")!, formaLineas);
  assert.ok(doradas.ok);
  assert.equal(doradas.edicion.flores?.petalo.product_id, "reflex-dorado");
  // «ponle flores» sin pieza nombrada recorre todas: un bouquet solo de metalizados se salta con su motivo (antes su
  // edición llegaba a Python, no compraba ninguna flor y el 422 tumbaba el pedido entero).
  const metalizados = { estructuras: [{ estructura_id: "EST_02_BOUQUET", materiales: [{ product_id: "estrella-dorada", color: "dorado" }] }] };
  const saltado = edicionFloresDePedido(metalizados, "EST_02_BOUQUET", pedidoFloresDeTexto("ponle flores")!, formaLineas);
  assert.deepEqual(saltado, { ok: false, motivo: "Esa pieza no lleva globos redondos para armar flores; dime de qué color las quieres." });
});

caso("2b. la tarjeta de la guiada (que no enseña el texto del modelo) dice lo mismo, comparando la lectura con el plan", () => {
  const sinFlores = { estructuras: [ARO] };
  assert.deepEqual(avisosFloresFotoSinComprar(conFlores({ color_petalo: "rosado" }), sinFlores), ["Tu foto tiene 2 flores de globo rosado en «Aro de globos», pero tu plan no lleva globos rosado: va sin esas flores (puedes pedirlas en otro color)."]);
  assert.deepEqual(avisosFloresFotoSinComprar(conFlores({ color_petalo: "blanco" }), sinFlores), [], "el plan lleva blanco: el cliente las quitó a propósito");
  const sinCentro = { estructuras: [{ ...ARO, flores: { cantidad: 2, petalo: { product_id: "silk-blanco", color: "blanco" } } }] };
  assert.deepEqual(avisosFloresFotoSinComprar(conFlores({ color_petalo: "blanco", color_centro: "amarillo" }), sinCentro), ["Las flores de «Aro de globos» van sin el centro amarillo de tu foto: tu plan no lleva globos amarillo."]);
  assert.deepEqual(avisosFloresFotoSinComprar(conFlores({ color_petalo: "blanco", color_centro: "amarillo", confianza: 0.3 }), sinCentro), [], "lectura poco fiable: la tarjeta no la prometió");
  assert.deepEqual(avisosFloresFotoSinComprar(undefined, sinCentro), []);
});

caso("5. «Ajustar mi plan»: la cifra de un color cuenta sus flores, pero el reparto mueve solo el cuerpo de la pieza", () => {
  // El aro de la idea deco-real-28 tal como lo resolvió Python (cuerpo de 94 globos), con sus 2 flores de 6 pétalos.
  const guardado = JSON.parse(readFileSync("data/biblioteca-real/analisis/nueva-sempertex-08.plan.json", "utf8")).plan_resuelto;
  const flores = { cantidad: 2, petalos: 6, petalo: { product_id: "9661845995815", color: "blanco" }, centro: { product_id: "8634255638823", color: "dorado" } };
  guardado.plan.estructuras[0].flores = flores;
  const silk = guardado.estructuras[0].lineas.find((linea: { product_id: string; diam_pulg: number }) => linea.product_id === "9661845995815" && linea.diam_pulg === 5);
  const reflex = guardado.estructuras[0].lineas.find((linea: { product_id: string; diam_pulg: number }) => linea.product_id === "8634255638823" && linea.diam_pulg === 5);
  guardado.estructuras[0].lineas.push({ ...silk, unidades: 12, adorno: "flor" }, { ...reflex, unidades: 2, adorno: "flor" });
  const plan = { ...guardado, approval_token: "token-de-prueba" } as never;
  const id = guardado.plan.estructuras[0].estructura_id as string;
  const pieza = piezasAjustables(plan)[0]!;
  const blanco = pieza.colores[0]!;
  assert.equal(blanco.globos, 50, "38 del cuerpo + 12 pétalos: lo mismo que el chip de la tarjeta");
  assert.equal(blanco.cantidad?.minimo, 5 + 12, "el piso del reparto (5 % de 94) más sus flores");
  const edicion = edicionCantidad(plan, id, 0, 46) as { accion: string; participaciones: number[] } | null;
  assert.equal(edicion?.accion, "repartir");
  // 46 blancos = 12 de las flores + 34 del cuerpo de 94 → 0,3617 (antes: 46/108 = 0,4259 y Python dejaba 52 blancos).
  assert.equal(edicion?.participaciones[0], 0.3617, JSON.stringify(edicion));
  assert.match(motivoSinCantidad(plan, id, 0, 10), /más 12 globos de sus flores/);
});

if (fallos > 0) {
  console.error(`\n${fallos} caso(s) fallaron`);
  process.exit(1);
}
console.log("\ntodas las flores de la foto llegan cableadas");
