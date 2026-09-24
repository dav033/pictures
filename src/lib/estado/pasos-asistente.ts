/**
 * Pasos en vivo del asistente (maqueta ChatNormal): cada evento SSE
 * `herramienta` se traduce a una frase de cliente, sin nombres técnicos.
 * Las herramientas existentes están en src/lib/ia/herramientas/registro-herramientas.ts.
 */
export type EstadoPaso = "en_curso" | "listo" | "fallido";
export type PasoAsistente = { id: string; texto: string; estado: EstadoPaso };

const FRASES: Readonly<Record<string, Record<EstadoPaso, string>>> = {
  guardar_brief: { en_curso: "Entendiendo tu idea", listo: "Entendí tu idea", fallido: "No pude guardar tu idea" },
  buscar_catalogo_rag: { en_curso: "Buscando globos en el catálogo", listo: "Busqué globos disponibles en el catálogo", fallido: "No pude buscar en el catálogo" },
  confirmar_seleccion_rag: { en_curso: "Confirmando los globos elegidos", listo: "Confirmé los globos elegidos", fallido: "No pude confirmar los globos elegidos" },
  confirmar_plan_decoracion: { en_curso: "Armando la propuesta con medidas y cantidades", listo: "Armé la propuesta con medidas y cantidades", fallido: "No pude armar la propuesta" },
};

const FRASE_DESCONOCIDA: Record<EstadoPaso, string> = { en_curso: "Trabajando en tu propuesta", listo: "Avancé con tu propuesta", fallido: "No pude avanzar con tu propuesta" };

export function textoPaso(nombreHerramienta: string, estado: EstadoPaso): string {
  return (FRASES[nombreHerramienta] ?? FRASE_DESCONOCIDA)[estado];
}

/**
 * Aplica un evento `herramienta` a la lista de pasos del turno. Una
 * herramienta que vuelve a ejecutarse (el agente reintenta o busca otra vez)
 * reabre su paso en vez de duplicarlo; el orden es el de la primera aparición.
 */
export function aplicarEventoHerramienta(
  pasos: readonly PasoAsistente[],
  nombre: string,
  estado: "ejecutando" | "lista",
  ok?: boolean,
): PasoAsistente[] {
  // `lista` solo dice que la herramienta dejó de ejecutarse. Sin mirar `ok`, un
  // resultado fallido se pintaba igual que uno correcto.
  const estadoPaso: EstadoPaso = estado === "ejecutando" ? "en_curso" : ok === false ? "fallido" : "listo";
  const paso: PasoAsistente = { id: nombre, texto: textoPaso(nombre, estadoPaso), estado: estadoPaso };
  const indice = pasos.findIndex((actual) => actual.id === nombre);
  if (indice < 0) return [...pasos, paso];
  const copia = [...pasos];
  copia[indice] = paso;
  return copia;
}

/**
 * Al terminar el turno ningún paso queda girando, aunque faltara su evento
 * `lista`. Un paso que ya falló conserva su estado: cerrarlo en verde seria
 * fabricar un exito que no ocurrió.
 */
export function cerrarPasos(pasos: readonly PasoAsistente[]): PasoAsistente[] {
  return pasos.map((paso) => paso.estado === "en_curso" ? { ...paso, estado: "listo" as const, texto: textoPaso(paso.id, "listo") } : paso);
}
