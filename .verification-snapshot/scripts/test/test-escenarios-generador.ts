/**
 * El generador de la matriz (`scripts/escenarios/generador.ts`, REQ-014 T13):
 *   - determinista por semilla (el escenario i de la semilla s sale igual, y no depende de los anteriores);
 *   - cada valor de cada eje se alcanza: estructura, tamaños, densidad, origen, número de colores (1 a 6) y familia de acabado;
 *   - los colores y acabados salen solo de la tabla Sempertex y los pesos suman 1;
 *   - todo escenario lo acepta el esquema del cliente.
 * Ejes que la matriz NO varía porque la fachada no los acepta (ver `generador.ts`): tamaño de sala, mobiliario e iluminación.
 * El tope de colores es 6 (`MAX_COLORES_PIEZA`, el máximo del esquema), no los 8 que pedía el plan; el esquema lo rechaza.
 *
 *   npx tsx --conditions=react-server scripts/test/test-escenarios-generador.ts
 */
import assert from "node:assert/strict";
import { ESTRUCTURAS_OFICIALES_IDS } from "../../src/lib/plan/estructuras-oficiales";
import { TABLA_SEMPERTEX } from "../../src/lib/plan/referencia-sempertex";
import {
  DENSIDADES_ESPEC, EspecClienteV1Schema, MAX_COLORES_PIEZA, ORIGENES_ESPEC, TAMANOS_ESPEC,
} from "../../src/lib/globos3d/motor/espec-cliente-v1";
import { COLORES_MAX, COLORES_MIN, escenarioDe, generarLote } from "../escenarios/generador";

const SEMILLA = 11;
const N = 3000;

function pruebaDeterminismo(): void {
  const lote = [...generarLote(SEMILLA, 60)].map((e) => JSON.stringify(e));
  assert.deepEqual([...generarLote(SEMILLA, 60)].map((e) => JSON.stringify(e)), lote, "el mismo lote sale igual");
  for (const i of [0, 17, 59]) assert.equal(JSON.stringify(escenarioDe(SEMILLA, i)), lote[i], `el escenario ${i} no depende de los anteriores`);
  assert.notEqual(JSON.stringify([...generarLote(SEMILLA + 1, 60)]), JSON.stringify([...generarLote(SEMILLA, 60)]), "otra semilla, otros escenarios");
  assert.equal(new Set(lote).size, lote.length, "los escenarios de un lote son distintos entre sí");
  console.log("  determinismo por semilla: ok");
}

function pruebaEjesAlcanzables(): void {
  const estructuras = new Set<string>(), tamanos = new Set<string>(), densidades = new Set<string>(), origenes = new Set<string>();
  const nColores = new Set<number>(), familias = new Set<string>(), piezasPorEscenario = new Set<number>();
  const familiaDe = new Map(TABLA_SEMPERTEX.referencias.map((r) => [r.codigo, r.familia]));
  for (const { espec } of generarLote(SEMILLA, N)) {
    origenes.add(espec.origen.tipo);
    piezasPorEscenario.add(espec.piezas.length);
    for (const p of espec.piezas) {
      estructuras.add(p.oficial);
      tamanos.add(p.tamanos);
      if (p.densidad) densidades.add(p.densidad);
      nColores.add(p.colores.length);
      for (const c of p.colores) familias.add(familiaDe.get(c.codigo)!);
    }
  }
  const faltan = (nombre: string, esperado: readonly (string | number)[], visto: Set<string | number>): void =>
    assert.deepEqual(esperado.filter((v) => !visto.has(v)), [], `${nombre}: valores que el generador nunca produce en ${N} escenarios`);
  faltan("estructura", ESTRUCTURAS_OFICIALES_IDS, estructuras);
  faltan("tamaños", TAMANOS_ESPEC, tamanos);
  faltan("densidad", DENSIDADES_ESPEC, densidades);
  faltan("origen", ORIGENES_ESPEC, origenes);
  faltan("número de colores", Array.from({ length: COLORES_MAX - COLORES_MIN + 1 }, (_, i) => COLORES_MIN + i), nColores);
  faltan("familia de acabado", [...new Set(TABLA_SEMPERTEX.referencias.map((r) => r.familia))], familias);
  faltan("piezas por escenario", [1, 2, 3], piezasPorEscenario);
  assert.equal(COLORES_MAX, MAX_COLORES_PIEZA, "el tope del generador es el del esquema");
  console.log(`  ejes alcanzables (${N} escenarios): ${estructuras.size} estructuras, ${tamanos.size} tamaños, ${densidades.size} densidades, ${origenes.size} orígenes, colores ${[...nColores].sort().join("/")}, ${familias.size} familias: ok`);
}

function pruebaCatalogoYEsquema(): void {
  const porCodigo = new Map(TABLA_SEMPERTEX.referencias.map((r) => [r.codigo, r]));
  for (const e of generarLote(SEMILLA, 500)) {
    const valida = EspecClienteV1Schema.safeParse(e.espec);
    assert.ok(valida.success, `${e.id} lo rechaza el esquema: ${valida.success ? "" : valida.error.message}`);
    for (const p of e.espec.piezas) {
      const codigos = [
        ...p.colores.map((c) => c.codigo), ...(p.flores ? [p.flores.codigo, ...(p.flores.centro ? [p.flores.centro] : [])] : []),
        ...(p.remate ? [p.remate.codigo] : []), ...(p.declarada?.materiales.map((m) => m.codigo) ?? []),
      ];
      for (const codigo of codigos) assert.ok(porCodigo.has(codigo), `${e.id}: el código ${codigo} no está en la tabla Sempertex`);
      for (const c of p.colores) assert.equal(c.nombre, porCodigo.get(c.codigo)!.nombre.slice(0, 80), `${e.id}: nombre de ${c.codigo} distinto del catálogo`);
      assert.equal(new Set(p.colores.map((c) => c.codigo)).size, p.colores.length, `${e.id}: colores repetidos en una pieza`);
      assert.ok(Math.abs(p.colores.reduce((s, c) => s + c.peso, 0) - 1) < 0.01, `${e.id}: los pesos no suman 1`);
    }
  }
  console.log("  códigos, nombres y pesos salen de la tabla y el esquema los acepta: ok");
}

pruebaDeterminismo();
pruebaEjesAlcanzables();
pruebaCatalogoYEsquema();
console.log("test-escenarios-generador: ok");
