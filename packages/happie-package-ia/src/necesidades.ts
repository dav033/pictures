import type { HappiaPackage } from "./tipos";

export interface NecesidadCurada {
  etiqueta: string;
  clave: string;
}

interface DefinicionNecesidad extends NecesidadCurada {
  categorias: string[];
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Categorías reales en `package_items.category_name` hoy: Bebidas, Comida,
 * Decoración. Mobiliario/Transporte/Entretenimiento no existen todavía en el
 * catálogo — se listan igual (con conteo real en 0) para capturar la
 * necesidad del cliente desde ya. No se usa para filtrar de forma dura: se
 * pasa como contexto estructurado al LLM (mismo enfoque que el tipo de
 * evento) para que razone si algún paquete lo cubre, en vez de descartar
 * todo por un campo de categoría que el catálogo aún no tiene.
 */
const DEFINICIONES: DefinicionNecesidad[] = [
  { etiqueta: "Comida", clave: "comida", categorias: ["comida"] },
  { etiqueta: "Bebidas", clave: "bebidas", categorias: ["bebidas"] },
  { etiqueta: "Decoración", clave: "decoracion", categorias: ["decoracion"] },
  { etiqueta: "Mobiliario", clave: "mobiliario", categorias: ["mobiliario"] },
  { etiqueta: "Transporte", clave: "transporte", categorias: ["transporte"] },
  { etiqueta: "Entretenimiento", clave: "entretenimiento", categorias: ["entretenimiento"] },
];

export function necesidadesCuradas(paquetes: HappiaPackage[]): (NecesidadCurada & { cantidad: number })[] {
  const activos = paquetes.filter((p) => p.is_active);
  return DEFINICIONES.map(({ etiqueta, clave, categorias }) => ({
    etiqueta,
    clave,
    cantidad: activos.filter((p) =>
      p.package_items.some((item) => item.category_name && categorias.includes(normalizar(item.category_name))),
    ).length,
  }));
}
