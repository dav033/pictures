import { decodificarTamano, type TamanoDecodificado } from "./derivar";

export type CampoDescripcion = {
  nombre: string;
  valor: string;
};

export type MedidaDescripcion = CampoDescripcion & {
  dimensiones: Array<{ valor: number; unidad: string }>;
};

export type ComponenteKit = {
  nombre: string;
  detalle: string | null;
  cantidad: number | null;
  cantidadTexto: string | null;
  tamanoCodigo: string | null;
  tamano: TamanoDecodificado | null;
};

export type TablaDescripcion = {
  tipo: "especificaciones" | "contenido";
  encabezados: string[];
  filas: string[][];
};

export type DescripcionEnriquecida = {
  descripcion: string | null;
  textoCompleto: string | null;
  especificaciones: CampoDescripcion[];
  medidas: MedidaDescripcion[];
  contenidoKit: ComponenteKit[];
  tablas: TablaDescripcion[];
};

const ENTIDADES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  Ntilde: "Ñ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entidad, codigo: string) => {
    if (codigo.startsWith("#x") || codigo.startsWith("#X")) {
      const valor = Number.parseInt(codigo.slice(2), 16);
      return Number.isFinite(valor) ? String.fromCodePoint(valor) : entidad;
    }
    if (codigo.startsWith("#")) {
      const valor = Number.parseInt(codigo.slice(1), 10);
      return Number.isFinite(valor) ? String.fromCodePoint(valor) : entidad;
    }
    return ENTIDADES[codigo] ?? ENTIDADES[codigo.toLowerCase()] ?? entidad;
  });
}

function quitarBloquesNoTextuales(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|iframe|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
}

function htmlATexto(html: string, conservarSaltos = false): string {
  const conSaltos = quitarBloquesNoTextuales(html)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|section|article|tr)\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ");
  const lineas = decodificarEntidades(conSaltos)
    .split(/\r?\n/)
    .map((linea) => linea.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return conservarSaltos ? lineas.join("\n") : lineas.join(" ");
}

function limpiarEtiqueta(texto: string): string {
  return texto.replace(/\s*:\s*$/, "").replace(/\s+/g, " ").trim();
}

function filasDeTabla(html: string): string[][] {
  return [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi)]
    .map((fila) => {
      const celdas = [...fila[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)].map(
        (celda) => htmlATexto(celda[1]),
      );
      while (celdas.at(-1) === "") celdas.pop();
      return celdas;
    })
    .filter((fila) => fila.some(Boolean));
}

function esTablaContenido(filas: string[][]): boolean {
  const primera = filas[0]?.join(" ") ?? "";
  return /\bcontenido\b|total diy globos/i.test(primera);
}

function normalizarCodigoTamano(codigo: string): string | null {
  const limpio = codigo.toUpperCase().replace(/\s+/g, " ").trim();
  let match = limpio.match(/\b(R|C)\s*-?\s*(\d+(?:[.,]\d+)?)\b/);
  if (match) return `${match[1]}-${match[2].replace(",", ".")}`;

  match = limpio.match(/\bLOL\s*-?\s*(\d+(?:[.,]\d+)?)\b/);
  if (match) return `LOL-${match[1].replace(",", ".")}`;

  match = limpio.match(/\bT\s*-?\s*(\d)(\d+)\b/);
  if (match) return `T-${match[1]}${match[2]}`;

  match = limpio.match(/\b(\d+(?:[.,]\d+)?)\s*IN\b/);
  if (match) return `${match[1].replace(",", ".")} IN`;

  match = limpio.match(/\b(\d+(?:[.,]\d+)?)\s*[X×]\s*(\d+(?:[.,]\d+)?)\s*CM\b/);
  if (match) return `${match[1].replace(",", ".")}X${match[2].replace(",", ".")} CM`;

  return null;
}

function cantidadExacta(texto: string): number | null {
  const match = texto.trim().match(/^(?:X\s*)?(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function componente(
  nombre: string,
  detalle: string | null,
  cantidadTexto: string | null,
): ComponenteKit | null {
  const nombreLimpio = limpiarEtiqueta(nombre);
  if (!nombreLimpio || /^total\b/i.test(nombreLimpio)) return null;
  const detalleLimpio = detalle ? limpiarEtiqueta(detalle) : null;
  const tamanoCodigo = normalizarCodigoTamano(detalleLimpio ?? nombreLimpio);
  return {
    nombre: nombreLimpio,
    detalle: detalleLimpio || null,
    cantidad: cantidadTexto ? cantidadExacta(cantidadTexto) : null,
    cantidadTexto: cantidadTexto?.trim() || null,
    tamanoCodigo,
    tamano: tamanoCodigo ? decodificarTamano(tamanoCodigo) : null,
  };
}

function componentesDeTabla(tabla: TablaDescripcion): ComponenteKit[] {
  if (tabla.tipo !== "contenido") return [];
  const salida: ComponenteKit[] = [];

  if (tabla.encabezados.length > 2) {
    for (const fila of tabla.filas) {
      const nombre = fila[0] ?? "";
      for (let indice = 1; indice < tabla.encabezados.length; indice++) {
        const cantidadTexto = fila[indice]?.trim();
        if (!cantidadTexto || cantidadExacta(cantidadTexto) === 0) continue;
        const item = componente(nombre, tabla.encabezados[indice], cantidadTexto);
        if (item) salida.push(item);
      }
    }
    return salida;
  }

  for (const fila of tabla.filas) {
    if (fila.length >= 3) {
      const item = componente(fila[0], fila[1], fila.at(-1) ?? null);
      if (item) salida.push(item);
      continue;
    }
    if (fila.length >= 2) {
      const item = componente(fila[0], null, fila[1]);
      if (item) salida.push(item);
    }
  }
  return salida;
}

function extraerDimensiones(valor: string): Array<{ valor: number; unidad: string }> {
  const numero = "(\\d+(?:[.,]\\d+)?)";
  const unidad = '(MM|CM|M|IN|PULG(?:ADA)?S?|\")';
  const patron = new RegExp(
    `^\\s*${numero}\\s*${unidad}?\\s*[X×]\\s*${numero}\\s*${unidad}?` +
      `(?:\\s*[X×]\\s*${numero}\\s*${unidad}?)?\\s*$`,
    "i",
  );
  const match = valor.match(patron);
  if (!match) {
    const simple = valor.match(new RegExp(`^\\s*${numero}\\s*${unidad}\\s*$`, "i"));
    if (!simple) return [];
    return [{ valor: Number(simple[1].replace(",", ".")), unidad: simple[2].toLowerCase() }];
  }

  const unidadComun = match[2] || match[4] || match[6];
  const dimensiones = [
    { numero: match[1], unidad: match[2] || unidadComun },
    { numero: match[3], unidad: match[4] || unidadComun },
    ...(match[5] ? [{ numero: match[5], unidad: match[6] || unidadComun }] : []),
  ];
  return dimensiones
    .filter((dimension) => Boolean(dimension.unidad))
    .map((dimension) => ({
      valor: Number(dimension.numero.replace(",", ".")),
      unidad: String(dimension.unidad).toLowerCase(),
    }));
}

/**
 * Convierte `body_html` de Shopify en datos seguros y deterministas.
 * No conserva HTML: estilos, iframes, scripts y atributos desaparecen.
 */
export function enriquecerDescripcion(html: string | null | undefined): DescripcionEnriquecida {
  if (!html?.trim()) {
    return {
      descripcion: null,
      textoCompleto: null,
      especificaciones: [],
      medidas: [],
      contenidoKit: [],
      tablas: [],
    };
  }

  const tablasHtml = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)].map(
    (match) => match[0],
  );
  const tablas: TablaDescripcion[] = tablasHtml
    .map((tablaHtml) => filasDeTabla(tablaHtml))
    .filter((filas) => filas.length > 0)
    .map((filas) => {
      const contenido = esTablaContenido(filas);
      return {
        tipo: contenido ? "contenido" : "especificaciones",
        encabezados: contenido ? filas[0] : [],
        filas: contenido ? filas.slice(1) : filas,
      };
    });

  const especificaciones = tablas
    .filter((tabla) => tabla.tipo === "especificaciones")
    .flatMap((tabla) =>
      tabla.filas
        .filter((fila) => fila.length >= 2 && Boolean(fila[0]) && Boolean(fila.slice(1).join(" ")))
        .map((fila) => ({ nombre: limpiarEtiqueta(fila[0]), valor: fila.slice(1).join(" | ") })),
    );

  const medidas = especificaciones
    .filter((campo) => /medida|tama(?:ñ|n)o|alto|ancho|largo|di[aá]metro/i.test(campo.nombre))
    .map((campo) => ({ ...campo, dimensiones: extraerDimensiones(campo.valor) }))
    .filter((campo) => campo.dimensiones.length > 0);

  const contenidoKit = tablas.flatMap(componentesDeTabla);
  const htmlSinTablas = quitarBloquesNoTextuales(html).replace(
    /<table\b[^>]*>[\s\S]*?<\/table\s*>/gi,
    " ",
  );
  const descripcion = htmlATexto(htmlSinTablas, true).replace(/\n+/g, "\n").trim() || null;
  const textoTablas = tablas
    .flatMap((tabla) => [tabla.encabezados, ...tabla.filas])
    .filter((fila) => fila.length > 0)
    .map((fila) => fila.join(" | "))
    .join("\n");
  const textoCompleto = [descripcion, textoTablas].filter(Boolean).join("\n").trim() || null;

  return { descripcion, textoCompleto, especificaciones, medidas, contenidoKit, tablas };
}
