/**
 * Editor de columnas orgánicas del motor con vista previa en vivo (ADR-0035, paso 3). Módulos sin React y render estático,
 * sin red ni proveedores, como `test-ui-editor-arco.ts`. La salida del motor es REAL: `vista-columna-organica.json`
 * (la columna, sus herramientas y sus rangos) y `limites-por-grosor.json` (los rangos vivos de `limites_de` y los
 * avisos de lo que el motor corrige, por grosor de la base, qué globos caben sobre la punta y la corrección del motor), ambos escritos por Python. Nada de lo que el motor decide
 * está escrito a mano aquí.
 *
 * Lo que vigila:
 * - **el cliente no calcula**: el armado que se manda al motor es exactamente el borrador, y cada cambio del
 *   borrador es UN campo; los rangos y los avisos son los del motor, cifra por cifra;
 * - **los rangos viven en el motor**: al engrosar la columna sube el alto mínimo, y los mandos de los acabados y los
 *   repartos salen de `opciones_admitidas`;
 * - **operación concurrente**: pausa, cancelación, gana la última respuesta y una respuesta vieja nunca se pinta;
 * - **estados explícitos** y Guardar solo con un dibujo del motor, por la ruta de edición que ya existe.
 *
 * Run: npx tsx scripts/test/test-ui-editor-columna-organica.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Reloj } from "@/components/plan/autoguardado";
import { PanelColumnaOrganica } from "@/components/plan/columna-organica/BloqueColumnaOrganica";
import {
  conAcabado,
  conAdorno,
  conColorAgregado,
  conColorQuitado,
  conEstilo,
  conForma,
  conFormaLista,
  conGloboGrande,
  conInterruptorDeForma,
  conMaterial,
  conMaterialDeGloboGrande,
  conMezclaDeColores,
  conPesoDeColor,
  conPesoDeTamano,
  conReparto,
  conRol,
  conSemilla,
  conTamanoDeGloboGrande,
  conTamanos,
  conVolumen,
  mismoArmadoColumnaOrganica,
  pesoDeTamano,
  rangoDeAlto,
  rangoDeGrosorBase,
  rangoDeGrosorPunta,
  rangoDeInclinacion,
  rangoDeSerpenteo,
  rangoDelContrato,
  valorEnRango,
} from "@/components/plan/columna-organica/borrador-columna-organica";
import { ControlesColumnaOrganica } from "@/components/plan/columna-organica/ControlesColumnaOrganica";
import { EditorColumnaOrganica } from "@/components/plan/columna-organica/EditorColumnaOrganica";
import { puedeGuardarColumnaOrganica } from "@/components/plan/columna-organica/guardar-columna-organica";
import { peticionVistaColumnaOrganica, type PiezaVistaColumnaOrganica } from "@/components/plan/columna-organica/vista-columna-organica";
import {
  alBorradorColumnaOrganica,
  crearVistaBorradorColumnaOrganica,
  panelDeBorradorColumnaOrganica,
  type EstadoVistaBorradorColumnaOrganica,
} from "@/components/plan/columna-organica/vista-borrador-columna-organica";
import { leyendaPatron } from "@/components/plan/patron/leyenda";
import { ArmadoColumnaOrganicaV1Schema, FormaColumnaOrganicaSchema, type ArmadoColumnaOrganicaV1 } from "@/lib/plan/armado-columna-organica";
import { EdicionArmadoColumnaOrganicaSchema } from "@/lib/plan/edicion-esquemas";
import type { LimitesColumnaOrganica } from "@/lib/plan/opciones-armado-columna-organica";
import { FalloPlanArmado, pedirPlanEditarArmado } from "@/lib/plan/peticion-armado";
import { pedirVistaArmadoColumnaOrganica, type VistaArmadoColumnaOrganica } from "@/lib/plan/peticion-armado-columna-organica";
import type { PlanResuelto } from "@/lib/plan/resuelto";

let casos = 0;
function caso(nombre: string, prueba: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(prueba)
    .then(() => {
      casos += 1;
      console.log(`[PASS] ${nombre}`);
    })
    .catch((error: unknown) => {
      console.error(`[FAIL] ${nombre}`);
      throw error;
    });
}

const leerJson = (ruta: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), ruta), "utf8")) as unknown;

const FIXTURE = leerJson("scripts/fixtures/columna-organica-ui/vista-columna-organica.json") as {
  peticion: { estructura_id: string; armado_columna_organica: ArmadoColumnaOrganicaV1; colores: string[] };
  respuesta: Record<string, unknown>;
};
const MOTOR = leerJson("scripts/fixtures/columna-organica-ui/limites-por-grosor.json") as {
  base: ArmadoColumnaOrganicaV1;
  colores: string[];
  por_grosor: Record<string, { armado: ArmadoColumnaOrganicaV1; limites: LimitesColumnaOrganica; avisos: string[]; globos: number }>;
  por_punta: Record<string, { armado: ArmadoColumnaOrganicaV1; coronaTamanos: number[] }>;
  globo_sin_proporcion: { armado: ArmadoColumnaOrganicaV1; status: number; avisos: string[] | null; globo_de_arriba: { tamano: number } | null };
  rechazo: { armado: ArmadoColumnaOrganicaV1; motivo: string; mensaje: string };
};
const RESUELTO = leerJson("scripts/fixtures/patron-color-ui/plan-con-patrones.json") as PlanResuelto;

const ESTRUCTURA_ID = FIXTURE.peticion.estructura_id;
const BASE = ArmadoColumnaOrganicaV1Schema.parse(FIXTURE.peticion.armado_columna_organica);
const PIEZA: PiezaVistaColumnaOrganica = { plan: RESUELTO.plan, estructuraId: ESTRUCTURA_ID, colores: FIXTURE.peticion.colores };
const DECLARADA = RESUELTO.plan.estructuras.find((estructura) => estructura.estructura_id === ESTRUCTURA_ID)!;
const RESUELTA = RESUELTO.estructuras.find((estructura) => estructura.estructura_id === ESTRUCTURA_ID)!;
const LEYENDA = leyendaPatron(DECLARADA.materiales, RESUELTA.lineas, undefined);
const COLORES_DE_PIEZA = LEYENDA.length;

/** El dibujo del motor de la fixture, validado por la misma frontera que usa la pantalla. */
async function vistaDeLaFixture(): Promise<VistaArmadoColumnaOrganica> {
  const fetcher = (async () => new Response(JSON.stringify(FIXTURE.respuesta), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
  return pedirVistaArmadoColumnaOrganica(peticionVistaColumnaOrganica(PIEZA, BASE), { fetcher });
}

/** Rutas hasta cada hoja que distingue dos armados. */
function diferencias(a: unknown, b: unknown, ruta = ""): string[] {
  if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
    const claves = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...claves].flatMap((clave) => diferencias((a as Record<string, unknown>)[clave], (b as Record<string, unknown>)[clave], `${ruta}.${clave}`));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [ruta];
}

// --- Un reloj y un puerto simulados ------------------------------------------------------------------------------

function relojFalso() {
  let ahora = 0;
  const pendientes = new Map<number, { en: number; accion: () => void }>();
  let id = 0;
  const reloj: Reloj = (accion, ms) => {
    const propio = ++id;
    pendientes.set(propio, { en: ahora + ms, accion });
    return () => { pendientes.delete(propio); };
  };
  return {
    reloj,
    avanzar(ms: number) {
      ahora += ms;
      for (const [clave, tarea] of [...pendientes]) {
        if (tarea.en <= ahora) {
          pendientes.delete(clave);
          tarea.accion();
        }
      }
    },
    pendientes: () => pendientes.size,
  };
}

type Peticion = { armado: ArmadoColumnaOrganicaV1; signal: AbortSignal; resolver: (vista: VistaArmadoColumnaOrganica) => void; rechazar: (error: unknown) => void };

function puertoFalso() {
  const peticiones: Peticion[] = [];
  const pedir = (armado: ArmadoColumnaOrganicaV1, signal: AbortSignal): Promise<VistaArmadoColumnaOrganica> =>
    new Promise<VistaArmadoColumnaOrganica>((resolver, rechazar) => {
      signal.addEventListener("abort", () => rechazar(new DOMException("cancelada", "AbortError")));
      peticiones.push({ armado, signal, resolver, rechazar });
    });
  return { pedir, peticiones };
}

/** Un dibujo del motor "de" un armado: el de la fixture con su eco cambiado (el puerto simulado no calcula nada). */
function vistaDe(base: VistaArmadoColumnaOrganica, armado: ArmadoColumnaOrganicaV1, marca: string): VistaArmadoColumnaOrganica {
  return { ...base, armado, columna: { ...base.columna, avisos: [marca] } };
}

const tick = () => new Promise<void>((listo) => setTimeout(listo, 0));

async function main(): Promise<void> {
  const VISTA = await vistaDeLaFixture();

  await caso("el borrador: cada cambio es UN campo del armado, marcado del decorador, sin tocar el original", () => {
    const copia = structuredClone(BASE);
    const casosCambio: Array<[string, ArmadoColumnaOrganicaV1, string]> = [
      ["alto", conForma(BASE, "altoM", 2.6), ".forma.altoM"],
      ["inclinación", conForma(BASE, "inclinacionM", 0.4), ".forma.inclinacionM"],
      ["serpenteo", conForma(BASE, "serpenteoM", 0.3), ".forma.serpenteoM"],
      ["ondulación", conForma(BASE, "ondulacion", 0.6), ".forma.ondulacion"],
      ["persona", conInterruptorDeForma(BASE, "persona", !BASE.forma.persona), ".forma.persona"],
      ["suelo", conInterruptorDeForma(BASE, "suelo", !BASE.forma.suelo), ".forma.suelo"],
      ["grosor en la base", conVolumen(BASE, "grosorPatasM", 0.6), ".volumen.grosorPatasM"],
      ["grosor en la punta", conVolumen(BASE, "grosorCimaM", 0.5), ".volumen.grosorCimaM"],
      ["relleno", conVolumen(BASE, "relleno", 0.5), ".volumen.relleno"],
      ["racimo", conVolumen(BASE, "racimo", 3), ".volumen.racimo"],
      ["inflado", conTamanos(BASE, "inflado", 0.9), ".tamanos.inflado"],
      ["grandes abajo", conTamanos(BASE, "grandesAbajo", 0.6), ".tamanos.grandesAbajo"],
      ["reparto", conReparto(BASE, "racimos"), ".colores.reparto"],
      ["mezcla entre colores", conMezclaDeColores(BASE, 0.9), ".colores.mezcla"],
      ["follaje", conAdorno(BASE, "follaje", 1.5), ".adornos.follaje"],
      ["flores", conAdorno(BASE, "flores", 1.5), ".adornos.flores"],
      ["otra disposición", conSemilla(BASE, 4242), ".aspecto.semilla"],
    ];
    for (const [nombre, siguiente, campo] of casosCambio) {
      assert.deepEqual(diferencias(BASE, siguiente).filter((ruta) => ruta !== ".origen"), [campo], `${nombre}: debe cambiar solo ${campo}`);
      assert.equal(siguiente.origen, "decorador", `${nombre}: lo cambió el decorador`);
      assert.ok(ArmadoColumnaOrganicaV1Schema.safeParse(siguiente).success, `${nombre}: sigue cumpliendo armado-columna-organica.v1`);
    }
    assert.deepEqual(BASE, copia, "el armado original no se muta");
    // Lo que el contrato no admite deja el borrador como estaba, sin inventar un valor.
    assert.equal(conForma(BASE, "altoM", 99), BASE);
    assert.equal(conVolumen(BASE, "racimo", 2.5), BASE);
    assert.equal(conMezclaDeColores(BASE, 4), BASE);
    assert.equal(conSemilla(BASE, 0), BASE);
    assert.equal(conSemilla(BASE, 100000), BASE);
    // Y lo que no cambia, no se vuelve a crear.
    assert.equal(conReparto(BASE, BASE.colores.reparto), BASE);
    assert.equal(conInterruptorDeForma(BASE, "persona", BASE.forma.persona), BASE);
    assert.ok(mismoArmadoColumnaOrganica(BASE, { ...BASE, origen: "decorador" }), "quién lo firmó no lo vuelve otro armado");
    assert.ok(!mismoArmadoColumnaOrganica(BASE, conForma(BASE, "altoM", 2.6)));
  });

  await caso("las formas listas y los estilos son los del motor: se copian sus campos, sin escribir una cifra aquí", () => {
    const { formas, estilos } = VISTA.opciones;
    assert.equal(formas.length, 8);
    for (const lista of formas) {
      const aplicada = conFormaLista(BASE, lista);
      assert.ok(ArmadoColumnaOrganicaV1Schema.safeParse(aplicada).success, `${lista.id}: sigue cumpliendo el contrato`);
      assert.deepEqual({ alto: aplicada.forma.altoM, inclinacion: aplicada.forma.inclinacionM, serpenteo: aplicada.forma.serpenteoM, ondulacion: aplicada.forma.ondulacion }, { alto: lista.forma.altoM, inclinacion: lista.forma.inclinacionM, serpenteo: lista.forma.serpenteoM, ondulacion: lista.forma.ondulacion }, `${lista.id}: la silueta es la de la forma`);
      assert.deepEqual(aplicada.volumen, lista.volumen, `${lista.id}: el volumen es el de la forma`);
      assert.deepEqual(aplicada.tamanos, lista.tamanos, `${lista.id}: los tamaños son los de la forma`);
      assert.equal(aplicada.aspecto.semilla, lista.semilla);
      // Lo que no es de la forma no se toca: los colores, los adornos, el globo grande, la persona y el suelo.
      assert.deepEqual([aplicada.colores, aplicada.adornos, aplicada.corona, aplicada.forma.persona, aplicada.forma.suelo], [BASE.colores, BASE.adornos, BASE.corona, BASE.forma.persona, BASE.forma.suelo], `${lista.id}: no toca lo que no es suyo`);
      assert.equal(aplicada.origen, "decorador");
    }
    assert.equal(estilos.length, 4);
    for (const estilo of estilos) {
      const aplicado = conEstilo(BASE, estilo);
      assert.deepEqual(aplicado.volumen, estilo.volumen, `${estilo.id}: el volumen es el del estilo`);
      assert.deepEqual([aplicado.forma, aplicado.colores, aplicado.corona], [BASE.forma, BASE.colores, BASE.corona], `${estilo.id}: solo cambia cuánto se llena`);
      // El inflado y la variación de tamaño se quedan como el decorador los tenía; la mezcla solo cambia si el estilo la describe.
      assert.equal(aplicado.tamanos.inflado, BASE.tamanos.inflado);
      assert.equal(aplicado.tamanos.variacion, BASE.tamanos.variacion);
      if (estilo.tamanos) assert.deepEqual([aplicado.tamanos.mezcla, aplicado.tamanos.grandesAbajo], [estilo.tamanos.mezcla, estilo.tamanos.grandesAbajo]);
      else assert.deepEqual(aplicado.tamanos, BASE.tamanos);
    }
    assert.ok(estilos.some((estilo) => estilo.tamanos), "el estilo de los gigantes también cambia la mezcla de tamaños");
  });

  await caso("el globo grande de arriba se pone y se quita, y solo con los tamaños que el motor dice que guardan proporción", () => {
    const permitidos = VISTA.limites.coronaTamanos;
    assert.ok(permitidos.length > 0);
    const sin = conGloboGrande(BASE, false, permitidos);
    assert.deepEqual(diferencias(BASE, sin).filter((ruta) => ruta !== ".origen"), [".corona.activa"], "quitarlo solo apaga el interruptor: conserva su tamaño y su color");
    assert.equal(sin.corona.tamano, BASE.corona.tamano);
    assert.equal(sin.corona.material, BASE.corona.material);
    // Ponerlo de nuevo conserva el tamaño si guarda proporción.
    assert.deepEqual(conGloboGrande(sin, true, permitidos).corona, BASE.corona);
    // Si el tamaño que tenía ya no cabe, toma el menor de los que sí caben.
    const sinR24 = { ...sin, corona: { ...sin.corona, tamano: 5 as const } };
    assert.equal(conGloboGrande(sinR24, true, permitidos).corona.tamano, Math.min(...permitidos));
    // Sin ningún tamaño que guarde proporción no se puede poner: el borrador queda como estaba.
    assert.equal(conGloboGrande(sin, true, []), sin);
    assert.equal(conGloboGrande(BASE, true, permitidos), BASE, "ya estaba puesto");
    // El tamaño y el color del globo son un campo cada uno.
    assert.deepEqual(diferencias(BASE, conTamanoDeGloboGrande(BASE, 36)).filter((ruta) => ruta !== ".origen"), [".corona.tamano"]);
    assert.deepEqual(diferencias(BASE, conMaterialDeGloboGrande(BASE, 0)).filter((ruta) => ruta !== ".origen"), [".corona.material"]);
    assert.equal(conTamanoDeGloboGrande(BASE, 7), BASE, "un tamaño que no es de globo no cambia nada");
    // Lo que cabe depende de la punta, y lo dice el motor: una punta gruesa deja menos tamaños y una muy gruesa, ninguno.
    const tamanosPorPunta = Object.entries(MOTOR.por_punta).map(([punta, { coronaTamanos }]) => [Number(punta), coronaTamanos.length] as const).sort((x, y) => x[0] - y[0]);
    assert.ok(tamanosPorPunta.every(([, cuantos], lugar) => lugar === 0 || cuantos <= tamanosPorPunta[lugar - 1]![1]), "cuanto más gruesa la punta, menos globos caben arriba");
    assert.equal(tamanosPorPunta.at(-1)![1], 0, "con una punta muy gruesa ningún globo guarda proporción");
    // Y el motor corrige lo que no guarda proporción, diciéndolo.
    assert.equal(MOTOR.globo_sin_proporcion.status, 200);
    assert.ok(MOTOR.globo_sin_proporcion.avisos?.some((aviso) => aviso.includes("globo grande de arriba")), "el motor dice que quitó el globo grande");
  });

  await caso("la paleta: cada papel es de un color de la pieza; agregar y quitar respetan los topes", () => {
    const paleta = BASE.colores.paleta;
    assert.equal(paleta.length, COLORES_DE_PIEZA, "la receta toma un color por material de la pieza");
    const otro = conMaterial(BASE, 0, 1);
    assert.deepEqual(diferencias(BASE, otro).filter((ruta) => ruta !== ".origen"), [".colores.paleta.0.material"]);
    assert.deepEqual(diferencias(BASE, conPesoDeColor(BASE, 1, 7)).filter((ruta) => ruta !== ".origen"), [".colores.paleta.1.peso"]);
    assert.deepEqual(diferencias(BASE, conAcabado(BASE, 0, "cromado")).filter((ruta) => ruta !== ".origen"), [".colores.paleta.0.acabado"]);
    assert.deepEqual(diferencias(BASE, conRol(BASE, 1, "acento")).filter((ruta) => ruta !== ".origen"), [".colores.paleta.1.rol"]);
    assert.equal(conMaterial(BASE, 9, 1), BASE, "una posición que no existe no cambia nada");
    // Quitar uno deja los demás; nunca una paleta vacía.
    const sinUno = conColorQuitado(BASE, 1);
    assert.equal(sinUno.colores.paleta.length, paleta.length - 1);
    let uno = BASE;
    while (uno.colores.paleta.length > 1) uno = conColorQuitado(uno, 0);
    assert.equal(conColorQuitado(uno, 0), uno, "el último color no se quita: una columna sin colores no se arma");
    // Agregar toma el primer color de la pieza que la paleta no usa; con todos usados, nada.
    const conUno = conColorAgregado(sinUno, COLORES_DE_PIEZA, 8);
    assert.equal(conUno.colores.paleta.length, paleta.length);
    assert.deepEqual(conUno.colores.paleta.map((entrada) => entrada.material).sort(), paleta.map((entrada) => entrada.material).sort());
    assert.equal(conColorAgregado(BASE, COLORES_DE_PIEZA, 8), BASE, "ya están todos los colores de la pieza");
    assert.equal(conColorAgregado(sinUno, COLORES_DE_PIEZA, 1), sinUno, "ni pasar del máximo que dice el motor");
  });

  await caso("la mezcla de tamaños: el peso de cada uno, y nunca una mezcla sin ningún tamaño", () => {
    assert.ok(pesoDeTamano(BASE, 12) > 0);
    const sin12 = conPesoDeTamano(BASE, 12, 0);
    assert.equal(pesoDeTamano(sin12, 12), 0);
    assert.equal(sin12.tamanos.mezcla["12"], undefined, "un tamaño sin peso sale de la mezcla");
    assert.ok(ArmadoColumnaOrganicaV1Schema.safeParse(sin12).success);
    const con36 = conPesoDeTamano(BASE, 36, 10);
    assert.equal(con36.tamanos.mezcla["36"], 10);
    assert.deepEqual(diferencias(BASE, con36).filter((ruta) => ruta !== ".origen"), [".tamanos.mezcla.36"]);
    // Quitar el último tamaño que queda dejaría una mezcla vacía, que el motor rechaza: el borrador no la admite.
    let unico = BASE;
    for (const pulgadas of [5, 9, 12, 18, 24, 36]) unico = pesoDeTamano(unico, pulgadas) > 0 && Object.keys(unico.tamanos.mezcla).length > 1 ? conPesoDeTamano(unico, pulgadas, 0) : unico;
    assert.equal(Object.keys(unico.tamanos.mezcla).length, 1);
    const ultimo = Object.keys(unico.tamanos.mezcla)[0]!;
    assert.equal(conPesoDeTamano(unico, Number(ultimo), 0), unico);
  });

  await caso("los rangos salen de limites_de: suben con el grosor y son los del motor, cifra por cifra", () => {
    const rangos = (grosor: string) => {
      const { limites } = MOTOR.por_grosor[grosor]!;
      return { limites, alto: rangoDeAlto(limites), inclinacion: rangoDeInclinacion(limites), serpenteo: rangoDeSerpenteo(limites), base: rangoDeGrosorBase(limites), punta: rangoDeGrosorPunta(limites) };
    };
    const fino = rangos("0.4");
    const grueso = rangos("1.2");
    assert.ok(grueso.alto.min > fino.alto.min, "una columna gruesa pide más alto");
    assert.equal(fino.alto.min, MOTOR.por_grosor["0.4"]!.limites.altoMin);
    assert.equal(grueso.alto.min, MOTOR.por_grosor["1.2"]!.limites.altoMin);
    for (const grosor of ["0.4", "0.8", "1.2"]) {
      const { limites, alto, inclinacion, serpenteo, base, punta } = rangos(grosor);
      assert.deepEqual([alto.min, alto.max, base.min, base.max, punta.min, punta.max], [limites.altoMin, limites.altoMax, limites.grosorBaseMin, limites.grosorBaseMax, limites.grosorPuntaMin, limites.grosorPuntaMax]);
      assert.deepEqual([inclinacion.min, inclinacion.max], [-limites.inclinacionMax, limites.inclinacionMax]);
      assert.deepEqual([serpenteo.min, serpenteo.max], [0, limites.serpenteoMax]);
    }
    // Lo que el motor no publica sale del contrato, no de un número escrito aquí.
    const ondulacion = rangoDelContrato(FormaColumnaOrganicaSchema.shape.ondulacion, 0.05);
    assert.equal(ondulacion.min, FormaColumnaOrganicaSchema.shape.ondulacion.minValue);
    assert.equal(ondulacion.max, FormaColumnaOrganicaSchema.shape.ondulacion.maxValue);
    // Pintar un valor fuera de su rango lo deja en el borde, sin decidir nada por el motor.
    assert.equal(valorEnRango(0.8, grueso.alto), grueso.alto.min);
    assert.equal(valorEnRango(99, grueso.alto), grueso.alto.max);
    assert.equal(valorEnRango(2, grueso.alto), 2);
  });

  await caso("la petición al motor lleva exactamente el borrador, y nada más que el contrato de la ruta", () => {
    const borrador = conVolumen(conForma(BASE, "altoM", 2.8), "grosorPatasM", 0.7);
    const cuerpo = peticionVistaColumnaOrganica(PIEZA, borrador);
    assert.deepEqual(Object.keys(cuerpo).sort(), ["armado_columna_organica", "colores", "estructura_id", "plan"]);
    assert.deepEqual(cuerpo.armado_columna_organica, borrador, "el armado viaja sin tocar: ni conteo, ni medidas, ni geometría calculada");
    assert.equal(cuerpo.estructura_id, ESTRUCTURA_ID);
  });

  await caso("pausa: varios cambios seguidos son UNA petición, la del último", () => {
    const { reloj, avanzar } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorColumnaOrganica({ pedir, inicial: VISTA, reloj });
    control.mostrar(conForma(BASE, "altoM", 3.4));
    avanzar(200);
    control.mostrar(conForma(BASE, "altoM", 3.6));
    avanzar(200);
    control.mostrar(conForma(BASE, "altoM", 3.8));
    assert.equal(peticiones.length, 0, "dentro de la pausa no se pide nada");
    avanzar(299);
    assert.equal(peticiones.length, 0);
    avanzar(1);
    assert.equal(peticiones.length, 1, "pasada la pausa sin otro cambio, una sola petición");
    assert.deepEqual(peticiones[0]!.armado, conForma(BASE, "altoM", 3.8), "y es la del último borrador");
    assert.equal(control.estado().borrador, "pendiente");
    assert.equal(control.estado().enVuelo, true);
  });

  await caso("gana la última: otro borrador cancela el que vuela y una respuesta vieja que llega igual no se pinta", async () => {
    const { reloj, avanzar } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorColumnaOrganica({ pedir, inicial: VISTA, reloj });
    const a = conForma(BASE, "altoM", 3.4);
    const b = conForma(BASE, "altoM", 3.9);
    control.mostrar(a);
    avanzar(300);
    assert.equal(peticiones.length, 1);
    control.mostrar(b);
    assert.equal(peticiones[0]!.signal.aborted, true, "mostrar otro borrador cancela la petición en vuelo (AbortController)");
    avanzar(300);
    assert.equal(peticiones.length, 2);
    // La vieja contesta tarde, aunque ya estaba cancelada: no cuenta.
    peticiones[0]!.resolver(vistaDe(VISTA, a, "vieja"));
    await tick();
    assert.equal(control.estado().vista?.columna.avisos[0] !== "vieja", true, "una respuesta vieja nunca se pinta");
    assert.equal(control.estado().borrador, "pendiente");
    peticiones[1]!.resolver(vistaDe(VISTA, b, "nueva"));
    await tick();
    assert.equal(control.estado().borrador, "listo");
    assert.deepEqual(control.estado().vista?.columna.avisos, ["nueva"]);
    assert.equal(control.estado().enVuelo, false);
  });

  await caso("mientras llega el dibujo nuevo se conserva el último que sí llegó, marcado como pendiente", async () => {
    const { reloj, avanzar } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorColumnaOrganica({ pedir, inicial: VISTA, reloj });
    assert.equal(control.estado().borrador, "listo", "el dibujo del plan se ve desde el primer momento, sin petición");
    assert.equal(peticiones.length, 0);
    const siguiente = conForma(BASE, "altoM", 3.9);
    control.mostrar(siguiente);
    assert.equal(control.estado().vista, VISTA, "el dibujo que hay sigue a la vista");
    assert.equal(control.estado().borrador, "pendiente");
    assert.deepEqual(panelDeBorradorColumnaOrganica(control.estado()), { fase: "listo", vista: VISTA, actualizando: true, fallo: null });
    avanzar(300);
    peticiones[0]!.resolver(vistaDe(VISTA, siguiente, "listo"));
    await tick();
    assert.deepEqual(panelDeBorradorColumnaOrganica(control.estado()), { fase: "listo", vista: control.estado().vista!, actualizando: false, fallo: null });
  });

  await caso("volver a un borrador que el motor ya dibujó no vuelve a pedirlo", async () => {
    const { reloj, avanzar } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorColumnaOrganica({ pedir, inicial: VISTA, reloj });
    const otro = conVolumen(BASE, "relleno", 0.5);
    control.mostrar(otro);
    avanzar(300);
    peticiones[0]!.resolver(vistaDe(VISTA, otro, "r50"));
    await tick();
    control.mostrar(BASE);
    assert.equal(control.estado().borrador, "listo", "el del plan ya estaba dibujado");
    control.mostrar(otro);
    assert.equal(control.estado().borrador, "listo");
    avanzar(1000);
    assert.equal(peticiones.length, 1, "ninguna petición más");
  });

  await caso("rechazo del motor: llega con su frase en español y no se reintenta solo; un fallo se reintenta con Reintentar", async () => {
    const { reloj, avanzar } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorColumnaOrganica({ pedir, inicial: VISTA, reloj });
    control.mostrar(MOTOR.rechazo.armado);
    avanzar(300);
    peticiones[0]!.rechazar(new FalloPlanArmado(MOTOR.rechazo.mensaje, { motivo: MOTOR.rechazo.motivo, armadoInvalido: true }));
    await tick();
    assert.equal(control.estado().borrador, "rechazado");
    assert.deepEqual(control.estado().error, { mensaje: MOTOR.rechazo.mensaje, armadoInvalido: true });
    assert.equal(control.estado().vista, VISTA, "el último dibujo sigue ahí");
    assert.deepEqual(panelDeBorradorColumnaOrganica(control.estado()), { fase: "listo", vista: VISTA, actualizando: false, fallo: null, vencido: true });
    avanzar(5000);
    assert.equal(peticiones.length, 1, "lo que el motor rechazó no se vuelve a pedir solo");
    // Un fallo de transporte: tampoco solo, pero sí con "Reintentar".
    const otro = conForma(BASE, "altoM", 4.4);
    control.mostrar(otro);
    avanzar(300);
    peticiones[1]!.rechazar(new FalloPlanArmado("Sin conexión.", { armadoInvalido: false }));
    await tick();
    assert.equal(control.estado().borrador, "fallido");
    avanzar(5000);
    assert.equal(peticiones.length, 2);
    control.reintentar();
    avanzar(300);
    assert.equal(peticiones.length, 3, "Reintentar vuelve a pedir el mismo borrador");
    assert.deepEqual(peticiones[2]!.armado, otro);
    // Una cancelación no es un fallo.
    control.mostrar(conForma(BASE, "altoM", 4.6));
    assert.equal(control.estado().error, null);
  });

  await caso("cerrar el editor cancela lo que quede, y el estado de este render no confunde el «listo» del borrador anterior", () => {
    const { reloj, avanzar, pendientes } = relojFalso();
    const { pedir, peticiones } = puertoFalso();
    const control = crearVistaBorradorColumnaOrganica({ pedir, inicial: VISTA, reloj });
    control.mostrar(conForma(BASE, "altoM", 3.9));
    avanzar(300);
    control.cerrar();
    assert.equal(peticiones[0]!.signal.aborted, true);
    control.mostrar(conForma(BASE, "altoM", 4.1));
    assert.equal(pendientes(), 1, "después de cerrar, un borrador nuevo empieza de cero");
    control.cerrar();
    assert.equal(pendientes(), 0, "cerrar apaga la pausa que esperaba");
    const estado: EstadoVistaBorradorColumnaOrganica = { vista: VISTA, borrador: "listo", enVuelo: false, error: null, clave: JSON.stringify("otra") };
    assert.equal(alBorradorColumnaOrganica(estado, conForma(BASE, "altoM", 5)).borrador, "pendiente");
  });

  await caso("Guardar solo con un dibujo del motor, sin cambios que perder ni otro ajuste en curso", () => {
    const listo = { borrador: "listo" as const, error: null };
    const entra = { hayCambios: true, guardando: false, ocupado: false };
    assert.deepEqual(puedeGuardarColumnaOrganica({ estado: listo, ...entra }), { puede: true });
    assert.deepEqual(puedeGuardarColumnaOrganica({ estado: { borrador: "pendiente", error: null }, ...entra }), { puede: false, motivo: "Dibujando tus cambios…", tipo: "espera" });
    const rechazado = puedeGuardarColumnaOrganica({ estado: { borrador: "rechazado", error: { mensaje: MOTOR.rechazo.mensaje, armadoInvalido: true } }, ...entra });
    assert.deepEqual(rechazado, { puede: false, motivo: MOTOR.rechazo.mensaje, tipo: "error" }, "la frase del motor, tal cual");
    assert.equal(puedeGuardarColumnaOrganica({ estado: { borrador: "fallido", error: { mensaje: "Sin conexión.", armadoInvalido: false } }, ...entra }).puede, false);
    assert.equal(puedeGuardarColumnaOrganica({ estado: listo, ...entra, hayCambios: false }).puede, false);
    assert.equal(puedeGuardarColumnaOrganica({ estado: listo, ...entra, ocupado: true }).puede, false);
    assert.equal(puedeGuardarColumnaOrganica({ estado: listo, ...entra, guardando: true }).puede, false);
    const colores = puedeGuardarColumnaOrganica({ estado: listo, ...entra, coloresCambiaron: true });
    assert.equal(colores.puede, false);
    assert.match(colores.puede ? "" : colores.motivo, /revisa la paleta/);
  });

  await caso("Guardar va por la ruta de edición que ya existe, con el borrador tal cual", async () => {
    const borrador = conVolumen(BASE, "relleno", 0.5);
    const edicion = { accion: "armado_columna_organica", estructura_id: ESTRUCTURA_ID, armado_columna_organica: borrador };
    assert.deepEqual(EdicionArmadoColumnaOrganicaSchema.parse(edicion), edicion, "la edición lleva el armado entero, sin tocar");
    assert.equal(EdicionArmadoColumnaOrganicaSchema.parse({ ...edicion, armado_columna_organica: null }).armado_columna_organica, null, "quitar el armado también");
    assert.equal(EdicionArmadoColumnaOrganicaSchema.safeParse({ ...edicion, armado_columna_organica: { ...borrador, campo_nuevo: 1 } }).success, false);
    assert.equal(EdicionArmadoColumnaOrganicaSchema.safeParse({ ...edicion, extra: 1 }).success, false);
    const llamadas: Array<{ url: string; cuerpo: unknown }> = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      llamadas.push({ url: String(url), cuerpo: JSON.parse(String(init?.body)) as unknown });
      return new Response(JSON.stringify({ error: "armado_invalido", motivo: MOTOR.rechazo.motivo, mensaje: MOTOR.rechazo.mensaje }), { status: 422, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
    await assert.rejects(
      () => pedirPlanEditarArmado({ modo: "aplicar", base: {}, edicion }, "No se pudo.", { fetcher }),
      (error: unknown) => error instanceof FalloPlanArmado && error.armadoInvalido && error.message === MOTOR.rechazo.mensaje,
    );
    assert.equal(llamadas[0]!.url, "/api/plan-editar", "la ruta de siempre: no hay otra");
    assert.deepEqual((llamadas[0]!.cuerpo as { edicion: unknown }).edicion, edicion);
  });

  // --- Lo que se ve -------------------------------------------------------------------------------------------------

  const texto = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const pintarControles = (borrador: ArmadoColumnaOrganicaV1, limites: LimitesColumnaOrganica = VISTA.limites) =>
    renderToStaticMarkup(React.createElement(ControlesColumnaOrganica, { borrador, opciones: VISTA.opciones, limites, leyenda: LEYENDA, onCambiar: () => {} }));
  const pintarEditor = (sobre: Partial<React.ComponentProps<typeof EditorColumnaOrganica>> = {}) =>
    renderToStaticMarkup(React.createElement(EditorColumnaOrganica, {
      borrador: BASE,
      vista: { vista: VISTA, borrador: "listo", error: null },
      leyenda: LEYENDA,
      guardar: { puede: true },
      guardando: false,
      errorGuardado: null,
      planCambio: false,
      coloresCambiaron: false,
      hayCambios: true,
      onSeguirConMiBorrador: () => {},
      onUsarColumnaDeLaPropuesta: () => {},
      onReceta: async () => null,
      onCambiar: () => {},
      onGuardar: () => {},
      onDescartar: () => {},
      onRestablecer: () => {},
      onReintentar: () => {},
      ...sobre,
    }));

  await caso("los ajustes: textos del motor, rangos vivos, sin claves internas visibles y con foco y 44 px", () => {
    const html = pintarControles(BASE);
    const visible = texto(html);
    for (const acabado of VISTA.opciones.acabados) assert.ok(visible.includes(acabado.texto), `falta el acabado del motor: ${acabado.texto}`);
    for (const reparto of VISTA.opciones.repartos) assert.ok(visible.includes(reparto.texto), `falta el reparto del motor: ${reparto.texto}`);
    for (const forma of VISTA.opciones.formas) assert.ok(visible.includes(forma.nombre), `falta la forma lista del motor: ${forma.nombre}`);
    for (const estilo of VISTA.opciones.estilos) assert.ok(visible.includes(estilo.nombre), `falta el estilo del motor: ${estilo.nombre}`);
    const repartoActual = VISTA.opciones.repartos.find((reparto) => reparto.valor === BASE.colores.reparto)!;
    if (repartoActual.ayuda) assert.ok(visible.includes(repartoActual.ayuda), "la ayuda del reparto sale del motor");
    for (const pulgadas of VISTA.opciones.tamanos) assert.ok(visible.includes(`Globos de ${pulgadas}″`), `un deslizador por tamaño: ${pulgadas}″`);
    for (const interno of ["altoM", "inclinacionM", "grosorPatasM", "grandesAbajo", "armado-columna-organica", "coronaTamanos"]) {
      assert.ok(!visible.includes(interno), `clave interna visible: ${interno}`);
    }
    // Los rangos del alto y los grosores son los vivos del motor.
    for (const valor of [VISTA.limites.altoMin, VISTA.limites.grosorBaseMin, VISTA.limites.grosorPuntaMin]) assert.ok(html.includes(`min="${valor}"`), `falta el rango ${valor}`);
    // Una paleta por color de la pieza, cada una con su selector de color, de acabado y de papel.
    assert.equal((html.match(/data-testid="color-columna-organica-\d"/g) ?? []).length, BASE.colores.paleta.length);
    assert.ok(html.includes("Acabado del color 1") && html.includes("Papel del color 2") && html.includes("Cuánto pesa el color 1"));
    // Accesibilidad: deslizadores con etiqueta y texto de valor, grupo de radio y lo que se toca mide 44 px.
    assert.ok((html.match(/type="range"/g) ?? []).length >= 12);
    assert.ok(html.includes("aria-valuetext") && html.includes('role="radiogroup"') && html.includes('role="switch"'));
    assert.ok((html.match(/min-h-11/g) ?? []).length >= 4, "los botones y las listas miden al menos 44 px");
    assert.ok(/<details open=""[^>]*data-testid="apartado-colores-columna-organica"/.test(html), "el apartado de los colores va abierto");
    assert.ok(!/<details open=""[^>]*data-testid="apartado-forma-columna-organica"/.test(html), "los demás van plegados para no agrandar la tarjeta");
  });

  await caso("el globo grande de arriba es lo primero que se ve: un interruptor, y con él puesto su tamaño y su color", () => {
    const con = pintarControles(BASE);
    const sinGlobo = pintarControles(conGloboGrande(BASE, false, VISTA.limites.coronaTamanos));
    // El interruptor va antes que cualquier apartado y refleja el estado del armado.
    assert.ok(con.indexOf("mando-globo-grande-organica") < con.indexOf("apartado-forma-columna-organica"));
    assert.match(/<button[^>]*data-testid="mando-globo-grande-organica"[^>]*>/.exec(con)![0], /aria-checked="true"/);
    assert.match(/<button[^>]*data-testid="mando-globo-grande-organica"[^>]*>/.exec(sinGlobo)![0], /aria-checked="false"/);
    // Con el globo puesto se elige su tamaño (solo los que el motor admite con esta punta) y su color.
    assert.ok(con.includes("tamano-globo-grande-organica") && con.includes("color-globo-grande-organica"));
    assert.ok(!sinGlobo.includes("tamano-globo-grande-organica") && !sinGlobo.includes("color-globo-grande-organica"), "sin globo no hay nada que elegir");
    const opcionesDelTamano = [...(/<select[^>]*data-testid="tamano-globo-grande-organica"[^>]*>([\s\S]*?)<\/select>/.exec(con)![1] ?? "").matchAll(/value="(\d+)"/g)].map((par) => Number(par[1]));
    assert.deepEqual(opcionesDelTamano, VISTA.limites.coronaTamanos, "los tamaños son los que dice limites_de");
    // Una punta tan gruesa que ningún globo guarda proporción: se dice por qué no se puede poner.
    const sinTamanos = pintarControles(conGloboGrande(BASE, false, VISTA.limites.coronaTamanos), { ...VISTA.limites, coronaTamanos: [] });
    assert.match(texto(sinTamanos), /Ningún globo guarda proporción con una punta tan gruesa/);
  });

  await caso("con una columna gruesa el rango del alto cambia: es el que dice el motor", () => {
    const fino = pintarControles(MOTOR.por_grosor["0.4"]!.armado, MOTOR.por_grosor["0.4"]!.limites);
    const grueso = pintarControles(MOTOR.por_grosor["1.2"]!.armado, MOTOR.por_grosor["1.2"]!.limites);
    const minimoDelAlto = (html: string): number => Number(/<input[^>]*data-testid="alto-columna-organica"[^>]*>/.exec(html)![0].match(/min="([^"]+)"/)![1]);
    assert.equal(minimoDelAlto(fino), MOTOR.por_grosor["0.4"]!.limites.altoMin);
    assert.equal(minimoDelAlto(grueso), MOTOR.por_grosor["1.2"]!.limites.altoMin);
    assert.ok(minimoDelAlto(grueso) > minimoDelAlto(fino), "una columna gruesa pide más alto");
  });

  await caso("el editor: listo para guardar, con cada estado explícito y los botones de siempre", () => {
    const listo = pintarEditor();
    assert.ok(listo.includes('data-testid="editor-columna-organica"') && listo.includes(">Editar columna<"));
    assert.match(texto(listo), /Listo para guardar\. Al guardar se recalcula la compra con el catálogo/);
    assert.ok(/data-testid="guardar-columna-organica"/.test(listo) && !/disabled=""[^>]*data-testid="guardar-columna-organica"/.test(listo));
    assert.ok(texto(listo).includes("Guardar columna") && texto(listo).includes("Descartar cambios") && texto(listo).includes("Restablecer") && texto(listo).includes("Volver a la receta"));
    assert.ok(listo.includes("la propuesta cambia de firma"), "se dice qué pasa al guardar");
    // Sin cambios: Cerrar en lugar de Descartar, y Guardar espera.
    const quieto = pintarEditor({ hayCambios: false, guardar: { puede: false, motivo: "Todavía no cambiaste nada.", tipo: "nada" } });
    assert.ok(texto(quieto).includes("Todavía no cambiaste nada.") && texto(quieto).includes("Cerrar") && !texto(quieto).includes("Descartar cambios"));
    assert.ok(/disabled=""[^>]*data-testid="guardar-columna-organica"|data-testid="guardar-columna-organica"[^>]*disabled=""/.test(quieto));
    // El motor rechazó el borrador: su frase, tal cual y con rol de alerta.
    const rechazo = pintarEditor({ vista: { vista: VISTA, borrador: "rechazado", error: { mensaje: MOTOR.rechazo.mensaje, armadoInvalido: true } }, guardar: { puede: false, motivo: MOTOR.rechazo.mensaje, tipo: "error" } });
    assert.ok(rechazo.includes(MOTOR.rechazo.mensaje) && rechazo.includes('role="alert"'));
    assert.ok(!rechazo.includes("reintentar-editor-columna-organica"), "un rechazo del motor no se reintenta");
    const fallo = pintarEditor({ vista: { vista: VISTA, borrador: "fallido", error: { mensaje: "Sin conexión.", armadoInvalido: false } }, guardar: { puede: false, motivo: "Sin conexión.", tipo: "error" } });
    assert.ok(fallo.includes("Sin conexión.") && fallo.includes("reintentar-editor-columna-organica"));
    // Sin las herramientas del motor todavía: cargando, sin mandos inventados.
    const cargando = pintarEditor({ vista: { vista: null, borrador: "pendiente", error: null }, guardar: { puede: false, motivo: "Dibujando tus cambios…", tipo: "espera" } });
    assert.ok(cargando.includes("Cargando los ajustes del motor…") && !cargando.includes('type="range"'));
    // Lo que el guardado no pudo meter en el plan.
    const noGuardo = pintarEditor({ errorGuardado: "El catálogo no vende los globos que esa columna necesita (R-36)." });
    assert.ok(noGuardo.includes("No se guardó: El catálogo no vende los globos") && noGuardo.includes("La propuesta sigue como estaba."));
    // Los colores de la pieza cambiaron y la paleta está sin revisar; la propuesta cambió bajo el borrador.
    const colores = pintarEditor({ coloresCambiaron: true, guardar: { puede: false, motivo: "revisa", tipo: "colores" } });
    assert.ok(colores.includes("Los colores de la pieza cambiaron: revisa la paleta.") && colores.includes("Seguir con mi borrador") && colores.includes("Usar la columna de la propuesta"));
    assert.ok(pintarEditor({ planCambio: true }).includes("La propuesta cambió mientras editabas la columna."));
  });

  await caso("el bloque: «Editar columna» en el encabezado y el dibujo apagado cuando no es el del borrador", () => {
    const pintar = (estado: React.ComponentProps<typeof PanelColumnaOrganica>["estado"], accion?: React.ReactNode) =>
      renderToStaticMarkup(React.createElement(PanelColumnaOrganica, { estado, leyenda: LEYENDA, nombrePieza: "Columna", repeticiones: 1, onReintentar: () => {}, accion }));
    const boton = React.createElement("button", { type: "button", "data-testid": "editar-columna-organica" }, "Editar columna");
    assert.ok(pintar({ fase: "listo", vista: VISTA, actualizando: false, fallo: null }, boton).includes("Editar columna"));
    assert.ok(!pintar({ fase: "listo", vista: VISTA, actualizando: false, fallo: null }).includes("Editar columna"), "sin onGuardar es de solo lectura");
    const nuevo = pintar({ fase: "listo", vista: VISTA, actualizando: true, fallo: null });
    assert.ok(nuevo.includes("opacity-60") && nuevo.includes("Actualizando…") && nuevo.includes('aria-busy="true"'));
    const vencido = pintar({ fase: "listo", vista: VISTA, actualizando: false, fallo: null, vencido: true });
    assert.ok(vencido.includes("opacity-60") && vencido.includes("Es el último dibujo que llegó."));
    assert.ok(!pintar({ fase: "listo", vista: VISTA, actualizando: false, fallo: null }).includes("opacity-60"));
    assert.ok(pintar({ fase: "listo", vista: VISTA, actualizando: false, fallo: null }).includes('data-testid="avisos-vivos-armado-columna-organica"'), "la región de avisos siempre está montada");
  });

  console.log(`\n${casos} casos en verde`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
