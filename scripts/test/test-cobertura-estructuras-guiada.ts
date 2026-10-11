/**
 * CUS-03: ninguna de las 18 estructuras oficiales se pierde en silencio en el plan de la vista guiada. Cada una, pedida sola con
 * los colores por defecto, hace una de tres cosas, y la prueba lo fija estructura por estructura:
 *   - se CONSTRUYE tal cual (el motor 3D la arma, sin avisos);
 *   - se construye APROXIMADA y el aviso llega a «Ajustes que hice» de la tarjeta (el cliente lo lee en el plan);
 *   - cae a PYTHON: la ruta lo dice (422 `no_representable`, con la pieza y su motivo), no cotiza un plan sin ella, y la tarjeta
 *     del plan de Python le dice qué pieza no dibuja la vista 3D y que ve el dibujo de siempre (`avisosSinVista3d`).
 * Los avisos al cliente no llevan palabras del motor. Sin red, base ni IA (precio y bandera son dobles).
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-cobertura-estructuras-guiada.ts
 */
import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { SESSION_COOKIE, sessionToken } from "../../src/lib/auth/session";
import { atenderPlanMotor, type DependenciasPlanMotor } from "../../src/lib/guiada-motor/plan-motor";
import { FalloPlanMotorSchema } from "../../src/lib/guiada-motor/plan-contrato";
import { avisosSinVista3d, ESTRUCTURAS_SIN_VISTA_3D } from "../../src/lib/guiada-motor/sin-vista-3d";
import { ajustesDePython } from "../../src/lib/ia/guiado/ajustes-python";
import { armarDesdeEspec, cotizarBom, crosswalkIncluido, sobreDelMotor } from "../../src/lib/globos3d/motor/v1";
import { avisoAproximada, representacionDe } from "../../src/lib/globos3d/motor/representable";
import { ESTRUCTURAS_OFICIALES, ESTRUCTURAS_OFICIALES_IDS, type EstructuraOficialId } from "../../src/lib/plan/estructuras-oficiales";
import { formasDeOficial } from "../../src/lib/plan/formas-pieza";
import { casosOficiales } from "../lib/casos-motor-guiada";
import { pythonDoble } from "../lib/python-doble-precio";

type Cobertura = "construye" | "aproximada" | "python";

/** Lo que el plan guiado hace hoy con cada estructura oficial. Una estructura nueva obliga a clasificarla aquí. */
const ESPERADO: Readonly<Record<EstructuraOficialId, Cobertura>> = {
  arco: "construye", arco_asimetrico: "construye", arco_no_denso: "aproximada",
  semiarco: "construye", semiarco_asimetrico: "construye",
  columna: "construye", columna_asimetrica: "construye", columna_no_densa: "aproximada",
  pared_densa: "construye", pared_no_densa: "python", pared_organica: "python",
  guirnalda: "construye", centro_mesa: "python", bouquet: "aproximada", figura: "python",
  aro_circular: "construye", techo_globos: "construye", racimo_pared: "construye",
};

/** Cómo nombra la frase al cliente cada pieza que cae a Python: el nombre del catálogo oficial, tal cual, con su artículo. */
const NOMBRE_PARA_CLIENTE: Partial<Record<EstructuraOficialId, string>> = {
  figura: "la figura con globos", centro_mesa: "el centro de mesa con globos", pared_organica: "la pared orgánica", pared_no_densa: "la pared de globos no densa",
};

/** Lo que el cliente nunca debe leer: el vocabulario del motor. */
const PALABRAS_DEL_MOTOR = /\b(motor|constructor|python|espec|fallback|bom)\b/i;

const CLAVE_APP = "clave-app-de-prueba";
const cruce = crosswalkIncluido();
const casos = new Map(casosOficiales().map((caso) => [caso.id.replace("oficial-", ""), caso]));

let anterior: Record<string, string | undefined> = {};
beforeEach(() => {
  anterior = { APP_PASSWORD: process.env.APP_PASSWORD, DATABASE_URL: process.env.DATABASE_URL };
  process.env.APP_PASSWORD = CLAVE_APP;
  delete process.env.DATABASE_URL;
});
afterEach(() => { for (const [clave, valor] of Object.entries(anterior)) { if (valor === undefined) delete process.env[clave]; else process.env[clave] = valor; } });

const casoDe = (id: EstructuraOficialId) => casos.get(id)!;

function clasificar(id: EstructuraOficialId): Cobertura {
  const caso = casoDe(id);
  const resultado = armarDesdeEspec(caso.espec);
  if (resultado.noRepresentable.length) return "python";
  return resultado.avisos.length ? "aproximada" : "construye";
}

test("la tabla esperada cubre las 18 estructuras oficiales, ni una más ni una menos", () => {
  assert.equal(ESTRUCTURAS_OFICIALES_IDS.length, 18);
  assert.deepEqual(Object.keys(ESPERADO).sort(), [...ESTRUCTURAS_OFICIALES_IDS].sort());
  assert.deepEqual([...casos.keys()].sort(), [...ESTRUCTURAS_OFICIALES_IDS].sort());
});

test("cada estructura se construye, se aproxima o cae a Python, como dice la tabla", () => {
  for (const id of ESTRUCTURAS_OFICIALES_IDS) assert.equal(clasificar(id), ESPERADO[id], id);
});

for (const id of ESTRUCTURAS_OFICIALES_IDS.filter((e) => ESPERADO[e] === "construye")) {
  test(`${id}: se construye tal cual, con globos y sin avisos que esconder`, () => {
    const resultado = armarDesdeEspec(casoDe(id).espec);
    assert.deepEqual(resultado.noRepresentable, []);
    assert.deepEqual(resultado.avisos, []);
    assert.ok(resultado.bom.total.reduce((suma, linea) => suma + linea.cantidad, 0) > 0, "construir sin globos sería callarse la pieza");
  });
}

for (const id of ESTRUCTURAS_OFICIALES_IDS.filter((e) => ESPERADO[e] === "aproximada")) {
  test(`${id}: se aproxima, dice por qué y el cliente lo lee en «Ajustes que hice» de su plan`, async () => {
    const caso = casoDe(id);
    const pieza = caso.espec.piezas[0]!;
    const resultado = armarDesdeEspec(caso.espec);
    assert.deepEqual(resultado.noRepresentable, []);
    assert.ok(resultado.bom.total.length > 0);
    const representacion = representacionDe(pieza);
    assert.equal(representacion.estado, "aproximada");
    const aviso = avisoAproximada(pieza.nombre, representacion.motivo!);
    assert.deepEqual(resultado.avisos, [aviso]);
    assert.doesNotMatch(aviso, PALABRAS_DEL_MOTOR);

    const cotizada = await cotizarBom(resultado.bom, { crosswalk: async () => cruce, cotizarLista: pythonDoble(cruce).cotizarLista });
    assert.ok(cotizada.ok, "la lista aproximada se cotiza");
    const sobre = sobreDelMotor({ espec: caso.espec, resultado, cotizacion: cotizada, concepto: { titulo: "Plan de prueba", descripcion: "Plan de prueba" }, requestId: "11111111-1111-4111-8111-111111111111" });
    assert.ok(sobre.ok);
    const lineas = ajustesDePython(sobre.plan).map((ajuste) => ajuste.texto);
    assert.ok(lineas.includes(aviso), `la tarjeta no muestra el aviso: ${JSON.stringify(lineas)}`);
  });
}

const sesion = () => `${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}; feedback_usuario=${"a1".repeat(16)}`;

for (const id of ESTRUCTURAS_OFICIALES_IDS.filter((e) => ESPERADO[e] === "python")) {
  test(`${id}: cae a Python con la pieza y su motivo, sin cotizar un plan sin ella, y la tarjeta dice qué dibujo ve`, async () => {
    const caso = casoDe(id);
    const pieza = caso.espec.piezas[0]!;
    const resultado = armarDesdeEspec(caso.espec);
    assert.equal(resultado.noRepresentable.length, 1);
    assert.equal(resultado.noRepresentable[0]!.piezaId, pieza.id);
    assert.ok(resultado.noRepresentable[0]!.motivo.length > 10);
    assert.equal(representacionDe(pieza).estado, "fallback");
    assert.ok((ESTRUCTURAS_SIN_VISTA_3D as readonly string[]).includes(id), "la tabla compartida sabe que el 3D no la dibuja");

    // La ruta: el plan 3D se rechaza con su razón tipada (la vista pasa a Python) y no se cotiza nada.
    let cotizaciones = 0;
    const deps: DependenciasPlanMotor = {
      leerBandera: async () => ({ motor: "3d", fuente: "cookie" }),
      auditar: () => undefined,
      planGuardado: () => null,
      cotizar: async () => { cotizaciones += 1; return { ok: false, razon: "precio_fallido", detalle: "no debía llamarse" }; },
      nuevoId: () => "00000000-0000-4000-8000-000000000001",
      registrarPlan: async () => undefined,
    };
    const respuesta = await atenderPlanMotor(new Request("https://app.test/api/guiada/motor/plan", {
      method: "POST", headers: { "content-type": "application/json", cookie: sesion() },
      body: JSON.stringify({ desde: "propuesta", propuesta: { frase: `Te propongo ${id}.`, colores: ["azul", "blanco", "dorado"], piezas: [{ estructura: id, cantidad: 1 }] } }),
    }), deps);
    assert.equal(respuesta.status, 422);
    const fallo = FalloPlanMotorSchema.parse(await respuesta.json());
    assert.equal(fallo.fallback?.razon, "no_representable");
    assert.equal(fallo.fallback?.piezas?.length, 1);
    assert.equal(cotizaciones, 0);

    // La tarjeta del plan de Python: una frase en palabras de cliente que nombra la pieza.
    const avisos = avisosSinVista3d({ plan: { estructuras: [{ estructura_oficial: id }, { estructura_oficial: id }] } });
    assert.equal(avisos.length, 1, "una sola frase aunque el plan repita la pieza");
    assert.ok(avisos[0]!.includes(NOMBRE_PARA_CLIENTE[id]!), avisos[0]);
    assert.doesNotMatch(avisos[0]!, PALABRAS_DEL_MOTOR);
    assert.match(avisos[0]!, /dibujo de siempre/);
  });
}

test("el aro circular parcial tampoco se dibuja: cae a Python y la tarjeta lo dice; el aro entero no dice nada", () => {
  const pieza = casoDe("aro_circular").espec.piezas[0]!;
  assert.equal(representacionDe(pieza).estado, "representable");
  assert.equal(representacionDe({ ...pieza, forma: "parcial" }).estado, "fallback");
  assert.deepEqual(avisosSinVista3d({ plan: { estructuras: [{ estructura_oficial: "aro_circular" }] } }), []);
  const [aviso] = avisosSinVista3d({ plan: { estructuras: [{ estructura_oficial: "aro_circular", forma: "parcial" }] } });
  assert.match(aviso!, /el aro circular parcial/);
});

test("la frase al cliente sale exactamente donde el motor devuelve fallback, con cualquier forma de pieza del catálogo", () => {
  for (const id of ESTRUCTURAS_OFICIALES_IDS) {
    const pieza = casoDe(id).espec.piezas[0]!;
    const formas = [undefined, ...formasDeOficial(id).map((forma) => forma.id)];
    for (const forma of formas) {
      const cae = representacionDe({ ...pieza, ...(forma ? { forma } : {}) }).estado === "fallback";
      const dicha = avisosSinVista3d({ plan: { estructuras: [{ estructura_oficial: id, ...(forma ? { forma } : {}) }] } }).length === 1;
      assert.equal(dicha, cae, `${id}${forma ? ` (${forma})` : ""}: ${cae ? "cae a Python y la tarjeta calla" : "se dibuja y la tarjeta dice que no"}`);
    }
  }
  assert.deepEqual(avisosSinVista3d({ plan: { estructuras: [{}] } }), [], "un plan sin estructura oficial no inventa nada");
});

test("el nombre de cada pieza que cae a Python es el del catálogo oficial completo (sin renombrarla a escondidas)", () => {
  for (const [id, nombre] of Object.entries(NOMBRE_PARA_CLIENTE)) {
    const oficial = ESTRUCTURAS_OFICIALES[id as EstructuraOficialId].nombre.toLocaleLowerCase("es");
    assert.equal(nombre, `${/^(figura|pared)/.test(oficial) ? "la" : "el"} ${oficial}`, id);
  }
});
