/**
 * Los tipos de los **repositorios de catálogo** (REQ-013): un repositorio es una fuente de entradas con un dueño, un régimen de
 * licencia, una fuente de precio y una política de visibilidad. Módulo hoja: no importa nada (ni tipos) para que el motor
 * (`globos3d`) pueda usar `ids.ts` sin arrastrar el registro ni la biblioteca (regla R8, `test-motor-guiada-fronteras`).
 * Lo que depende de los tipos del motor (la carga de cada clase, la entrada, el contrato del repositorio) está en `repositorio.ts`.
 */

export type IdRepositorioFundador = "sempertex" | "mobiliario" | "escenografia";
/** `terceros/<slug>`: un paquete de datos de un tercero (fase 7); el slug cumple `PATRON_SLUG_TERCEROS` de `ids.ts`. */
export type IdRepositorio = IdRepositorioFundador | `terceros/${string}`;

export type Superficie = "taller" | "ia_taller" | "foto" | "rag" | "estudio" | "guiada";

export type Licencia = {
  regimen: "propia" | "marca-socio" | "referencia" | "cc-by" | "cc0" | "comercial";
  /** «Sempertex», «Equipo demo-decoracion», el nombre del proveedor. */
  titular: string;
  url?: string;
  /** El texto que se muestra al dibujar o exportar la entrada. */
  atribucion?: string;
  restricciones: readonly string[];
};

export type FuentePrecioDeclarada =
  | { tipo: "crosswalk-tienda" }
  | { tipo: "lista-alquiler"; archivo: string; moneda: "COP" | "USD"; vigencia: string }
  | { tipo: "sin-precio"; motivo: string };

/** Las clases de entrada de los repositorios fundadores (SPEC §4.2); las de terceros llegan con su cargador. */
export type ClaseEntrada =
  | "item-biblioteca" | "formato" | "color" | "producto-tienda" | "plan-idea" | "decoracion-guiada" | "modulo"
  | "mueble" | "mueble-fijo" | "generador"
  | "fondo" | "decorado";

/** Qué ids locales reclama un repositorio: por prefijo (la biblioteca: `idea:`, `escena:`…) o los exactos que da su cargador. */
export type ReclamoIdsLocales = { prefijos: readonly string[] } | { exactos: "del-cargador" };

export type ManifiestoRepositorio = {
  /** Versión del esquema del manifiesto. */
  esquema: 1;
  id: IdRepositorio;
  /** Semver del CONTENIDO: viene de `repositorios/<id>/lock.json`; `test-catalogo-lock --escribir` la sube cuando cambia la huella, con su línea en `historial`. */
  version: string;
  historial: ReadonlyArray<{ version: string; nota: string }>;
  /** Para la interfaz: «Sempertex», «Mobiliario», «Escenografía». */
  nombre: string;
  descripcion: string;
  clases: readonly ClaseEntrada[];
  /** La de todas sus entradas, salvo la que una entrada declare en su procedencia. */
  licencia: Licencia;
  precio: FuentePrecioDeclarada;
  visiblePorDefecto: readonly Superficie[];
  /** Repositorios cuyas entradas pueden aparecer dentro de las suyas (las escenas de Sempertex ponen fondos y muebles). */
  depende: readonly IdRepositorio[];
  idsLocales: ReclamoIdsLocales;
  /** Carpeta de los datos generados (fichas, vectores): «data/taller» (Sempertex, la de siempre) o «data/catalogos/<id>». */
  datos: string;
};

export type Procedencia = {
  fuente: "idea-sempertex" | "celebra" | "tienda-sempertex" | "referencia-web" | "referencia-dueno" | "propio" | "terceros";
  titulo: string;
  url?: string;
  fotoUrl?: string;
  /** Solo cuando no es la del manifiesto. */
  licencia?: Licencia;
};
