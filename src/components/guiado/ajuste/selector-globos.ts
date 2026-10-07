import { productoCliente } from "@/lib/plan/presentacion-cliente";
import { coloresRealesProducto } from "@/lib/plan/colores-producto";
import type { CandidatoDelServidor, ColorCatalogo } from "@/components/plan/ajuste/ajuste-propuesta";
import { familiaDeColor, nombreDeFamilia, ordenDeFamilia, type FamiliaId } from "@/components/plan/ajuste/familias-color";
import { familiaSempertex } from "../color-globo";
import { colorSempertex } from "../color-sempertex";

/**
 * El selector de globos del catálogo de «Ajustar mi plan» («Cambiar» un color, «Añadir color»), sin React ni red:
 * convierte lo que devuelve la búsqueda del explorador de la clásica (`/api/plan-editar`, `modo: "buscar"`) en globos
 * que se pueden elegir. Un globo es UN producto Sempertex en UN color («Reflex Dorado») con TODOS sus tamaños
 * disponibles: al elegirlo, el color del plan pasa a ese globo en cada medida que lleve. Solo globos lisos redondos,
 * salvo que el plan ya lleve impresos (vino de una foto con ellos). Nada se cuenta aquí: Python vuelve a resolver.
 */

/** Lo que no es un globo liso de un color (impresos, Infinity, dos caras, figuras, letras, kits). */
const NO_LISO = /impres|estampad|2 caras|dos caras|feliz|cumplea|happy|birthday|infinity|bal[oó]n|f[uú]tbol|\bcopa\b|letra|n[uú]mero|coraz[oó]n|estrella|figura|foil|bouquet|surtido|confet+i|navidad|boda|bautizo|comuni[oó]n|a[nñ]os|grado|mensaje|filigree|terrazo|marmol/i;

/** Familias Sempertex en el orden en que se ofrecen dentro de un color: la lisa de siempre primero. */
const ORDEN_ACABADO = ["Fashion", "Pastel Matte", "Pastel Dusk", "Pastel", "Reflex", "Silk", "Satín", "Metal", "Neón", "Crystal", "Deluxe"];

export type GloboCatalogo = {
  /** Clave estable: producto + color. */
  clave: string;
  productId: string;
  /** Color del catálogo («dorado»), el que el plan guarda. */
  color: string;
  /** «Reflex Dorado»: el globo como se pide en Sempertex. */
  nombre: string;
  /** «Dorado cromado»: el color en palabras del cliente (el mismo nombre que los chips). */
  colorCliente: string;
  /** «Reflex», «Fashion»…, o null si el título no lo dice. */
  acabado: string | null;
  hex: string;
  imagen: string | null;
  /** Tamaños disponibles, en pulgadas, de menor a mayor. */
  tamanos: number[];
  /** Todas las variantes disponibles de ese color (cada tamaño y paquete), las que el servidor admite en el plan. */
  variantIds: string[];
  /** Título del producto (para el acabado del motor y el registro). */
  titulo: string;
};

export type GrupoGlobos = { familia: FamiliaId; nombre: string; globos: GloboCatalogo[] };

function plegar(texto: string | null | undefined): string {
  return (texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLocaleLowerCase("es");
}

/** El plan ya lleva globos impresos (vino de una foto con ellos): entonces el selector también los ofrece. */
export function planConImpresos(titulos: readonly (string | null | undefined)[]): boolean {
  return titulos.some((titulo) => /impres|estampad|2 caras|dos caras/i.test(titulo ?? ""));
}

/**
 * Los globos que se pueden elegir de una búsqueda: uno por producto y color, con sus tamaños disponibles y redondos.
 * Sin impresos (salvo `conImpresos`), sin productos sin color y sin repetir.
 */
export function globosDeCandidatos(candidatos: readonly CandidatoDelServidor[], opciones: { conImpresos?: boolean } = {}): GloboCatalogo[] {
  const vistos = new Set<string>();
  const globos: GloboCatalogo[] = [];
  for (const candidato of candidatos) {
    if (!opciones.conImpresos && NO_LISO.test(candidato.titulo)) continue;
    const porColor = new Map<string, Array<CandidatoDelServidor["variantes"][number]>>();
    for (const variante of candidato.variantes) {
      if (!variante.disponible || (variante.forma ?? "redondo") !== "redondo" || variante.diamPulg == null) continue;
      const colores = coloresRealesProducto(candidato.titulo, variante.colores);
      if (colores.length !== 1) continue;
      porColor.set(colores[0]!, [...(porColor.get(colores[0]!) ?? []), variante]);
    }
    for (const [color, variantes] of porColor) {
      const clave = `${candidato.productId}|${color}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      const sempertex = colorSempertex(color, { titulo: candidato.titulo });
      const familia = familiaSempertex(candidato.titulo);
      globos.push({
        clave,
        productId: candidato.productId,
        color,
        nombre: sempertex.producto ?? productoCliente(candidato.titulo).replace(/^globo\s+latex\s+redondo\s+/i, ""),
        colorCliente: sempertex.nombre,
        acabado: familia?.nombre ?? null,
        hex: sempertex.hex,
        imagen: candidato.imagen,
        tamanos: [...new Set(variantes.map((variante) => variante.diamPulg!))].sort((a, b) => a - b),
        variantIds: [...new Set(variantes.map((variante) => variante.variantId))].slice(0, 24),
        titulo: candidato.titulo,
      });
    }
  }
  return globos;
}

/**
 * Los globos agrupados por familia de color, las familias de la más vendida a la menos (los totales de `modo:
 * "colores"`), y dentro de cada una la lisa de siempre primero y luego los acabados. `fuera`: globos que no se ofrecen
 * (el que ya está en ese lugar del plan).
 */
export function agruparGlobos(globos: readonly GloboCatalogo[], ventas: readonly ColorCatalogo[], fuera: ReadonlySet<string> = new Set()): GrupoGlobos[] {
  const total = new Map(ventas.map((color) => [plegar(color.valor), color.total]));
  const familias = new Map<FamiliaId, GloboCatalogo[]>();
  for (const globo of globos) {
    if (fuera.has(globo.clave)) continue;
    const familia = familiaDeColor(globo.color);
    familias.set(familia, [...(familias.get(familia) ?? []), globo]);
  }
  const vendidos = (lista: readonly GloboCatalogo[]) => Math.max(0, ...lista.map((globo) => total.get(plegar(globo.color)) ?? 0));
  const rangoAcabado = (globo: GloboCatalogo) => {
    const posicion = ORDEN_ACABADO.indexOf(globo.acabado ?? "");
    return posicion < 0 ? ORDEN_ACABADO.length : posicion;
  };
  return [...familias.entries()]
    .sort(([a, listaA], [b, listaB]) => vendidos(listaB) - vendidos(listaA) || ordenDeFamilia(a) - ordenDeFamilia(b))
    .map(([familia, lista]) => ({
      familia,
      nombre: nombreDeFamilia(familia),
      globos: [...lista].sort((a, b) => (total.get(plegar(b.color)) ?? 0) - (total.get(plegar(a.color)) ?? 0) || rangoAcabado(a) - rangoAcabado(b) || a.nombre.localeCompare(b.nombre, "es")),
    }));
}

/** Filtra por lo que el cliente escribe («dorado», «reflex», «perla»): nombre, color o acabado. */
export function filtrarGlobos(globos: readonly GloboCatalogo[], texto: string): GloboCatalogo[] {
  const palabras = plegar(texto).split(/\s+/).filter(Boolean);
  if (!palabras.length) return [...globos];
  return globos.filter((globo) => {
    const donde = plegar(`${globo.nombre} ${globo.colorCliente} ${globo.color} ${globo.acabado ?? ""} ${globo.titulo}`);
    return palabras.every((palabra) => donde.includes(palabra));
  });
}

/** «5″ · 12″ · 18″» */
export function tamanosEnTexto(tamanos: readonly number[]): string {
  return tamanos.map((pulgadas) => `${pulgadas}″`).join(" · ");
}
