import type { Categoria, Producto } from "./types";

export const NOMBRES_CATEGORIA: Record<Categoria, string> = {
  arco: "Arcos y altares",
  centro_mesa: "Centros de mesa",
  mobiliario: "Mobiliario",
  manteleria: "Mantelería",
  iluminacion: "Iluminación",
  flores: "Flores y follaje",
};

/** Semilla con la que se crea data/productos.json la primera vez que corre el demo. */
export const CATALOGO_SEED: Producto[] = [
  {
    id: "arc-001",
    nombre: "Arco circular de madera con pampas",
    categoria: "arco",
    estilos: ["boho", "rustico"],
    colores: ["tierra", "beige", "blanco"],
    descripcion:
      "arco circular de 2.4 m de madera clara sin tratar, decorado asimétricamente con plumas de pampa color crema, hojas de eucalipto seco y flor seca en tonos tierra",
    precio: 8500,
    emoji: "◍",
    tono: "#c8a882",
  },
  {
    id: "arc-002",
    nombre: "Arco triangular con follaje verde",
    categoria: "arco",
    estilos: ["minimalista", "rustico"],
    colores: ["verde", "blanco"],
    descripcion:
      "arco geométrico triangular de madera oscura de 2.5 m, con follaje verde denso de eucalipto y helecho concentrado en la esquina superior izquierda y flores blancas dispersas",
    precio: 7200,
    emoji: "△",
    tono: "#7a9471",
  },
  {
    id: "arc-003",
    nombre: "Arco clásico de flores blancas",
    categoria: "arco",
    estilos: ["clasico", "glamour"],
    colores: ["blanco", "dorado"],
    descripcion:
      "arco de medio punto cubierto por completo de rosas blancas, hortensias y peonías, con estructura dorada apenas visible entre las flores",
    precio: 14500,
    emoji: "⌒",
    tono: "#d9cbb3",
  },
  {
    id: "cen-001",
    nombre: "Centro bajo de eucalipto y velas",
    categoria: "centro_mesa",
    estilos: ["boho", "minimalista", "rustico"],
    colores: ["verde", "blanco"],
    descripcion:
      "centro de mesa bajo y alargado de ramas de eucalipto plateado tendidas sobre la mesa, con velas votivas en vasos de vidrio transparente de distintas alturas",
    precio: 780,
    emoji: "🕯",
    tono: "#8fa383",
  },
  {
    id: "cen-002",
    nombre: "Jarrón de barro con flor seca",
    categoria: "centro_mesa",
    estilos: ["boho", "rustico"],
    colores: ["tierra", "terracota", "beige"],
    descripcion:
      "jarrón de barro artesanal color terracota mate de 25 cm con arreglo de flor seca en tonos tierra, pampas pequeñas y espigas de trigo",
    precio: 640,
    emoji: "🏺",
    tono: "#b87351",
  },
  {
    id: "cen-003",
    nombre: "Centro alto de cristal con rosas",
    categoria: "centro_mesa",
    estilos: ["clasico", "glamour"],
    colores: ["blanco", "dorado", "rosa"],
    descripcion:
      "centro de mesa alto de 70 cm con copa de cristal sobre base dorada, coronado por un arreglo esférico de rosas blancas y rosa pálido con follaje colgante",
    precio: 1450,
    emoji: "🌹",
    tono: "#d8a7ac",
  },
  {
    id: "mob-001",
    nombre: "Silla cruzada de madera natural",
    categoria: "mobiliario",
    estilos: ["boho", "rustico", "minimalista"],
    colores: ["tierra", "beige"],
    descripcion:
      "silla de madera natural con respaldo cruzado en X y asiento de mimbre tejido color miel, estilo campestre europeo",
    precio: 145,
    emoji: "🪑",
    tono: "#bf9a6a",
  },
  {
    id: "mob-002",
    nombre: "Silla Tiffany dorada",
    categoria: "mobiliario",
    estilos: ["clasico", "glamour"],
    colores: ["dorado", "blanco"],
    descripcion:
      "silla Tiffany de estructura dorada brillante con cojín blanco acolchado, líneas finas y elegantes",
    precio: 180,
    emoji: "🪑",
    tono: "#c9a961",
  },
  {
    id: "mob-003",
    nombre: "Mesa imperial de madera rústica",
    categoria: "mobiliario",
    estilos: ["rustico", "boho"],
    colores: ["tierra", "cafe"],
    descripcion:
      "mesa imperial larga de 6 m de tablones de madera recuperada con vetas visibles y patas robustas, sin mantel",
    precio: 3200,
    emoji: "▬",
    tono: "#9c7550",
  },
  {
    id: "man-001",
    nombre: "Mantel de lino crudo",
    categoria: "manteleria",
    estilos: ["boho", "rustico", "minimalista"],
    colores: ["beige", "crudo", "blanco"],
    descripcion:
      "mantel de lino natural color crudo con textura visible y caída suave hasta el piso, con arrugas naturales del lino",
    precio: 320,
    emoji: "▢",
    tono: "#ddd2c0",
  },
  {
    id: "man-002",
    nombre: "Camino de mesa en gasa terracota",
    categoria: "manteleria",
    estilos: ["boho", "glamour"],
    colores: ["terracota", "tierra"],
    descripcion:
      "camino de mesa de gasa translúcida color terracota que recorre la mesa en ondas sueltas y cae por los extremos",
    precio: 210,
    emoji: "〰",
    tono: "#c26e4a",
  },
  {
    id: "ilu-001",
    nombre: "Serie de foquitos colgantes",
    categoria: "iluminacion",
    estilos: ["boho", "rustico", "clasico"],
    colores: ["dorado", "ambar"],
    descripcion:
      "guirnaldas de foquitos incandescentes cálidos colgando en líneas paralelas sobre el área de mesas, creando un techo de luz ámbar",
    precio: 2400,
    emoji: "✨",
    tono: "#e0b355",
  },
  {
    id: "ilu-002",
    nombre: "Faroles de piso de metal negro",
    categoria: "iluminacion",
    estilos: ["rustico", "minimalista"],
    colores: ["negro", "ambar"],
    descripcion:
      "faroles de piso de metal negro mate de distintas alturas, entre 40 y 90 cm, con vela gruesa encendida dentro",
    precio: 380,
    emoji: "🏮",
    tono: "#4a4744",
  },
  {
    id: "flo-001",
    nombre: "Camino de flores para pasillo",
    categoria: "flores",
    estilos: ["boho", "clasico", "rustico"],
    colores: ["blanco", "verde", "tierra"],
    descripcion:
      "camino de pétalos y arreglos florales bajos que bordea el pasillo central a ambos lados, con flores blancas y follaje verde",
    precio: 4200,
    emoji: "🌾",
    tono: "#a8b899",
  },
];

/** Pura: sin fs, se puede importar desde componentes de cliente o de servidor. */
export function filtrarProductos(
  lista: Producto[],
  filtros: {
    categorias?: string[];
    estilos?: string[];
    colores?: string[];
    presupuesto_max?: number;
  },
): Producto[] {
  const { categorias, estilos, colores, presupuesto_max } = filtros;

  const coincide = (p: Producto) => {
    if (categorias?.length && !categorias.includes(p.categoria)) return false;
    if (estilos?.length && !estilos.some((e) => p.estilos.includes(e))) return false;
    if (colores?.length && !colores.some((c) => p.colores.includes(c))) return false;
    if (presupuesto_max && p.precio > presupuesto_max) return false;
    return true;
  };

  const resultado = lista.filter(coincide);

  // Nunca devolvemos vacío en el demo: relajamos el color, que es el filtro más
  // restrictivo, antes que dejar al cliente sin opciones.
  if (resultado.length === 0 && colores?.length) {
    return filtrarProductos(lista, { ...filtros, colores: undefined });
  }

  return resultado;
}

export function seleccionarProductos(lista: Producto[], ids: string[]): Producto[] {
  return ids
    .map((id) => lista.find((p) => p.id === id))
    .filter((p): p is Producto => Boolean(p));
}
