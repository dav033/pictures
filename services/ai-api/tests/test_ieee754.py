"""``app/motores/ieee754.py`` contra lo que de verdad devuelve V8, bit a bit.

El oráculo lo genera Node (v24.19.0, V8 13.6) y vive en ``tests/datos/``. No se regenera para que una
prueba pase: si una falla, o el puerto se desvió, o se cambió de versión de Node a propósito y entonces el
commit lo dice y explica qué caso cambió. Se compara con ``==`` sobre los ``float`` —cero tolerancia, un ulp
de diferencia es un fallo— y los NaN con ``math.isnan``, porque JavaScript no distingue un NaN de otro y los
dos lados eligen patrones de bits distintos (``7ff8…`` contra ``fff8…`` contra un NaN con señal).

Tres archivos de datos:

``ieee754-v8.json``
    4000 valores al azar por función, tal como los entregó Node con las opciones por defecto:
    ``{"cos": [[x, resultado]], "sin": …, "at2": [[y, x, resultado]], "pw": [[base, exp, resultado]],
    "hy": [[x, y, resultado]], "sq": [[x, resultado]]}``.

``ieee754-v8-pow-fdlibm.json``
    Las mismas 4000 bases y exponentes evaluados con ``node --no-use-std-math-pow``. Es el oráculo de
    ``pow``, y el párrafo siguiente explica por qué hacen falta dos.

``ieee754-v8-exp.json``
    El oráculo de ``exp``, en tres lotes: ``exp``, 4000 valores muestreados **como los calcula el motor
    orgánico** (``grandesAbajo · 2,2 · RANGO[t] · (baseza − 0,4) + 0,6 · carga · RANGO[t]``, que es el único
    sitio donde los motores piden una exponencial); ``limites``, los umbrales internos de ``e_exp.c`` con su
    valor a cada lado y los casos de signo, en hexadecimal; y ``asociacion``, 3000 valores donde las **dos
    formas de asociar la suma final** de ``e_exp.c`` dan bits distintos, que es lo que fija que el puerto
    agrupe como el original y no «como también sale lo mismo».

``ieee754-v8-extra.json``
    Casos límite y argumentos enormes, con los números en hexadecimal de sus 64 bits porque JSON no sabe
    escribir ``NaN``, ``Infinity`` ni ``-0``. Ahí están los umbrales internos de cada función (pi/4, 3pi/4,
    2^20·pi/2, 2^-27, 0.3, 0.78125, 0.4375, 1.1875, 2.4375, 2^66) con su valor justo a cada lado, los
    argumentos que fuerzan el camino de Payne-Hanek (1e7 … 1e300) y todas las combinaciones de signo de
    ``±0``, ``±Infinity`` y ``NaN``.

**Por qué ``pow`` tiene su propio oráculo.** V8 13.6 trae dos implementaciones de ``Math.pow`` y la elige
con una opción, ``--use-std-math-pow``, que **viene activada**: ``v8::internal::math::pow``
(``src/numbers/ieee754.cc``) añade los casos especiales de JavaScript y delega el resto en el ``std::pow``
de la biblioteca C con la que se compiló Node. Su propio puerto de fdlibm, ``base::ieee754::legacy::pow``,
solo se usa con ``--no-use-std-math-pow``. Lo que eso implica, medido en esta máquina sobre los 4000 casos:

* el ``Math.pow`` por defecto no es reproducible desde Python, y no por falta de cuidado: ni el ``**`` de
  CPython lo iguala. CPython llama a ``pow`` de ``ucrtbase.dll`` y coincide con ella en los 4000 casos,
  pero **Node se desvía de ``ucrtbase`` en 11**, porque enlaza el CRT estáticamente y se lleva la ``pow``
  del SDK con el que se construyó, no la del sistema;
* las dos implementaciones de V8 difieren entre sí en 331 de los 4000, siempre en 1 ulp, y también en
  valores nada exóticos: ``Math.pow(10, 23)`` da ``44b52d02c7e14af7`` por defecto y ``…af6`` con fdlibm,
  y el redondeo correcto es ``…af6``;
* o sea que el ``Math.pow`` por defecto depende de la máquina que compiló Node. El motor de TypeScript, si
  usa ``Math.pow``, no da el mismo dibujo en Windows y en Linux.

Por eso ``app.motores.ieee754.pow`` porta ``legacy::pow``, que sí es código de V8 e igual en todas las
plataformas, y se comprueba contra el oráculo de fdlibm sin ninguna tolerancia. Para que el puerto y el
motor original coincidan de verdad hay que ejecutar Node con ``--no-use-std-math-pow``, o no llamar a
``Math.pow``. En los 325 casos límite de ``ieee754-v8-extra.json`` las dos implementaciones coinciden salvo
en tres: ``pow(2, -0.5)``, ``pow(0.5, -0.5)`` y ``pow(10, 23)``.

**``exp`` no tiene el problema de ``pow``, pero tiene uno propio y pequeño.** No hay ninguna opción de V8
que cambie de implementación, y el puerto de ``e_exp.c`` iguala a Node en todo lo que se ha medido: 2 892 661
comparaciones (la rejilla de 0,001 en [-3, 3], 20 000 ulps alrededor de cada entero y medio entero, los
umbrales internos con su vecindario y 2,5 millones de valores al azar) y **cero diferencias**, frente a las
que da ``math.exp``, que se desvía en el 9,3 %. La excepción es un único punto: en ``x == 1`` exactamente, y
solo ahí, Node devuelve ``Math.E`` y la fórmula de fdlibm se queda un ulp por encima. No hay aquí una copia
de la fuente de V8 con la que confirmar por qué —que un motor quiera garantizar ``Math.exp(1) === Math.E`` es
una conjetura razonable, no un hecho comprobado—, así que el puerto lo reproduce como lo que es, una medida,
y ``test_exp_de_uno_no_sale_de_la_formula`` lo deja escrito para que nadie lo borre por parecer de más.

``sin``, ``cos``, ``atan``, ``atan2`` y ``hypot`` no tienen este problema: ahí Node por defecto ya es el
código propio de V8 y el puerto lo iguala en los 4000 casos al azar y en todos los límites. (``sin`` y
``cos`` también tienen una opción, ``--no-use-libm-trig-functions``, pero solo existe si la compilación
define ``V8_USE_LIBM_TRIG_FUNCTIONS``, que no es el caso de este Node: por eso coinciden con fdlibm.)
"""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path
from typing import Callable

import pytest

from app.motores.ieee754 import atan, atan2, cos, exp, hypot, pow, sin

DATOS = Path(__file__).resolve().parent / "datos"
AL_AZAR: dict[str, list[list[float]]] = json.loads(
    (DATOS / "ieee754-v8.json").read_text(encoding="utf-8")
)
POW_FDLIBM: dict[str, list[list[float]]] = json.loads(
    (DATOS / "ieee754-v8-pow-fdlibm.json").read_text(encoding="utf-8")
)
EXTRA: dict[str, list[list[str]]] = json.loads(
    (DATOS / "ieee754-v8-extra.json").read_text(encoding="utf-8")
)
EXP: dict[str, list[list[float]] | list[list[str]]] = json.loads(
    (DATOS / "ieee754-v8-exp.json").read_text(encoding="utf-8")
)


# ---------------------------------------------------------------------------
# Comparar como lo haría JavaScript
# ---------------------------------------------------------------------------


def de_hex(texto: str) -> float:
    """El double cuyos 64 bits son ese hexadecimal, que es como viaja ``-0`` o ``NaN`` en el JSON."""
    return float(struct.unpack(">d", bytes.fromhex(texto))[0])


def bits(valor: float) -> int:
    """Los 64 bits del double: distingue ``0.0`` de ``-0.0``, que ``==`` no distingue."""
    return int(struct.unpack(">Q", struct.pack(">d", valor))[0])


def igual(obtenido: float, esperado: float) -> bool:
    """Idénticos para JavaScript: mismo bit a bit, salvo que los dos sean NaN (cualquier NaN vale)."""
    if math.isnan(esperado):
        return math.isnan(obtenido)
    return not math.isnan(obtenido) and bits(obtenido) == bits(esperado)


def _comprobar(
    nombre: str,
    fn: Callable[..., float],
    casos: list[list[float]],
    n_args: int,
) -> None:
    """Exige cero diferencias y, si hay alguna, enseña las primeras con sus bits."""
    fallos: list[str] = []
    for caso in casos:
        argumentos = caso[:n_args]
        esperado = caso[n_args]
        obtenido = fn(*argumentos)
        if not igual(obtenido, esperado):
            fallos.append(
                "%s(%s): node=%r (%016x) python=%r (%016x)"
                % (
                    nombre,
                    ", ".join(repr(a) for a in argumentos),
                    esperado,
                    bits(esperado),
                    obtenido,
                    bits(obtenido),
                )
            )
    assert not fallos, "%d de %d difieren de V8:\n%s" % (
        len(fallos),
        len(casos),
        "\n".join(fallos[:10]),
    )


def _comprobar_hex(nombre: str, fn: Callable[..., float], clave: str, n_args: int) -> None:
    """Lo mismo para el lote con los números en hexadecimal."""
    casos = [[de_hex(h) for h in caso] for caso in EXTRA[clave]]
    _comprobar(nombre, fn, casos, n_args)


# ---------------------------------------------------------------------------
# Los 4000 valores al azar
# ---------------------------------------------------------------------------


def test_cos_al_azar() -> None:
    _comprobar("cos", cos, AL_AZAR["cos"], 1)


def test_sin_al_azar() -> None:
    _comprobar("sin", sin, AL_AZAR["sin"], 1)


def test_atan2_al_azar() -> None:
    _comprobar("atan2", atan2, AL_AZAR["at2"], 2)


def test_hypot_al_azar() -> None:
    _comprobar("hypot", hypot, AL_AZAR["hy"], 2)


def test_pow_al_azar() -> None:
    """Contra ``legacy::pow``; el encabezado del módulo explica por qué no contra el ``pow`` por defecto."""
    _comprobar("pow", pow, POW_FDLIBM["pw"], 2)


def test_los_dos_pow_de_v8_no_coinciden() -> None:
    """Deja escrito por qué hay dos oráculos de ``pow``, y en qué se diferencian.

    No comprueba nada de este repositorio: compara los dos archivos de datos entre sí. Está para que la
    razón de tener dos no viva solo en un comentario, y para que salte si alguien regenera uno de ellos con
    la opción equivocada —ahí el número cambia de golpe— o si una versión futura de Node unifica las dos
    implementaciones, que sería la buena noticia que permitiría quedarse con un solo archivo.
    """
    por_defecto = AL_AZAR["pw"]
    fdlibm = POW_FDLIBM["pw"]
    assert [c[:2] for c in por_defecto] == [c[:2] for c in fdlibm], "no son los mismos argumentos"
    distintos = [a for a, b in zip(por_defecto, fdlibm) if bits(a[2]) != bits(b[2])]
    assert len(distintos) == 331, (
        "el std::pow de Node y el legacy::pow de V8 difieren en %d de %d casos, no en 331: "
        "o se regeneraron los datos con otra versión de Node, o uno de los dos archivos se generó "
        "con la opción --use-std-math-pow equivocada" % (len(distintos), len(por_defecto))
    )
    # El caso que mejor lo resume: 10**23 no es representable y las dos redondean a distinto lado.
    assert pow(10.0, 23.0) == 9.999999999999999e22
    assert pow(10.0, 23.0) != 1.0000000000000001e23


def test_sqrt_al_azar() -> None:
    """``math.sqrt`` ya es ``Math.sqrt``: IEEE-754 obliga a redondear bien la raíz, y se comprueba."""
    _comprobar("sqrt", math.sqrt, AL_AZAR["sq"], 1)


def test_exp_al_azar() -> None:
    """Sobre el rango que pide el motor orgánico, muestreado como él lo calcula."""
    _comprobar("exp", exp, EXP["exp"], 1)  # type: ignore[arg-type]


def test_la_libm_no_sirve_para_exp() -> None:
    """Deja escrito para qué está el puerto de ``exp``, con el número medido.

    No comprueba este repositorio: compara ``math.exp`` con el oráculo de Node. Si algún día la libm del
    sistema coincidiera en los 4000, este módulo podría dejar de portar ``exp``, y entonces el que falla es
    este caso y no uno de los motores.
    """
    distintos = [c for c in EXP["exp"] if not igual(_libm_exp(float(c[0])), float(c[1]))]
    assert len(distintos) == 297, (
        "math.exp se desvía de Node en %d de los %d casos del motor, no en 297: o cambió la libm de este "
        "equipo, o se regeneró el oráculo con otra versión de Node"
        % (len(distintos), len(EXP["exp"]))
    )


def _libm_exp(x: float) -> float:
    """``math.exp`` sin que un desborde lance, que es lo que hace ``Math.exp``."""
    try:
        return math.exp(x)
    except OverflowError:
        return math.inf


# ---------------------------------------------------------------------------
# Umbrales, argumentos enormes y casos límite
# ---------------------------------------------------------------------------


def test_cos_limites() -> None:
    _comprobar_hex("cos", cos, "cos", 1)


def test_sin_limites() -> None:
    _comprobar_hex("sin", sin, "sin", 1)


def test_atan_limites() -> None:
    _comprobar_hex("atan", atan, "atan", 1)


def test_atan2_limites() -> None:
    _comprobar_hex("atan2", atan2, "at2", 2)


def test_pow_limites() -> None:
    _comprobar_hex("pow", pow, "pw", 2)


def test_exp_limites() -> None:
    casos = [[de_hex(h) for h in caso] for caso in EXP["limites"]]  # type: ignore[arg-type]
    _comprobar("exp", exp, casos, 1)


def test_exp_asocia_la_suma_final_como_el_original() -> None:
    """3000 valores donde las dos formas de agrupar la última suma de ``e_exp.c`` dan bits distintos.

    El último paso es ``y = 1 - ((lo - (x*c)/(2-c)) - hi)``. Agruparlo como ``1 - (lo - q) + hi`` es la misma
    expresión en álgebra y **otro número** en coma flotante: difieren en uno de cada cinco valores. Node
    coincide con la agrupación del original en los 3000, así que esto es lo que impide «simplificar» esa
    línea en un refactor.
    """
    casos = [[de_hex(h) for h in caso] for caso in EXP["asociacion"]]  # type: ignore[arg-type]
    _comprobar("exp", exp, casos, 1)


def test_exp_de_uno_no_sale_de_la_formula() -> None:
    """El único punto medido en el que Node no devuelve lo que da ``e_exp.c``: ``exp(1)``.

    La fórmula se queda en ``2.7182818284590455`` y Node devuelve ``Math.E``, un ulp por debajo y el double
    correctamente redondeado. Está aparte porque es un caso especial **medido, no leído** en la fuente de V8:
    si alguna vez se consigue mirar esa fuente y resulta que no hay tal caso especial, lo que hay que revisar
    es este caso y la línea que lo reproduce, no los motores.
    """
    assert exp(1.0) == math.e
    assert bits(exp(1.0)) == 0x4005BF0A8B145769
    # Y los vecinos inmediatos sí salen de la fórmula, que es lo que lo hace un punto y no un tramo.
    assert bits(exp(0.9999999999999999)) == 0x4005BF0A8B145769
    assert bits(exp(1.0000000000000002)) == 0x4005BF0A8B14576B


def test_hypot_limites() -> None:
    _comprobar_hex("hypot", hypot, "hy", 2)


def test_sqrt_limites_no_negativos() -> None:
    """``Math.sqrt`` de un negativo es ``NaN``; ``math.sqrt`` lanza. Lo comprueba el test siguiente."""
    casos = [[de_hex(h) for h in caso] for caso in EXTRA["sq"]]
    _comprobar("sqrt", math.sqrt, [c for c in casos if not c[0] < 0.0], 1)


def test_sqrt_de_un_negativo_lanza_en_python() -> None:
    """La trampa al portar: donde el motor sigue con ``NaN``, Python corta la ejecución.

    No es un defecto de ``math.sqrt`` ni algo que este módulo deba envolver —``Math.sqrt`` solo se llama
    sobre cantidades que el motor ya sabe no negativas—, pero queda escrito: si alguna vez una raíz recibe
    un negativo, en JavaScript el dibujo sale con ``NaN`` y en Python se levanta ``ValueError``.
    """
    for caso in EXTRA["sq"]:
        x = de_hex(caso[0])
        if x < 0.0:
            assert math.isnan(de_hex(caso[1])), x
            with pytest.raises(ValueError):
                math.sqrt(x)


# ---------------------------------------------------------------------------
# Casos especiales escritos a mano
#
# Están en el oráculo, pero escritos aquí se leen: son las reglas de JavaScript que no se deducen del
# algoritmo y las que un refactor rompe sin que ningún valor al azar se queje.
# ---------------------------------------------------------------------------

INF = float("inf")
NAN = float("nan")


@pytest.mark.parametrize("x", [INF, -INF, NAN])
def test_sin_y_cos_de_infinito_y_nan_son_nan(x: float) -> None:
    assert math.isnan(sin(x))
    assert math.isnan(cos(x))


def test_sin_y_cos_conservan_el_cero_con_signo() -> None:
    """``Math.sin(-0)`` es ``-0``, no ``0``: el signo sobrevive y el SVG lo escribiría distinto."""
    assert bits(sin(0.0)) == bits(0.0)
    assert bits(sin(-0.0)) == bits(-0.0)
    assert cos(0.0) == 1.0
    assert cos(-0.0) == 1.0


def test_atan_de_los_extremos() -> None:
    assert atan(INF) == 1.5707963267948966
    assert atan(-INF) == -1.5707963267948966
    assert math.isnan(atan(NAN))
    assert bits(atan(0.0)) == bits(0.0)
    assert bits(atan(-0.0)) == bits(-0.0)


def test_atan2_cuadrantes_con_ceros_con_signo() -> None:
    """Los cuatro cuadrantes del cero, que es donde ``atan2`` se diferencia de ``atan(y/x)``."""
    assert bits(atan2(0.0, 1.0)) == bits(0.0)
    assert bits(atan2(-0.0, 1.0)) == bits(-0.0)
    assert atan2(0.0, -1.0) == math.pi
    assert atan2(-0.0, -1.0) == -math.pi
    assert atan2(1.0, 0.0) == 1.5707963267948966
    assert atan2(-1.0, 0.0) == -1.5707963267948966
    assert atan2(0.0, 0.0) == 0.0
    assert atan2(0.0, -0.0) == math.pi


def test_atan2_con_infinitos() -> None:
    assert atan2(INF, INF) == math.pi / 4
    assert atan2(-INF, INF) == -math.pi / 4
    assert atan2(INF, -INF) == 3 * math.pi / 4
    assert atan2(-INF, -INF) == -3 * math.pi / 4
    assert atan2(INF, 1.0) == 1.5707963267948966
    assert atan2(1.0, INF) == 0.0
    assert atan2(1.0, -INF) == math.pi
    assert math.isnan(atan2(NAN, 1.0))
    assert math.isnan(atan2(1.0, NAN))


def test_pow_con_exponente_cero_es_uno_hasta_con_nan() -> None:
    """La regla de JavaScript que más sorprende: ``NaN ** 0`` es ``1``, no ``NaN``."""
    assert pow(NAN, 0.0) == 1.0
    assert pow(NAN, -0.0) == 1.0
    assert pow(INF, 0.0) == 1.0
    assert pow(0.0, 0.0) == 1.0
    assert pow(-1.0, 0.0) == 1.0


def test_pow_de_uno_elevado_a_infinito_es_nan() -> None:
    """Aquí JavaScript se separa de C99 a propósito: C dice ``1``, la primera edición de ECMAScript ``NaN``."""
    assert math.isnan(pow(1.0, INF))
    assert math.isnan(pow(1.0, -INF))
    assert math.isnan(pow(-1.0, INF))
    assert math.isnan(pow(-1.0, -INF))


def test_pow_casos_de_signo_y_paridad() -> None:
    """Un exponente entero impar conserva el signo de la base; uno par lo pierde; uno fraccionario da NaN."""
    assert pow(-2.0, 3.0) == -8.0
    assert pow(-2.0, 4.0) == 16.0
    assert math.isnan(pow(-2.0, 0.5))
    assert math.isnan(pow(-2.0, 3.5))
    assert bits(pow(-0.0, 3.0)) == bits(-0.0)
    assert bits(pow(-0.0, 2.0)) == bits(0.0)
    assert pow(-0.0, -3.0) == -INF
    assert pow(-0.0, -2.0) == INF
    assert pow(0.0, -1.0) == INF
    assert pow(-INF, 3.0) == -INF
    assert pow(-INF, 2.0) == INF


def test_pow_potencias_exactas() -> None:
    """``pow(entero, entero)`` tiene que dar el entero exacto si cabe en un double."""
    assert pow(2.0, 10.0) == 1024.0
    assert pow(2.0, 53.0) == 9007199254740992.0
    assert pow(3.0, 5.0) == 243.0
    assert pow(7.0, 11.0) == 1977326743.0
    assert pow(10.0, 22.0) == 1e22
    assert pow(2.0, 1024.0) == INF
    assert pow(2.0, -1074.0) == 5e-324  # la salida subnormal
    assert pow(2.0, -1075.0) == 0.0


def test_pow_con_infinito_en_el_exponente() -> None:
    assert pow(2.0, INF) == INF
    assert pow(2.0, -INF) == 0.0
    assert pow(0.5, INF) == 0.0
    assert pow(0.5, -INF) == INF
    assert pow(-2.0, INF) == INF


def test_hypot_casos_de_javascript() -> None:
    """Un argumento infinito gana sobre un ``NaN``, y el orden de los dos argumentos importa."""
    assert hypot(INF, NAN) == INF
    assert hypot(NAN, INF) == INF
    assert hypot(-INF, 1.0) == INF
    assert math.isnan(hypot(NAN, 1.0))
    assert math.isnan(hypot(1.0, NAN))
    assert bits(hypot(0.0, 0.0)) == bits(0.0)
    assert bits(hypot(-0.0, -0.0)) == bits(0.0)  # el signo se pierde: sale +0
    assert hypot(3.0, 4.0) == 5.0
    assert hypot(-3.0, -4.0) == 5.0


def test_hypot_normaliza_para_no_desbordar() -> None:
    """Sin dividir por el mayor, ``1e300**2`` sería infinito y el resultado se perdería."""
    assert hypot(1e300, 1e300) == 1.4142135623730952e300
    # sqrt(2)*5e-324 vuelve a caer en el mismo subnormal: no hay un double entre los dos.
    assert hypot(5e-324, 5e-324) == 5e-324
    assert hypot(1e300, 1.0) == 1e300


def test_argumentos_enormes_pasan_por_payne_hanek() -> None:
    """Con 1e22 el camino medio ya no tiene bits significativos: el cuadrante solo sale de la tabla de 2/pi.

    Son los valores de Node; si la tabla ``_TWO_OVER_PI`` o el núcleo de Payne-Hanek se tocan, estos cuatro
    son los primeros que se van, y a la vez son los que ninguna implementación ingenua acierta.
    """
    assert cos(1e8) == -0.3633850893556905
    assert sin(1e8) == 0.931639027109726
    assert cos(1e16) == -0.6261681981330862
    assert sin(1e16) == 0.7796880066069788
    assert cos(1e22) == 0.523214785395139
    assert sin(1e22) == -0.8522008497671888
    assert cos(1e300) == -0.5753861119575491
    assert sin(1e300) == -0.8178819121159085


def test_argumento_justo_en_el_umbral_del_camino_medio() -> None:
    """2^20·pi/2 es la frontera entre el camino medio y Payne-Hanek: el valor de al lado la cruza."""
    assert cos(1647099.3267948967) == 0.9999971906298385
    assert sin(1647099.3267948967) == -0.00237038655717383
