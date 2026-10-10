/**
 * Propiedades de las herramientas de la escena (las que llama el modelo), sin modelo y sin coste. Cada herramienta
 * recibe argumentos generados desde SU declaración (`DECLARACIONES_ESCENA`), con los ids de piezas que de verdad hay en
 * una escena de partida, y se comprueba que:
 * - con argumentos válidos, el esquema nunca los rechaza y nunca cae en un error inesperado («No se pudo aplicar…»);
 * - una herramienta que funciona aplica un cambio real: cada herramienta que cambia la escena tiene al menos un caso
 *   que lo hace, y las que no cambian nunca son solo las de consulta (lista explícita);
 * - una llamada que funciona no toca la escena de partida, y la escena que devuelve es consistente (ids únicos, piezas
 *   con tipo y colocación, tope de piezas respetado);
 * - con claves que no existen, siempre se rechaza con mensaje.
 */
import assert from "node:assert/strict";
import { aplicarHerramienta, DECLARACIONES_ESCENA, MAX_NODOS, NOMBRES_HERRAMIENTAS, type DeclaracionHerramienta } from "../../src/lib/globos3d/herramientas-escena";
import { escenaPredefinida } from "../../src/lib/globos3d/escenas-presets";
import type { Escena } from "../../src/lib/globos3d/escena";
import { Azar } from "./lib-semilla";
import { configPropiedades, semillaDeNombre } from "./lib-config-propiedades";

const { casos: CASOS, semilla: SEMILLA } = configPropiedades();
const PREFIJO_CRASH = "No se pudo aplicar";
const PREFIJO_ESQUEMA = "Parámetros no válidos";
/** Herramientas que solo consultan: son las únicas que pueden terminar sin cambiar la escena. */
const SOLO_CONSULTA = new Set(["ver_escena", "ver_pieza", "buscar_en_escena", "buscar_en_biblioteca", "contar_globos", "seleccionar_grupo", "listar_colores", "preguntar_usuario"]);

type Esquema = Record<string, unknown>;
const LETRAS = "abcdefghijklmnopqrstuvwxyz";
/** Cuántos argumentos opcionales se llenan: pocos, para que la combinación sea coherente (una pieza no lleva a la vez un tipo y otro). */
const PROB_OPCIONAL = 0.12;
/** Las escenas de partida: una predefinida, o una con las mesas y centros, o con un salón armado (así las herramientas que
 * necesitan esas piezas tienen con qué trabajar). Se construyen con las mismas herramientas, y el montaje tiene que funcionar. */
function aplicarOBien(escena: Escena, nombre: string, argumentos: Record<string, unknown>): Escena {
  const r = aplicarHerramienta(escena, nombre, argumentos);
  assert.ok(r.ok, `montaje de la escena: ${nombre} falló: ${r.ok ? "" : r.error}`);
  return r.escena;
}
const BASES: Record<string, () => Escena> = {
  arco: () => escenaPredefinida("arco_organico_columnas_guirnalda"),
  pared: () => escenaPredefinida("pared_fondo_columnas"),
  techo: () => escenaPredefinida("techo_racimos"),
  mesas: () => aplicarOBien(aplicarOBien(escenaPredefinida("arco_organico_columnas_guirnalda"), "agregar_mesas", { cantidad: 4, tipo: "redonda", sillas_por_mesa: 4 }), "decorar_mesas", { disenos: [{ tipo: "ramo_helio" }], mesas: ["mesa-redonda"] }),
  salon: () => aplicarOBien(escenaPredefinida("arco_organico_columnas_guirnalda"), "armar_salon", { invitados: 30 }),
};
const BASE_INDICES = Object.keys(BASES);
const MONTADAS = new Map<string, Escena>();
/** Una copia de la escena de partida (montarla es caro: se hace una vez). */
function baseDe(nombre: string): Escena {
  if (!MONTADAS.has(nombre)) MONTADAS.set(nombre, BASES[nombre]!());
  return structuredClone(MONTADAS.get(nombre)!);
}
/** Qué escena pide cada grupo de herramientas (lo demás, al azar entre las de partida). */
const BASE_DE_HERRAMIENTA: Record<string, string> = {
  decorar_mesas: "mesas", completar_centros: "mesas", cambiar_centros: "mesas", quitar_centros: "mesas", cambiar_sillas: "mesas", cambiar_mesas: "mesas",
  ajustar_salon: "salon", mover_zona: "salon", quitar_zona: "salon",
  editar_globos: "pared", pintar_en_malla: "pared",
};

type Contexto = { nombre: string; ids: string[]; mesas: string[]; porTipo: Record<string, string[]> };

/** Herramientas cuyo `id` tiene que ser una pieza de cierto tipo (lo demás se elige entre todas las piezas). */
const TIPO_DE_ID: Record<string, string> = { ajustar_tamanos: "organico", pintar_en_malla: "pared_malla" };
const FORMATOS = ["R-5", "R-9", "R-12", "R-18", "R-24", "R-36", "LOL-12", "T-260"] as const;

/** Un valor que cumple el esquema JSON que ve el modelo. Los campos que nombran piezas se llenan con ids de la escena. */
function valorValido(esquema: Esquema, azar: Azar, contexto: Contexto, clave = "", profundidad = 0): unknown {
  if (Array.isArray(esquema.enum)) return azar.elegir(esquema.enum as unknown[]);
  if (clave === "id" || clave === "padre_id" || clave === "respecto_id") {
    const tipo = TIPO_DE_ID[contexto.nombre];
    const grupo = tipo ? contexto.porTipo[tipo] ?? [] : contexto.ids;
    return grupo.length ? azar.elegir(grupo) : "no-existe";
  }
  if (clave === "ids" && esquema.type === "array") return subconjunto(azar, contexto.ids);
  if (clave === "mesas" && esquema.type === "array") return subconjunto(azar, contexto.mesas.length ? contexto.mesas : contexto.ids);
  if (clave === "formato" && esquema.type === "string") return azar.elegir(FORMATOS);
  if (clave === "formatos" && esquema.type === "array") return subconjunto(azar, FORMATOS);
  if (esquema.const !== undefined) return esquema.const;
  switch (esquema.type) {
    case "string": {
      const minimo = (esquema.minLength as number | undefined) ?? 1;
      const maximo = Math.min((esquema.maxLength as number | undefined) ?? 12, 40);
      const largo = azar.entero(minimo, Math.max(minimo, maximo));
      return Array.from({ length: largo }, () => azar.elegir([...LETRAS])).join("") || "x";
    }
    case "number":
    case "integer": {
      const minimo = (esquema.minimum as number | undefined) ?? 0;
      const maximo = (esquema.maximum as number | undefined) ?? Math.max(minimo + 10, 10);
      if (esquema.type === "integer") return azar.entero(Math.ceil(minimo), Math.floor(maximo));
      return Math.round((minimo + azar.real() * (maximo - minimo)) * 10) / 10;
    }
    case "boolean": return azar.booleano();
    case "array": {
      const minimo = (esquema.minItems as number | undefined) ?? 0;
      const maximo = Math.min((esquema.maxItems as number | undefined) ?? 3, 3);
      const items = (esquema.items ?? { type: "string" }) as Esquema;
      return Array.from({ length: azar.entero(minimo, Math.max(minimo, maximo)) }, () => valorValido(items, azar, contexto, "", profundidad + 1));
    }
    case "object": {
      const propiedades = (esquema.properties ?? {}) as Record<string, Esquema>;
      const requeridas = new Set((esquema.required as string[] | undefined) ?? []);
      const salida: Record<string, unknown> = {};
      for (const [sub, esquemaSub] of Object.entries(propiedades)) {
        if (requeridas.has(sub) || (profundidad < 3 && azar.booleano(PROB_OPCIONAL))) salida[sub] = valorValido(esquemaSub, azar, contexto, sub, profundidad + 1);
      }
      return salida;
    }
    default: return null;
  }
}

function subconjunto<T>(azar: Azar, ids: readonly T[]): T[] {
  if (!ids.length) return [];
  const cuantos = azar.entero(1, Math.min(3, ids.length));
  return [...ids].sort(() => azar.real() - 0.5).slice(0, cuantos);
}

/** Un valor que no cumple el esquema: un tipo cambiado, un nulo o una clave que no existe. */
function argumentosInvalidos(declaracion: DeclaracionHerramienta, azar: Azar, contexto: Contexto): unknown {
  const mundo = [null, 7, -3.5, "texto", true, [], { raro: 1 }, [1, "x"]];
  const base = valorValido(declaracion.parametersJsonSchema as Esquema, azar, contexto);
  if (!base || typeof base !== "object" || Array.isArray(base)) return azar.elegir(mundo);
  const copia: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  const claves = Object.keys(copia);
  if (claves.length && azar.booleano()) copia[azar.elegir(claves)] = azar.elegir(mundo);
  else copia[`clave_que_no_existe_${azar.entero(1, 99)}`] = azar.elegir(mundo);
  return copia;
}

const contextoDe = (nombre: string, escena: Escena): Contexto => {
  const porTipo: Record<string, string[]> = {};
  for (const n of escena.nodos) (porTipo[n.pieza.tipo] ??= []).push(n.id);
  return { nombre, ids: escena.nodos.map((n) => n.id), mesas: escena.nodos.filter((n) => n.id.startsWith("mesa")).map((n) => n.id), porTipo };
};

/** La escena es consistente: ids únicos, cada pieza con tipo y colocación, y no pasa el tope de piezas. */
function verificarConsistencia(escena: Escena, donde: string): void {
  const ids = escena.nodos.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, `${donde}: ids de piezas repetidos`);
  assert.ok(ids.length <= MAX_NODOS, `${donde}: ${ids.length} piezas pasa el tope de ${MAX_NODOS}`);
  for (const n of escena.nodos) {
    assert.equal(typeof n.pieza?.tipo, "string", `${donde}: la pieza ${n.id} no tiene tipo`);
    assert.ok(n.colocacion, `${donde}: la pieza ${n.id} no tiene colocación`);
  }
}

/** Una llamada de referencia: válida y con la escena que necesita, para las herramientas que las llamadas al azar casi nunca aciertan. */
type Referencia = { base: string; argumentos: (escena: Escena) => Record<string, unknown> };
const REFERENCIAS: Record<string, Referencia> = {
  recolorear_escena: { base: "arco", argumentos: () => ({ colores: ["rojo reflex"] }) },
  alinear: { base: "arco", argumentos: () => ({ ids: ["columna-izq", "columna-der"], como: ["fila"] }) },
  editar_globos: { base: "pared", argumentos: () => ({ formatos: ["LOL-*"], cambio: { color: "verde" } }) },
  techo_por_zona: { base: "arco", argumentos: () => ({ tipo: "festones", toda_la_sala: true }) },
  ajustar_tamanos: { base: "arco", argumentos: () => ({ id: "arco", densidad: "mas" }) },
  listar_colores: { base: "arco", argumentos: () => ({ formato: "R-12" }) },
  cambiar_pieza: { base: "arco", argumentos: () => ({ id: "columna-izq", colores: ["azul"] }) },
  pintar_en_malla: { base: "pared", argumentos: (e) => ({ id: e.nodos.find((n) => n.pieza.tipo === "pared_malla")!.id, texto: "AB", color: "rojo" }) },
  separar_copia: { base: "pared", argumentos: () => ({ id: "flores-pared", copia: 1 }) },
  ajustar_salon: { base: "salon", argumentos: (e) => ({ ancho_cm: e.sala.anchoCm + 500, fondo_cm: e.sala.fondoCm + 500 }) },
  armar_salon: { base: "arco", argumentos: () => ({ invitados: 30 }) },
  cambiar_mesas: { base: "mesas", argumentos: () => ({ tipo: "rectangular" }) },
  cambiar_sillas: { base: "mesas", argumentos: () => ({ cantidad: 2 }) },
  cambiar_centros: { base: "mesas", argumentos: () => ({ alto_cm: 180 }) },
  distribuir: { base: "arco", argumentos: () => ({ ids: ["columna-izq", "columna-der"], desde_x_cm: -250, hasta_x_cm: 250 }) },
  buscar_en_escena: { base: "arco", argumentos: () => ({ formatos: ["R-12"] }) },
  mover_zona: { base: "salon", argumentos: () => ({ zona: "mesa_postres", x_cm: 100 }) },
  quitar_zona: { base: "salon", argumentos: () => ({ zona: "fondo_fotos" }) },
};
/** Herramientas que no se pueden llamar con datos del azar ni con una escena de partida: necesitan algo de fuera (una foto, un id de la biblioteca). Su prueba vive en otro lado. */
const EXENTAS: Record<string, string> = {
  modelar_desde_foto: "necesita una foto adjunta (su prueba es test-foto-a-escena)",
  insertar_de_biblioteca: "necesita un id de la biblioteca del taller (lo da buscar_en_biblioteca; su prueba es test-escena-ia-biblioteca-rag)",
};

/** Una sala sin piezas: para lo que se rechaza por la forma de los argumentos, no hace falta armar nada. */
const sinPiezas: Escena = { ...escenaPredefinida("arco_organico_columnas_guirnalda"), nodos: [] };

type Recuento = { validas: number; ok: number; cambios: number; rechazos: Map<string, number> };

function llamar(escena: Escena, nombre: string, argumentos: unknown, donde: string): { ok: true; escena: Escena } | { ok: false; error: string } {
  const resultado = aplicarHerramienta(escena, nombre, argumentos);
  if (resultado.ok) {
    verificarConsistencia(resultado.escena, donde);
    return { ok: true, escena: resultado.escena };
  }
  assert.ok(!resultado.error.startsWith(PREFIJO_CRASH), `${donde}: error inesperado con ${JSON.stringify(argumentos).slice(0, 200)}: ${resultado.error}`);
  assert.ok(!resultado.error.startsWith(PREFIJO_ESQUEMA), `${donde}: el esquema rechaza argumentos que su declaración admite: ${resultado.error} con ${JSON.stringify(argumentos).slice(0, 300)}`);
  return { ok: false, error: resultado.error };
}

/** Un motivo de rechazo corto y estable (sin ids ni números que cambian de un caso a otro) para contar cuántas llamadas cayeron por qué. */
const motivoDe = (error: string): string => error.replace(/\d+/g, "N").replace(/«[^»]*»/g, "«…»").slice(0, 90);

function main(): void {
  const resumen: { nombre: string; ok: number; validas: number; cambios: number; referencia: boolean }[] = [];
  let invalidas = 0;
  let rechazadas = 0;
  for (const declaracion of DECLARACIONES_ESCENA) {
    const nombre = declaracion.name;
    assert.ok(NOMBRES_HERRAMIENTAS.includes(nombre), `${nombre} no está en el registro`);
    const recuento: Recuento = { validas: 0, ok: 0, cambios: 0, rechazos: new Map() };
    if (!EXENTAS[nombre]) {
      for (let caso = 0; caso < CASOS; caso += 1) {
        const azar = new Azar(SEMILLA + semillaDeNombre(nombre) + caso);
        const base = baseDe(BASE_DE_HERRAMIENTA[nombre] ?? azar.elegir(BASE_INDICES));
        const antes = structuredClone(base);
        const donde = `${nombre} caso ${caso}`;
        const argumentos = valorValido(declaracion.parametersJsonSchema as Esquema, azar, contextoDe(nombre, base));
        recuento.validas += 1;
        const r = llamar(base, nombre, argumentos, donde);
        assert.deepEqual(base, antes, `${donde}: la llamada tocó la escena de partida`);
        if (r.ok) {
          recuento.ok += 1;
          if (JSON.stringify(r.escena) !== JSON.stringify(antes)) recuento.cambios += 1;
        } else recuento.rechazos.set(motivoDe(r.error), (recuento.rechazos.get(motivoDe(r.error)) ?? 0) + 1);

        const malos = argumentosInvalidos(declaracion, azar, contextoDe(nombre, base));
        invalidas += 1;
        if (!aplicarHerramienta(sinPiezas, nombre, malos).ok) rechazadas += 1;
        const conClaveDeMas = aplicarHerramienta(sinPiezas, nombre, { ...(typeof argumentos === "object" && argumentos ? argumentos : {}), clave_que_no_existe: 1 });
        assert.ok(!conClaveDeMas.ok, `${donde}: aceptó una clave que no existe`);
      }
    }
    const referencia = REFERENCIAS[nombre];
    if (referencia) {
      const base = baseDe(referencia.base);
      const r = llamar(base, nombre, referencia.argumentos(base), `${nombre} (referencia)`);
      assert.ok(r.ok, `${nombre}: la llamada de referencia tiene que funcionar`);
      if (r.ok && JSON.stringify(r.escena) !== JSON.stringify(base)) recuento.cambios += 1;
      if (r.ok) recuento.ok += 1;
    }
    resumen.push({ nombre, ok: recuento.ok, validas: recuento.validas, cambios: recuento.cambios, referencia: Boolean(referencia) });
    const sinFuncionar = recuento.ok === 0 && !EXENTAS[nombre];
    assert.ok(!sinFuncionar, `${nombre}: ninguna llamada válida funcionó (motivos: ${[...recuento.rechazos].map(([m, n]) => `${n}× ${m}`).join("; ") || "ninguna llamada"})`);
    if (!SOLO_CONSULTA.has(nombre) && !EXENTAS[nombre]) assert.ok(recuento.cambios > 0, `${nombre}: ninguna llamada válida cambió la escena`);
  }
  const ok = resumen.reduce((a, r) => a + r.ok, 0);
  const validas = resumen.reduce((a, r) => a + r.validas, 0);
  console.log(`test-propiedades-herramientas (semilla ${SEMILLA}, ${CASOS} casos): ${DECLARACIONES_ESCENA.length} herramientas (${Object.keys(EXENTAS).length} exentas con motivo); ${ok} llamadas que aplicaron un resultado consistente de ${validas} válidas (${REFERENCIAS ? Object.keys(REFERENCIAS).length : 0} con referencia); ${rechazadas} de ${invalidas} llamadas inválidas rechazadas.`);
  assert.ok(rechazadas >= Math.floor(invalidas * 0.9), `solo ${rechazadas} de ${invalidas} llamadas inválidas se rechazaron`);
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
