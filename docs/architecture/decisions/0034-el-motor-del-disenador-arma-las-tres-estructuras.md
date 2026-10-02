# 0034 — El motor del diseñador arma el arco, la columna y la guirnalda

Fecha: 2026-10-01
Estado: en ejecución
Sucede a: ADR-0033 (motor de columna migrado, sin cablear)

## Problema

Este repositorio no tiene un motor de armado. Tiene una **estimación**: para un arco, `plan.py` calcula el
perímetro de media elipse (`_eje`, `plan.py:1168`), lo multiplica por un ancho de banda sacado de una tabla
(`_BAND_WIDTH`, `plan.py:98`) y lo divide por el área media de la mezcla con un factor de densidad
(`_DENSITY_LAMBDA = {sencilla: 2,8, media: 3,6, lujosa: 4,5}`, `plan.py:117`). La columna es la misma fórmula
con el eje cambiado por la altura; la guirnalda, con el eje cambiado por el largo. La diferencia entre un arco
y una columna, en todo el sistema, son **cuatro líneas**.

Encima de eso, `patron_color.py` tiende una rejilla genérica de `filas × columnas` y decide de qué color es
cada celda con siete modos, y `VistaPatron.tsx` recibe esa matriz de índices y **vuelve a calcular la
geometría en el cliente** para dibujarla.

De ahí salen tres problemas que no se arreglan por separado:

1. **Nadie coloca un globo.** El sistema sabe cuántos globos caben, no dónde va cada uno. No puede decir si el
   patrón se lee, si la espiral cierra, si el arcoíris reparte sus bandas o si un rombo cabe en la banda.
2. **Hay dos geometrías.** La que cuenta (Python) y la que dibuja (el cliente). Lo que se ve no es lo que se
   cobra, y nada obliga a que coincidan.
3. **El dibujo no se parece a una decoración.** Celdas de una rejilla, no globos empaquetados.

Mientras tanto, el repositorio hermano `clasificador-decoraciones` sí tiene un motor: coloca cada globo sobre
una línea guía con empaquetado hexagonal, compensa la curva, aplica catorce patrones de color, admite capas a
lo ancho y secciones por altura, cuenta lo que lleva, calcula la compra con desperdicio y **emite su SVG**.
Está escrito contra el catálogo Sempertex y contra la técnica de armado real.

## Decisión

**El motor de `clasificador-decoraciones` es el dueño de cómo se arma un arco, una columna y una guirnalda.**
Se migra 1 a 1 a Python, con su dibujo, y `pictures` se adapta a él —no al revés—. Cuando los dos difieran,
manda el motor.

Cinco consecuencias concretas:

### 1. Un paquete de Python por motor, con un módulo por archivo del original

`app/arco/`, `app/columna/`, `app/guirnalda/` y `app/organico/`, con los mismos nombres de archivo que allá
(`tipos`, `patrones`, `limites`, `motor`, `medidas`…), para que un cambio en el repositorio dueño se encuentre
aquí sin buscar. Lo común vive en `app/motores/`.

### 2. El dibujo también se migra

ADR-0033 dejó el SVG fuera por considerarlo pantalla. Deja de serlo: **lo que el cliente aprueba es la
imagen**. Si la gráfica se vuelve a pintar en el cliente hay dos motores otra vez y el que se ve no es el que
se cobra. El SVG lo emite Python, el cliente lo muestra, y los vectores de oro comparan su **sha256** caso por
caso: la paridad del dibujo es verificable, no una impresión.

El SVG es derivado: no entra en el plan, ni en el snapshot, ni en `plan_hash`. Viaja por su propia ruta
(`/api/plan-armado-arco`), no dentro de cada resolución.

### 3. El motor cuenta lo que se compra, cuando la pieza trae su armado

Es la decisión que ADR-0033 dejó abierta. Una estructura con `armado_arco` o `armado_columna` se cuenta con el
motor: el eje es su largo real, el total son los globos que colocó, y el reparto por material es su conteo.
Una estructura sin armado sigue por el camino de siempre.

No es una concesión a medias: es lo que hace el cambio reversible y lo que impide mover el `plan_hash` de los
planes ya aprobados, que no llevan armado. Los planes nuevos sí lo llevan, así que en la práctica el motor
pasa a ser quien cuenta. El camino viejo no se borra porque **pared, centro de mesa, aro, semiarco y escultura
lo siguen necesitando**: lo que se retira es su autoridad sobre estas tres piezas.

### 4. El azar y la aritmética se replican bit a bit

La prueba de que una migración es 1 a 1 no es leer los dos códigos: es un oráculo congelado. Se generan desde
el motor original con `scripts/migracion/vectores-*.ts` y se comparan globo por globo, aviso por aviso y sha
por sha. Arco: 259 vectores, 35 653 globos. Guirnalda: 199 vectores, 25 694 globos. Columna: 135 vectores de
geometría más 60 de dibujo.

Para llegar ahí hubo que replicar lo que Python y JavaScript no comparten, y una cosa que no era evidente:

> **V8 no usa la libm del sistema.** Lleva su propio puerto de fdlibm para `sin`, `cos`, `atan`, `atan2` y
> `pow`, y escribe `hypot` en JavaScript con suma de Kahan. Medido sobre 4000 valores: `cos` difiere 96 veces,
> `sin` 85, `atan2` 698, `pow` 11 y `hypot` 1434, siempre en el último bit. `sqrt` no difiere nunca, porque
> IEEE-754 lo fija.

Un bit no se ve en el dibujo, pero sí en el **orden**: los motores ordenan los globos por profundidad, y dos
globos simétricos de la misma fila tienen una `z` que en teoría es idéntica y en coma flotante no lo es. Con
la libm del sistema, 12 de los 259 casos del arco intercambiaban dos globos. Por eso `app/motores/ieee754.py`
porta el fdlibm de V8 y `app/motores/mate.py` es la única puerta por la que los motores hacen trigonometría.

#### `Math.pow` es la excepción, y el problema no es del puerto

V8 tiene **dos** `Math.pow` y elige con `--use-std-math-pow`, **activada por defecto**: la de por defecto pone
los casos especiales de JavaScript y delega en el `std::pow` del CRT con el que se compiló Node; el puerto de
fdlibm solo entra con `--no-use-std-math-pow`. Las dos difieren entre sí en **331 de 4000** casos corrientes
(`Math.pow(10, 23)` sale distinto, y el correctamente redondeado es el de fdlibm).

De ahí sale un hecho incómodo que no es nuestro: **el motor original no da el mismo dibujo en Windows que en
Linux** cuando un patrón pasa por la compensación de la curva, porque Node se lleva la `pow` de su SDK y no
la del sistema. Medido aquí, el `**` de CPython coincide con el `pow` del sistema en los 4000 casos y Node se
desvía de él en 11.

Entre dos opciones imperfectas, `mate.pow` usa el camino del sistema con la semántica de JavaScript encima
—el que falla 11 veces de 4000 en vez de 331— y los 259 vectores pasan con él. `mate.pow_fdlibm` queda
disponible para comparar. Si algún día hace falta paridad exacta también en `pow`, el arreglo está en el
repositorio dueño: dejar de llamar a `Math.pow` en el motor, o fijar `--no-use-std-math-pow` al generar los
vectores. Esto está anotado aquí porque se descubrió midiendo, no leyendo.

Dos avisos más de la misma medición, para quien actualice: si V8 se compila con
`v8_use_libm_trig_functions`, `sin` y `cos` dejan de ser fdlibm; y V8 `main` ya migró toda esta aritmética a
LLVM-libc, así que **una subida de versión de Node cambiará los resultados de la trigonometría**, no solo los
de `pow`. Los vectores de oro lo detectarían al instante, que es justo para lo que están.

### 5. La IA recibe las herramientas del diseñador, no una lista escrita a mano

`opciones_admitidas()` sale del motor: los catorce patrones con sus mandos, rangos, ayudas y mínimos de color.
Si allá se añade un patrón o cambia un rango, aquí se ve sin tocar nada.

## Alternativas descartadas

**Copiar el motor en TypeScript dentro de `pictures`.** Dejaría las reglas comerciales fuera de Python, contra
la regla de propiedad del repositorio, y mantendría dos geometrías: la que dibuja y la que cobra.

**Migrar sin el dibujo, como en ADR-0033.** Es lo que ya se hizo con la columna y lo que la dejó un año sin
cablear: un motor que coloca globos y una gráfica que los vuelve a colocar no es una migración, son dos
motores.

**Mejorar la estimación actual con mejores constantes.** No resuelve ninguno de los tres problemas: seguiría
sin colocar un globo, seguirían siendo dos geometrías y seguiría sin parecerse a una decoración.

**Cambiar `_total_globos` para todas las piezas de golpe.** Mueve el `plan_hash` de todos los planes en vuelo
con arco, columna o guirnalda, y con él el token HMAC, la caché, la auditoría y las imágenes guardadas por
hash. El cambio por armado da el mismo destino sin ese coste.

## Consecuencias

- Una pieza con armado cuenta distinto que antes. Es el objetivo, y por eso solo pasa con armado.
- `patron_color.v1` deja de ser el camino de estos tres tipos. No se retira: lo siguen usando la pared y el
  centro de mesa, que no tienen motor migrado.
- `VistaPatron.tsx` deja de calcular geometría para estas tres piezas: recibe el SVG del motor.
- Los vectores de oro pesan: 3,1 MB el arco y 1,7 MB la guirnalda. Es el precio de poder demostrar la
  paridad; se compactó guardando los globos uno a uno solo en los casos que cubren cada camino del motor y el
  sha en los demás.
- Hay dos contratos nuevos de armado en el plan (`armado_arco`, `armado_columna`) y dos listas de resueltos
  fuera del snapshot (`armados_arco`, `armados_columna`).

## Vuelta atrás

Quitar el armado de la estructura devuelve la pieza al camino viejo, sin tocar código: el motor solo cuenta
cuando hay armado. Los paquetes `app/arco/`, `app/guirnalda/` y `app/organico/` quedan sin consumidor, como
quedó `app/columna/` entre ADR-0033 y este documento, y no estorban.

Desplegar la revisión anterior de la aplicación y de `ai-api` a la vez sigue siendo la recuperación completa.

## Cómo se cambia un criterio de armado a partir de ahora

En `clasificador-decoraciones` primero. Después se vuelven a generar los vectores allá
(`scripts/migracion/vectores-arco.ts`, `vectores-guirnalda.ts`, `vectores-columna.ts`,
`vectores-columna-dibujo.ts`), se traen enteros y se replica el cambio aquí hasta que las pruebas pasen. Nunca
al revés, y nunca regenerando el oráculo desde la implementación que se está probando.
