# Demo — Asistente de decoración

Chatbot que conversa con el cliente, le recomienda piezas **reales del catálogo** y genera una
visualización de cómo quedaría su evento decorado.

La conversación y la generación de imágenes usan Gemini (`gemini-3.6-flash` y
`gemini-3.1-flash-image`).

## Arrancar

```bash
npm install
cp .env.example .env.local   # y pon tu GEMINI_API_KEY
npm run dev
```

Abre http://localhost:3000

Sin `GEMINI_API_KEY` la interfaz carga, pero chat y generación de imágenes responden con un error
explicando que falta la llave.

## Flujo del demo (cliente)

1. El cliente describe su evento en el chat.
2. El asistente extrae los datos (evento, espacio, invitados, colores, estilo) y los va mostrando
   en el panel derecho.
3. Cuando tiene idea del estilo, llama a `buscar_catalogo` y muestra piezas dentro del chat.
4. El cliente selecciona piezas y elige un espacio: sube su propia foto o toma uno de la galería.
5. "Generar visualización" compone la imagen.
6. El campo de ajuste permite iterar: *"más velas"*, *"de noche"*, *"quita las sillas"*.

## Panel de administración (`/admin`)

Todo el catálogo se administra desde la UI, sin tocar código:

- **Productos**: sube la foto real de cada pieza (se guarda en `public/uploads/productos/` y se
  manda como referencia real a `gemini-3.1-flash-image`), con nombre, categoría, descripción visual, precio,
  estilos y colores.
- **Decoraciones**: paquetes curados a partir del catálogo (ej. "Boda boho jardín"), con una
  imagen de portada y un checklist de productos que la componen. Todos los elementos son
  opcionales: el cliente podrá quitar cualquiera al personalizar.

## Cómo se genera la imagen

| Situación | API de Gemini | Qué hace |
|---|---|---|
| El cliente subió foto de su lugar | `interactions.create` | Decora **esa** foto conservando arquitectura y perspectiva |
| El cliente eligió fondo de galería | `interactions.create` | Genera la escena completa desde la descripción del ambiente |

`gemini-3.1-flash-image` acepta hasta 14 imágenes de referencia. Si un producto del catálogo tiene el campo
`foto` apuntando a un archivo en `public/`, esa foto se manda como referencia y el modelo respeta
su forma y color reales. Sin `foto`, sólo se usa la descripción de texto.

## Dónde vive cada dato

| Qué | Dónde |
|---|---|
| Productos y decoraciones (datos) | `data/demo.sqlite` — SQLite, se crea y siembra solo al arrancar |
| Fotos subidas | `public/uploads/productos/` y `public/uploads/decoraciones/` |
| Fondos de stock | `src/lib/backgrounds.ts` (por ahora fijos, no editables desde la UI) |

`data/demo.sqlite` tiene tres tablas: `productos`, `decoraciones` y `decoracion_elementos` (la
relación muchos-a-muchos entre ambas, con `ON DELETE CASCADE`). Si borras un producto que forma
parte de una decoración, la decoración se queda sin ese elemento automáticamente — no quedan ids
huérfanos. Usa el módulo nativo `node:sqlite` de Node 24+, sin dependencias nuevas.

Para reiniciar el catálogo desde cero: borra `data/demo.sqlite` (y opcionalmente
`public/uploads/`) y reinicia el servidor — se vuelve a sembrar con el mock de 14 piezas.

## Estructura

```
src/
  app/
    page.tsx                Interfaz del cliente (chat + panel)
    admin/page.tsx           Panel de administración (server component)
    api/chat/route.ts        Conversación con tool calling
    api/generate/route.ts    Generación / edición de imagen
    api/productos/           CRUD de productos (multipart, con imagen)
    api/decoraciones/        CRUD de decoraciones (multipart, con imagen)
  components/
    ProductoCard.tsx         Ficha seleccionable de producto (chat)
    PanelFondo.tsx           Galería de fondos y subida de foto (chat)
    admin/
      AdminTabs.tsx          Tabs + estado compartido productos/decoraciones
      ProductosTab.tsx / ProductoForm.tsx
      DecoracionesTab.tsx / DecoracionForm.tsx
      ImageInput.tsx         Input de imagen con preview, reutilizable
  lib/
    db.ts                    Conexión sqlite + esquema + semilla
    products.ts               CRUD de productos sobre sqlite
    decoraciones.ts           CRUD de decoraciones sobre sqlite
    catalog-data.ts           Datos/funciones puras (semilla, filtros) — sin fs, usable en cliente
    store.ts                  Guardar/borrar imágenes subidas
    backgrounds.ts            Fondos de stock
    gemini.ts                 Cliente y nombres de modelo Gemini
    types.ts
```

## Lo que este demo NO es

- SQLite en archivo local: no sirve en plataformas serverless con filesystem efímero (ej. Vercel
  borra `data/` entre despliegues). Para producción real, Postgres + un bucket de storage.
- No hay persistencia de la *sesión de chat* del cliente. Al recargar `/` se pierde la
  conversación (el catálogo y las decoraciones sí persisten, viven en sqlite).
- No hay captura de lead ni cotización.
- No hay límite de generaciones por sesión — en producción hace falta para controlar costo.
- Los fondos de stock (`backgrounds.ts`) no son editables desde el panel todavía, solo productos
  y decoraciones.
# test
