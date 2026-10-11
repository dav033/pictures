/**
 * `pg` (8.x) trata `sslmode=require|prefer|verify-ca` como `verify-full` y, cada vez que lo lee, escribe
 * `SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca' are treated as aliases for 'verify-full'`: Vercel lo
 * deja a nivel «error» en cada arranque en frío. Decir `verify-full` desde el principio es lo mismo que hace hoy (verifica el
 * certificado y el nombre del servidor), no afloja nada, y es lo que la propia advertencia pide; en `pg` 9 esos tres modos
 * pasan a ser los de libpq, más débiles, y la URL ya no cambiaría de significado.
 *
 * Solo cambia el valor de `sslmode`: la URL lleva la contraseña y no se vuelve a serializar.
 */
const SSLMODE_QUE_PG_TRATA_COMO_VERIFY_FULL = /([?&]sslmode=)(?:require|prefer|verify-ca)(?=&|#|$)/;

export function urlConSslExplicito(url: string): string {
  // `uselibpqcompat=true` pide expresamente la semántica de libpq: ahí `require` significa otra cosa y no se toca.
  if (/[?&]uselibpqcompat=/.test(url)) return url;
  return url.replace(SSLMODE_QUE_PG_TRATA_COMO_VERIFY_FULL, "$1verify-full");
}
