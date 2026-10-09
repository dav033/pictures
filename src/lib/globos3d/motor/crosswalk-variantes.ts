import { z } from "zod";
import { TABLA_SEMPERTEX } from "@/lib/plan/referencia-sempertex";
import { colorSeVendeEnFormato, coloresDelFormato, FORMATOS_GLOBO, type TipoGlobo } from "../formatos";
import { nombreEsperado, NO_ESTAN_EN_LA_TIENDA } from "../productos-tienda";

/**
 * **Cruce motor 3D -> tienda**: de un globo del motor (`formatoId` + `codigo` Sempertex) a la variante del catálogo que se
 * compra (`product_id` + `variant_id`). El motor 3D no sabe de variantes; el servicio de precios de Python solo cotiza
 * variantes. Este archivo es el puente, y es puro (sin red, sin base): `scripts/motor/generar-crosswalk.ts` lo alimenta
 * con las filas del catálogo publicado y guarda el resultado por snapshot en `data/motor/crosswalk-<snapshot>.json`;
 * `crosswalk-vigente.ts` lo sirve en producción (con consulta en vivo si el archivo se quedó viejo).
 *
 * Una combinación que la tienda no vende no se inventa: queda en `sinCobertura` con su motivo, y quien cotiza decide
 * (volver al motor de Python), nunca se omite una línea del plan.
 */
export const VERSION_CROSSWALK = 1;

/** Las filas del catálogo que importan, ya filtradas como las filtra Python (`fetch_current_material_rows`): activas, con precio y paquete. */
export type FilaCatalogo = {
  snapshot: string;
  productId: string;
  tituloProducto: string;
  variantId: string;
  tituloVariante: string | null;
  codigoTamano: string | null;
  unidadesPaq: number;
  precio: number;
  coloresDerivados: readonly string[] | null;
};

export const MOTIVOS_SIN_COBERTURA = ["no_esta_en_la_tienda", "talla_no_vendida", "sin_producto_en_el_catalogo"] as const;
export type MotivoSinCobertura = (typeof MOTIVOS_SIN_COBERTURA)[number];

const VarianteSchema = z.object({
  variantId: z.string().min(1),
  /** «R-12 / PAQUETE X 50»: lo que dice el catálogo de esa variante. */
  titulo: z.string(),
  unidadesPaq: z.number().int().positive(),
  /** Solo para ELEGIR entre los paquetes de una misma talla (el más barato para la cantidad). El precio que ve el cliente lo da Python. */
  precio: z.number().int().positive(),
}).strict();

const EntradaSchema = z.object({
  productId: z.string().min(1),
  titulo: z.string().min(1),
  /** El color que el catálogo le asigna al producto («rosado»); null si no lo trae. */
  color: z.string().nullable(),
  variantes: z.array(VarianteSchema).min(1),
}).strict();

export const CrosswalkSchema = z.object({
  version: z.literal(VERSION_CROSSWALK),
  snapshot: z.string().min(1),
  /** `<formatoId>|<codigo>` -> el producto y sus variantes. */
  entradas: z.record(z.string(), EntradaSchema),
  /** `<formatoId>|<codigo>` de lo que la tabla oficial dice que se fabrica y la tienda no vende, con el motivo. */
  sinCobertura: z.record(z.string(), z.enum(MOTIVOS_SIN_COBERTURA)),
}).strict();

export type Crosswalk = z.infer<typeof CrosswalkSchema>;
export type EntradaCrosswalk = z.infer<typeof EntradaSchema>;

export const claveCruce = (formatoId: string, codigo: string): string => `${formatoId}|${codigo}`;

/** «R-12», «r12», «R 12» -> «R12»: el catálogo escribe la talla de varias maneras. */
export function claveTalla(texto: string): string {
  return texto.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const PALABRAS_DE_RELLENO = new Set(["b2b", "latex", "para", "fiesta"]);
const SIGLAS: Readonly<Record<string, string>> = { pm: "pastel mate", pd: "pastel dusk" };

/**
 * Cómo el catálogo se aparta del nombre que la tabla oficial le da a un globo (revisado contra el snapshot publicado):
 * «B2b Globo Fashion Rosa» es el redondo (sin la palabra), la tienda antepone la familia de color a «Turquesa Profundo»
 * y la línea Silk de 2026 se anuncia «Silk Nuevo». Lo que no esté aquí se empareja solo si el título es idéntico.
 */
const ALIAS_DE_TITULO: ReadonlyArray<readonly [RegExp, string]> = [
  [/^globo (fashion|reflex|silk|satin|metal|pastel mate|pastel dusk|neon) /, "globo redondo $1 "],
  [/ azul turquesa profundo$/, " turquesa profundo"],
  [/ silk nuevo /, " silk "],
];

/** Sin tildes ni signos ni marca: «B2b Globo Latex Link-O-Loon® Fashion Azul» y «GLOBO LINK-O-LOON FASHION AZUL» dan lo mismo. */
export function normalizarTitulo(texto: string): string {
  const base = texto
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .split(" ").filter((palabra) => !PALABRAS_DE_RELLENO.has(palabra)).map((palabra) => SIGLAS[palabra] ?? palabra).join(" ");
  return ALIAS_DE_TITULO.reduce((titulo, [patron, reemplazo]) => titulo.replace(patron, reemplazo), base);
}

const TIPOS: readonly TipoGlobo[] = ["redondo", "link", "tubito", "corazon"];

type Destino = { tipo: TipoGlobo; codigo: string };

/** El título normalizado que tendría en la tienda cada (tipo, código) de la tabla oficial: «globo redondo fashion azul rey» -> (redondo, 041). */
function indiceDeTitulos(): Map<string, Destino[]> {
  const indice = new Map<string, Destino[]>();
  for (const referencia of TABLA_SEMPERTEX.referencias) {
    for (const tipo of TIPOS) {
      const clave = normalizarTitulo(nombreEsperado(tipo, referencia.codigo));
      indice.set(clave, [...(indice.get(clave) ?? []), { tipo, codigo: referencia.codigo }]);
    }
  }
  return indice;
}

export type DiagnosticoCrosswalk = {
  productosEmparejados: number;
  /** Productos del catálogo que se llaman como un globo liso del motor pero con dos candidatos o más (no se usa ninguno). */
  titulosAmbiguos: string[];
  /** Pares (tipo, código) que dos productos del catálogo reclaman: gana el de más variantes. */
  colisiones: Array<{ clave: string; productos: string[] }>;
};

/** Crea el cruce de un snapshot a partir de las filas del catálogo. Determinista: mismas filas, mismos bytes. */
export function construirCrosswalk(filas: readonly FilaCatalogo[], snapshot: string): { crosswalk: Crosswalk; diagnostico: DiagnosticoCrosswalk } {
  const indice = indiceDeTitulos();
  const porProducto = new Map<string, FilaCatalogo[]>();
  for (const fila of filas) if (fila.snapshot === snapshot) porProducto.set(fila.productId, [...(porProducto.get(fila.productId) ?? []), fila]);

  const candidatos = new Map<string, Array<{ productId: string; entrada: EntradaCrosswalk }>>();
  const productosPorPar = new Map<string, Set<string>>();
  const titulosAmbiguos: string[] = [];
  let emparejados = 0;
  for (const [productId, variantes] of [...porProducto.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const titulo = variantes[0]!.tituloProducto;
    const destinos = indice.get(normalizarTitulo(titulo));
    if (!destinos) continue;
    if (destinos.length !== 1) { titulosAmbiguos.push(titulo); continue; }
    const { tipo, codigo } = destinos[0]!;
    emparejados += 1;
    productosPorPar.set(`${tipo}|${codigo}`, new Set([...(productosPorPar.get(`${tipo}|${codigo}`) ?? []), productId]));
    const color = variantes.find((fila) => fila.coloresDerivados?.length)?.coloresDerivados?.[0] ?? null;
    for (const formato of FORMATOS_GLOBO.filter((f) => f.tipo === tipo)) {
      const delFormato = variantes.filter((fila) => fila.codigoTamano !== null && claveTalla(fila.codigoTamano) === claveTalla(formato.id));
      if (!delFormato.length) continue;
      const entrada: EntradaCrosswalk = {
        productId, titulo, color,
        variantes: delFormato.map((fila) => ({ variantId: fila.variantId, titulo: fila.tituloVariante ?? formato.id, unidadesPaq: fila.unidadesPaq, precio: Math.round(fila.precio) }))
          .sort((a, b) => a.unidadesPaq - b.unidadesPaq || (a.variantId < b.variantId ? -1 : 1)),
      };
      const clave = claveCruce(formato.id, codigo);
      candidatos.set(clave, [...(candidatos.get(clave) ?? []), { productId, entrada }]);
    }
  }

  const entradas: Crosswalk["entradas"] = {};
  const colisiones: DiagnosticoCrosswalk["colisiones"] = [];
  for (const clave of [...candidatos.keys()].sort()) {
    const lista = candidatos.get(clave)!;
    // Entre dos productos que reclaman el mismo par gana el que vende más paquetes de esa talla, y a igualdad el de id menor.
    const ganador = [...lista].sort((a, b) => b.entrada.variantes.length - a.entrada.variantes.length || (a.productId < b.productId ? -1 : 1))[0]!;
    if (lista.length > 1) colisiones.push({ clave, productos: lista.map((c) => c.productId).sort() });
    entradas[clave] = ganador.entrada;
  }

  const noEnTienda = new Set(NO_ESTAN_EN_LA_TIENDA.map((item) => `${item.tipo}|${item.codigo}`));
  const sinCobertura: Crosswalk["sinCobertura"] = {};
  for (const formato of FORMATOS_GLOBO) {
    for (const referencia of coloresDelFormato(formato.id)) {
      const clave = claveCruce(formato.id, referencia.codigo);
      if (entradas[clave]) continue;
      // Un corazón en un color que la tabla no le da a ese formato (lo atestiguado por el dueño): no es un hueco del catálogo; `presentaciones` dice el motivo.
      if (formato.id === "C-12" && !colorSeVendeEnFormato(formato.id, referencia.codigo)) continue;
      const par = `${formato.tipo}|${referencia.codigo}`;
      sinCobertura[clave] = noEnTienda.has(par) ? "no_esta_en_la_tienda" : productosPorPar.has(par) ? "talla_no_vendida" : "sin_producto_en_el_catalogo";
    }
  }
  const ordenado = <T>(registro: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(registro).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    crosswalk: { version: VERSION_CROSSWALK, snapshot, entradas: ordenado(entradas), sinCobertura: ordenado(sinCobertura) },
    diagnostico: { productosEmparejados: emparejados, titulosAmbiguos, colisiones },
  };
}

export type VarianteElegida = {
  ok: true;
  productId: string;
  variantId: string;
  /** Título del producto del catálogo, sin la variante: «B2b Globo Latex Redondo Fashion Frambuesa». */
  titulo: string;
  /** Título de la variante: «R-12 / PAQUETE X 50». */
  tituloVariante: string;
  unidadesPaq: number;
  /** Lo que cuesta ese paquete en el cruce (para decidir, no para cobrar: el precio es el de Python). */
  precio: number;
  color: string | null;
};
/** El corazón C-12 se arma en cualquier color (decisión del dueño) pero la tienda solo lo vende en los de la tabla: en los demás, ese es el motivo (no «desconocida»). */
export type MotivoCruce = MotivoSinCobertura | "corazon_color_no_vendido" | "desconocida";
export type SinVariante = { ok: false; motivo: MotivoCruce };

/** Por qué no hay variante para un par que ni el cruce ni su lista de huecos mencionan. */
export function motivoSinEntrada(formatoId: string, codigo: string): MotivoCruce {
  return formatoId === "C-12" && !colorSeVendeEnFormato(formatoId, codigo) ? "corazon_color_no_vendido" : "desconocida";
}

/** Todas las presentaciones (paquetes) que la tienda vende de ese formato y color, o por qué no hay ninguna. */
export function presentaciones(crosswalk: Crosswalk, formatoId: string, codigo: string): { ok: true; entrada: EntradaCrosswalk } | SinVariante {
  const clave = claveCruce(formatoId, codigo);
  const entrada = crosswalk.entradas[clave];
  return entrada ? { ok: true, entrada } : { ok: false, motivo: crosswalk.sinCobertura[clave] ?? motivoSinEntrada(formatoId, codigo) };
}

/**
 * Política `mas_barato`: la variante que se compra para `cantidad` globos de ese formato y color: entre los paquetes que vende la tienda de esa
 * talla, la que cuesta menos para esa cantidad (paquetes cerrados), y a igual costo el paquete mayor. Lo que cuesta de
 * verdad lo cotiza Python con la variante elegida.
 */
export function elegirVariante(crosswalk: Crosswalk, formatoId: string, codigo: string, cantidad: number): VarianteElegida | SinVariante {
  const clave = claveCruce(formatoId, codigo);
  const entrada = crosswalk.entradas[clave];
  if (!entrada) return { ok: false, motivo: crosswalk.sinCobertura[clave] ?? motivoSinEntrada(formatoId, codigo) };
  const costo = (variante: EntradaCrosswalk["variantes"][number]) => Math.ceil(Math.max(1, cantidad) / variante.unidadesPaq) * variante.precio;
  const mejor = [...entrada.variantes].sort((a, b) => costo(a) - costo(b) || b.unidadesPaq - a.unidadesPaq || (a.variantId < b.variantId ? -1 : 1))[0]!;
  return { ok: true, productId: entrada.productId, variantId: mejor.variantId, titulo: entrada.titulo, tituloVariante: mejor.titulo, unidadesPaq: mejor.unidadesPaq, precio: mejor.precio, color: entrada.color };
}

