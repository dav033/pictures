import { createHash, createHmac } from "node:crypto";
import { z } from "zod";

/**
 * Almacén de objetos compartido (Garage dedicado de demo-decoracion en el VPS, S3 con rutas): subir, leer, preguntar si
 * existe, borrar y firmar una URL de lectura. Cada función de la app (feedback de la IA, módulos renderizados...) usa su
 * propio prefijo de clave (`feedback/…`, `modulos/…`) dentro del mismo bucket. Firma SigV4 propia, sin el SDK de AWS
 * (~60 paquetes por cinco operaciones); se verifica contra los vectores publicados por AWS (objetos-s3.test.ts).
 * Las claves de acceso solo viven en el servidor: el navegador recibe, como mucho, una URL firmada y con caducidad.
 *
 * Variables de entorno: ALMACEN_S3_ENDPOINT, ALMACEN_S3_BUCKET, ALMACEN_S3_ACCESS_KEY_ID, ALMACEN_S3_SECRET_ACCESS_KEY y
 * (opcional, por defecto «garage») ALMACEN_S3_REGION.
 */

const ConfiguracionSchema = z.object({
  ALMACEN_S3_ENDPOINT: z.url(),
  ALMACEN_S3_REGION: z.string().min(1).default("garage"),
  ALMACEN_S3_BUCKET: z.string().min(3),
  ALMACEN_S3_ACCESS_KEY_ID: z.string().min(1),
  ALMACEN_S3_SECRET_ACCESS_KEY: z.string().min(1),
});

export type ConfiguracionAlmacen = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/** `null` si el almacén no está configurado (desarrollo sin S3): cada función decide cómo degradar. */
export function configuracionAlmacen(env: Record<string, string | undefined> = process.env): ConfiguracionAlmacen | null {
  const leida = ConfiguracionSchema.safeParse(env);
  if (!leida.success) return null;
  return {
    endpoint: leida.data.ALMACEN_S3_ENDPOINT.replace(/\/+$/, ""),
    region: leida.data.ALMACEN_S3_REGION,
    bucket: leida.data.ALMACEN_S3_BUCKET,
    accessKeyId: leida.data.ALMACEN_S3_ACCESS_KEY_ID,
    secretAccessKey: leida.data.ALMACEN_S3_SECRET_ACCESS_KEY,
  };
}

export class ErrorAlmacen extends Error {
  constructor(mensaje: string, readonly estado?: number) {
    super(mensaje);
    this.name = "ErrorAlmacen";
  }
}

export type ObjetoAlmacenado = { cuerpo: Uint8Array; tipo: string };

export type ClienteAlmacen = {
  poner(clave: string, cuerpo: Uint8Array, tipo: string): Promise<void>;
  /** `null` si la clave no existe. */
  obtener(clave: string): Promise<ObjetoAlmacenado | null>;
  existe(clave: string): Promise<boolean>;
  /** Borrar una clave que no existe no es un error. */
  borrar(clave: string): Promise<void>;
  /** URL de lectura firmada que caduca en `caducaEnSegundos` (1 a 604800): para que el navegador pida la imagen directo. */
  urlFirmada(clave: string, caducaEnSegundos: number): string;
};

const sha256 = (datos: string | Uint8Array): string => createHash("sha256").update(datos).digest("hex");
const hmac = (clave: string | Buffer, datos: string): Buffer => createHmac("sha256", clave).update(datos).digest();
const SIN_FIRMAR_CUERPO = "UNSIGNED-PAYLOAD";

type Credenciales = { region: string; accessKeyId: string; secretAccessKey: string };

function marcaDeTiempo(fecha: Date): { marca: string; dia: string } {
  const marca = fecha.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { marca, dia: marca.slice(0, 8) };
}

function firmaDe(c: Credenciales, dia: string, marca: string, canonica: string): { alcance: string; firma: string } {
  const alcance = `${dia}/${c.region}/s3/aws4_request`;
  const aFirmar = ["AWS4-HMAC-SHA256", marca, alcance, sha256(canonica)].join("\n");
  const claveFirma = hmac(hmac(hmac(hmac(`AWS4${c.secretAccessKey}`, dia), c.region), "s3"), "aws4_request");
  return { alcance, firma: createHmac("sha256", claveFirma).update(aFirmar).digest("hex") };
}

const codificar = (texto: string): string => encodeURIComponent(texto).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

type PeticionFirmada = Credenciales & {
  metodo: string;
  url: URL;
  fecha: Date;
  hashCuerpo: string;
  /** Cabeceras adicionales que también se firman (en minúsculas). */
  cabeceras?: Record<string, string>;
};

/** Cabeceras SigV4 (`authorization`, `x-amz-date`, `x-amz-content-sha256`, `host`) de una petición al servicio s3. */
export function firmarPeticion(p: PeticionFirmada): Record<string, string> {
  const { marca, dia } = marcaDeTiempo(p.fecha);
  const todas: Record<string, string> = { ...p.cabeceras, host: p.url.host, "x-amz-content-sha256": p.hashCuerpo, "x-amz-date": marca };
  const nombres = Object.keys(todas).sort();
  const canonicas = nombres.map((nombre) => `${nombre}:${todas[nombre].trim()}\n`).join("");
  const firmadas = nombres.join(";");
  const consulta = [...p.url.searchParams].map(([k, v]) => `${codificar(k)}=${codificar(v)}`).sort().join("&");
  const canonica = [p.metodo, p.url.pathname, consulta, canonicas, firmadas, p.hashCuerpo].join("\n");
  const { alcance, firma } = firmaDe(p, dia, marca, canonica);
  return {
    ...todas,
    authorization: `AWS4-HMAC-SHA256 Credential=${p.accessKeyId}/${alcance}, SignedHeaders=${firmadas}, Signature=${firma}`,
  };
}

/** URL GET con la firma en la consulta (SigV4 «presigned»): solo se firma la cabecera host y el cuerpo va sin firmar. */
export function firmarUrlGet(p: Credenciales & { url: URL; fecha: Date; caducaEnSegundos: number }): string {
  const { marca, dia } = marcaDeTiempo(p.fecha);
  const alcance = `${dia}/${p.region}/s3/aws4_request`;
  const parametros: [string, string][] = [
    ...p.url.searchParams,
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${p.accessKeyId}/${alcance}`],
    ["X-Amz-Date", marca],
    ["X-Amz-Expires", String(p.caducaEnSegundos)],
    ["X-Amz-SignedHeaders", "host"],
  ];
  const consulta = parametros.map(([k, v]) => `${codificar(k)}=${codificar(v)}`).sort().join("&");
  const canonica = ["GET", p.url.pathname, consulta, `host:${p.url.host}\n`, "host", SIN_FIRMAR_CUERPO].join("\n");
  const { firma } = firmaDe(p, dia, marca, canonica);
  return `${p.url.origin}${p.url.pathname}?${consulta}&X-Amz-Signature=${firma}`;
}

const TIEMPO_MAXIMO_MS = 15_000;
const CADUCIDAD_MAXIMA_S = 604_800;

function urlDeObjeto(config: ConfiguracionAlmacen, clave: string): URL {
  const ruta = clave.split("/").map(codificar).join("/");
  return new URL(`${config.endpoint}/${config.bucket}/${ruta}`);
}

export function crearClienteAlmacen(config: ConfiguracionAlmacen, llamar: typeof fetch = fetch): ClienteAlmacen {
  async function enviar(metodo: "PUT" | "GET" | "HEAD" | "DELETE", clave: string, cuerpo?: Uint8Array, tipo?: string): Promise<Response> {
    const url = urlDeObjeto(config, clave);
    const cabeceras = firmarPeticion({ ...config, metodo, url, fecha: new Date(), hashCuerpo: sha256(cuerpo ?? "") });
    try {
      return await llamar(url, {
        method: metodo,
        headers: { ...cabeceras, ...(tipo ? { "content-type": tipo } : {}) },
        body: cuerpo ? Buffer.from(cuerpo) : undefined,
        signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
      });
    } catch (causa) {
      throw new ErrorAlmacen(`El almacén no respondió: ${causa instanceof Error ? causa.message : String(causa)}`);
    }
  }

  const rechazo = (accion: string, respuesta: Response) => new ErrorAlmacen(`El almacén rechazó ${accion} (${respuesta.status}).`, respuesta.status);

  return {
    async poner(clave, cuerpo, tipo) {
      const respuesta = await enviar("PUT", clave, cuerpo, tipo);
      if (!respuesta.ok) throw rechazo("la subida", respuesta);
    },
    async obtener(clave) {
      const respuesta = await enviar("GET", clave);
      if (respuesta.status === 404) return null;
      if (!respuesta.ok) throw rechazo("la lectura", respuesta);
      return { cuerpo: new Uint8Array(await respuesta.arrayBuffer()), tipo: respuesta.headers.get("content-type") ?? "application/octet-stream" };
    },
    async existe(clave) {
      const respuesta = await enviar("HEAD", clave);
      if (respuesta.status === 404) return false;
      if (!respuesta.ok) throw rechazo("la consulta", respuesta);
      return true;
    },
    async borrar(clave) {
      const respuesta = await enviar("DELETE", clave);
      if (!respuesta.ok && respuesta.status !== 404) throw rechazo("el borrado", respuesta);
    },
    urlFirmada(clave, caducaEnSegundos) {
      if (!Number.isInteger(caducaEnSegundos) || caducaEnSegundos < 1 || caducaEnSegundos > CADUCIDAD_MAXIMA_S) {
        throw new ErrorAlmacen(`La caducidad debe estar entre 1 y ${CADUCIDAD_MAXIMA_S} segundos.`);
      }
      return firmarUrlGet({ ...config, url: urlDeObjeto(config, clave), fecha: new Date(), caducaEnSegundos });
    },
  };
}
