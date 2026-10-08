import { TABLA_SEMPERTEX, referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { FAMILIAS_POR_PALABRA, codigosDePedido, palabras, plegar } from "./herramientas-escena-colores";
import { PARTES_DECORACIONES } from "./partes-decoraciones";
import type { SelectorGlobos } from "./partes-globos";
import type { TipoPieza } from "./piezas";
import {
  FAMILIAS_FORMATO, FORMATOS_CON_NOMBRE, INTENSIFICADORES, NUMEROS_CON_FORMATO, PARTES_TALLER, PULGADAS, RELLENO_ENTRE, TALLAS_REDONDO, TAMANOS,
  TECNICAS_TALLER, TIPOS_TALLER, UNIDADES, VACIAS_GLOSARIO, type ClaseTermino, type EntradaGlosario,
} from "./glosario-taller-datos";

export type { ClaseTermino, EntradaGlosario } from "./glosario-taller-datos";

/**
 * **Glosario del taller**: traduce lo que dice el decorador («los link-o-loon de las ramas», «los globos de 24 azules»,
 * «los tubitos del moño», «las perlitas doradas») a lo que entiende el taller: formatos («LOL-*», «R-24»), partes de
 * pieza («ramas», «hojas»), tipos de pieza, técnicas y colores (con el resolvedor de `herramientas-escena-colores.ts`),
 * más un `SelectorGlobos` listo (ver `partes-globos.ts`). Determinista y sin red: tolera tildes, mayúsculas, guiones,
 * «r24»/«R 24»/«24"», plurales y las faltas comunes. Lo usan `buscar_en_escena` y el prompt de la IA de escena
 * (`prompt-escena.ts`); los datos están en `glosario-taller-datos.ts`.
 */

// ----------------------------------------------------------------------------------------------------------
// PUNTO DE EXTENSIÓN: partes que declaran los módulos que etiquetan las piezas
// ----------------------------------------------------------------------------------------------------------

/**
 * Lo que exporta un módulo de etiquetado por cada parte: su nombre tal como va en `parte` («copa/frutas») o un
 * objeto con ese nombre (en `parte` o `id`), cómo se muestra y sus sinónimos.
 */
export type ParteDeclarada = string | { parte?: string; id?: string; nombre?: string; sinonimos?: readonly string[] };

/**
 * Las listas de partes de los módulos que etiquetan decoraciones y estructuras: UNA LÍNEA POR MÓDULO, p. ej.
 *   import { PARTES_DECORACIONES } from "./partes-decoraciones";   y aquí:   PARTES_DECORACIONES,
 *   import { PARTES_ESTRUCTURAS } from "./partes-estructuras";     y aquí:   PARTES_ESTRUCTURAS,
 * (si un módulo exporta un Record, va `Object.keys(X)` o `Object.values(X)`). Una parte que ya está suma sus
 * sinónimos; una nueva entra con su nombre, su nombre visible y sus sinónimos.
 */
/** «globo» es la parte del globo suelto: como término diría «cualquier globo» y filtraría mal («los globos de la flor»). */
const PARTES_AMBIGUAS = new Set(["globo"]);

/** «petalos/interior» → «petalos interiores», «patas/delantera» → «patas delanteras»: cómo lo dice el dueño. */
function plurales(parte: string): string[] {
  const nivel = parte.split("/");
  if (nivel.length < 2) return [];
  const ultimo = nivel[nivel.length - 1];
  const plural = /[aeiou]$/.test(ultimo) ? `${ultimo}s` : /s$/.test(ultimo) ? ultimo : `${ultimo}es`;
  return plural === ultimo ? [] : [[...nivel.slice(0, -1), plural].join(" ")];
}

const PARTES_DE_MODULOS: ReadonlyArray<readonly ParteDeclarada[]> = [
  PARTES_DECORACIONES.filter((p) => !PARTES_AMBIGUAS.has(p.nombre)).map((p) => ({ parte: p.nombre, sinonimos: [...p.ingles, ...plurales(p.nombre)] })),
  // PARTES_ESTRUCTURAS,
];

// ----------------------------------------------------------------------------------------------------------
// Normalización y glosario compilado
// ----------------------------------------------------------------------------------------------------------

/** Texto a tokens comparables: sin tildes, minúsculas, «24"» → «24 pulgadas», «r24» → «r 24», «link-o-loon» → «link o loon». */
export function normalizarTexto(texto: string): string {
  return plegar(texto)
    .replace(/(\d)\s*(?:"|”|“|''|pulg(?:adas?|s)?\b\.?|in(?:ch(?:es)?)?\b)/g, "$1 pulgadas ")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();
}
const tokens = (texto: string) => normalizarTexto(texto).split(" ").filter(Boolean);

type TerminoCompilado = { entrada: EntradaGlosario; tokens: string[]; soloConNumero: boolean };
export type Glosario = { entradas: readonly EntradaGlosario[]; terminos: readonly TerminoCompilado[] };

const nombreParte = (p: Exclude<ParteDeclarada, string>) => (p.parte ?? p.id ?? "").trim().toLowerCase();

/** Suma las partes declaradas por los módulos de etiquetado a las de base (sin repetir). */
export function partesConDeclaradas(base: readonly EntradaGlosario[], declaradas: ReadonlyArray<readonly ParteDeclarada[]>): EntradaGlosario[] {
  const salida = base.map((e) => ({ ...e, terminos: [...e.terminos] }));
  for (const lista of declaradas) {
    for (const d of lista) {
      const canon = typeof d === "string" ? d.trim().toLowerCase() : nombreParte(d);
      if (!canon) continue;
      const extra = typeof d === "string" ? [] : [...(d.nombre ? [d.nombre] : []), ...(d.sinonimos ?? [])];
      const existente = salida.find((e) => e.canon === canon);
      const propios = [canon.replace(/[/_]/g, " "), ...extra];
      if (existente) { for (const t of propios) if (!existente.terminos.includes(t)) existente.terminos.push(t); continue; }
      salida.push({ clase: "parte", canon, nombre: typeof d === "string" ? canon.replace(/\//g, " / ") : d.nombre ?? canon, terminos: propios });
    }
  }
  return salida;
}

/** Compila el glosario (términos normalizados, del más largo al más corto). */
export function construirGlosario(declaradas: ReadonlyArray<readonly ParteDeclarada[]> = PARTES_DE_MODULOS): Glosario {
  const entradas = [...FORMATOS_CON_NOMBRE, ...FAMILIAS_FORMATO, ...TAMANOS, ...TECNICAS_TALLER, ...TIPOS_TALLER, ...partesConDeclaradas(PARTES_TALLER, declaradas)];
  const terminos: TerminoCompilado[] = [];
  for (const entrada of entradas) {
    const soloNumero = new Set((entrada.requiereNumero ?? []).map(normalizarTexto));
    for (const t of entrada.terminos) {
      const norm = normalizarTexto(t);
      if (norm) terminos.push({ entrada, tokens: norm.split(" "), soloConNumero: soloNumero.has(norm) });
    }
  }
  // Más palabras primero («columna orgánica» antes que «columna»); a igual largo, el orden de las entradas.
  terminos.sort((a, b) => b.tokens.length - a.tokens.length);
  return { entradas, terminos };
}

export const GLOSARIO: Glosario = construirGlosario();

// ----------------------------------------------------------------------------------------------------------
// Faltas de ortografía: distancia de edición con transposición
// ----------------------------------------------------------------------------------------------------------

function distancia(a: string, b: string, tope: number): number {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + costo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

/** Palabras de la tabla de colores (y sus variantes): nunca se «corrigen» hacia un término del glosario. */
const PALABRAS_COLOR: ReadonlySet<string> = new Set(TABLA_SEMPERTEX.referencias.flatMap((r) => palabras(r.nombre)));
const MODIFICADORES_COLOR: ReadonlySet<string> = new Set([...Object.keys(FAMILIAS_POR_PALABRA), "cristal", "claro", "clara", "oscuro", "oscura", "bebe", "pastel"]);
const NO_NUCLEO = new Set(["te", "rey", "palo", "profundo", "imperial", "tropical", "primaveral", "aurora", "galaxy", "medianoche", "artico", "caribe"]);
const esColorPalabra = (t: string) => PALABRAS_COLOR.has(palabras(t)[0] ?? t);

/** ¿El token del texto es el del término? Igual, o con una falta (dos desde 9 letras) si el término tiene 7 o más. */
function igualA(token: string, termino: string): boolean {
  if (token === termino) return true;
  if (termino.length < 7 || /\d/.test(token) || VACIAS_GLOSARIO.has(token) || esColorPalabra(token) || MODIFICADORES_COLOR.has(token)) return false;
  return distancia(token, termino, 2) <= (termino.length >= 9 ? 2 : 1);
}

// ----------------------------------------------------------------------------------------------------------
// Interpretar
// ----------------------------------------------------------------------------------------------------------

export type ColorNombrado = { pedido: string; codigos: string[] };
export type TerminoHallado = { texto: string; clase: ClaseTermino | "color"; canon: string };

export type Interpretacion = {
  /** Formatos exactos («R-24») o familias («LOL-*»); si hay uno exacto de una familia, la familia sobra. */
  formatos: string[];
  /** Partes canónicas («ramas», «hojas», «pata/izquierda»). */
  partes: string[];
  /** Tipos de pieza del taller a los que se refiere («columna», «arbol_globos»…). */
  tipos: TipoPieza[];
  tecnicas: string[];
  /** Colores nombrados como filtro («los azules», «el rosado»), con los códigos que encajan. */
  colores: ColorNombrado[];
  /** Colores nombrados como destino («a dorado», «por azul», «en blanco»): el color NUEVO, no un filtro. */
  coloresDestino: ColorNombrado[];
  /** Palabras que no son del glosario ni vacías (para buscar por el nombre de la pieza). */
  resto: string[];
  terminos: TerminoHallado[];
  notas: string[];
  /** Formatos, partes y colores-filtro juntos (lo que se le pasa a `coincide`). */
  selector: SelectorGlobos;
};

const ANTES_DE_DESTINO = new Set(["a", "al", "por", "en", "hacia", "to", "into"]);
const ARTICULOS = new Set(["el", "la", "los", "las", "un", "una", "color", "tono", "globos", "globo"]);
const FOLLAJE = [["flores", "de", "tela"], ["flores", "artificiales"], ["flor", "artificial"], ["follaje"], ["hojas", "de", "tela"]];

const unico = <T>(lista: T[], x: T) => { if (!lista.includes(x)) lista.push(x); };

/** Lo que dice el texto, en términos del taller. Determinista y sin red. */
export function interpretarTerminos(texto: string, glosario: Glosario = GLOSARIO): Interpretacion {
  const t = tokens(texto);
  const usado = t.map(() => false);
  const r: Interpretacion = { formatos: [], partes: [], tipos: [], tecnicas: [], colores: [], coloresDestino: [], resto: [], terminos: [], notas: [], selector: {} };
  const esNumero = (i: number) => /^\d+$/.test(t[i] ?? "");
  const anotar = (desde: number, hasta: number, clase: TerminoHallado["clase"], canon: string) => {
    for (let k = desde; k < hasta; k++) usado[k] = true;
    r.terminos.push({ texto: t.slice(desde, hasta).join(" "), clase, canon });
  };

  // Follaje (flores y hojas de tela): no son globos, solo se avisa.
  for (const frase of FOLLAJE) {
    for (let i = 0; i + frase.length <= t.length; i++) {
      if (frase.every((p, k) => t[i + k] === p && !usado[i + k])) {
        for (let k = 0; k < frase.length; k++) usado[i + k] = true;
        unico(r.notas, `«${frase.join(" ")}» es follaje de tela (no son globos): va en flores/follaje de la pieza`);
      }
    }
  }

  // 1) Términos del glosario, de izquierda a derecha y el más largo primero.
  for (let i = 0; i < t.length; i++) {
    if (usado[i]) continue;
    const hallado = glosario.terminos.find((term) => term.tokens.every((tok, k) => i + k < t.length && !usado[i + k] && igualA(t[i + k]!, tok))
      && (!term.soloConNumero || esNumero(i + term.tokens.length))
      && !(term.entrada.clase === "tamano" && term.tokens.length === 1 && INTENSIFICADORES.has(t[i - 1] ?? "")));
    if (!hallado) continue;
    const e = hallado.entrada, fin = i + hallado.tokens.length;
    anotar(i, fin, e.clase, e.canon);
    if (e.clase === "formato") {
      const exactos = e.tallas ? tallasDetras(t, usado, fin, e.tallas) : [];
      if (exactos.length) {
        for (const x of exactos) { unico(r.formatos, x.formato); r.terminos.push({ texto: t[x.indice]!, clase: "formato", canon: x.formato }); }
        unico(r.notas, `«${t.slice(i, fin).join(" ")} ${exactos.map((x) => t[x.indice]).join(" y ")}» → ${exactos.map((x) => x.formato).join(", ")}`);
      } else {
        for (const f of e.formatos ?? [e.canon]) unico(r.formatos, f);
        if (!hallado.soloConNumero) unico(r.notas, `«${t.slice(i, fin).join(" ")}» → ${(e.formatos ?? [e.canon]).join(", ")} (${e.nombre})`);
      }
    } else if (e.clase === "tamano") {
      for (const f of e.formatos ?? []) unico(r.formatos, f);
      unico(r.notas, `«${t.slice(i, fin).join(" ")}» = ${e.nombre}: ${(e.formatos ?? []).join(", ")} (si la pieza no los tiene, son sus globos más ${e.canon === "chicos" || e.canon === "chiquitos" ? "chicos" : e.canon === "medianos" ? "medianos" : "grandes"})`);
    } else if (e.clase === "tecnica") unico(r.tecnicas, e.canon);
    else if (e.clase === "tipo") for (const x of e.tipos ?? []) unico(r.tipos, x);
    else unico(r.partes, e.canon);
    i = fin - 1;
  }

  // 2) Números sueltos: «260» es T-260; «de 24» o «24 pulgadas» es R-24 (pero no «de 24 globos» ni «de 12 cm»).
  for (let i = 0; i < t.length; i++) {
    if (usado[i] || !esNumero(i)) continue;
    const n = t[i]!, antes = t[i - 1] ?? "", despues = t[i + 1] ?? "";
    const conFormato = NUMEROS_CON_FORMATO[n];
    if (conFormato) { anotar(i, i + 1, "formato", conFormato); unico(r.formatos, conFormato); unico(r.notas, `«${n}» → ${conFormato}`); continue; }
    const enPulgadas = PULGADAS.has(despues);
    const redondo = TALLAS_REDONDO[n];
    if (redondo && (enPulgadas || (antes === "de" && !UNIDADES.has(despues)))) {
      anotar(i, enPulgadas ? i + 2 : i + 1, "formato", redondo);
      unico(r.formatos, redondo);
      unico(r.notas, `«${antes === "de" ? "de " : ""}${n}${enPulgadas ? " pulgadas" : ""}» → ${redondo}`);
    } else if (!redondo && enPulgadas) {
      const cercano = Object.keys(TALLAS_REDONDO).map(Number).sort((a, b) => Math.abs(a - Number(n)) - Math.abs(b - Number(n)))[0];
      unico(r.notas, `no hay redondo de ${n} pulgadas: el más cercano es R-${cercano}`);
    }
  }

  // Si hay un formato exacto de una familia, la familia sobra («los link-o-loon, los de 12» → LOL-12).
  r.formatos = r.formatos.filter((f) => !f.endsWith("*") || !r.formatos.some((g) => g !== f && !g.endsWith("*") && g.startsWith(f.slice(0, -1))));

  // 3) Colores en lo que queda (código de 3 cifras o palabras de la tabla con su acabado).
  colores(t, usado, r);

  r.resto = t.filter((x, i) => !usado[i] && x.length >= 3 && !/^\d+$/.test(x) && !VACIAS_GLOSARIO.has(x) && !UNIDADES.has(x) && !PULGADAS.has(x));
  const codigos = [...new Set(r.colores.flatMap((c) => c.codigos))];
  r.selector = { ...(r.formatos.length ? { formatos: [...r.formatos] } : {}), ...(r.partes.length ? { partes: [...r.partes] } : {}), ...(codigos.length ? { colores: codigos } : {}) };
  return r;
}

/** Los números que siguen a una familia («de 12», «6 y 12», «número 260») y valen en ella. */
function tallasDetras(t: readonly string[], usado: boolean[], desde: number, tallas: Readonly<Record<string, string>>): Array<{ formato: string; indice: number }> {
  const salida: Array<{ formato: string; indice: number }> = [];
  let k = desde;
  for (;;) {
    let j = k;
    while (j < t.length && !usado[j] && RELLENO_ENTRE.has(t[j]!)) j++;
    const formato = tallas[t[j] ?? ""];
    if (!formato || usado[j] || UNIDADES.has(t[j + 1] ?? "")) break;
    salida.push({ formato, indice: j });
    for (let x = k; x <= j; x++) usado[x] = true;
    k = j + 1;
    if (PULGADAS.has(t[k] ?? "")) { usado[k] = true; k++; }
    if (!["y", "o", "e"].includes(t[k] ?? "")) break;
    const siguiente = t.slice(k + 1).find((x) => !RELLENO_ENTRE.has(x));
    if (!siguiente || !tallas[siguiente]) break;
    usado[k] = true;
    k += 1;
  }
  return salida;
}

/** Busca colores en los tokens libres: códigos de 3 cifras de la tabla y corridas de palabras de color con su acabado. */
function colores(t: readonly string[], usado: boolean[], r: Interpretacion) {
  const destino = (i: number) => {
    let k = i - 1;
    while (k >= 0 && ARTICULOS.has(t[k]!)) k--;
    return k >= 0 && ANTES_DE_DESTINO.has(t[k]!);
  };
  const poner = (pedido: string, codigos: string[], i: number) => {
    const lista = destino(i) ? r.coloresDestino : r.colores;
    if (!lista.some((c) => c.pedido === pedido)) lista.push({ pedido, codigos });
    r.terminos.push({ texto: pedido, clase: "color", canon: codigos.join("/") });
  };
  const deColor = (x: string) => esColorPalabra(x) || MODIFICADORES_COLOR.has(x);
  for (let i = 0; i < t.length; i++) {
    if (usado[i]) continue;
    const x = t[i]!;
    if (/^\d{3}$/.test(x)) {
      if (referenciaPorCodigo(x)) { usado[i] = true; poner(x, [x], i); }
      continue;
    }
    const base = palabras(x)[0] ?? x;
    if (!PALABRAS_COLOR.has(base) || NO_NUCLEO.has(base)) continue;
    // La corrida: palabras de color o de acabado seguidas (con «de» en medio: «palo de rosa»).
    let a = i, b = i + 1;
    while (a > 0 && !usado[a - 1] && deColor(t[a - 1]!)) a--;
    while (b < t.length && !usado[b] && (deColor(t[b]!) || (t[b] === "de" && deColor(t[b + 1] ?? "") && !usado[b + 1]))) b++;
    const corrida = t.slice(a, b).join(" ");
    let codigos = codigosDePedido(corrida);
    let pedido = corrida, desde = a, hasta = b;
    if (!codigos.length) {
      // «rojo verde»: no es un color; cada núcleo con sus acabados.
      const acabados = t.slice(a, b).filter((p) => MODIFICADORES_COLOR.has(p));
      pedido = [x, ...acabados].join(" ");
      codigos = codigosDePedido(pedido);
      desde = i; hasta = i + 1;
      if (!codigos.length) { pedido = x; codigos = codigosDePedido(x); }
    }
    if (!codigos.length) continue;
    for (let k = desde; k < hasta; k++) usado[k] = true;
    if (desde === i) for (let k = a; k < b; k++) if (MODIFICADORES_COLOR.has(t[k]!)) usado[k] = true;
    poner(pedido, codigos, desde);
    i = hasta - 1;
  }
}

// ----------------------------------------------------------------------------------------------------------
// Para el prompt
// ----------------------------------------------------------------------------------------------------------

/** Hasta `n` términos de una entrada, sin repetir plurales ni femeninos («tubito», no «tubitos» ni «tuvitos»). */
function muestra(e: EntradaGlosario, n: number): string {
  if (e.muestra) return e.muestra.join(" / ");
  const raiz = (x: string) => normalizarTexto(x).split(" ").map((p) => p.replace(/(es|s)$/, "").replace(/[aoe]$/, "").replace(/v/g, "b")).join(" ");
  const vistas = new Set<string>(), salida: string[] = [];
  for (const x of e.terminos) {
    const k = raiz(x);
    if (x.length < 2 || vistas.has(k) || salida.length >= n) continue;
    vistas.add(k);
    salida.push(x);
  }
  return salida.join(" / ");
}

/** El vocabulario del taller en pocas líneas, para el sistema de la IA de escena. */
export function vocabularioParaPrompt(glosario: Glosario = GLOSARIO): string {
  const de = (clase: ClaseTermino) => glosario.entradas.filter((e) => e.clase === clase);
  const familias = de("formato").filter((e) => e.tallas).map((e) => `${muestra(e, 6)} = ${e.canon} (${Object.values(e.tallas ?? {}).join(", ")})`);
  const conNombre = de("formato").filter((e) => !e.tallas).map((e) => `${muestra(e, 2)} = ${e.canon}`);
  return [
    "VOCABULARIO DEL TALLER (lo que dice el decorador → lo que es; buscar_en_escena lo traduce solo):",
    `- Formatos: ${[...familias, ...conNombre].join("; ")}. «R-24», «r24», «de 24», «24 pulgadas» = R-24; «260» = T-260; «660» = LOL-660.`,
    `- Tamaños de redondo: ${de("tamano").map((e) => `${muestra(e, 3)} = ${(e.formatos ?? []).join(", ")}`).join("; ")}. Si la pieza no tiene esos, son sus globos más grandes (o más chicos).`,
    `- Técnicas: ${de("tecnica").map((e) => e.nombre).join(", ")}.`,
    `- Piezas: ${de("tipo").map((e) => `${muestra(e, 2)} = ${(e.tipos ?? []).join("/")}`).join("; ")}.`,
    `- Partes de una pieza (cada globo dice de cuál es; ver_pieza las lista): ${de("parte").map((e) => e.nombre).join(", ")}.`,
  ].join("\n");
}
