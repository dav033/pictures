/**
 * Un solo rango para el grosor de un cuerpo orgánico (`GROSOR_CUERPO_CM`, 12–160 cm): lo comprueba el trazo al armar (la lectura
 * de una foto: un racimo de piso o una columna de 160 cm no se cae) y lo aceptan las herramientas de la IA de escena (agregar_pieza,
 * cambiar_pieza). Antes el tope de la herramienta era 120 cm y el de la lectura 160: la IA no podía pedir lo que la foto tenía.
 *
 * Con el rango ancho, un cuerpo largo y grueso a la vez tardaría decenas de segundos en armarse. Unos topes de armado
 * (`presupuesto-cuerpo.ts`: volumen y largo) valen para las rutas en que la IA pide un cuerpo: agregar_pieza (estructuras nuevas,
 * arco_organico, trazo), cambiar_pieza (arco, pieza orgánica que ya existe, trazo) y ajustar_tamanos (que engruesa para que quepan más
 * globos: se acota y se dice). Todo se mide UNA vez y de UNA manera, por la geometría con que se arma la pieza: el mismo arco mide lo
 * mismo como arco por medidas y cuando pasa a orgánico (con tamaños propios, más abultado, más R-24), así que convertirlo no abre
 * camino para engordarlo. Lo que no cabe se rechaza antes de armar y el error dice el grosor que sí cabe, que se deja crear.
 *
 * La guiada arma con los rangos del cliente de siempre (el grosor cambia la lista de materiales y la cotización: ampliarlo lo aprueba el
 * dueño), que con las medidas más grandes caben en los topes. Las excepciones, a propósito: la lectura de una foto (arma lo que mide,
 * acotado a 140 cm) y el aro orgánico (20–70 cm, al crearlo y al cambiarlo).
 *
 * Sin relojes: en este equipo (15,7 GB) un tiempo de armado varía demasiado con la carga. Se prueban el error, el volumen del cuerpo y
 * el grosor con que queda. Sin coste: ninguna IA ni red.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-rango-grosor-cuerpo.ts
 */
import assert from "node:assert/strict";
import { SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { RANGOS_ESTRUCTURA } from "../../src/lib/globos3d/herramientas-escena-estructuras";
import { RANGOS_TRAZO } from "../../src/lib/globos3d/herramientas-escena-trazo";
import { GROSOR_CUERPO_CM, validarTrazo, type ParametrosTrazoOrganico } from "../../src/lib/globos3d/trazo-organico";
import { LARGO_MAXIMO_CUERPO_CM, PRESUPUESTO_CUERPO_CM3, cuerpoDeOrganico, volumenDeCuerpoCm3, type Cuerpo } from "../../src/lib/globos3d/presupuesto-cuerpo";
import { cuerpoDePieza, engrosarEnPresupuesto } from "../../src/lib/globos3d/presupuesto-ajustes";
import { comoOrganico, conGrosor, esPiezaOrganica } from "../../src/lib/globos3d/organico-ajustes";
import { compilarLectura } from "../../src/lib/globos3d/compilar-lectura";
import { LecturaFotoSchema } from "../../src/lib/globos3d/lectura-foto";
import type { Pieza } from "../../src/lib/globos3d/piezas";
import { PiezaEspecSchema, type PiezaEspec } from "../../src/lib/globos3d/motor/espec-cliente-v1";
import { construirArcoAsimetrico, construirArcoOrganico, construirAro, construirColumnaOrganica, construirGuirnaldaOrganica, construirSemiarco } from "../../src/lib/globos3d/motor/constructores-organicos";
import { RANGO_GROSOR_GUIADA_CM } from "../../src/lib/globos3d/motor/medidas-espec";
import { medidasEditables } from "../../src/lib/globos3d/motor/rangos-medidas";
import { armarDesdeEspec } from "../../src/lib/globos3d/motor/v1";
import { IDEAS_SEMPERTEX } from "../../src/lib/globos3d/ideas-sempertex/index";
import { todosLosCasos } from "../lib/casos-motor-guiada";

type Resultado = ReturnType<typeof aplicarHerramienta>;
const sala = { ...SALA_INICIAL, altoCm: 600, anchoCm: 1200 };
const vacia = (): Escena => ({ sala, nodos: [] });
const agregar = (p: Record<string, unknown>) => aplicarHerramienta(vacia(), "agregar_pieza", p);
const volumen = (c: Cuerpo) => volumenDeCuerpoCm3(c.largoCm, c.grosorCm);
/** El cuerpo de la pieza orgánica de una escena, medido como se mide al crearla. */
const cuerpoDeNodo = (pieza: Pieza): Cuerpo => (esPiezaOrganica(pieza) ? cuerpoDePieza(pieza) : assert.fail(`no es orgánica: ${pieza.tipo}`));
const ultima = (r: Resultado) => (r.ok ? r.escena.nodos[r.escena.nodos.length - 1]! : assert.fail(r.error));
/** El grosor que dice un rechazo por grosor. */
const grosorDelError = (r: Resultado) => Number(/el grosor máximo es (\d+) cm/.exec(r.ok ? "" : r.error)?.[1] ?? assert.fail(r.ok ? "no se rechazó" : r.error));

assert.equal(PRESUPUESTO_CUERPO_CM3, 8_000_000);
assert.equal(LARGO_MAXIMO_CUERPO_CM, 2000);
assert.deepEqual([GROSOR_CUERPO_CM.min, GROSOR_CUERPO_CM.max], [12, 160]);
for (const tipo of ["columna_organica", "guirnalda_organica", "semiarco_organico", "marco_organico", "organico"] as const) {
  assert.deepEqual(RANGOS_ESTRUCTURA[tipo].grosor_cm, [12, 160], `${tipo}: grosor_cm`);
}
assert.deepEqual(RANGOS_TRAZO.grosor_cm, [12, 160], "trazo: grosor_cm");
assert.deepEqual(RANGOS_ESTRUCTURA.aro_organico.grosor_cm, [20, 70], "el aro conserva 20–70 cm");
console.log("  ✓ un rango (12–160 cm) en el trazo, en las estructuras orgánicas y en el trazo de la herramienta; el aro, 20–70 cm");

const punto = (grosor: number) => ({ x: 0, y: 0, grosor });
const trazo = (grosor: number): ParametrosTrazoOrganico => ({
  puntos: [punto(grosor), { x: 0, y: 100, grosor }], mezcla: { "R-12": 1 }, colores: [{ codigo: "080", peso: 1 }],
} as unknown as ParametrosTrazoOrganico);
assert.equal(validarTrazo(trazo(12)), null, "12 cm vale");
assert.equal(validarTrazo(trazo(160)), null, "160 cm vale (el racimo de la foto de 161 cm entra en el tope)");
assert.match(validarTrazo(trazo(161)) ?? "", /fuera de rango \(12 a 160 cm\)/);
assert.match(validarTrazo(trazo(11)) ?? "", /fuera de rango/);
for (const grosor of [12, 120, 160]) assert.ok(agregar({ tipo: "columna_organica", grosor_cm: grosor, alto_cm: 200 }).ok, `columna de ${grosor} cm`);
assert.ok(!agregar({ tipo: "columna_organica", grosor_cm: 165, alto_cm: 200 }).ok, "165 cm no vale");
console.log("  ✓ el trazo y agregar_pieza (columna) aceptan 12–160 cm y dicen el rango cuando se pasa");

// --- Los topes al crear ---------------------------------------------------------------------------------------------------------------
/** Rechazada por grueso, y el grosor que dice el error se deja crear (medido con la pieza misma, aunque su largo cambie con el grosor). */
function rechazadaConGrosorQueCabe(nombre: string, pedido: Record<string, unknown>): { cabe: number; pieza: Pieza } {
  const r = agregar(pedido);
  assert.ok(!r.ok && /demasiado grueso/.test(r.error), `${nombre}: debía rechazarse por grueso: ${r.ok ? "" : r.error}`);
  const cabe = grosorDelError(r);
  const armada = ultima(agregar({ ...pedido, grosor_cm: cabe }));
  assert.ok(volumen(cuerpoDeNodo(armada.pieza)) <= PRESUPUESTO_CUERPO_CM3, `${nombre}: a ${cabe} cm pasa del presupuesto`);
  assert.ok(!agregar({ ...pedido, grosor_cm: cabe + 1 }).ok, `${nombre}: a ${cabe + 1} cm ya no cabe`);
  return { cabe, pieza: armada.pieza };
}
// Lo que ya se armaba antes del rango ancho sigue entrando: el marco de 500 × 320 a 100 cm y el arco de 500 × 320 a 120.
assert.ok(rechazadaConGrosorQueCabe("marco 500 × 320 a 160", { tipo: "marco_organico", ancho_cm: 500, alto_cm: 320, grosor_cm: 160 }).cabe >= 100, "el marco llega a 100 cm");
const ARCO_GRANDE = { tipo: "arco_organico", ancho_cm: 500, alto_cm: 320 } as const;
const { cabe: topeArco, pieza: enElTope } = rechazadaConGrosorQueCabe("arco_organico 500 × 320 a 160", { ...ARCO_GRANDE, grosor_cm: 160 });
assert.ok(topeArco >= 120, `el arco de 500 × 320 llega a ${topeArco} cm (antes del rango ancho, a 120)`);
console.log(`  ✓ agregar_pieza: el marco y el arco de 500 × 320 a 160 cm se rechazan; el grosor que dice el error se arma (arco hasta ${topeArco} cm)`);

// El largo también tiene tope: un trazo de 100 m tardaba 57 s aunque fino.
const largo = agregar({ tipo: "trazo_organico", puntos: [{ x_cm: -5000, y_cm: 100, grosor_cm: 20 }, { x_cm: 5000, y_cm: 100, grosor_cm: 20 }] });
assert.ok(!largo.ok && /demasiado largo/.test(largo.error) && largo.error.includes(`hasta ${LARGO_MAXIMO_CUERPO_CM} cm`), largo.ok ? "" : largo.error);
assert.ok(agregar({ tipo: "trazo_organico", puntos: [{ x_cm: -900, y_cm: 100, grosor_cm: 12 }, { x_cm: 900, y_cm: 100, grosor_cm: 12 }] }).ok, "uno de 18 m fino sí");
// Uno de millones de kilómetros se rechaza antes de sacar nada de sus puntos (al muestrearlo se agotaba la memoria).
const enorme = agregar({ tipo: "trazo_organico", puntos: [{ x_cm: -1e9, y_cm: 100, grosor_cm: 20 }, { x_cm: 1e9, y_cm: 100, grosor_cm: 20 }] });
assert.ok(!enorme.ok && /demasiado largo/.test(enorme.error), enorme.ok ? "" : enorme.error);
const trazoGordo = agregar({ tipo: "trazo_organico", silueta: "feston", ancho_cm: 900, alto_cm: 300, grosor_cm: 160 });
assert.ok(!trazoGordo.ok && /el grosor máximo es \d+ cm/.test(trazoGordo.error), trazoGordo.ok ? "" : trazoGordo.error);
const festonFino = ultima(agregar({ tipo: "trazo_organico", silueta: "feston", ancho_cm: 400, alto_cm: 150, grosor_cm: 40 }));
const engordarFeston = aplicarHerramienta({ sala, nodos: [festonFino] }, "cambiar_pieza", { id: festonFino.id, ancho_cm: 900, grosor_cm: 160 });
assert.ok(!engordarFeston.ok && /el grosor máximo es \d+ cm/.test(engordarFeston.error), engordarFeston.ok ? "" : engordarFeston.error);
console.log("  ✓ el trazo: uno de 100 m se rechaza por largo (hasta 2000 cm); uno grueso, por grosor, al crearlo y al cambiarlo");

// --- Una sola medida: el arco antes y después de pasar a orgánico ----------------------------------------------------------------------
// El hueco de la cuarta reseña: el arco a 120 cm pasaba a orgánico (más R-24, tamaños, racimos), medía la mitad y se dejaba poner a 160.
const arcoGrande = ultima(agregar({ ...ARCO_GRANDE, grosor_cm: 120 }));
assert.ok(arcoGrande.pieza.tipo === "arco_organico", "arco por medidas");
if (arcoGrande.pieza.tipo === "arco_organico") assert.deepEqual(cuerpoDePieza(arcoGrande.pieza), cuerpoDeOrganico(comoOrganico(arcoGrande.pieza).opciones), "mide lo mismo como arco y como orgánico");
const conArco = (r: Resultado) => (r.ok ? r.escena : assert.fail(r.error));
const escenaArco = { sala, nodos: [arcoGrande] };
for (const [como, convertir] of [
  ["con tamaños propios (cambiar_pieza)", () => aplicarHerramienta(escenaArco, "cambiar_pieza", { id: arcoGrande.id, tamanos: ["R-18", "R-12", "R-9"] })],
  ["más abultado (ajustar_tamanos)", () => aplicarHerramienta(escenaArco, "ajustar_tamanos", { id: arcoGrande.id, racimos: "mas" })],
] as const) {
  const convertido = conArco(convertir());
  const pieza = convertido.nodos[0]!.pieza;
  assert.equal(pieza.tipo, "organico", `${como}: pasa a orgánico`);
  const engordar = aplicarHerramienta(convertido, "cambiar_pieza", { id: arcoGrande.id, grosor_cm: 160 });
  assert.ok(!engordar.ok && /demasiado grueso/.test(engordar.error), `${como}: engordarlo a 160 se rechaza: ${engordar.ok ? "" : engordar.error}`);
  assert.ok(Math.abs(grosorDelError(engordar) - topeArco) <= 2, `${como}: el tope (${grosorDelError(engordar)} cm) es el del arco (${topeArco} cm)`);
}
console.log("  ✓ el arco mide lo mismo como arco por medidas y como orgánico: convertido (tamaños, racimos), no se deja engordar a 160");

// cambiar_pieza sobre una pieza orgánica que ya existe: lo que pasa del tope se rechaza; achicar, nunca.
const guirnalda = ultima(agregar({ tipo: "guirnalda_organica", ancho_cm: 800, grosor_cm: 50 }));
const escenaGuirnalda = { sala, nodos: [guirnalda] };
const gruesa = aplicarHerramienta(escenaGuirnalda, "cambiar_pieza", { id: guirnalda.id, grosor_cm: 160 });
assert.ok(!gruesa.ok && /el grosor máximo es \d+ cm/.test(gruesa.error), gruesa.ok ? "" : gruesa.error);
assert.ok(aplicarHerramienta(escenaGuirnalda, "cambiar_pieza", { id: guirnalda.id, grosor_cm: 40 }).ok, "afinar una pieza orgánica nunca se rechaza");
// El aro conserva su rango también al cambiarlo (crearlo a más de 70 ya se rechazaba).
const aro = ultima(agregar({ tipo: "aro_organico", ancho_cm: 160, grosor_cm: 30 }));
const aroGrueso = aplicarHerramienta({ sala, nodos: [aro] }, "cambiar_pieza", { id: aro.id, grosor_cm: 120 });
assert.ok(!aroGrueso.ok && aroGrueso.error.includes("va de 20 a 70 cm"), aroGrueso.ok ? "" : aroGrueso.error);
assert.ok(aplicarHerramienta({ sala, nodos: [aro] }, "cambiar_pieza", { id: aro.id, grosor_cm: 60 }).ok, "un aro a 60 cm sí");
assert.ok(!agregar({ tipo: "aro_organico", ancho_cm: 160, grosor_cm: 120 }).ok, "crearlo a 120 tampoco");
// Alto y ancho de un orgánico que ya existe: se comprueba el cuerpo que de verdad queda al estirarlo, no una estimación (que dejaba pasar
// una columna de 80 cm a 160 de grosor estirada a 500 × 320, 14,6 M, y rechazaba el arco de Halloween de la biblioteca a 800 cm, 1,8 M).
const columnaBaja = ultima(agregar({ tipo: "columna_organica", alto_cm: 80, grosor_cm: 160 }));
const estirada = aplicarHerramienta({ sala, nodos: [columnaBaja] }, "cambiar_pieza", { id: columnaBaja.id, ancho_cm: 500, alto_cm: 320 });
assert.ok(!estirada.ok && /demasiado grueso/.test(estirada.error), `la columna estirada a 500 × 320 se rechaza: ${estirada.ok ? "" : estirada.error}`);
const columnaGruesa = ultima(agregar({ tipo: "columna_organica", alto_cm: 200, grosor_cm: 150 }));
assert.ok(!aplicarHerramienta({ sala, nodos: [columnaGruesa] }, "cambiar_pieza", { id: columnaGruesa.id, ancho_cm: 400 }).ok, "la columna de 150 cm ensanchada a 400 se rechaza");
const ideaHalloween = IDEAS_SEMPERTEX.find((i) => i.slug === "arco-halloween-de-varios-tamanos") ?? assert.fail("sin el arco de Halloween");
const escenaHalloween = ideaHalloween.contenido.tipo === "escena" ? ideaHalloween.contenido.escena : assert.fail("el arco de Halloween es una escena");
const anchoHalloween = aplicarHerramienta({ ...escenaHalloween, sala: { ...escenaHalloween.sala, anchoCm: 1200 } }, "cambiar_pieza", { id: "arco", ancho_cm: 800 });
assert.ok(anchoHalloween.ok, `el arco de Halloween a 800 cm cabe: ${anchoHalloween.ok ? "" : anchoHalloween.error}`);
assert.ok(volumen(cuerpoDeNodo(anchoHalloween.escena.nodos.find((n) => n.id === "arco")!.pieza)) <= PRESUPUESTO_CUERPO_CM3, "y queda dentro del presupuesto");
console.log("  ✓ cambiar_pieza: lo que pasa del tope se rechaza, achicar no; alto y ancho se comprueban con el cuerpo que queda; un aro no pasa de 70 cm");

// --- ajustar_tamanos -------------------------------------------------------------------------------------------------------------------
// «Más tupida» engruesa el cuerpo cuando ya no caben más globos; repetido, se queda en el tope y lo dice (antes un arco de 500 × 320 a
// 105 cm pasaba a 13,1, 17,3 y 22,9 M cm³ con tres «más tupida» seguidos).
const tupido = ultima(agregar({ ...ARCO_GRANDE, grosor_cm: 105 }));
let escena: Escena = { sala, nodos: [tupido] };
const resumenes: string[] = [];
for (let vez = 1; vez <= 3; vez++) {
  const r = aplicarHerramienta(escena, "ajustar_tamanos", { id: tupido.id, densidad: "mas" });
  escena = conArco(r);
  const cuerpo = cuerpoDeNodo(escena.nodos[0]!.pieza);
  assert.ok(volumen(cuerpo) <= PRESUPUESTO_CUERPO_CM3, `densidad «mas» (${vez}): ${Math.round(volumen(cuerpo))} cm³ pasa del presupuesto`);
  resumenes.push(r.ok ? r.resumen ?? "" : "");
}
const topesDichos = resumenes.flatMap((x) => [...x.matchAll(/lo más grueso que se arma de una vez es (\d+) cm/g)].map((m) => Number(m[1])));
assert.ok(topesDichos.length && topesDichos.every((t) => Math.abs(t - topeArco) <= 2), `dice el tope (${topeArco} cm): ${resumenes.join(" | ")}`);
// En el tope no se engruesa más, y nada pasa de 160 cm de diámetro (antes conGrosor acotaba el radio a 160).
assert.ok(esPiezaOrganica(enElTope) && engrosarEnPresupuesto(enElTope, 1.4).pieza === null, `a ${topeArco} cm, el arco no se engruesa más`);
const triple = esPiezaOrganica(enElTope) ? conGrosor(enElTope, 3) : enElTope;
assert.ok(triple.tipo === "arco_organico" && 2 * triple.arco.radioBaseCm <= GROSOR_CUERPO_CM.max, "diámetro de la base hasta 160 cm");
// Un aro no se engruesa más allá de su rango.
const aroTope = ultima(agregar({ tipo: "aro_organico", ancho_cm: 160, grosor_cm: 70 })).pieza;
const aroEngrosado = esPiezaOrganica(aroTope) ? engrosarEnPresupuesto(aroTope, 1.3) : assert.fail("aro");
assert.ok(aroEngrosado.pieza === null && aroEngrosado.tope.includes("hasta 70 cm"), JSON.stringify(aroEngrosado.tope));
console.log(`  ✓ ajustar_tamanos («más tupida» tres veces, engrosar por pasos) no pasa del tope y lo dice; el aro, de 70 cm`);

// --- La guiada (motor) ------------------------------------------------------------------------------------------------------------------
// Los constructores arman con el rango del cliente de siempre y, con las medidas más grandes de cada pieza, caben en los topes.
const color = { codigo: "570", nombre: "dorado", peso: 1 };
const espec = (oficial: PiezaEspec["oficial"], medidas: object) => PiezaEspecSchema.parse({ id: "EST_01_PRUEBA", oficial, nombre: "prueba", lugar: "centro", medidas, colores: [color], tamanos: "organica_gruesa" });
const CONSTRUCTORES = [
  ["arco", construirArcoOrganico, { anchoM: 5, altoM: 3.2, grosorM: 1.6 }, RANGO_GROSOR_GUIADA_CM.arco],
  ["arco_asimetrico", construirArcoAsimetrico, { anchoM: 5, altoM: 3.2, grosorM: 1.6 }, RANGO_GROSOR_GUIADA_CM.arco],
  ["semiarco", construirSemiarco, { anchoM: 3, altoM: 3, grosorM: 1.6 }, RANGO_GROSOR_GUIADA_CM.semiarco],
  ["guirnalda", construirGuirnaldaOrganica, { largoM: 8, grosorM: 1.6 }, RANGO_GROSOR_GUIADA_CM.guirnalda],
  ["columna", construirColumnaOrganica, { altoM: 3.2, grosorM: 1.6 }, RANGO_GROSOR_GUIADA_CM.columna],
  ["aro_circular", construirAro, { anchoM: 3, grosorM: 1.6 }, RANGO_GROSOR_GUIADA_CM.aro],
] as const;
for (const [oficial, construir, medidas, rango] of CONSTRUCTORES) {
  const avisos: string[] = [], notas: string[] = [];
  const { pieza } = construir({ espec: espec(oficial, medidas), medidas, avisos, notas });
  assert.ok(pieza.tipo === "organico", oficial);
  if (pieza.tipo !== "organico") continue;
  const cuerpo = cuerpoDeOrganico(pieza.opciones);
  assert.ok(volumen(cuerpo) <= PRESUPUESTO_CUERPO_CM3 && cuerpo.largoCm <= LARGO_MAXIMO_CUERPO_CM, `${oficial}: ${Math.round(cuerpo.largoCm)} cm de largo a ${Math.round(cuerpo.grosorCm)} cm pasa de los topes`);
  assert.ok(avisos.some((a) => a.includes("El grosor") && a.includes(`se usó ${rango[1]} cm`)), `${oficial}: avisa que acotó el grosor a ${rango[1]} cm: ${avisos.join(" | ")}`);
}
console.log("  ✓ los constructores de la guiada acotan el grosor al rango del cliente y, con las medidas más grandes, caben en los topes");

// Lo que el cliente ve y paga no cambia con el rango ancho del Taller: el grosor de la columna se edita en 0,3–1,2 m y uno explícito
// fuera de ahí arma (y cotiza) lo mismo que su tope.
assert.deepEqual(RANGO_GROSOR_GUIADA_CM, { columna: [30, 120], guirnalda: [20, 90], semiarco: [30, 110], aro: [20, 70], arco: [20, 120] });
assert.deepEqual(medidasEditables({ oficial: "columna", tamanos: "organica_gruesa" }).anchoM, [0.3, 1.2]);
const casoColumna = todosLosCasos().find((c) => c.espec.piezas.some((p) => p.oficial === "columna_asimetrica")) ?? assert.fail("sin caso con columna asimétrica");
const conGrosorDe = (grosorM: number) => ({ ...casoColumna.espec, piezas: casoColumna.espec.piezas.map((p) => (p.oficial === "columna_asimetrica" ? { ...p, medidas: { ...p.medidas, grosorM } } : p)) });
const lista = (grosorM: number) => armarDesdeEspec(conGrosorDe(grosorM)).bom.total;
assert.deepEqual(lista(1.6), lista(1.2), "una columna pedida a 1,6 m lleva los globos de la de 1,2 m");
assert.deepEqual(lista(0.12), lista(0.3), "una columna pedida a 0,12 m lleva los globos de la de 0,3 m");
assert.notDeepEqual(lista(1.2), lista(0.3), "el grosor sí cuenta dentro del rango");
console.log(`  ✓ la guiada: el grosor de la columna se edita en 0,3–1,2 m y uno explícito fuera de ahí cotiza lo mismo que su tope (${casoColumna.id})`);

// --- La lectura de una foto (excepción) --------------------------------------------------------------------------------------------------
// Arma lo que mide la foto, acotado a 140 cm y sin los topes: una columna leída de 200 cm de grosor queda en 140.
const blanco = { nombre: "blanco", hex: "#f4f1ea", peso: 100, acabado: "mate" as const };
const leida = compilarLectura(LecturaFotoSchema.parse({
  resumen: "columna gruesa", aspecto: 1.5, escala: { altoImagenCm: 250, referencia: "puerta" }, pisoY: 0.95, sala: { pared: "#ffffff", piso: "#cccccc" },
  piezas: [{ tipo: "columna_organica", forma: "recta", x: 0.5, yBase: 0.95, yArriba: 0.15, ancho: 0.8, grosor: 0.8, tamanos: { "R-12": 100 }, racimos: 0.2, colores: [blanco] }],
}));
const columnaLeida = leida.escena.nodos[0]?.pieza;
assert.ok(columnaLeida?.tipo === "organico" && columnaLeida.generador?.tipo === "trazo", `la columna leída se arma: ${leida.omitidas.join(" | ")}`);
if (columnaLeida?.tipo === "organico" && columnaLeida.generador?.tipo === "trazo") {
  assert.equal(Math.max(...columnaLeida.generador.trazo.puntos.map((q) => q.grosor)), 140, "la lectura acota a 140 cm, no al rango ni a los topes");
}
console.log("  ✓ la lectura de una foto (excepción documentada) acota su grosor a 140 cm y no pasa por los topes");

console.log("test-rango-grosor-cuerpo: ok");
