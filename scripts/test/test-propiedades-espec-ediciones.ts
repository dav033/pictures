/**
 * Propiedades de `armarDesdeEspec` y de las ediciones del cliente (`aplicarEdicion`), sin red, sin coste y con semilla fija: los
 * escenarios salen del generador de la matriz (`scripts/escenarios/generador.ts`), las ediciones de `lib-espec-aleatoria.ts`.
 * Cada fallo imprime su semilla base y el caso, y se reproduce con `PROPIEDADES_SEMILLA=<n> PROPIEDADES_CASOS=<n>`.
 *   (a) una espec generada valida, se arma igual dos veces y sobrevive al viaje por JSON con el mismo hash;
 *   (b) una edición solo toca las piezas que dice (`tocadas`); las demás quedan idénticas;
 *   (c) lo que no se puede hacer dice «No pude: …» y no cambia nada; una forma inventada tampoco se ejecuta;
 *   (d) ida y vuelta EXACTA solo donde la edición tiene inverso exacto: agregar/quitar pieza, flores, lado y proporción de color.
 *       Los pasos de tamaño NO son invertibles por diseño (P-042: el redondeo a la rejilla y los topes): se afirma que la vuelta se
 *       acepta, sigue dentro de lo que arma el constructor y deriva como mucho un paso; los pasos de tamaño de globos y de más/menos
 *       color se informan (no siempre vuelven) y se afirma que cada paso deja una espec válida.
 *   npx tsx --conditions=react-server scripts/test/test-propiedades-espec-ediciones.ts
 */
import assert from "node:assert/strict";
import { escenarioDe } from "../escenarios/generador";
import { aplicarEdicion, armarDesdeEspec, especHashDe, EspecClienteV1Schema, PREFIJO_NO_PUDE, VERSION_MOTOR, type EdicionEspecV1, type EspecClienteV1, type PiezaEspec } from "../../src/lib/globos3d/motor/v1";
import { medidasEditables, type RangoMedida } from "../../src/lib/globos3d/motor/rangos-medidas";
import { Azar } from "./lib-semilla";
import { configPropiedades, semillaDeCaso } from "./lib-config-propiedades";
import { edicionAleatoria, OPERACIONES_ALEATORIAS } from "./lib-espec-aleatoria";

const { casos: CASOS, semilla: SEMILLA } = configPropiedades();
const TOTAL = CASOS * 3;
const PASO_TAMANO = 0.1;
const HOLGURA_M = 0.01;
const MEDIDAS = ["anchoM", "altoM", "largoM"] as const;
const sinOrigen = (e: EspecClienteV1) => JSON.stringify(e.piezas);

/** Corre un caso y, si falla, dice la semilla y el caso para reproducirlo. */
function caso(propiedad: string, indice: number, fn: () => void): void {
  try { fn(); } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(`[${propiedad}] FALLÓ con PROPIEDADES_SEMILLA=${SEMILLA} en el caso ${indice} (escenario ${escenarioDe(SEMILLA, indice).id}, semilla del escenario ${escenarioDe(SEMILLA, indice).semilla}): ${motivo}`);
  }
}

function armadoDeterminista(): number {
  let conGlobos = 0;
  for (let i = 0; i < TOTAL; i += 1) caso("armado", i, () => {
    const { espec } = escenarioDe(SEMILLA, i);
    assert.ok(EspecClienteV1Schema.safeParse(espec).success, "la espec generada no valida");
    const primero = armarDesdeEspec(espec);
    assert.deepEqual(armarDesdeEspec(structuredClone(espec)), primero, "armar dos veces dio resultados distintos");
    assert.equal(primero.especHash, especHashDe(espec, VERSION_MOTOR));
    const viaje = EspecClienteV1Schema.parse(JSON.parse(JSON.stringify(espec)));
    assert.equal(armarDesdeEspec(viaje).especHash, primero.especHash, "el hash cambia al viajar por JSON");
    assert.deepEqual(armarDesdeEspec(viaje).bom, primero.bom, "la lista cambia al viajar por JSON");
    if (primero.bom.total.length) conGlobos += 1;
    else assert.ok(primero.noRepresentable.length > 0, "sin globos y sin decir por qué");
  });
  assert.ok(conGlobos >= TOTAL * 0.5, `solo ${conGlobos} de ${TOTAL} escenarios tienen globos: la propiedad quedaría en vacío`);
  return conGlobos;
}

function edicionesQueSoloTocanLoSuyo(): Record<string, { aplicadas: number; rechazadas: number }> {
  const cuentas: Record<string, { aplicadas: number; rechazadas: number }> = {};
  for (let i = 0; i < TOTAL; i += 1) caso("ediciones", i, () => {
    const { espec } = escenarioDe(SEMILLA, i);
    const operacion = i % OPERACIONES_ALEATORIAS;
    const edicion = edicionAleatoria(new Azar(semillaDeCaso(SEMILLA, "espec-ediciones", i)), espec, operacion);
    const cuenta = (cuentas[edicion.op] ??= { aplicadas: 0, rechazadas: 0 });
    const antes = structuredClone(espec);
    const r = aplicarEdicion(espec, edicion, { idea: (id) => escenarioDe(SEMILLA, Number(id.replace(/\D/g, "")) || 1).espec });
    assert.deepEqual(espec, antes, "la edición mutó la espec de entrada");
    if (r.noAplicado) {
      cuenta.rechazadas += 1;
      assert.ok(r.noAplicado.startsWith(PREFIJO_NO_PUDE), `rechazo sin «No pude:»: ${r.noAplicado}`);
      assert.deepEqual(r.espec, espec, "un rechazo cambió la espec");
      assert.deepEqual(r.tocadas, [], "un rechazo dice que tocó piezas");
      return;
    }
    cuenta.aplicadas += 1;
    assert.ok(EspecClienteV1Schema.safeParse(r.espec).success, "la espec editada no valida");
    const tocadas = new Set(r.tocadas);
    for (const pieza of espec.piezas.filter((p) => !tocadas.has(p.id))) {
      assert.deepEqual(r.espec.piezas.find((p) => p.id === pieza.id), pieza, `cambió ${pieza.id}, que no figura entre las tocadas (${r.tocadas.join(", ")})`);
    }
    if ("pieza" in edicion && edicion.pieza) assert.ok(r.tocadas.every((id) => id === edicion.pieza), `la edición nombra ${edicion.pieza} y tocó ${r.tocadas.join(", ")}`);
    assert.deepEqual(armarDesdeEspec(r.espec).bom, armarDesdeEspec(structuredClone(r.espec)).bom, "la espec editada no arma igual dos veces");
  });
  for (const op of ["reemplazar_color", "agregar_color", "quitar_color", "proporcion_color", "mas_menos_color", "tamano_pieza", "tamano_globos", "lado", "quitar_pieza", "agregar_pieza", "agregar_idea", "flores"]) {
    assert.ok((cuentas[op]?.aplicadas ?? 0) > 0, `la operación ${op} nunca se aplicó en ${TOTAL} casos: la propiedad no la ejerce`);
  }
  return cuentas;
}

function rechazosHonestos(): number {
  let rechazos = 0;
  for (let i = 0; i < TOTAL; i += 1) caso("rechazos", i, () => {
    const { espec } = escenarioDe(SEMILLA, i);
    const inexistente = "EST_99_ARCO";
    const imposibles: EdicionEspecV1[] = [
      { op: "quitar_pieza", pieza: inexistente },
      { op: "lado", pieza: inexistente, lado: "izquierda" },
      { op: "flores", pieza: inexistente, flores: null },
      { op: "tamano_pieza", pieza: inexistente, direccion: 1 },
      { op: "proporcion_color", pieza: inexistente, pesos: [1, 2] },
      { op: "agregar_idea", ideaId: "idea-que-no-existe" },
      { op: "reemplazar_color", de: "color-que-nadie-dijo-zzz", a: "azul" },
      { op: "quitar_color", color: "color-que-nadie-dijo-zzz" },
    ];
    for (const edicion of imposibles) {
      const r = aplicarEdicion(espec, edicion, { idea: () => null });
      assert.ok(r.noAplicado, `${edicion.op} sobre algo que no existe se aplicó`);
      assert.ok(r.noAplicado.startsWith(PREFIJO_NO_PUDE));
      assert.deepEqual(r.espec, espec);
      rechazos += 1;
    }
    const inventada = aplicarEdicion(espec, { op: "inventada" } as unknown as EdicionEspecV1);
    assert.ok(inventada.noAplicado?.startsWith(PREFIJO_NO_PUDE), "una forma inventada se ejecutó o no dice «No pude:»");
    assert.deepEqual(inventada.espec, espec);
  });
  return rechazos;
}

type Vuelta = { exactas: number; casos: number };

function idaYVueltaExacta(): Record<string, Vuelta> {
  const cuentas: Record<string, Vuelta> = {};
  const registrar = (nombre: string, exacta: boolean | null) => {
    const c = (cuentas[nombre] ??= { exactas: 0, casos: 0 });
    if (exacta === null) return;
    c.casos += 1;
    if (exacta) c.exactas += 1;
  };
  for (let i = 0; i < TOTAL; i += 1) caso("ida-y-vuelta", i, () => {
    const { espec } = escenarioDe(SEMILLA, i);
    const pieza: PiezaEspec = espec.piezas[i % espec.piezas.length]!;
    const igual = (otra: EspecClienteV1) => sinOrigen(otra) === sinOrigen(espec);
    const y = (e: EspecClienteV1, edicion: EdicionEspecV1) => aplicarEdicion(e, edicion);

    const sumada = y(espec, { op: "agregar_pieza", oficial: "arco" });
    if (!sumada.noAplicado) {
      const quitada = y(sumada.espec, { op: "quitar_pieza", pieza: sumada.tocadas[0]! });
      assert.ok(!quitada.noAplicado, "no se puede quitar la pieza recién agregada");
      assert.ok(igual(quitada.espec), "agregar y quitar la pieza nueva no vuelve a las piezas de antes");
      registrar("agregar_pieza/quitar_pieza", true);
    } else registrar("agregar_pieza/quitar_pieza", null);

    if (!pieza.flores) {
      const con = y(espec, { op: "flores", pieza: pieza.id, flores: { cantidad: 4, petalos: 4, codigo: "040" } });
      if (!con.noAplicado) {
        const sin = y(con.espec, { op: "flores", pieza: pieza.id, flores: null });
        assert.ok(!sin.noAplicado && igual(sin.espec), "poner y quitar flores no vuelve a la pieza de antes");
        registrar("flores", true);
      }
    }

    if (pieza.lugar === "izquierda" || pieza.lugar === "derecha") {
      const otro = pieza.lugar === "izquierda" ? "derecha" : "izquierda";
      const ida = y(espec, { op: "lado", pieza: pieza.id, lado: otro });
      if (!ida.noAplicado) {
        const vuelta = y(ida.espec, { op: "lado", pieza: pieza.id, lado: pieza.lugar });
        assert.ok(!vuelta.noAplicado && igual(vuelta.espec), "cambiar de lado y volver no deja la pieza donde estaba");
        registrar("lado", true);
      }
    }

    if (pieza.colores.length >= 2) {
      const ida = y(espec, { op: "proporcion_color", pieza: pieza.id, pesos: pieza.colores.map((_, k) => k + 1) });
      if (!ida.noAplicado) {
        const vuelta = y(ida.espec, { op: "proporcion_color", pieza: pieza.id, pesos: pieza.colores.map((c) => c.peso) });
        assert.ok(!vuelta.noAplicado, "la proporción original se rechaza");
        const original = pieza.colores.map((c) => c.peso);
        const vueltos = vuelta.espec.piezas.find((p) => p.id === pieza.id)!.colores.map((c) => c.peso);
        original.forEach((peso, k) => assert.ok(Math.abs(peso - vueltos[k]!) <= 0.001, `el color ${k} vuelve con ${vueltos[k]} y era ${peso}`));
        registrar("proporcion_color", true);
      }
    }

    // Tamaño: no es invertible por diseño (P-042). Se afirma lo que sí se garantiza.
    const conMedidas: PiezaEspec | undefined = espec.piezas.find((p) => MEDIDAS.some((m) => p.medidas[m] !== undefined));
    if (conMedidas) for (const direccion of [1, -1] as const) {
      const ida = y(espec, { op: "tamano_pieza", pieza: conMedidas.id, direccion });
      if (ida.noAplicado) continue;
      const vuelta = y(ida.espec, { op: "tamano_pieza", pieza: conMedidas.id, direccion: -direccion as 1 | -1 });
      // Si el paso llegó al borde del rango, la vuelta puede decir «No pude: ya está en su tamaño mínimo/máximo»: honesto y sin cambios.
      if (vuelta.noAplicado) {
        assert.ok(vuelta.noAplicado.startsWith(PREFIJO_NO_PUDE), "la vuelta de un paso de tamaño se rechaza sin «No pude:»");
        assert.deepEqual(vuelta.espec, ida.espec, "la vuelta rechazada cambió la espec");
        registrar(`tamano_pieza${direccion > 0 ? "+" : "-"} (no invertible: P-042)`, false);
        continue;
      }
      const a: PiezaEspec = vuelta.espec.piezas.find((p) => p.id === conMedidas.id)!;
      for (const m of MEDIDAS) {
        const antes: number | undefined = conMedidas.medidas[m];
        const rango: RangoMedida | undefined = medidasEditables(conMedidas)[m];
        if (antes === undefined || !rango) continue;
        const vuelto = a.medidas[m];
        assert.ok(vuelto !== undefined && vuelto >= rango[0] - 1e-9 && vuelto <= rango[1] + 1e-9, `${m} vuelve como ${vuelto}, fuera de lo que arma el constructor (${rango.join("–")})`);
        // Una medida de partida fuera de rango se acota a su borde (y se dice): la deriva se mide contra esa medida acotada.
        const acotada = Math.min(rango[1], Math.max(rango[0], antes));
        assert.ok(Math.abs(vuelto - acotada) <= acotada * PASO_TAMANO + HOLGURA_M, `${m} ${antes} (acotada ${acotada}) vuelve como ${vuelto}: deriva de más de un paso`);
      }
      registrar(`tamano_pieza${direccion > 0 ? "+" : "-"} (no invertible: P-042)`, igual(vuelta.espec));
    }

    for (const direccion of [1, -1] as const) {
      const ida = y(espec, { op: "tamano_globos", pieza: pieza.id, direccion });
      if (!ida.noAplicado) {
        assert.ok(EspecClienteV1Schema.safeParse(ida.espec).success);
        const vuelta = y(ida.espec, { op: "tamano_globos", pieza: pieza.id, direccion: -direccion as 1 | -1 });
        registrar(`tamano_globos${direccion > 0 ? "+" : "-"}`, !vuelta.noAplicado && igual(vuelta.espec));
      }
      const color = pieza.colores[0]!.nombre;
      const mas = y(espec, { op: "mas_menos_color", color, direccion, piezas: [pieza.id] });
      if (!mas.noAplicado) {
        assert.ok(EspecClienteV1Schema.safeParse(mas.espec).success);
        const vuelta = y(mas.espec, { op: "mas_menos_color", color, direccion: -direccion as 1 | -1, piezas: [pieza.id] });
        registrar(`mas_menos_color${direccion > 0 ? "+" : "-"}`, !vuelta.noAplicado && igual(vuelta.espec));
      }
    }
  });
  for (const exacta of ["agregar_pieza/quitar_pieza", "flores", "lado", "proporcion_color"]) {
    assert.ok((cuentas[exacta]?.casos ?? 0) >= TOTAL * 0.1, `${exacta}: solo ${cuentas[exacta]?.casos ?? 0} casos: la propiedad queda en vacío`);
  }
  return cuentas;
}

const conGlobos = armadoDeterminista();
const ediciones = edicionesQueSoloTocanLoSuyo();
const rechazos = rechazosHonestos();
const vueltas = idaYVueltaExacta();
const resumen = (o: Record<string, { aplicadas: number; rechazadas: number }>) => Object.entries(o).map(([k, v]) => `${k} ${v.aplicadas}/${v.rechazadas}`).join(", ");
console.log(`test-propiedades-espec-ediciones (semilla ${SEMILLA}, ${TOTAL} casos): ${conGlobos} escenarios con globos; ediciones aplicadas/rechazadas: ${resumen(ediciones)}; ${rechazos} rechazos de lo imposible con «No pude:».`);
console.log(`  ida y vuelta (exactas/casos): ${Object.entries(vueltas).map(([k, v]) => `${k} ${v.exactas}/${v.casos}`).join(", ")}`);
