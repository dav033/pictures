/**
 * Propiedades del motor 3D de la vista guiada (sin coste, sin red, sin modelo), con semilla fija: cada caso se reproduce
 * con su número. Las propiedades que miden algo exigen cuántos casos lo ejercieron (si no, pasarían en vacío).
 * (a) `armarDesdeEspec`: determinismo; totales = suma de las piezas; el precio cuadra con lo que el motor pidió; más
 * densidad y más tamaño dan más globos (estrictamente en una parte de los casos, no solo «no menos»).
 * (b) Ediciones del cliente: ida y vuelta por la espec, idempotencia donde se define, y una edición no toca las demás.
 * (c) Colores que nombra el cliente (`lib-propiedades-color.ts`): cada nombre de la tarjeta es su color, lo demás como dice
 * el oráculo, y las preguntas sin bucle.
 * Cada caso tiene su semilla (`semillaDeCaso`): las semillas 1 a 10 prueban especificaciones distintas.
 */
import assert from "node:assert/strict";
import {
  aplicarEdicion, armarDesdeEspec, cotizarBom, crosswalkIncluido, especDesdePropuesta, especHashDe, EspecClienteV1Schema, VERSION_MOTOR,
  type BomLinea, type EspecClienteV1, type PiezaEspec, type ResultadoMotorV1,
} from "../../src/lib/globos3d/motor/v1";
import { pythonDoble } from "../lib/python-doble-precio";
import { Azar } from "./lib-semilla";
import { configPropiedades, semillaDeCaso } from "./lib-config-propiedades";
import { conDensidad, conMedidas, edicionAleatoria, especAleatoria, especDeIdeaPrueba, OPERACIONES_ALEATORIAS } from "./lib-espec-aleatoria";
import { propiedadesDeColoresDelCliente, propiedadesDeNombresDeTarjeta } from "./lib-propiedades-color";

const { casos: CASOS, semilla: SEMILLA } = configPropiedades();
const DENSIDADES_EN_ORDEN = ["sencilla", "media", "lujosa"] as const;
const TAMANOS_EN_ORDEN = [0.6, 1, 1.6] as const;
const MEDIDAS_BASE = { anchoM: 1, altoM: 1.5, largoM: 2 };
/** Qué parte de los casos tiene que mostrar un cambio ESTRICTO de globos (si el motor ignora el dato, cero). */
const MINIMO_ESTRICTO = Math.max(1, Math.floor(CASOS * 0.2));

const globos = (lineas: readonly BomLinea[]): number => lineas.reduce((suma, l) => suma + l.cantidad, 0);
const clave = (l: { formatoId: string; codigo: string }) => `${l.formatoId}|${l.codigo}`;

function sumaPorClave(lineas: readonly BomLinea[]): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const l of lineas) mapa.set(clave(l), (mapa.get(clave(l)) ?? 0) + l.cantidad);
  return mapa;
}

function verificarBom(resultado: ResultadoMotorV1, donde: string): void {
  const porPieza = sumaPorClave(Object.values(resultado.bom.porPieza).flat());
  const total = sumaPorClave(resultado.bom.total);
  assert.deepEqual([...total].sort(), [...porPieza].sort(), `${donde}: el total no es la suma de las piezas`);
}

/** Cotiza y verifica el precio. Devuelve cómo salió: `ok` (cuadra), `sin_cobertura` (honesto) o `sin_globos`. */
async function verificarPrecio(resultado: ResultadoMotorV1, donde: string): Promise<"ok" | "sin_cobertura" | "sin_globos"> {
  const cruce = crosswalkIncluido();
  const cotizacion = await cotizarBom(resultado.bom, { crosswalk: async () => cruce, cotizarLista: pythonDoble(cruce).cotizarLista });
  if (!resultado.bom.total.length) {
    assert.equal(cotizacion.ok, false, `${donde}: sin globos no debería haber precio`);
    return "sin_globos";
  }
  if (!cotizacion.ok) {
    assert.equal(cotizacion.razon, "sin_cobertura", `${donde}: fallo de precio sin explicar (${cotizacion.razon} ${"detalle" in cotizacion ? cotizacion.detalle : ""})`);
    assert.ok(cotizacion.faltantes.length > 0, `${donde}: sin_cobertura sin faltantes nombrados`);
    const claves = new Set(resultado.bom.total.map(clave));
    for (const f of cotizacion.faltantes) assert.ok(claves.has(clave(f)), `${donde}: faltante ${clave(f)} que no está en la lista`);
    return "sin_cobertura";
  }
  const suma = cotizacion.cotizacion.lineas.reduce((acc, l) => acc + (l.subtotal ?? Number.NaN), 0);
  assert.equal(cotizacion.total, suma, `${donde}: el total cotizado no es la suma de las líneas`);
  // Lo que se compra por (formato, código) cubre exactamente lo que pidió el motor, y cada compra cubre su merma.
  const comprado = new Map<string, number>();
  for (const c of cotizacion.compras) {
    comprado.set(clave(c), (comprado.get(clave(c)) ?? 0) + c.cantidad);
    assert.ok(c.paquetes * c.unidadesPaquete >= c.cantidadConMerma, `${donde}: ${clave(c)} compra ${c.paquetes * c.unidadesPaquete} y necesita ${c.cantidadConMerma}`);
    assert.ok(c.precioPaquete > 0, `${donde}: ${clave(c)} sin precio de paquete`);
    assert.equal(c.subtotal, c.paquetes * c.precioPaquete, `${donde}: ${clave(c)} cobra ${c.subtotal} y ${c.paquetes} paquetes de ${c.precioPaquete} son ${c.paquetes * c.precioPaquete}`);
  }
  assert.deepEqual([...comprado].sort(), [...sumaPorClave(resultado.bom.total)].sort(), `${donde}: lo comprado no es lo que pide el motor`);
  return "ok";
}

type Cuentas = { especificaciones: number; conGlobos: number; precio: Record<"ok" | "sin_cobertura" | "sin_globos", number>; densidadEstricta: number[]; tamanoEstricto: number[] };

/**
 * Se arman especificaciones hasta tener `CASOS` con globos (como mucho el triple): las de piezas que el motor no arma salen
 * sin globos y también se comprueban, pero no cuentan. Con un porcentaje fijo, una semilla con varias seguidas fallaba sin
 * que el motor tuviera nada mal.
 */
async function propiedadesDelMotor(): Promise<Cuentas> {
  const cuentas: Cuentas = { especificaciones: 0, conGlobos: 0, precio: { ok: 0, sin_cobertura: 0, sin_globos: 0 }, densidadEstricta: [0, 0], tamanoEstricto: [0, 0] };
  for (let caso = 0; cuentas.conGlobos < CASOS && caso < CASOS * 3; caso += 1) {
    const espec = especAleatoria(new Azar(semillaDeCaso(SEMILLA, "motor", caso)));
    const donde = `caso ${caso} (semilla ${SEMILLA})`;

    const primero = armarDesdeEspec(espec);
    assert.deepEqual(armarDesdeEspec(structuredClone(espec)), primero, `${donde}: armar dos veces dio resultados distintos`);
    assert.equal(primero.especHash, especHashDe(espec, VERSION_MOTOR), `${donde}: especHash no es el de la espec`);
    cuentas.especificaciones += 1;
    if (primero.bom.total.length) cuentas.conGlobos += 1;

    verificarBom(primero, donde);
    cuentas.precio[await verificarPrecio(primero, donde)] += 1;

    const densidades = DENSIDADES_EN_ORDEN.map((d) => globos(armarDesdeEspec(conDensidad(espec, d)).bom.total));
    for (let i = 1; i < densidades.length; i += 1) {
      assert.ok(densidades[i]! >= densidades[i - 1]!, `${donde}: ${DENSIDADES_EN_ORDEN[i]} da ${densidades[i]} globos y ${DENSIDADES_EN_ORDEN[i - 1]} da ${densidades[i - 1]}`);
      if (densidades[i]! > densidades[i - 1]!) cuentas.densidadEstricta[i - 1] += 1;
    }

    const tamanos = TAMANOS_EN_ORDEN.map((f) => globos(armarDesdeEspec(conMedidas(espec, MEDIDAS_BASE, f)).bom.total));
    for (let i = 1; i < tamanos.length; i += 1) {
      assert.ok(tamanos[i]! >= tamanos[i - 1]!, `${donde}: al crecer el tamaño (×${TAMANOS_EN_ORDEN[i]}) pasó de ${tamanos[i - 1]} a ${tamanos[i]} globos`);
      if (tamanos[i]! > tamanos[i - 1]!) cuentas.tamanoEstricto[i - 1] += 1;
    }
  }
  assert.ok(cuentas.conGlobos >= CASOS, `solo ${cuentas.conGlobos} de ${cuentas.especificaciones} especificaciones tienen globos (hacen falta ${CASOS}): las propiedades de la lista quedan vacías`);
  DENSIDADES_EN_ORDEN.slice(1).forEach((d, i) => assert.ok(cuentas.densidadEstricta[i]! >= MINIMO_ESTRICTO, `densidad ${d}: solo ${cuentas.densidadEstricta[i]} casos con más globos (mínimo ${MINIMO_ESTRICTO}): el motor no la usa`));
  cuentas.tamanoEstricto.forEach((n, i) => assert.ok(n >= MINIMO_ESTRICTO, `paso de tamaño ×${TAMANOS_EN_ORDEN[i + 1]}: solo ${n} casos con más globos (mínimo ${MINIMO_ESTRICTO}): el motor no usa el tamaño`));
  return cuentas;
}

type Operacion = ReturnType<typeof edicionAleatoria>["op"];

/** Lo que una edición deja igual en las piezas que no nombra: las mismas, con el mismo contenido. */
function piezasAjenasIntactas(antes: EspecClienteV1, despues: EspecClienteV1, excepto: ReadonlySet<string>, donde: string): void {
  for (const pieza of antes.piezas.filter((p) => !excepto.has(p.id))) {
    const igual = despues.piezas.find((p: PiezaEspec) => p.id === pieza.id);
    assert.deepEqual(igual, pieza, `${donde}: cambió la pieza ${pieza.id}, que no es la editada`);
  }
}

function propiedadesDeEdiciones(): Record<Operacion, number> {
  const aplicadas = Object.fromEntries(OPERACIONES.map((op) => [op, 0])) as Record<Operacion, number>;
  const total = Math.max(CASOS * 4, 48);
  // Si alguna operación todavía no se aplicó, se siguen sacando casos (en rotación, hasta el triple) antes de darla por muerta.
  for (let caso = 0; caso < total || (caso < total * 3 && OPERACIONES.some((op) => aplicadas[op] === 0)); caso += 1) {
    const azar = new Azar(semillaDeCaso(SEMILLA, "ediciones", caso));
    const espec = especAleatoria(azar);
    const edicion = edicionAleatoria(azar, espec, caso % OPERACIONES_ALEATORIAS);
    const donde = `edición ${caso} (${JSON.stringify(edicion)})`;
    const contexto = { idea: especDeIdeaPrueba };

    const resultado = aplicarEdicion(espec, edicion, contexto);
    if (resultado.noAplicado) {
      assert.deepEqual(resultado.espec, espec, `${donde}: se dijo que no se pudo y la espec cambió`);
      assert.match(resultado.noAplicado, /^No pude:/, `${donde}: el rechazo no dice «No pude»`);
      continue;
    }
    aplicadas[edicion.op] += 1;

    const leida = EspecClienteV1Schema.parse(JSON.parse(JSON.stringify(resultado.espec)));
    assert.equal(especHashDe(leida, VERSION_MOTOR), especHashDe(resultado.espec, VERSION_MOTOR), `${donde}: el hash cambia al serializar`);
    assert.deepEqual(armarDesdeEspec(leida).bom, armarDesdeEspec(resultado.espec).bom, `${donde}: la lista cambia al serializar`);

    if (["tamano_pieza", "lado", "flores", "quitar_pieza", "reemplazar_color", "proporcion_color"].includes(edicion.op)) {
      assert.deepEqual(aplicarEdicion(resultado.espec, edicion, contexto).espec, resultado.espec, `${donde}: no es idempotente`);
    }

    const pieza = "pieza" in edicion ? edicion.pieza : undefined;
    if (pieza) {
      piezasAjenasIntactas(espec, resultado.espec, new Set([pieza]), donde);
      assert.ok(resultado.tocadas.every((id) => id === pieza), `${donde}: tocó ${resultado.tocadas.join(", ")}`);
    } else if (edicion.op === "agregar_pieza" || edicion.op === "agregar_idea") {
      piezasAjenasIntactas(espec, resultado.espec, new Set(), donde);
      assert.ok(resultado.espec.piezas.length > espec.piezas.length, `${donde}: sumó y no quedó más piezas`);
    }
  }
  const sin = OPERACIONES.filter((op) => aplicadas[op] === 0);
  assert.deepEqual(sin, [], `operaciones que nunca se aplicaron en ${total} ediciones: ${sin.join(", ")}`);
  return aplicadas;
}

const OPERACIONES: readonly Operacion[] = [
  "reemplazar_color", "agregar_color", "quitar_color", "proporcion_color", "mas_menos_color", "tamano_pieza",
  "tamano_globos", "lado", "quitar_pieza", "agregar_pieza", "agregar_idea", "flores",
];

/**
 * Regresión: «reemplazar dorado reflex» dos veces. La segunda vez el dorado reflex ya no está y el acabado no es una
 * familia: no puede cambiar el dorado metal, que es de otro acabado. Antes lo cambiaba (cazado por la propiedad de
 * idempotencia con la semilla 20261009, caso de ediciones 55).
 */
function regresionAcabadoAjeno(): void {
  const { espec: base } = especDesdePropuesta({ frase: "Regresión.", colores: ["azul"], piezas: [{ estructura: "arco", cantidad: 1 }] });
  const espec: EspecClienteV1 = {
    ...base,
    piezas: base.piezas.map((p) => ({ ...p, colores: [{ codigo: "570", nombre: "dorado metal", peso: 0.5 }, { codigo: "970", nombre: "dorado reflex", peso: 0.5 }] })),
  };
  const edicion = { op: "reemplazar_color" as const, de: "dorado reflex", a: "azul mate" };
  const una = aplicarEdicion(espec, edicion);
  const dos = aplicarEdicion(una.espec, edicion);
  assert.deepEqual(dos.espec, una.espec, "la segunda vez no puede cambiar nada: el dorado reflex ya no está");
  assert.ok(dos.espec.piezas[0]!.colores.some((c) => c.codigo === "570"), "el dorado metal tiene que seguir");
}

/** Las semillas 1 a 10, con 12 casos cada una, dan 120 especificaciones distintas (con `semilla + caso` eran 21). */
function semillasDistintas(): void {
  const vistas = new Set<string>();
  for (let semilla = 1; semilla <= 10; semilla += 1) {
    for (let caso = 0; caso < 12; caso += 1) vistas.add(JSON.stringify(especAleatoria(new Azar(semillaDeCaso(semilla, "motor", caso)))));
  }
  assert.equal(vistas.size, 120, `las semillas 1 a 10 repiten especificaciones: ${vistas.size} distintas de 120`);
}

async function main(): Promise<void> {
  semillasDistintas();
  regresionAcabadoAjeno();
  const cuentas = await propiedadesDelMotor();
  const aplicadas = propiedadesDeEdiciones();
  const nombres = propiedadesDeNombresDeTarjeta(SEMILLA, Math.max(CASOS, 12));
  const colores = propiedadesDeColoresDelCliente(SEMILLA, Math.max(CASOS * 8, 96));
  const totalAplicadas = Object.values(aplicadas).reduce((a, b) => a + b, 0);
  console.log(`test-propiedades-motor (semilla ${SEMILLA}, ${CASOS} casos): ${cuentas.especificaciones} especificaciones (${cuentas.conGlobos} con globos; precio ok ${cuentas.precio.ok}, sin_cobertura ${cuentas.precio.sin_cobertura}, sin globos ${cuentas.precio.sin_globos}); densidad estricta ${cuentas.densidadEstricta.join("/")}; tamaño estricto ${cuentas.tamanoEstricto.join("/")}; ${totalAplicadas} ediciones aplicadas en ${OPERACIONES.length} operaciones; nombres de tarjeta: ${nombres.delPlan} del plan y ${nombres.dePieza} de pieza, cada uno su color (${nombres.dosRosas} planes con «Rosa» y «Rosado» a la vez); frases del cliente: ${colores.aplicadas} aplicadas, ${colores.noLleva} «no lleva», ${colores.preguntas} preguntas (${colores.repeticiones} por parecer una orden repetida, ${colores.sinOrden} iguales sin orden previa que no preguntan) y ${colores.opciones} opciones sin bucle; motor ${VERSION_MOTOR}.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

