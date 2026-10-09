/**
 * Guardia PARCIAL del prerender de producción (P-033; ver los puntos ciegos en `scripts/lib/guardia-prerender.ts`). Sin coste,
 * sin red. Tres partes:
 *  1. El detector sobre fixtures con violaciones conocidas (directas, en iteradores, en props de render, en helpers de un salto,
 *     en referencias sin llamar) y con patrones seguros conocidos.
 *  2. El archivo previo al incidente 7245991f (`Taller3D.tsx`, `claveNueva()` en un `useState`) tiene que marcarse por el salto
 *     hasta `guardado-conversacion.ts`.
 *  3. El repositorio entero: ningún componente cliente de `src/` puede evaluar un valor no determinista al pintar sin
 *     `// prerender-seguro: <motivo>` al final de su línea.
 *
 *   NODE_OPTIONS=--use-system-ca npx tsx scripts/test/test-guardia-prerender.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { esArchivoCliente, hallazgosDelArchivo, type Hallazgo } from "../lib/guardia-prerender";

const RAIZ_SRC = fileURLToPath(new URL("../../src", import.meta.url));
const DIRECTORIO_FIXTURES = fileURLToPath(new URL("./fixtures/guardia-prerender", import.meta.url));
/** Ruta virtual dentro de src/: así los `@/` y `./` de los fixtures se resuelven contra los archivos reales. */
const RUTA_VIRTUAL = path.join(RAIZ_SRC, "components", "guardia-fixture.tsx");

const FIXTURE_VIOLACIONES = `"use client";
import React, { memo, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { claveNueva } from "@/components/tres-d/guardado-conversacion";

export function Vista({ items }: { items: string[] }) {
  const inicio = Date.now();
  const azar = Math.random();
  const ahora = new Date();
  const guardado = localStorage.getItem("k");
  const ancho = window.innerWidth;
  const etiqueta = () => performance.now();
  useEffect(() => { document.title = "x"; const t = Date.now(); }, []);
  const onClick = () => Date.now();
  return (
    <div>
      {inicio}{azar}{String(ahora)}{guardado}{ancho}{etiqueta()}{String(onClick)}
      {items.map((x) => <i key={Math.random()}>{x}</i>)}
      <Cajon render={() => <b>{new Date().getTime()}</b>} />
    </div>
  );
}

export function Lista() {
  const [items] = useState(() => [Math.random()]);
  const ref = useRef(performance.now());
  const memo2 = useMemo(() => crypto.randomUUID(), []);
  const [s] = useReducer(reducer, 0, () => new Date().getTime());
  const [t0] = useState(Date.now);
  const [t1] = useState(Math.random);
  const ahora = () => Date.now();
  const [v] = useMemo(ahora, []);
  const [mm] = React.useState(() => Math.random());
  const [z] = useState(() => Math.random()); const aviso = "// prerender-seguro: no cuenta";
  return <p>{items}{ref.current}{memo2}{s}{t0}{t1}{v}{mm}{z}{aviso}</p>;
}

export function Guardado() {
  const [clave] = useState(() => claveNueva());
  const [referencia] = useState(claveNueva);
  return <p>{clave}</p>;
}

export function useReloj() {
  const t = sessionStorage.getItem("t");
  return t;
}

const Tarjeta = memo(() => {
  const r = Math.random();
  return <i>{r}</i>;
});

const arranque = Date.now();

function reducer(estado: number) { return estado; }
`;

const FIXTURE_SEGURO = `"use client";
import { useCallback, useEffect, useState } from "react";

export function Seguro({ items }: { items: string[] }) {
  const [id] = useState(() => "x");
  const [t] = useState(() => Date.now()); // prerender-seguro: se fija solo después de montar
  const [u] = useState(() => Math.random()); // prerender-seguro: el valor lo elige el servidor y el cliente lo lee al montar
  const [w] = useState(() => Date.now()); // prerender-seguro: se fija al montar
  "esta línea empieza con una cadena, y el opt-out de arriba sigue valiendo";
  useEffect(() => { localStorage.setItem("a", "b"); }, []);
  const manejar = useCallback(() => window.scrollTo(0, 0), []);
  const cuando = () => new Date();
  return (
    <div>
      {items.map((x) => <b key={x} onClick={() => Math.random()} />)}
      <Cajon onChange={() => Date.now()} ref={() => performance.now()} />
      {typeof window === "undefined" ? null : <p onClick={manejar} data-id={id} data-t={t} data-u={u}>{String(cuando)}</p>}
    </div>
  );
}

function armar() {
  return Date.now();
}
`;

const FIXTURE_NO_CLIENTE = FIXTURE_VIOLACIONES.replace('"use client";', "");

/** Línea (1-based) de la primera línea del texto que contiene el fragmento: el fixture se mide por lo que dice, no por su número. */
function lineaDe(texto: string, fragmento: string): number {
  const indice = texto.split("\n").findIndex((l) => l.includes(fragmento));
  assert.ok(indice >= 0, `el fixture no tiene «${fragmento}»`);
  return indice + 1;
}

function esperado(texto: string, fragmento: string, patron: string, ambito: Hallazgo["ambito"]): string {
  return `${lineaDe(texto, fragmento)} ${patron} ${ambito}`;
}

const resumen = (hallazgos: Hallazgo[]) => hallazgos.map((h) => `${h.linea} ${h.patron} ${h.ambito}${h.via ? ` via ${h.via.split(" ")[0]}` : ""}`);

// 1. El detector sobre los fixtures.
assert.equal(esArchivoCliente(FIXTURE_VIOLACIONES, RUTA_VIRTUAL), true, "el fixture de violaciones es de cliente");
assert.equal(esArchivoCliente(FIXTURE_NO_CLIENTE, RUTA_VIRTUAL), false, "sin la directiva no es de cliente");
assert.deepEqual(hallazgosDelArchivo(FIXTURE_NO_CLIENTE, RUTA_VIRTUAL), [], "un archivo del servidor no se mira");

const violaciones = hallazgosDelArchivo(FIXTURE_VIOLACIONES, RUTA_VIRTUAL);
const esperadasViolaciones = [
  esperado(FIXTURE_VIOLACIONES, "const inicio = Date.now()", "Date.now()", "render"),
  esperado(FIXTURE_VIOLACIONES, "const azar = Math.random()", "Math.random()", "render"),
  esperado(FIXTURE_VIOLACIONES, "const ahora = new Date()", "new Date()", "render"),
  esperado(FIXTURE_VIOLACIONES, "const guardado = localStorage", "localStorage", "render"),
  esperado(FIXTURE_VIOLACIONES, "const ancho = window.innerWidth", "window.innerWidth", "render"),
  esperado(FIXTURE_VIOLACIONES, "items.map((x) => <i key={Math.random()}", "Math.random()", "render"),
  esperado(FIXTURE_VIOLACIONES, "render={() => <b>{new Date()", "new Date()", "render"),
  esperado(FIXTURE_VIOLACIONES, "const [items] = useState(() => [Math.random()])", "Math.random()", "inicializador"),
  esperado(FIXTURE_VIOLACIONES, "const ref = useRef(performance.now())", "performance.now()", "inicializador"),
  esperado(FIXTURE_VIOLACIONES, "const memo2 = useMemo(() => crypto.randomUUID()", "crypto.randomUUID()", "inicializador"),
  esperado(FIXTURE_VIOLACIONES, "() => new Date().getTime()", "new Date()", "inicializador"),
  esperado(FIXTURE_VIOLACIONES, "const [t0] = useState(Date.now)", "Date.now (sin llamar)", "inicializador"),
  esperado(FIXTURE_VIOLACIONES, "const [t1] = useState(Math.random)", "Math.random (sin llamar)", "inicializador"),
  esperado(FIXTURE_VIOLACIONES, "const [mm] = React.useState(() => Math.random())", "Math.random()", "inicializador"),
  esperado(FIXTURE_VIOLACIONES, "const [z] = useState(() => Math.random())", "Math.random()", "inicializador"),
  esperado(FIXTURE_VIOLACIONES, "const t = sessionStorage", "sessionStorage", "render"),
  esperado(FIXTURE_VIOLACIONES, "const r = Math.random()", "Math.random()", "render"),
  esperado(FIXTURE_VIOLACIONES, "const arranque = Date.now()", "Date.now()", "modulo"),
];
assert.deepEqual(
  violaciones.filter((h) => !h.via).map((h) => `${h.linea} ${h.patron} ${h.ambito}`).sort(),
  [...esperadasViolaciones].sort(),
  "cada violación directa en su línea, con su patrón y su ámbito",
);

// Un salto: el helper local `etiqueta` (llamado en JSX), el local `ahora` (referencia en useMemo) y el importado `claveNueva`
// (llamado y referenciado en un inicializador) se marcan en su cuerpo, con la línea de la llamada que los trajo.
const RUTA_GUARDADO = path.join(RAIZ_SRC, "components", "tres-d", "guardado-conversacion.ts");
const lineaClaveNueva = lineaDe(readFileSync(RUTA_GUARDADO, "utf8"), "export const claveNueva");
const viaDeVirtual = (fragmento: string, nombre: string) => `${nombre}() llamada en components/guardia-fixture.tsx:${lineaDe(FIXTURE_VIOLACIONES, fragmento)}`;
const porSalto = violaciones.filter((h) => h.via);
assert.deepEqual(
  porSalto.map((h) => `${h.linea} ${h.patron} ${h.ambito} ${path.basename(h.archivo)} ${h.via}`).sort(),
  [
    `${lineaDe(FIXTURE_VIOLACIONES, "const etiqueta = () => performance.now()")} performance.now() render guardia-fixture.tsx ${viaDeVirtual("{etiqueta()}", "etiqueta")}`,
    `${lineaDe(FIXTURE_VIOLACIONES, "const ahora = () => Date.now()")} Date.now() inicializador guardia-fixture.tsx ${viaDeVirtual("useMemo(ahora", "ahora")}`,
    `${lineaClaveNueva} Date.now() inicializador guardado-conversacion.ts ${viaDeVirtual("useState(() => claveNueva())", "claveNueva")}`,
    `${lineaClaveNueva} Math.random() inicializador guardado-conversacion.ts ${viaDeVirtual("useState(() => claveNueva())", "claveNueva")}`,
    `${lineaClaveNueva} Date.now() inicializador guardado-conversacion.ts ${viaDeVirtual("useState(claveNueva)", "claveNueva")}`,
    `${lineaClaveNueva} Math.random() inicializador guardado-conversacion.ts ${viaDeVirtual("useState(claveNueva)", "claveNueva")}`,
  ].sort(),
  "el salto: helper local en JSX, local en useMemo e importado en un inicializador (llamado o sin llamar), en la línea del helper y con la llamada que lo trajo",
);

// Un hook de un archivo que no es de cliente, llamado desde un componente cliente: su inicializador (con useState y React.useState) se marca.
const RUTA_CLIENTE_HOOK = path.join(DIRECTORIO_FIXTURES, "cliente-hook.tsx");
const FIXTURE_HOOK = readFileSync(path.join(DIRECTORIO_FIXTURES, "hook-no-cliente.ts"), "utf8");
const CLIENTE_HOOK = `"use client";
import { useReloj } from "./hook-no-cliente";
export function Reloj() {
  const t = useReloj();
  return <p>{t}</p>;
}
`;
assert.deepEqual(
  hallazgosDelArchivo(CLIENTE_HOOK, RUTA_CLIENTE_HOOK).map((h) => `${h.linea} ${h.patron} ${h.ambito} ${path.basename(h.archivo)} ${h.via?.startsWith("useReloj() llamada")}`),
  [
    `${lineaDe(FIXTURE_HOOK, "useState(() => Date.now())")} Date.now() inicializador hook-no-cliente.ts true`,
    `${lineaDe(FIXTURE_HOOK, "React.useState(() => Math.random())")} Math.random() inicializador hook-no-cliente.ts true`,
  ],
  "el hook de un archivo sin directiva: sus inicializadores (useState y React.useState) se marcan por el salto",
);

assert.deepEqual(hallazgosDelArchivo(FIXTURE_SEGURO, RUTA_VIRTUAL), [], "los patrones seguros no se marcan: efectos, manejadores, ref, typeof window, opt-out, no llamados y funciones que no son componente");

// 2. El archivo previo al incidente 7245991f (Taller3D con claveNueva() en un useState) tiene que marcarse.
const RUTA_TALLER = path.join(RAIZ_SRC, "components", "tres-d", "Taller3D.tsx");
const textoPrevio = readFileSync(path.join(DIRECTORIO_FIXTURES, "taller3d-prefix-7245991f.tsx.txt"), "utf8");
const hallazgosPrevios = hallazgosDelArchivo(textoPrevio, RUTA_TALLER);
assert.ok(
  hallazgosPrevios.some((h) => h.patron === "Date.now()" && h.via?.startsWith("claveNueva()") && h.archivo === RUTA_GUARDADO && h.linea === lineaClaveNueva),
  `el Taller3D previo al incidente tiene que marcar Date.now() de claveNueva (guardado-conversacion.ts:11); salió: ${JSON.stringify(resumen(hallazgosPrevios))}`,
);

// 3. El repositorio: componentes cliente de src/.
function archivosFuente(directorio: string): string[] {
  return readdirSync(directorio, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = path.join(directorio, entrada.name);
    if (entrada.isDirectory()) return archivosFuente(ruta);
    return /\.(ts|tsx)$/.test(entrada.name) ? [ruta] : [];
  });
}

const clientes = archivosFuente(RAIZ_SRC).filter((ruta) => esArchivoCliente(readFileSync(ruta, "utf8"), ruta));
assert.ok(clientes.length >= 100, `se esperaban más de 100 componentes cliente en src/ y hay ${clientes.length}: revisa la búsqueda`);

const hallazgos = clientes.flatMap((ruta) => hallazgosDelArchivo(readFileSync(ruta, "utf8"), ruta));
const relativos = hallazgos.map((h) => `${path.relative(RAIZ_SRC, h.archivo).split(path.sep).join("/")}:${h.linea} ${h.patron} (${h.ambito}${h.via ? `, ${h.via}` : ""}): ${h.texto}`);
assert.deepEqual(relativos, [], `hay ${hallazgos.length} valores no deterministas al pintar en componentes cliente (P-033); o se mueven a useEffect, o se revisan con // prerender-seguro: <motivo> al final de su línea`);

console.log(`test-guardia-prerender: ok (guardia parcial; fixture: ${violaciones.length} violaciones, ${porSalto.length} por un salto; hook sin directiva marcado; Taller3D previo marcado; ${clientes.length} componentes cliente en src/ sin hallazgos)`);
