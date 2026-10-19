-- Topes de gasto durables y globales: los contadores por hora de las llamadas que se pagan (la foto de FLUX del Taller y del
-- estudio de módulos, la imagen del plan 3D por navegador, el asistente de escena con Gemini y la revisión de sus rondas)
-- vivían en la memoria de cada instancia de Vercel, así que cada instancia tibia tenía su propio tope y el límite por hora no
-- era real. Una fila por contador (`clave`, p. ej. `fotos_hora` o `imagenes_navegador:<sha256 de la identidad del navegador>`:
-- nunca una IP ni una cookie en claro) con la hora en que abrió su ventana y cuántas llevan. El reloj es el de Postgres (`now()`),
-- no el de cada instancia: un reloj desfasado no puede dejar a todos sin cupo.
--
-- La toma es UNA sentencia atómica (INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING): suma solo si la ventana vigente tiene
-- cupo o si ya venció (entonces abre una nueva con 1), y no devuelve fila si no caben. Dos instancias a la vez no pueden pasarse
-- del tope. La ventana se abre en la primera toma y dura una hora, igual que el contador en memoria que reemplaza.
-- La app limpia por su cuenta las filas sin uso hace más de un día (`ventana_inicio` se renueva con cada ventana nueva).
--
-- Aditiva e idempotente: solo crea una tabla y un índice, no toca ninguna tabla existente. Si la tabla no existe todavía o
-- Neon no responde, la app sigue con el contador en memoria de la instancia (el comportamiento de antes) y lo registra.
-- Orden de despliegue: indiferente (el código sin la tabla se comporta como antes).
--
-- rollback: DROP TABLE topes_gasto;
--           DELETE FROM schema_migrations WHERE filename = '035_topes_gasto.sql';
-- (sin la segunda línea migrate.ts da la 035 por aplicada y no vuelve a crear la tabla).
-- La app tolera que la tabla no exista (vuelve al contador en memoria por instancia), así que el rollback no rompe nada.

CREATE TABLE IF NOT EXISTS topes_gasto (
  clave          TEXT PRIMARY KEY,
  ventana_inicio TIMESTAMPTZ NOT NULL DEFAULT now(),
  usadas         INTEGER NOT NULL CHECK (usadas >= 0)
);

CREATE INDEX IF NOT EXISTS ix_topes_gasto_ventana ON topes_gasto (ventana_inicio);
