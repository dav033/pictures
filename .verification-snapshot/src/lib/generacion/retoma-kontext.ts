/**
 * Lo que el navegador recuerda de una imagen de Kontext que quedó en curso (contrato en `solicitud-kontext-contrato.ts`): el token para
 * retomarla y cuánto vale. Si una retoma falla por la red o por un 5xx, el token NO se pierde: el siguiente «Reintentar» retoma la
 * solicitud ya pagada en vez de enviar otra (pagar dos veces). Y si la pestaña se recarga durante la espera, el token sigue en
 * `sessionStorage` y la imagen se retoma en vez de pagarse otra vez.
 *
 * Del navegador, sin dependencias de servidor. `sessionStorage` solo se toca desde los manejadores y las funciones async que ellos
 * llaman (nunca al renderizar), siempre dentro de try/catch (modo privado, almacenamiento bloqueado, cuota): si no está, queda la
 * memoria de la pestaña.
 */

/** Cuánto vive el token en el servidor (`VIDA_SOLICITUD_KONTEXT_MS`, 15 min): el navegador lo suelta antes, para no mandar uno vencido. */
export const VIDA_TOKEN_EN_NAVEGADOR_MS = 13 * 60_000;
/** Cuántas veces se repite una retoma que falló por la red o por un 5xx antes de dar el error (el token se conserva). */
export const MAX_REINTENTOS_DE_RETOMA = 2;
/** La pausa antes de cada retoma y de cada repetición: una red que acaba de cortarse no se recupera al instante. */
export const PAUSA_ENTRE_RETOMAS_MS = 2_500;
export const CLAVE_ALMACEN_RETOMA = "retoma-kontext.v1";
const MAX_PENDIENTES = 20;

type Pendiente = { token: string; venceEn: number };
const pendientes = new Map<string, Pendiente>();

/** Un hash rápido (FNV-1a de 32 bits, en hex) de un texto largo, como el cuerpo de una petición con su captura: solo identifica la petición en este navegador; quien decide si el token sirve es el servidor. */
export function huellaRapida(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) h = Math.imul(h ^ texto.charCodeAt(i), 0x01000193);
  return `${(h >>> 0).toString(16).padStart(8, "0")}.${texto.length.toString(16)}`;
}

/** La clave de una imagen pedida: la ruta y la huella de SU cuerpo (plan, captura, aspecto…): otra vista u otro plan es otra clave y nunca recibe el token de la anterior. */
export const claveDeRetoma = (ruta: string, cuerpo: string): string => `${ruta}|${huellaRapida(cuerpo)}`;

function almacen(): Storage | null {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; }
}

function leerAlmacen(): Record<string, Pendiente> {
  try {
    const crudo = almacen()?.getItem(CLAVE_ALMACEN_RETOMA);
    const dato: unknown = crudo ? JSON.parse(crudo) : null;
    return dato && typeof dato === "object" && !Array.isArray(dato) ? (dato as Record<string, Pendiente>) : {};
  } catch {
    return {};
  }
}

function escribirAlmacen(): void {
  try { almacen()?.setItem(CLAVE_ALMACEN_RETOMA, JSON.stringify(Object.fromEntries(pendientes))); } catch { /* Sin almacenamiento queda la memoria de la pestaña. */ }
}

const vigente = (p: unknown, ahora: number): p is Pendiente =>
  typeof p === "object" && p !== null && typeof (p as Pendiente).token === "string" && typeof (p as Pendiente).venceEn === "number" && (p as Pendiente).venceEn > ahora;

/** Con la memoria vacía (pestaña recién recargada) trae lo guardado antes de escribir: si no, escribir uno borraría los demás. */
function hidratar(ahora: number): void {
  if (pendientes.size) return;
  for (const [clave, p] of Object.entries(leerAlmacen())) if (vigente(p, ahora)) pendientes.set(clave, p);
}

export function guardarTokenDeRetoma(clave: string, token: string, ahora = Date.now()): void {
  hidratar(ahora);
  pendientes.delete(clave);
  pendientes.set(clave, { token, venceEn: ahora + VIDA_TOKEN_EN_NAVEGADOR_MS });
  if (pendientes.size > MAX_PENDIENTES) pendientes.delete(pendientes.keys().next().value as string);
  escribirAlmacen();
}

/** El token vigente de una imagen en curso, o `undefined` (no hay, o ya venció). Tras una recarga lo trae de `sessionStorage`. */
export function tokenDeRetoma(clave: string, ahora = Date.now()): string | undefined {
  const enMemoria = pendientes.get(clave);
  if (enMemoria && vigente(enMemoria, ahora)) return enMemoria.token;
  if (enMemoria) { pendientes.delete(clave); escribirAlmacen(); }
  const guardado = leerAlmacen()[clave];
  if (!vigente(guardado, ahora)) return undefined;
  pendientes.set(clave, guardado);
  return guardado.token;
}

export function soltarTokenDeRetoma(clave: string): void {
  hidratar(Date.now());
  pendientes.delete(clave);
  escribirAlmacen();
}

/** Solo para las pruebas: vacía la memoria (como una pestaña recién abierta) sin tocar `sessionStorage`. */
export const olvidarMemoriaDeRetoma = (): void => { pendientes.clear(); };
