/**
 * Los turnos de la IA que ya se registraron en el servidor (POST sin nota, REQ-010): cada turno se registra UNA vez por pestaña
 * (el servidor también es idempotente por turno). Se guardan en sessionStorage para no repetirlo al recargar, y los registros
 * salen de uno en uno con una pausa, para que una conversación larga restaurada no se acerque al tope de peticiones por minuto.
 */
const CLAVE = "feedback-ia:registrados";
const MAX_GUARDADOS = 400;
const PAUSA_POR_DEFECTO_MS = 150;

let vistos: Set<string> | null = null;
let cola: Promise<void> = Promise.resolve();
let pausaMs = PAUSA_POR_DEFECTO_MS;

function cargar(): Set<string> {
  if (vistos) return vistos;
  vistos = new Set();
  try {
    const crudo = window.sessionStorage.getItem(CLAVE);
    const lista: unknown = crudo ? JSON.parse(crudo) : [];
    if (Array.isArray(lista)) for (const x of lista) if (typeof x === "string") vistos.add(x);
  } catch {
    // Sin sessionStorage (modo privado, SSR): solo en memoria.
  }
  return vistos;
}

function guardar(): void {
  try {
    window.sessionStorage.setItem(CLAVE, JSON.stringify([...cargar()].slice(-MAX_GUARDADOS)));
  } catch {
    // Cuota o modo privado: se sigue en memoria.
  }
}

export const yaRegistrado = (clave: string): boolean => cargar().has(clave);

export function marcarRegistrado(clave: string): void {
  if (cargar().has(clave)) return;
  cargar().add(clave);
  guardar();
}

export function desmarcarRegistrado(clave: string): void {
  if (cargar().delete(clave)) guardar();
}

/** Pone el registro en la cola: una tarea a la vez, con una pausa entre una y otra. */
export function encolarRegistro(tarea: () => Promise<void>): Promise<void> {
  const pausa = () => (pausaMs > 0 ? new Promise<void>((r) => setTimeout(r, pausaMs)) : Promise.resolve());
  cola = cola.then(tarea, tarea).then(pausa, pausa);
  return cola;
}

/** Para las pruebas: vacía lo registrado y la pausa entre registros. */
export function reiniciarRegistros(pausa = PAUSA_POR_DEFECTO_MS): void {
  vistos = new Set();
  cola = Promise.resolve();
  pausaMs = pausa;
}
