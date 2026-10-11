# Humo e2e (`npm run e2e:humo`)

Recorre la app en un Chrome de verdad, sin pagar nada, en 1 a 2 minutos. Existe porque un fallo real (la «Hoja de armado»
del Taller abría detrás de un modal nativo y no respondía) solo lo ve un navegador. **No va en CI**: necesita Chrome.

## Qué recorre

1. `/login` (con `APP_PASSWORD`) → sesión iniciada y llegada a `/asistente`.
2. `/asistente`: conmutador Clásica/Guiada, «Explorar catálogo» en el menú, ideas (≥ 1 tarjeta) y «Cuánto cuesta»
   (un precio o un «no pude» claro; se omite si el Python local no responde).
3. `/` (chat clásico), `/catalogo` (lista productos) y `/3d/modulos`.
4. `/3d`: plantilla → «Lista de compra» (Bomba o «Helio y cinta») → «Hoja de armado» (se omite con la bandera apagada)
   → «Imprimir» recibe el clic y al imprimir solo se ve la hoja → cerrar y el foco vuelve a «Lista de compra».
   → «Añadir» por repositorio (REQ-013 fase 5): el selector Todos · Sempertex · Mobiliario · Escenografía, se añade una «Silla
   Tiffany» de Mobiliario, Escenografía lista sus fondos y Sempertex vuelve a sus pestañas. **Se omite** (`SKIPPED`, con el motivo)
   si el despliegue no trae la ruta `/api/catalogo/repositorios` (anterior a esa fase) o si la interfaz por repositorio está
   apagada (fila `catalogo_ui_repositorios` o variable `CATALOGO_UI_REPOSITORIOS`); falla si la ruta dice `ui: true` y el
   selector no sale.

Cada paso sale como `PASS`, `FAIL` o `SKIPPED` con su duración. Un `FAIL` guarda una captura; el informe JSON y las
capturas quedan en `%TEMP%/e2e-humo/<fecha>/` (la ruta se imprime al final). Sale con código 1 si algún paso falla.

## Cómo correrlo

Desde la raíz del repo, contra el servidor de desarrollo local (no lo reinicia ni lo toca):

```bash
npm run e2e:humo -- --env-file .env.local
```

Contra producción:

```bash
npm run e2e:humo -- --base https://demo-decoracion.vercel.app --env-file <archivo con APP_PASSWORD de producción>
```

- Producción pide la contraseña compartida: tiene que estar en el entorno como `APP_PASSWORD` (con `--env-file`, o
  exportada). Nunca se imprime y se tacha de los mensajes de error. Un `next dev` local no la pide, pero el paso de login
  la usa si está.
- Chrome: usa `PLAYWRIGHT_CHROMIUM_EXECUTABLE` o, si no, `C:/Program Files/Google/Chrome/Application/chrome.exe`.
- Los turnos de chat con el asistente (ideas y precio, dos en total) solo corren con la IA local de Claude sin costo
  (`/api/ia/salud` dice `predeterminado: claude` en una base local). En una base remota o con otra IA quedan `SKIPPED`;
  `--con-chat` los incluye y entonces se pagan.

## Sin gasto

Una guardia en el navegador aborta cualquier llamada que no sea una lectura a las rutas de imágenes y de IA de pago
(`/api/generate`, `/api/guiada-imagen`, `/api/render-3d-imagen`, `/api/modulos-render`, `/api/chat`…) y el tercer turno del
asistente. El último paso del informe, «guardia de gasto», falla si la interfaz intentó alguna. La lógica de la guardia se
prueba sin navegador con `npm run test-e2e-humo-guardia`.

## Qué asume

La app sin el modo «solo guiada» (D-039): `/`, `/catalogo` y el conmutador Clásica/Guiada existen, y el login lleva a
`/asistente`. Contra un despliegue o un servidor local más viejo, «aterriza en /asistente» falla y los pasos de la vista
clásica y el catálogo pueden fallar por redirección: se ve en el mensaje.
