import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * **Guardia PARCIAL del prerender (P-033).** Un `Date.now()` que se evalúa al pintar un componente cliente rompe el build
 * de producción (Next 16) o hace que el HTML del servidor y el del navegador no coincidan. Mira los archivos con
 * `"use client"` y marca, con su línea, lo que se evalúa al pintar:
 *  - `render`: en el cuerpo de un componente o de un hook (parámetros incluidos), sin entrar en funciones anidadas
 *    (efectos, manejadores de evento, callbacks), salvo las que React ejecuta al pintar: las de los iteradores
 *    (`.map`, `.filter`, `.reduce`…), las de props de render (`render={() => …}`, `{(x) => …}` como hijo) y las que no son
 *    `on*` ni `ref`;
 *  - `inicializador`: en un argumento de `useState`, `useReducer`, `useMemo` o `useRef` (lazy incluido), y la referencia
 *    sin llamar de `useState(Date.now)` también;
 *  - `modulo`: en el código de nivel de módulo, que se ejecuta al importar el archivo en el servidor.
 * Un salto de llamadas: si el render (o un inicializador) llama a una función con nombre, o le pasa su nombre a un hook
 * (`useMemo(ahora, [])`) —local o importada desde `@/` o una ruta relativa—, se revisa su cuerpo (también sus propios hooks) (parámetros por defecto incluidos) y el hallazgo señala la línea del helper y
 * la llamada que lo trajo (`via`).
 * Un hallazgo se da por revisado con un comentario `// prerender-seguro: <motivo>` al final de SU línea (no en una cadena,
 * no en la línea de arriba). Si el hallazgo está en un helper, el comentario va en la línea del helper.
 *
 * **Puntos ciegos (la guardia es parcial):**
 *  - Un solo salto: lo que llama un helper no se sigue.
 *  - Solo se resuelven funciones con nombre (declaración o variable con función) del mismo archivo o importadas por nombre.
 *    No: re-exportaciones (`export { x } from`), importaciones de espacio de nombres, `require`, ni funciones guardadas en
 *    props, contexto, objetos o variables que se llaman después.
 *  - Patrones fuera de la lista: `navigator.*`, `matchMedia`, `crypto.getRandomValues`, `Date()` sin `new`, `process.env`,
 *    `Intl` con la hora, cookies.
 *  - Un opt-out en la línea de la LLAMADA descarta ese salto (el revisor lo justifica donde está el contexto, p. ej. la rama
 *    `typeof window`). Un opt-out en una línea del helper solo vale para esa línea.
 *  - Las referencias sin llamar (`onClick={Math.random}`) solo se marcan como argumento de un inicializador.
 */

export const PATRONES_NO_DETERMINISTAS = ["Date.now()", "Math.random()", "new Date()", "performance.now()", "crypto.randomUUID()"] as const;
const REFERENCIAS_NO_DETERMINISTAS = ["Date.now", "Math.random", "performance.now", "crypto.randomUUID"] as const;
const OBJETOS_GLOBALES = ["window", "document"] as const;
const ALMACENAMIENTO = ["localStorage", "sessionStorage"] as const;
/** Qué argumentos de cada inicializador se evalúan al pintar. */
const INICIALIZADORES: ReadonlyMap<string, readonly number[]> = new Map([["useState", [0]], ["useReducer", [1, 2]], ["useMemo", [0]], ["useRef", [0]]]);
/** Métodos que ejecutan su callback en el mismo render. */
const ITERADORES = new Set(["map", "flatMap", "filter", "reduce", "reduceRight", "forEach", "find", "findIndex", "some", "every", "sort"]);
const SRC = fileURLToPath(new URL("../../src", import.meta.url));

export type Ambito = "render" | "inicializador" | "modulo";
export type Hallazgo = { archivo: string; linea: number; patron: string; ambito: Ambito; texto: string; via?: string };

type Contexto = { archivo: string; fuente: ts.SourceFile };
type Escaneo = { ambito: Ambito; via?: string; saltarFunciones: boolean; resolver: boolean; salida: Map<string, Hallazgo> };

const archivosCargados = new Map<string, Contexto | null>();
const indicesDeFunciones = new WeakMap<ts.SourceFile, Map<string, ts.Node>>();

/** Si el archivo declara `"use client"` como primera directiva. */
export function esArchivoCliente(texto: string, archivo: string): boolean {
  return tieneDirectivaCliente(crearFuente(texto, archivo));
}

/** Todos los hallazgos del archivo (ninguno si no es de cliente), ordenados por línea. */
export function hallazgosDelArchivo(texto: string, archivo: string): Hallazgo[] {
  const ctx: Contexto = { archivo, fuente: crearFuente(texto, archivo) };
  if (!tieneDirectivaCliente(ctx.fuente)) return [];
  const salida = new Map<string, Hallazgo>();
  const explorar = (nodo: ts.Node): void => {
    if (ts.isFunctionLike(nodo) && esComponenteOHook(nodo)) {
      escanearCuerpo(nodo, ctx, { ambito: "render", saltarFunciones: true, resolver: true, salida });
    }
    if (esInicializador(nodo)) escanearInicializador(nodo, ctx, { ambito: "inicializador", saltarFunciones: false, resolver: true, salida });
    ts.forEachChild(nodo, explorar);
  };
  explorar(ctx.fuente);
  for (const sentencia of ctx.fuente.statements) {
    if (ts.isFunctionLike(sentencia) || ts.isClassDeclaration(sentencia)) continue;
    escanear(sentencia, ctx, { ambito: "modulo", saltarFunciones: true, resolver: true, salida });
  }
  return [...salida.values()].sort((a, b) => a.linea - b.linea);
}

/** `useState`, `React.useState`… : la llamada a un hook que guarda un valor inicial. */
function esInicializador(nodo: ts.Node): nodo is ts.CallExpression {
  return ts.isCallExpression(nodo) && INICIALIZADORES.has(nombreLlamado(nodo));
}

/** Los argumentos que el hook evalúa al pintar: una función en línea, una referencia sin llamar, o el nombre de una función. */
function escanearInicializador(llamada: ts.CallExpression, ctx: Contexto, esc: Escaneo): void {
  const deInicializador: Escaneo = { ...esc, ambito: "inicializador", saltarFunciones: false };
  for (const indice of INICIALIZADORES.get(nombreLlamado(llamada)) ?? []) {
    const argumento = llamada.arguments[indice];
    if (!argumento) continue;
    if (ts.isPropertyAccessExpression(argumento) && ts.isIdentifier(argumento.expression) && (REFERENCIAS_NO_DETERMINISTAS as readonly string[]).includes(`${argumento.expression.text}.${argumento.name.text}`)) {
      anotarPatron(`${argumento.expression.text}.${argumento.name.text} (sin llamar)`, argumento, ctx, deInicializador);
    }
    if (ts.isIdentifier(argumento) && esc.resolver) seguirFuncion(argumento.text, argumento, ctx, deInicializador);
    escanear(argumento, ctx, deInicializador);
  }
}

function escanearCuerpo(funcion: ts.Node, ctx: Contexto, esc: Escaneo): void {
  ts.forEachChild(funcion, (hijo) => escanear(hijo, ctx, esc));
}

function escanear(nodo: ts.Node, ctx: Contexto, esc: Escaneo): void {
  if (esc.saltarFunciones && ts.isFunctionLike(nodo) && !esCallbackDeRender(nodo)) return;
  const patron = patronDe(nodo);
  if (patron) anotarPatron(patron, nodo, ctx, esc);
  if (esInicializador(nodo)) escanearInicializador(nodo, ctx, esc);
  if (ts.isCallExpression(nodo) && esc.resolver && ts.isIdentifier(nodo.expression)) seguirFuncion(nodo.expression.text, nodo, ctx, esc);
  ts.forEachChild(nodo, (hijo) => escanear(hijo, ctx, esc));
}

/** Un salto: el cuerpo (parámetros y hooks incluidos) de la función con ese nombre, en su propio archivo y sin seguir más. */
function seguirFuncion(nombre: string, sitio: ts.Node, ctx: Contexto, esc: Escaneo): void {
  const linea = ctx.fuente.getLineAndCharacterOfPosition(sitio.getStart(ctx.fuente)).line;
  if (tieneOptOut(ctx, linea)) return;
  const destino = resolverFuncion(nombre, ctx);
  if (!destino) return;
  const via = `${nombre}() llamada en ${path.relative(SRC, ctx.archivo).split(path.sep).join("/")}:${linea + 1}`;
  escanearCuerpo(destino.nodo, destino.ctx, { ...esc, via, resolver: false, saltarFunciones: true });
}

function anotarPatron(patron: string, nodo: ts.Node, ctx: Contexto, esc: Escaneo): void {
  const inicio = nodo.getStart(ctx.fuente);
  const linea = ctx.fuente.getLineAndCharacterOfPosition(inicio).line;
  if (tieneOptOut(ctx, linea)) return;
  const clave = `${ctx.archivo}:${inicio}:${patron}:${esc.via ?? ""}`;
  if (esc.salida.has(clave)) return;
  esc.salida.set(clave, { archivo: ctx.archivo, linea: linea + 1, patron, ambito: esc.ambito, texto: lineaDe(ctx.fuente, linea), ...(esc.via ? { via: esc.via } : {}) });
}

/** Funciones que React (o un iterador) ejecuta durante el render: no las de `on*`, `ref` ni las de efectos o callbacks sueltos. */
function esCallbackDeRender(nodo: ts.Node): boolean {
  const padre = nodo.parent;
  if (ts.isCallExpression(padre) && padre.arguments.includes(nodo as ts.Expression) && ts.isPropertyAccessExpression(padre.expression) && ITERADORES.has(padre.expression.name.text)) return true;
  if (ts.isJsxExpression(padre)) {
    const contenedor = padre.parent;
    if (ts.isJsxAttribute(contenedor)) return !(ts.isIdentifier(contenedor.name) && (/^on[A-Z]/.test(contenedor.name.text) || contenedor.name.text === "ref"));
    return true;
  }
  return false;
}

function resolverFuncion(nombre: string, ctx: Contexto): { ctx: Contexto; nodo: ts.Node } | undefined {
  const local = indiceDe(ctx).get(nombre);
  if (local) return { ctx, nodo: local };
  const importado = importDe(ctx.fuente, nombre);
  if (!importado) return undefined;
  const archivo = resolverModulo(importado.modulo, ctx.archivo);
  const otro = archivo ? cargarContexto(archivo) : undefined;
  const nodo = otro ? indiceDe(otro).get(importado.original) : undefined;
  return otro && nodo ? { ctx: otro, nodo } : undefined;
}

/** Primera función con ese nombre en el archivo: declaración `function f`, o variable cuyo valor es una función. */
function indiceDe(ctx: Contexto): Map<string, ts.Node> {
  const existente = indicesDeFunciones.get(ctx.fuente);
  if (existente) return existente;
  const indice = new Map<string, ts.Node>();
  const visitar = (nodo: ts.Node): void => {
    if (ts.isFunctionDeclaration(nodo) && nodo.name && !indice.has(nodo.name.text)) indice.set(nodo.name.text, nodo);
    if (ts.isVariableDeclaration(nodo) && ts.isIdentifier(nodo.name) && nodo.initializer && ts.isFunctionLike(nodo.initializer) && !indice.has(nodo.name.text)) {
      indice.set(nodo.name.text, nodo.initializer);
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(ctx.fuente);
  indicesDeFunciones.set(ctx.fuente, indice);
  return indice;
}

function importDe(fuente: ts.SourceFile, nombre: string): { modulo: string; original: string } | undefined {
  for (const sentencia of fuente.statements) {
    if (!ts.isImportDeclaration(sentencia) || !ts.isStringLiteral(sentencia.moduleSpecifier)) continue;
    const enlaces = sentencia.importClause?.namedBindings;
    if (!enlaces || !ts.isNamedImports(enlaces)) continue;
    for (const elemento of enlaces.elements) {
      if (elemento.name.text === nombre) return { modulo: sentencia.moduleSpecifier.text, original: elemento.propertyName?.text ?? nombre };
    }
  }
  return undefined;
}

/** Solo alias `@/` (src) y rutas relativas: lo demás (paquetes) no se abre. */
function resolverModulo(especificador: string, desde: string): string | undefined {
  const base = especificador.startsWith("@/") ? path.join(SRC, especificador.slice(2)) : especificador.startsWith(".") ? path.resolve(path.dirname(desde), especificador) : undefined;
  if (!base) return undefined;
  const candidatos = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")];
  return candidatos.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
}

function cargarContexto(archivo: string): Contexto | undefined {
  if (!archivosCargados.has(archivo)) {
    const contexto = fs.existsSync(archivo) ? { archivo, fuente: crearFuente(fs.readFileSync(archivo, "utf8"), archivo) } : null;
    archivosCargados.set(archivo, contexto);
  }
  return archivosCargados.get(archivo) ?? undefined;
}

/**
 * Un opt-out vale si es un comentario `//` real al final de SU línea: el texto está después de código de la misma línea, no
 * dentro de una cadena, plantilla o texto JSX, y TypeScript lo reconoce como comentario final.
 */
function tieneOptOut(ctx: Contexto, linea: number): boolean {
  const { fuente } = ctx;
  const inicio = fuente.getPositionOfLineAndCharacter(linea, 0);
  for (const coincidencia of lineaDe(fuente, linea, true).matchAll(/\/\/\s*prerender-seguro:\s*\S/g)) {
    const posicion = inicio + (coincidencia.index ?? 0);
    if (!enLiteral(fuente, posicion) && esComentarioFinal(fuente.text, posicion)) return true;
  }
  return false;
}

/** Hay código antes del comentario en su misma línea, y TypeScript lo ve como comentario que empieza en `posicion`. */
function esComentarioFinal(texto: string, posicion: number): boolean {
  let fin = posicion;
  while (fin > 0 && (texto[fin - 1] === " " || texto[fin - 1] === "\t")) fin--;
  if (fin === 0 || texto[fin - 1] === "\n" || texto[fin - 1] === "\r") return false;
  return (ts.getTrailingCommentRanges(texto, fin) ?? []).some((comentario) => comentario.pos === posicion);
}

/** Si la posición cae dentro de un literal de texto (cadena, plantilla, texto JSX o expresión regular). */
function enLiteral(fuente: ts.SourceFile, posicion: number): boolean {
  let nodo: ts.Node = fuente;
  for (let bajando = true; bajando; ) {
    bajando = false;
    ts.forEachChild(nodo, (hijo) => {
      if (hijo.getStart(fuente) <= posicion && posicion < hijo.end) {
        nodo = hijo;
        bajando = true;
        return true;
      }
      return undefined;
    });
  }
  return ts.isStringLiteralLike(nodo) || ts.isJsxText(nodo) || ts.isRegularExpressionLiteral(nodo) || ts.isTemplateHead(nodo) || ts.isTemplateMiddle(nodo) || ts.isTemplateTail(nodo);
}

function crearFuente(texto: string, archivo: string): ts.SourceFile {
  const tipo = archivo.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.TSX;
  return ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true, tipo);
}

function tieneDirectivaCliente(fuente: ts.SourceFile): boolean {
  for (const sentencia of fuente.statements) {
    if (!ts.isExpressionStatement(sentencia) || !ts.isStringLiteral(sentencia.expression)) return false;
    if (sentencia.expression.text === "use client") return true;
  }
  return false;
}

/** Componente (nombre en mayúscula, o `export default`) o hook (`useX` / `usarX`): los dos se evalúan al pintar. */
function esComponenteOHook(nodo: ts.Node): boolean {
  if (!ts.isFunctionLike(nodo)) return false;
  const nombre = nombreDe(nodo);
  if (nombre === undefined) return false;
  return nombre === "default" || /^[A-Z]/.test(nombre) || /^(use|usar)[A-Z]/.test(nombre);
}

/** El nombre de una función: el propio, o el de la variable a la que se asigna (también a través de `memo(...)` y `forwardRef(...)`). */
function nombreDe(nodo: ts.SignatureDeclaration): string | undefined {
  if (ts.isFunctionDeclaration(nodo) && nodo.name) return nodo.name.text;
  if (ts.isFunctionDeclaration(nodo) && nodo.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) return "default";
  if (ts.isFunctionExpression(nodo) && nodo.name) return nodo.name.text;
  let actual: ts.Node = nodo;
  while (ts.isParenthesizedExpression(actual.parent) || (ts.isCallExpression(actual.parent) && /^(memo|forwardRef)$/.test(nombreLlamado(actual.parent)))) {
    actual = actual.parent;
  }
  const padre = actual.parent;
  if (ts.isVariableDeclaration(padre) && ts.isIdentifier(padre.name)) return padre.name.text;
  if (ts.isExportAssignment(padre)) return "default";
  return undefined;
}

function nombreLlamado(llamada: ts.CallExpression): string {
  const expresion = llamada.expression;
  if (ts.isIdentifier(expresion)) return expresion.text;
  if (ts.isPropertyAccessExpression(expresion)) return expresion.name.text;
  return "";
}

function patronDe(nodo: ts.Node): string | undefined {
  if (ts.isCallExpression(nodo) && ts.isPropertyAccessExpression(nodo.expression) && ts.isIdentifier(nodo.expression.expression)) {
    const patron = `${nodo.expression.expression.text}.${nodo.expression.name.text}()`;
    return (PATRONES_NO_DETERMINISTAS as readonly string[]).includes(patron) ? patron : undefined;
  }
  if (ts.isNewExpression(nodo) && ts.isIdentifier(nodo.expression) && nodo.expression.text === "Date" && (nodo.arguments?.length ?? 0) === 0) return "new Date()";
  if (ts.isPropertyAccessExpression(nodo) && ts.isIdentifier(nodo.expression) && (OBJETOS_GLOBALES as readonly string[]).includes(nodo.expression.text)) {
    return `${nodo.expression.text}.${nodo.name.text}`;
  }
  if (ts.isIdentifier(nodo) && (ALMACENAMIENTO as readonly string[]).includes(nodo.text) && !esNombreDePropiedad(nodo)) return nodo.text;
  return undefined;
}

function esNombreDePropiedad(identificador: ts.Identifier): boolean {
  const padre = identificador.parent;
  return (ts.isPropertyAccessExpression(padre) && padre.name === identificador) || (ts.isPropertyAssignment(padre) && padre.name === identificador);
}

function lineaDe(fuente: ts.SourceFile, linea: number, sinRecortar = false): string {
  const texto = fuente.text.split("\n")[linea] ?? "";
  return sinRecortar ? texto : texto.trim();
}
