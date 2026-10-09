import type { AlmacenImagenes } from "../puertos";

/**
 * Adaptador del puerto `AlmacenImagenes` sobre el cliente S3 compartido (`src/lib/almacen/objetos-s3.ts`,
 * `crearClienteAlmacen`). Se tipa contra la forma mínima que usa (`poner` / `obtener`), que `ClienteAlmacen` cumple, para
 * probarlo con un doble. Quien enchufa el cliente real es `fabrica.ts`.
 */
export type ClienteObjetos = {
  poner(clave: string, cuerpo: Uint8Array, tipo: string): Promise<void>;
  obtener(clave: string): Promise<{ cuerpo: Uint8Array; tipo: string } | null>;
  borrar(clave: string): Promise<void>;
  existe(clave: string): Promise<boolean>;
};

export function crearAlmacenS3(cliente: ClienteObjetos): AlmacenImagenes {
  return {
    guardar: (objeto, imagen) => cliente.poner(objeto, imagen.bytes, imagen.mime),
    borrar: (objeto) => cliente.borrar(objeto),
    existe: (objeto) => cliente.existe(objeto),
    async leer(objeto) {
      const encontrado = await cliente.obtener(objeto);
      return encontrado ? { bytes: encontrado.cuerpo, mime: encontrado.tipo } : null;
    },
  };
}
