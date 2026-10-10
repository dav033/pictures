/**
 * Corpus de frases del dueño, a través de las herramientas de la escena con un modelo SIMULADO (sin red, sin coste, sin
 * IA): cada frase tiene el guion de llamadas que un modelo razonable haría, y el resultado se comprueba en la escena.
 * Corre el mismo `aplicarHerramienta` que `/api/escena-ia`; lo que cambia es que las vueltas del modelo vienen de un guion.
 *
 * Cada frase dice qué escena de partida usa y qué tiene que cambiar. Si una herramienta falla, la prueba falla con la
 * frase y el mensaje de la herramienta.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { aplicarHerramienta, type ResultadoHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import type { Escena } from "../../src/lib/globos3d/escena";
import { centrosDe } from "../../src/lib/globos3d/centros-mesa";

type Args = Record<string, unknown>;
/** Los argumentos pueden depender de la escena del momento (un id que ya existe, un ancho mayor que el actual). */
type Llamada = { nombre: string; args: Args | ((escena: Escena) => Args) };
/** Una vuelta del modelo simulado: las llamadas que hace en ese turno. Sin llamadas, el modelo termina. */
type Vuelta = Llamada[];

type Resultados = ResultadoHerramienta[];
type Frase = {
  frase: string;
  /** Una escena predefinida, o «salon-armado» (la guardada con un salón ya armado). */
  base: string;
  vueltas: Vuelta[];
  comprobar: (antes: Escena, despues: Escena, resultados: Resultados) => void;
};

/** Modelo simulado: entrega sus vueltas en orden y recibe los resultados de cada una. */
export function modeloSimulado(vueltas: readonly Vuelta[]) {
  let turno = 0;
  const recibidos: Resultados = [];
  return {
    pedir(escena: Escena): { llamadas: { nombre: string; args: Args }[] } {
      const vuelta = vueltas[turno];
      turno += 1;
      if (!vuelta) return { llamadas: [] };
      return { llamadas: vuelta.map((l) => ({ nombre: l.nombre, args: typeof l.args === "function" ? l.args(escena) : l.args })) };
    },
    recibir(resultados: Resultados) {
      recibidos.push(...resultados);
    },
    recibidos,
  };
}

/** Corre el guion: el modelo pide, la herramienta aplica, la escena avanza. Devuelve la escena final y los resultados. */
export function correrFrase(frase: Frase): { antes: Escena; despues: Escena; resultados: Resultados } {
  const antes = escenaDeBase(frase.base);
  let escena = antes;
  const modelo = modeloSimulado(frase.vueltas);
  for (let vuelta = 0; vuelta < frase.vueltas.length + 1; vuelta += 1) {
    const paso = modelo.pedir(escena);
    if (!paso.llamadas.length) break;
    const resultados: Resultados = [];
    for (const llamada of paso.llamadas) {
      const r = aplicarHerramienta(escena, llamada.nombre, llamada.args);
      resultados.push(r);
      assert.ok(r.ok, `«${frase.frase}»: ${llamada.nombre} falló: ${r.ok ? "" : r.error}`);
      if (r.ok) escena = r.escena;
    }
    modelo.recibir(resultados);
  }
  return { antes, despues: escena, resultados: modelo.recibidos };
}

function escenaDeBase(base: string): Escena {
  return base === "salon-armado" ? structuredClone(SALON_ARMADO) : escenaPredefinida(base);
}

const contarTotal = (escena: Escena, ids: string[]): number => {
  const r = aplicarHerramienta(escena, "contar_globos", { ids });
  assert.ok(r.ok, `contar_globos falló: ${r.ok ? "" : r.error}`);
  const total = /(\d[\d.]*) en total/.exec(r.resumen);
  assert.ok(total, `contar_globos no dice el total: ${r.resumen}`);
  return Number(total[1]!.replace(/\./g, ""));
};

const piezasCon = (escena: Escena, prefijo: string) => escena.nodos.filter((n) => n.id.startsWith(prefijo));
const coloresDe = (escena: Escena, id: string): string[] => {
  const pieza = escena.nodos.find((n) => n.id === id)?.pieza as { colores?: string[] } | undefined;
  assert.ok(pieza?.colores, `la pieza ${id} no tiene colores`);
  return pieza.colores;
};
/** El salón armado con `armar_salon` (30 invitados) y guardado: «haz el salón más grande» parte de él, sin armarlo otra vez. */
const SALON_ARMADO = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "escena-salon-armado.json"), "utf8")) as Escena;
/** El código Sempertex del acabado que el taller da por cada color (verde = 030, dorado = 570). */
const VERDE = "030";
const DORADO = "570";

const FRASES: Frase[] = [
  {
    frase: "6 mesas redondas con 4 sillas cada una",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[{ nombre: "agregar_mesas", args: { cantidad: 6, tipo: "redonda", sillas_por_mesa: 4 } }]],
    comprobar: (antes, despues) => {
      assert.equal(piezasCon(despues, "mesa-redonda").length, 6, "tienen que quedar 6 mesas redondas");
      const sillas = despues.nodos.filter((n) => n.nombre.startsWith("Silla") && n.colocacion.en === "sobre");
      assert.equal(sillas.length, 6, "cada mesa lleva su grupo de sillas");
      for (const silla of sillas) {
        const pieza = silla.pieza as { mueble?: { sillas?: { pedida?: number; puestos?: unknown[] } } };
        assert.equal(pieza.mueble?.sillas?.pedida, 4, `${silla.id}: tiene que pedir 4 sillas`);
        assert.equal(pieza.mueble?.sillas?.puestos?.length, 4, `${silla.id}: tiene que tener 4 puestos`);
      }
    },
  },
  {
    frase: "pon un centro de mesa en cada mesa",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [
      [{ nombre: "agregar_mesas", args: { cantidad: 6, tipo: "redonda", sillas_por_mesa: 4 } }],
      [{ nombre: "decorar_mesas", args: { disenos: [{ tipo: "ramo_helio" }] } }],
    ],
    comprobar: (antes, despues) => {
      const mesas = piezasCon(despues, "mesa-redonda").map((n) => n.id);
      assert.equal(mesas.length, 6, "las 6 mesas siguen");
      // Solo cuentan los centros: las sillas también van «sobre» la mesa y harían que esto pasara sin que hubiera ni un centro.
      assert.equal(centrosDe(antes).length, 0, "la sala de partida no tiene centros");
      const padres = centrosDe(despues).map((n) => (n.colocacion.en === "sobre" ? n.colocacion.padreId : ""));
      assert.equal(padres.length, mesas.length, "tiene que haber un centro por mesa, ni más ni menos");
      assert.deepEqual([...padres].sort(), [...mesas].sort(), "cada mesa tiene que llevar su centro");
      assert.ok(antes.nodos.every((n) => despues.nodos.some((m) => m.id === n.id)), "decorar no quita piezas");
    },
  },
  {
    frase: "haz el salón más grande",
    base: "salon-armado",
    vueltas: [[{ nombre: "ajustar_salon", args: (escena) => ({ ancho_cm: escena.sala.anchoCm + 500, fondo_cm: escena.sala.fondoCm + 500 }) }]],
    comprobar: (antes, despues) => {
      assert.ok(despues.sala.anchoCm > antes.sala.anchoCm && despues.sala.fondoCm > antes.sala.fondoCm, "la sala tiene que crecer");
      assert.ok(antes.nodos.every((n) => despues.nodos.some((m) => m.id === n.id)), "agrandar el salón no quita las piezas que ya estaban");
    },
  },
  {
    frase: "dúo de reflex rojo con azul mate",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[
      { nombre: "agregar_pieza", args: { tipo: "columna", colores: ["rojo reflex"] } },
      { nombre: "agregar_pieza", args: { tipo: "columna", colores: ["azul mate"] } },
    ]],
    comprobar: (antes, despues) => {
      assert.equal(despues.nodos.length - antes.nodos.length, 2, "un dúo son dos columnas");
      const [rojo, azul] = despues.nodos.slice(-2).map((n) => n.id);
      assert.deepEqual(coloresDe(despues, rojo!), ["915"], "la primera tiene que ser roja reflex");
      assert.deepEqual(coloresDe(despues, azul!), ["640"], "la segunda tiene que ser azul mate");
    },
  },
  {
    frase: "cambia los link-o-loon a verde",
    base: "pared_fondo_columnas",
    vueltas: [[{ nombre: "editar_globos", args: { formatos: ["LOL-*"], cambio: { color: "verde" } } }]],
    comprobar: (antes, despues) => {
      assert.equal(antes.nodos.length, despues.nodos.length, "cambiar color no agrega ni quita piezas");
      const pared = (escena: Escena) => coloresDe(escena, "pared");
      assert.deepEqual([...new Set(pared(despues))], [VERDE], `la pared tiene que quedar toda verde: ${pared(despues)}`);
      assert.ok(pared(antes).length > 1 && !pared(antes).includes(VERDE), "la pared empezaba sin verde");
    },
  },
  {
    frase: "quita el arco",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[{ nombre: "quitar_pieza", args: { id: "arco" } }]],
    comprobar: (antes, despues) => {
      assert.equal(despues.nodos.length, antes.nodos.length - 1, "se quita una pieza");
      assert.ok(!despues.nodos.some((n) => n.id === "arco"), "el arco ya no está");
      assert.ok(despues.nodos.some((n) => n.id === "columna-izq"), "las columnas se quedan");
    },
  },
  {
    frase: "columna dorada de 2 metros",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[{ nombre: "agregar_pieza", args: { tipo: "columna", alto_cm: 200, colores: ["dorado"] } }]],
    comprobar: (antes, despues) => {
      assert.equal(despues.nodos.length - antes.nodos.length, 1, "una columna nueva");
      const nueva = despues.nodos.at(-1)!;
      assert.equal((nueva.pieza as { alturaCm?: number }).alturaCm, 200, "la columna mide 2 metros");
      assert.deepEqual(coloresDe(despues, nueva.id), [DORADO], "la columna es dorada");
    },
  },
  {
    frase: "más tupida",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[{ nombre: "ajustar_tamanos", args: { id: "arco", densidad: "mas" } }]],
    comprobar: (antes, despues) => {
      assert.ok(contarTotal(despues, ["arco"]) > contarTotal(antes, ["arco"]), `el arco no quedó más tupido: ${contarTotal(antes, ["arco"])} → ${contarTotal(despues, ["arco"])}`);
    },
  },
];

function main(): void {
  for (const frase of FRASES) {
    const { antes, despues, resultados } = correrFrase(frase);
    frase.comprobar(antes, despues, resultados);
    console.log(`OK «${frase.frase}»`);
  }
  console.log(`test-frases-dueno: ${FRASES.length} frases del dueño, cada una con su cambio en la escena.`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
