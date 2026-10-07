import { z } from "zod";

/**
 * Los dibujos del motor que pide «Tu plan» (`GraficaMotorGuiada`): UNO por pieza y versión del plan, compartido por
 * todos los componentes que lo muestran, con pocos a la vez y sin cancelar los que ya van en camino. Sin React.
 *
 * Por qué existe (probador, 2026-10-06): la gráfica pedía el dibujo en un efecto que dependía del plan y de la pieza
 * por referencia y lo abortaba al volver a correr. Cada turno del chat (y el doble montaje de desarrollo) remontaba
 * las tarjetas: 19 POST a `/api/plan-armado-columna-organica` para dos columnas, 9 de ellos cancelados (499), y 17
 * respuestas 400 «El cuerpo de la solicitud no es JSON válido», que son peticiones abortadas antes de mandar su
 * cuerpo (llegan sin cuerpo y responden en 2-6 ms). El Python respondía `motor_ocupado` y «Modificar pieza» mostraba
 * «Hay mucha demanda». Ahora:
 *  - la clave es estable (versión del plan + pieza + armado + tonos + mezcla): el mismo dibujo no se pide dos veces;
 *  - una petición en curso nunca se aborta: quien se desmonta deja de escuchar y el resultado queda en la caché;
 *  - a lo sumo `MAX_EN_VUELO` a la vez; las que esperan salen de la más reciente a la más vieja (el plan que se acaba
 *    de pintar, abajo en la conversación, antes que las versiones anteriores);
 *  - un fallo pasajero (429, 5xx, red) se recuerda poco tiempo (`ESPERA_TRAS_FALLO_MS`): no se reintenta en cada
 *    render, pero sí más tarde; uno permanente (4xx, dibujo que no pasa el esquema) no se vuelve a pedir.
 */

/**
 * El SVG del motor y su lienzo. El de la columna clásica trae `lienzo: { ancho, alto }` (600 × 720) y los demás un
 * número (cuadrado) o `ancho`/`alto` sueltos: antes solo se aceptaba el número y las columnas de «Tu plan» caían
 * siempre al icono. Se normaliza a `lienzo` (ancho) + `alto`.
 */
export const GraficaMotorSchema = z.object({
  svg: z.string().min(1),
  lienzo: z.union([z.number().positive(), z.object({ ancho: z.number().positive(), alto: z.number().positive() }).passthrough()]).optional(),
  ancho: z.number().positive().optional(),
  alto: z.number().positive().optional(),
}).passthrough().transform(({ lienzo, ...resto }) => (typeof lienzo === "object"
  ? { ...resto, lienzo: lienzo.ancho, alto: resto.alto ?? lienzo.alto }
  : { ...resto, ...(lienzo === undefined ? {} : { lienzo }) }));

export type GraficaMotor = z.output<typeof GraficaMotorSchema>;

/** El motor corre en pocos trabajadores de CPU (y la ruta de la columna orgánica acepta 4 por proceso). */
export const MAX_EN_VUELO = 2;
const ESPERA_TRAS_FALLO_MS = 15_000;
const MAX_ENTRADAS = 48;

type Entrada = { promesa: Promise<GraficaMotor | null>; valor?: GraficaMotor | null; hasta?: number };

const cache = new Map<string, Entrada>();
const espera: Array<() => void> = [];
let enVuelo = 0;
/**
 * Las peticiones en camino por ruta + cuerpo exacto. Dos piezas pareja (columna izquierda y derecha) tienen claves
 * distintas pero, si su receta es la misma, el MISMO cuerpo: salían dos POST idénticos en el mismo milisegundo y el
 * motor respondía 429 a uno (verificador 127, producción 05:01:13.202 y .204, 3096 bytes). Ahora el segundo espera
 * la respuesta del primero.
 */
const enCaminoPorCuerpo = new Map<string, Promise<Resultado>>();

/** Mide cuántas peticiones salieron y cuántas se ahorraron por llevar el mismo cuerpo (pruebas y diagnóstico). */
export const contadores = { pedidas: 0, enVueloMaximo: 0, compartidas: 0 };

type Pedir = typeof fetch;
let pedirRed: Pedir = (...argumentos) => fetch(...argumentos);

/** Solo para pruebas: cambia la red y vacía la caché. */
export function reiniciarGraficasParaPruebas(red?: Pedir): void {
  cache.clear();
  espera.length = 0;
  enCaminoPorCuerpo.clear();
  enVuelo = 0;
  contadores.pedidas = 0;
  contadores.enVueloMaximo = 0;
  contadores.compartidas = 0;
  pedirRed = red ?? ((...argumentos) => fetch(...argumentos));
}

/** Huella corta y estable de un texto (FNV-1a de 32 bits, en base 36). */
export function huella(texto: string): string {
  let h = 0x811c9dc5;
  for (let indice = 0; indice < texto.length; indice += 1) {
    h ^= texto.charCodeAt(indice);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * La clave de un dibujo: la ruta del motor, la versión del plan (`plan_hash`), la pieza, su armado (o la receta), los
 * tonos con que se pinta y la mezcla real (que va fuera de lo que firma `plan_hash`).
 */
export function claveGrafica(partes: { ruta: string; version: string; estructuraId: string; armado?: unknown; tonos?: string; mezclaReal?: unknown }): string {
  const armado = partes.armado === undefined ? "-" : huella(JSON.stringify(partes.armado) ?? "null");
  const mezcla = partes.mezclaReal === undefined || partes.mezclaReal === null ? "-" : huella(JSON.stringify(partes.mezclaReal));
  return [partes.ruta, partes.version, partes.estructuraId, armado, partes.tonos ?? "", mezcla].join("|");
}

/** El dibujo ya resuelto (o el fallo reciente, `null`); `undefined` si hay que pedirlo o sigue en camino. */
export function graficaGuardada(clave: string, ahora = Date.now()): GraficaMotor | null | undefined {
  const entrada = cache.get(clave);
  if (!entrada || !("valor" in entrada)) return undefined;
  if (entrada.valor === null && entrada.hasta !== undefined && entrada.hasta <= ahora) return undefined;
  return entrada.valor;
}

/** El turno pasa directo a quien espera (sin soltarlo): así nadie se cuela entre medias y nunca hay más de MAX. */
function liberar(): void {
  // La más reciente primero: es la del plan que el cliente acaba de ver aparecer.
  const siguiente = espera.pop();
  if (siguiente) siguiente();
  else enVuelo -= 1;
}

async function conTurno<T>(trabajo: () => Promise<T>): Promise<T> {
  if (enVuelo >= MAX_EN_VUELO) await new Promise<void>((listo) => espera.push(listo));
  else enVuelo += 1;
  contadores.enVueloMaximo = Math.max(contadores.enVueloMaximo, enVuelo);
  try {
    return await trabajo();
  } finally {
    liberar();
  }
}

function esperar(ms: number): Promise<void> {
  return new Promise((listo) => setTimeout(listo, ms));
}

/**
 * Lo que dejó una petición. `reintentable`: el motor estaba ocupado, falló por dentro o no hubo red (se vuelve a
 * pedir pasado `ESPERA_TRAS_FALLO_MS`). Un 4xx o un dibujo que no pasa el esquema no cambian al repetir la misma
 * petición: se recuerdan para toda la sesión. Verificador (2026-10-06): las columnas clásicas respondían 200 con un
 * lienzo que el esquema no aceptaba, y se volvían a pedir cada ~20 s (≈30 POST en 5 min, varios 429 motor_ocupado).
 */
type Resultado = { grafica: GraficaMotor | null; reintentable: boolean };

/** Intentos de un dibujo mientras el motor responde 429 (ocupado): el primero y hasta tres más. */
export const INTENTOS_MOTOR_OCUPADO = 4;
const ESPERA_OCUPADO_TOPE_MS = 4_000;

/**
 * Cuánto esperar antes del intento `intento + 1` tras un 429: el `Retry-After` del servidor (o 1 s), doblado en cada
 * intento hasta 4 s, con ±25 % al azar para que dos pestañas no vuelvan a coincidir. Probador 141, I-7: con UNA sola
 * espera, tres sesiones a la vez dejaban el dibujo en su icono de fallo; ahora la pieza sigue «dibujándose» (el brillo
 * de carga, sin error) mientras espera turno.
 */
export function esperaTrasOcupado(intento: number, retryAfter: string | null, azar: () => number = Math.random): number {
  const segundos = Number(retryAfter);
  const base = Number.isFinite(segundos) && segundos > 0 ? Math.min(segundos, 5) * 1000 : 1000;
  const espera = Math.min(ESPERA_OCUPADO_TOPE_MS, base * 2 ** Math.max(0, intento));
  return Math.round(espera * (0.75 + 0.5 * Math.min(1, Math.max(0, azar()))));
}

async function pedirUna(ruta: string, cuerpo: string): Promise<Resultado> {
  for (let intento = 0; intento < INTENTOS_MOTOR_OCUPADO; intento += 1) {
    contadores.pedidas += 1;
    const respuesta = await pedirRed(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: cuerpo });
    // El motor atiende un dibujo a la vez (429 con `Retry-After`): se espera turno, cada vez un poco más, sin mostrar
    // ningún error (la gráfica sigue en «cargando»). Solo el último 429 cuenta como fallo pasajero.
    if (respuesta.status === 429 && intento < INTENTOS_MOTOR_OCUPADO - 1) {
      await esperar(esperaTrasOcupado(intento, respuesta.headers.get("retry-after")));
      continue;
    }
    if (!respuesta.ok) return { grafica: null, reintentable: respuesta.status === 429 || respuesta.status === 408 || respuesta.status >= 500 };
    const datos: unknown = await respuesta.json();
    if (typeof datos !== "object" || datos === null || !("grafica" in datos)) return { grafica: null, reintentable: false };
    const parseada = GraficaMotorSchema.safeParse(datos.grafica);
    return { grafica: parseada.success ? parseada.data : null, reintentable: false };
  }
  return { grafica: null, reintentable: true };
}

/** Una petición por ruta + cuerpo a la vez: si ya va en camino (o en cola) una idéntica, se espera su respuesta. */
function pedirCompartida(ruta: string, cuerpo: string): Promise<Resultado> {
  const llave = `${ruta}\n${cuerpo}`;
  const enCamino = enCaminoPorCuerpo.get(llave);
  if (enCamino) {
    contadores.compartidas += 1;
    return enCamino;
  }
  const promesa = conTurno(() => pedirUna(ruta, cuerpo)).finally(() => enCaminoPorCuerpo.delete(llave));
  enCaminoPorCuerpo.set(llave, promesa);
  return promesa;
}

function recortar(): void {
  while (cache.size > MAX_ENTRADAS) {
    const vieja = [...cache.entries()].find(([, entrada]) => "valor" in entrada)?.[0];
    if (vieja === undefined) return;
    cache.delete(vieja);
  }
}

/**
 * El dibujo de `clave`: el guardado, el que ya va en camino o uno nuevo (en cola). `cuerpo` solo se arma si de verdad
 * hay que pedirlo (y se arma ya, para reconocer otra pieza que pide exactamente lo mismo). Nunca lanza: un fallo es
 * `null`.
 */
export function pedirGrafica(clave: string, ruta: string, cuerpo: () => unknown): Promise<GraficaMotor | null> {
  const guardada = graficaGuardada(clave);
  if (guardada !== undefined) return Promise.resolve(guardada);
  const enCurso = cache.get(clave);
  if (enCurso && !("valor" in enCurso)) return enCurso.promesa;
  let texto: string | null;
  try {
    texto = JSON.stringify(cuerpo());
  } catch {
    texto = null;
  }
  const entrada: Entrada = {
    promesa: (texto === null ? Promise.reject<Resultado>(new Error("cuerpo sin JSON")) : pedirCompartida(ruta, texto))
      .catch((): Resultado => ({ grafica: null, reintentable: true }))
      .then(({ grafica: valor, reintentable }) => {
        // La entrada se reemplaza si mientras tanto alguien la borró: el resultado vale igual.
        entrada.valor = valor;
        // Solo un fallo pasajero caduca; uno permanente (4xx, esquema) queda como icono sin volver a pedirse.
        if (valor === null && reintentable) entrada.hasta = Date.now() + ESPERA_TRAS_FALLO_MS;
        cache.set(clave, entrada);
        recortar();
        return valor;
      }),
  };
  cache.set(clave, entrada);
  return entrada.promesa;
}
