# 0035 — Editar las estructuras desde el motor

Fecha: 2026-10-02
Estado: propuesto (es el siguiente paso, no está implementado)
Continúa: ADR-0034 (el motor del diseñador arma las tres estructuras)

## Dónde estamos

ADR-0034 puso el motor del diseñador a armar el arco, la columna y la guirnalda: coloca cada globo, cuenta lo
que se compra y emite el dibujo. Lo que hay hoy, funcionando y probado:

| Pieza | Qué existe |
|---|---|
| Motor | `app/arco/`, `app/columna/`, `app/guirnalda/`, `app/organico/`, con sus oráculos congelados (531 vectores, 93 494 globos) |
| Puerta | `armado_arco.py`, `armado_columna.py`, `armado_guirnalda_organica.py` |
| Contrato | `armado-arco.v1`, `armado-columna.v1`, `armado-guirnalda-organica.v1` dentro del plan |
| Conteo | `plan.py` cuenta con el motor cuando la pieza trae su armado |
| Vista previa | `/api/plan-armado-arco` y `/api/plan-armado-guirnalda-organica`, que devuelven el SVG |
| Pantalla | `BloqueArco` muestra el dibujo del motor, el conteo, la compra, las medidas y los avisos |
| IA | `consultar_opciones_armado` y `armar_estructura` |

**Lo que no hay es edición.** El armado se compone una vez —lo arma el modelo o lo completa la receta— y a
partir de ahí la pieza es de solo lectura. Cambiar un arco de espiral a chevron, subirlo diez centímetros o
pasar de globos R12 a R18 no se puede hacer desde la propuesta.

Y el motor ya publica todo lo que haría falta para hacerlo:

- `opciones_admitidas()` devuelve los **catorce patrones** con su nombre, su descripción, sus roles, cuántos
  colores admite cada uno y **cada mando con su clave, etiqueta, rango, paso, valor por defecto y ayuda**.
- `limites_de(armado, pieza)` devuelve los rangos **vivos**: con globos R36 el arco no puede ser tan angosto
  como con R12, y el motor lo sabe.
- La ruta de vista previa ya recalcula y devuelve el dibujo nuevo con cada cambio.

O sea: la pieza que falta es la edición, no el motor.

## Decisión

**El decorador y el modelo editan la misma estructura por el mismo sitio: el armado.** No habrá dos caminos.

Cambiar una pieza es cambiar su `armado_*` y volver a pedir el dibujo; guardar es escribir ese armado en el
plan y volver a resolver. La gráfica no se recalcula nunca en el navegador: la emite el mismo motor que colocó
y contó los globos.

### Qué se puede cambiar, por pieza

Lo que sigue **ya lo admite el contrato y lo valida la puerta**; lo que falta es ofrecerlo.

**Arco** — el patrón (`solido`, `bloques`, `apilado`, `espiral`, `espiralPunteada`, `zigzag`, `chevron`,
`diamante`, `punteado`, `franjas`, `floral`, `ombre`, `arcoiris`, `doslados`) con los mandos propios de cada
uno; la forma (alto, semicírculo, herradura), el ancho, el alto y los globos a lo ancho; el tamaño de globo y
cómo se infla; las capas a lo ancho y las secciones por altura, que es pintar racimo por racimo.

**Columna** — el patrón, el remate (ninguno, globo, racimo, estrella o corazón de foil), los globos por capa,
la altura, la base y el escalonado.

**Guirnalda** — no tiene patrón: tiene forma (largo, altura, pendiente, ondulación, colgado, festones, de qué
lado carga), volumen (grosor en los extremos y en el centro, irregularidad, relleno, racimo, salientes), la
mezcla de tamaños, la paleta con el acabado y el papel de cada color, y los adornos.

### Cómo se edita

1. **Vista previa en vivo.** El navegador manda el armado en borrador a la ruta de vista previa y pinta lo que
   vuelve. El gemelo ya escrito es el editor de guirnalda de ADR-0032: `debounce`, cancelación con
   `AbortController`, gana la última respuesta, y los cuatro estados (cargando, vacío, error, listo) explícitos.
   Nada se guarda todavía.
2. **Guardar.** Va por `/api/plan-editar`, que escribe el armado en el plan, vuelve a resolver y vuelve a
   firmar. Es lo que mueve dinero, así que pasa por donde ya pasa todo lo que lo mueve.
3. **El modelo usa lo mismo.** `armar_estructura` ya compone un armado y lo valida contra la pieza; editar es
   armar otra vez con los cambios. Lo único que le falta es poder partir del armado que la pieza ya tiene en
   vez de empezar de cero.

### Lo que los controles tienen que respetar

- **Los rangos salen de `limites_de`, no de la interfaz.** Subir el tamaño del globo cambia el ancho mínimo
  del arco; el control tiene que enterarse. Una lista de rangos escrita en el cliente se desincroniza el día
  que el motor cambie uno.
- **Los mandos salen de `opciones_admitidas`.** Cada patrón tiene los suyos, con su etiqueta y su ayuda ya
  escritas. Si allá se añade un patrón, aquí aparece sin tocar nada.
- **Lo que el motor corrige se dice.** Un alto imposible se ajusta y el motor lo explica en español; esos
  avisos son del cliente, no del registro técnico.
- **El cliente no calcula.** Ni medidas, ni conteo, ni totales, ni geometría. Lo único que la pantalla hace con
  un número es darle formato.

## Alternativas descartadas

**Un editor por pieza, escrito a mano.** Es lo que obligaría a copiar los rangos y los mandos al cliente, que
es justo la duplicación que ADR-0034 vino a quitar.

**Editar el plan directamente y que el motor se entere después.** Deja un momento en el que lo que se ve y lo
que se cobra no coinciden, que es el problema del que se partía.

**Dos caminos, uno para el decorador y otro para el modelo.** Dos sitios donde validar lo mismo, y uno de los
dos se queda atrás.

## Por dónde empezar

1. **El arco, que es el que más mandos tiene** y el que ya tiene bloque en la tarjeta: añadirle los controles
   contra `opciones_admitidas` y `limites_de`, con la vista previa en vivo.
2. **Pintar racimo por racimo**: el SVG del motor ya marca cada globo con su sección, su capa, su fila y su
   color (`data-b`, `data-c`, `data-f`, `data-k`), y `VistaMotor` ya resuelve el clic. Falta escribirlo en
   `capas` y `secciones`.
3. **La columna y la guirnalda**, con el mismo molde.
4. **Que el modelo parta del armado existente** en `armar_estructura`.

## Consecuencias

- Un armado editado cambia el `plan_hash`, porque el armado va dentro del plan firmado. Es correcto: es otra
  decoración.
- La vista previa pide el dibujo a Python en cada cambio. El motor orgánico es el más caro de los tres (~230 ms
  por pieza); el `debounce` y el `lru_cache` que ya existen lo cubren, pero conviene medirlo antes de dar por
  bueno un deslizador continuo.
- Lo que hoy no se puede editar seguirá sin poder editarse: pared, centro de mesa, aro, semiarco y escultura no
  tienen motor migrado y se quedan con el camino de siempre.
