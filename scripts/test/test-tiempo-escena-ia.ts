/**
 * El tiempo de la IA de escena del taller 3D (P-054), sin relojes (en este equipo, 15,7 GB, un armado varía hasta un 50 % con la carga): lo que
 * se prueba es cuántos empaques de verdad pide cada herramienta (`EMPAQUES`: los que salen de la caché no cuentan), que es lo que cuesta el tiempo.
 * - un cuerpo de solo R-5 de 320 × 160 se rechaza antes de armar nada, con un mensaje para el modelo; con globos más grandes entra; lo mismo
 *   si se pide con «más R-5», «más tupida» o cambiando los tamaños de una pieza que ya existe (todo se acota sin armar);
 * - «más R-24» seguido, tres veces, no vuelve a armar la pieza por cada peso que prueba: la búsqueda va sin armar y se arma la elegida;
 * - agregar_pieza no vuelve a armar un cuerpo grande para afinar su alto si ya tardó (se dice), y uno que no cabe bajo el techo se estira una vez
 *   (dos armadas, como antes) o dice qué alto_cm pedir;
 * - la ruta tiene `maxDuration` y deja de aplicar herramientas cuando no queda tiempo.
 * Sin coste: ninguna IA ni red.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-tiempo-escena-ia.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SALA_INICIAL, type Escena } from "../../src/lib/globos3d/escena";
import { alturaDePieza } from "../../src/lib/globos3d/altura-pieza";
import { aplicarHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { EMPAQUES } from "../../src/lib/globos3d/organico-empaques";
import { GLOBOS_MAXIMOS_CUERPO } from "../../src/lib/globos3d/presupuesto-cuerpo";
import { globosDeEstructura } from "../../src/lib/globos3d/organico-estructura";
import { comoOrganico, conDensidad, conPeso, opcionesDe, type Organico } from "../../src/lib/globos3d/organico-ajustes";
import { radiosDeArco } from "../../src/lib/globos3d/formas-escena";
import { valorQueCabeEnPresupuesto } from "../../src/lib/globos3d/presupuesto-ajustes";
import type { Pieza } from "../../src/lib/globos3d/piezas";

let pruebas = 0;
const prueba = (nombre: string, fn: () => void) => { fn(); pruebas += 1; console.log(`  ✓ ${nombre}`); };

const alta = { ...SALA_INICIAL, altoCm: 600, anchoCm: 1200 };
const agregar = (pedido: Record<string, unknown>, sala = alta) => aplicarHerramienta({ sala, nodos: [] }, "agregar_pieza", pedido);
/** Cuántos empaques nuevos hace `fn`. */
function empaquesDe<T>(fn: () => T): { valor: T; empaques: number } {
  const antes = EMPAQUES.hechos;
  const valor = fn();
  return { valor, empaques: EMPAQUES.hechos - antes };
}

console.log("El presupuesto cuenta los globos, no solo los cm³");
prueba("una columna de solo R-5 de 320 × 160 pasa del volumen de armado de siempre pero se rechaza por globos, sin armar nada, con un mensaje para el modelo", () => {
  const { valor: r, empaques } = empaquesDe(() => agregar({ tipo: "columna_organica", alto_cm: 320, grosor_cm: 160, tamanos: ["R-5"] }));
  assert.ok(!r.ok, "debía rechazarse");
  assert.equal(empaques, 0, "se rechaza antes de armar");
  assert.match(r.error, /demasiados globos/);
  assert.ok(r.error.includes(`hasta ${GLOBOS_MAXIMOS_CUERPO}`), r.error);
  assert.match(r.error, /R-12, R-18, R-24/, "dice qué hacer");
  assert.match(r.error, /el grosor máximo es \d+ cm/, "y hasta qué grosor cabe con esos tamaños");
});

prueba("la misma columna con R-12 entra (lleva unos 130 globos de estructura), y la de mezcla de siempre también", () => {
  for (const tamanos of [["R-12"], undefined]) {
    const r = agregar({ tipo: "columna_organica", alto_cm: 320, grosor_cm: 160, ...(tamanos ? { tamanos } : {}) });
    assert.ok(r.ok, r.ok ? "" : r.error);
  }
});

console.log("Más globos de un formato, más densidad y otros tamaños tampoco pasan del presupuesto");
/** Un arco de 500 × 320 a 120 cm de cuerpo (de los más pesados que se arman), sin armarlo. */
const arcoGrande: Pieza = { tipo: "arco_organico", arco: { anchoCm: 500, altoCm: 320, ...radiosDeArco(120), semilla: 7, densidad: 1, colores: [{ codigo: "609", peso: 1 }], flores: null, huecosFlores: 0 } };
const estructuraDe = (p: Organico) => globosDeEstructura(opcionesDe(p));

prueba("«más R-5» se acota al presupuesto buscando sin armar: el peso que cabe deja la pieza en el tope y un poco más ya lo pasa", () => {
  const arco = comoOrganico(arcoGrande as Extract<Pieza, { tipo: "arco_organico" }>);
  const conK = (k: number) => conPeso(arco, "R-5", "todo", k, false);
  assert.ok(estructuraDe(conK(80)) > GLOBOS_MAXIMOS_CUERPO, "con el peso más alto pasaría del tope");
  const { valor: k, empaques } = empaquesDe(() => valorQueCabeEnPresupuesto(conK, 80));
  assert.equal(empaques, 0, "sin armar");
  assert.ok(k !== null && k > 1 && k < 80, `peso ${k}`);
  assert.ok(estructuraDe(conK(k!)) <= GLOBOS_MAXIMOS_CUERPO, "cabe");
  assert.ok(estructuraDe(conK(k! * 1.15)) > GLOBOS_MAXIMOS_CUERPO, "un poco más ya no");
  assert.equal(valorQueCabeEnPresupuesto(conK, 1.01), 1.01, "lo que ya cabe se deja");
});

prueba("«más tupida» se acota igual: la densidad que cabe no pasa de los globos de estructura que se arman", () => {
  const arco = comoOrganico(arcoGrande as Extract<Pieza, { tipo: "arco_organico" }>);
  assert.ok(estructuraDe(conDensidad(arco, 2.5) as Organico) > GLOBOS_MAXIMOS_CUERPO, "×2,5 pasaría del tope");
  const factor = valorQueCabeEnPresupuesto((f) => conDensidad(arco, f), 2.5);
  assert.ok(factor !== null && factor > 1 && factor < 2.5, `factor ${factor}`);
  assert.ok(estructuraDe(conDensidad(arco, factor!) as Organico) <= GLOBOS_MAXIMOS_CUERPO);
});

prueba("cambiar los tamaños de un arco grande a solo R-5 se rechaza antes de armar nada, con el mensaje de globos", () => {
  const escena: Escena = { sala: alta, nodos: [{ id: "arco", nombre: "Arco", pieza: arcoGrande, colocacion: { en: "piso", xCm: 0, zCm: 0, giroGrados: 0 } }] };
  const { valor: r, empaques } = empaquesDe(() => aplicarHerramienta(escena, "cambiar_pieza", { id: "arco", tamanos: ["R-5"] }));
  assert.ok(!r.ok, "debía rechazarse");
  assert.match(r.error, /demasiados globos/);
  assert.equal(empaques, 0);
});

console.log("ajustar_tamanos busca sin armar");
prueba("«más R-24» tres veces seguidas en un arco de 500 × 320 hace pocos empaques en cada llamada (la búsqueda va con la cuenta sin armar y se arma la elegida: antes, decenas en la tercera)", () => {
  let escena = (() => { const r = agregar({ tipo: "arco_organico", ancho_cm: 500, alto_cm: 320 }, SALA_INICIAL); return r.ok ? r.escena : assert.fail(r.error); })();
  const gastados: number[] = [];
  for (let vez = 1; vez <= 3; vez++) {
    const { valor: r, empaques } = empaquesDe(() => aplicarHerramienta(escena, "ajustar_tamanos", { id: escena.nodos[0]!.id, cambios: [{ formato: "R-24", accion: "mas" }] }));
    assert.ok(r.ok, r.ok ? "" : r.error);
    gastados.push(empaques);
    escena = r.escena;
    assert.match(r.resumen, /R-24: \d+ → \d+/, "dice cuántos había y cuántos hay");
  }
  assert.ok(gastados.every((n) => n <= 8), `empaques por llamada: ${gastados.join(", ")}`);
});

console.log("agregar_pieza no arma de más");
prueba("un marco grande en una sala alta se arma una vez o dos (la segunda solo si la primera fue rápida), nunca más", () => {
  const { valor: r, empaques } = empaquesDe(() => agregar({ tipo: "marco_organico", ancho_cm: 500, alto_cm: 320, grosor_cm: 100 }));
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.ok(empaques >= 1 && empaques <= 2, `empaques: ${empaques}`);
});

prueba("el mismo marco en una sala de 320 cm cabe: se estira una vez, como antes (dos armadas) y no da el error del techo", () => {
  const { valor: r, empaques } = empaquesDe(() => agregar({ tipo: "marco_organico", ancho_cm: 500, alto_cm: 320, grosor_cm: 100 }, SALA_INICIAL));
  assert.ok(r.ok, r.ok ? "" : r.error);
  assert.ok(empaques <= 2, `empaques: ${empaques}`);
  assert.ok(alturaDePieza(r.escena.nodos[0]!.pieza) <= SALA_INICIAL.altoCm, "cabe bajo el techo");
});


console.log("La ruta tiene plazo");
prueba("la ruta declara maxDuration y no aplica herramientas cuando no queda tiempo: el modelo recibe «No pude: …» y la respuesta lo dice", () => {
  const ruta = readFileSync(new URL("../../src/app/api/escena-ia/route.ts", import.meta.url), "utf8");
  assert.match(ruta, /export const maxDuration = 75;/);
  assert.match(ruta, /crearPlazo\(maxDuration \* 1000\)/);
  assert.match(ruta, /control\.hayVuelta\(\)/, "mira antes de cada vuelta del modelo");
  assert.match(ruta, /control\.puedeAplicar\(\)/, "y antes de cada herramienta");
  assert.match(ruta, /textoHerramientaSinTiempo\(nombre\)/, "lo que recibe el modelo");
  assert.match(ruta, /textoPasoSinTiempo\(nombre\)/, "lo que ve el usuario (sin las instrucciones al modelo)");
  assert.match(ruta, /corteConPlazo\(request\.signal, plazo\)/, "la llamada al modelo se corta con el plazo");
  assert.match(ruta, /corteElPlazo\(corte, request\.signal\)/, "y un fallo del proveedor no se toma por tiempo agotado");
  assert.match(ruta, /respuestaConPlazo\(respuesta, cambios\.length, control\.estado\(\)\)/, "la respuesta dice que no alcanzó");
});

console.log(`test-tiempo-escena-ia: ${pruebas} pruebas ok`);
