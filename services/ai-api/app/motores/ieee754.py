"""Las funciones trascendentes de ``Math`` tal como las calcula V8, no como las calcula la libm.

Python y JavaScript comparten el tipo de número (el double de IEEE-754) y comparten las cuatro
operaciones, que la norma fija bit a bit. Lo que **no** comparten es el seno. V8 no llama a la libm del
sistema para la trigonometría: lleva su propio puerto de fdlibm 5.3 de Sun en ``src/base/ieee754.cc`` y
resuelve ahí ``Math.sin``, ``Math.cos``, ``Math.atan``, ``Math.atan2`` y ``Math.exp``; ``Math.hypot`` lo
resuelve con una suma de Kahan propia. CPython llama a la libm del sistema, que en Windows es la de MSVC. Las
dos redondean bien —el error está por debajo de un ulp— pero **no eligen el mismo ulp**: sobre 4000 valores al
azar, ``cos`` se desvía en 96, ``atan2`` en 698 y ``hypot`` en 1434; ``exp``, en 297 sobre el rango que pide
el motor orgánico (y en un 9,3 % sobre un rango amplio).

``pow`` es el caso incómodo y conviene leerlo antes de usarlo. V8 13.6 (el de Node 24) tiene **dos**
``Math.pow`` y elige con la opción ``--use-std-math-pow``, que viene **activada**: la que se usa por
defecto, ``v8::internal::math::pow`` en ``src/numbers/ieee754.cc``, pone los casos especiales de
JavaScript y para el resto llama al ``std::pow`` de la biblioteca C con la que se compiló Node. El puerto
de fdlibm de V8, ``base::ieee754::legacy::pow``, solo entra con ``--no-use-std-math-pow``, y las dos
difieren en 331 de 4000 casos. Lo que se porta aquí es ``legacy::pow``, porque es el único de los dos que
es código de V8 y da lo mismo en toda plataforma; el de por defecto no se puede igualar desde Python —ni el
``**`` de CPython lo iguala, se desvía en 11 de 4000— así que para que el motor original y este puerto
coincidan en ``pow`` hay que ejecutar Node con ``--no-use-std-math-pow`` o no llamar a ``Math.pow``.
``tests/test_ieee754.py`` lo explica con las medidas y guarda los dos oráculos.

Un ulp no se ve en una medida, pero sí se ve en un SVG: el motor convierte cada coordenada a texto con
``toFixed`` y un ulp de diferencia cambia el último decimal, el texto deja de coincidir y con él el sha256
del dibujo que el cliente aprobó. Por eso aquí no hay aproximaciones nuevas: es el mismo algoritmo de V8,
constante por constante y en el mismo orden de operaciones, que es lo que de verdad decide el resultado.

``Math.sqrt`` no está porque IEEE-754 obliga a redondear correctamente la raíz: ``math.sqrt`` ya es la misma
en los 4000 casos, y volver a implementarla solo añadiría un sitio donde equivocarse.

Los nombres internos (``_kernel_sin``, ``_rem_pio2``, ``L1``, ``aT``…) son los de fdlibm a propósito: así un
cambio en el original se encuentra aquí sin traducir. Los comentarios que explican **por qué** una rama
existe están en español; los rangos y los pasos del algoritmo son los de fdlibm.
"""

from __future__ import annotations

import math
import struct

__all__ = ["atan", "atan2", "cos", "exp", "hypot", "pow", "sin"]

_INF = float("inf")
_NAN = float("nan")


# ---------------------------------------------------------------------------
# Los bits del double
#
# fdlibm no mira el número, mira sus dos mitades de 32 bits: la alta (signo, exponente y los 20 bits
# altos de la mantisa) con signo, como el ``int32_t hx`` de C, y la baja sin signo. Todas las ramas se
# deciden comparando palabras altas con constantes en hexadecimal, y varios pasos truncan la mantisa
# poniendo la palabra baja a cero. Sin estas seis funciones no hay puerto posible.
# ---------------------------------------------------------------------------


def _palabras(x: float) -> tuple[int, int]:
    """Las dos mitades de un double: la alta con signo y la baja sin signo (``EXTRACT_WORDS``)."""
    alto, bajo = struct.unpack(">iI", struct.pack(">d", x))
    return int(alto), int(bajo)


def _alto(x: float) -> int:
    """La palabra alta con signo (``GET_HIGH_WORD`` sobre un ``int32_t``)."""
    return int(struct.unpack(">i", struct.pack(">d", x)[:4])[0])


def _bajo(x: float) -> int:
    """La palabra baja sin signo (``GET_LOW_WORD``)."""
    return int(struct.unpack(">I", struct.pack(">d", x)[4:])[0])


def _unir(alto: int, bajo: int) -> float:
    """El double con esas dos palabras (``INSERT_WORDS``)."""
    crudo = struct.pack(">II", alto & 0xFFFFFFFF, bajo & 0xFFFFFFFF)
    return float(struct.unpack(">d", crudo)[0])


def _con_alto(x: float, alto: int) -> float:
    """``x`` con su palabra alta cambiada (``SET_HIGH_WORD``)."""
    return _unir(alto, _bajo(x))


def _con_bajo(x: float, bajo: int) -> float:
    """``x`` con su palabra baja cambiada (``SET_LOW_WORD``); con ``0`` trunca a 21 bits de mantisa."""
    return _unir(_alto(x) & 0xFFFFFFFF, bajo)


def _i32(valor: int) -> int:
    """El valor como ``int32_t``, que es lo que desborda solo en C."""
    valor &= 0xFFFFFFFF
    return valor - 0x100000000 if valor >= 0x80000000 else valor


def _dividir(a: float, b: float) -> float:
    """La división de IEEE-754: donde Python lanza ``ZeroDivisionError``, C da ``±inf`` o ``NaN``.

    fdlibm genera sus NaN y sus infinitos dividiendo a propósito (``(x-x)/(x-x)``, ``one/z`` con ``z``
    cero). Si eso lanzara, el puerto tendría que reescribir esas ramas y dejaría de ser el mismo código.
    """
    try:
        return a / b
    except ZeroDivisionError:
        if math.isnan(a) or a == 0.0:
            return _NAN
        signo = math.copysign(1.0, a) * math.copysign(1.0, b)
        return _INF if signo > 0 else -_INF


def _entero(x: float) -> int:
    """``(int32_t)x`` de C: trunca hacia cero. Solo se usa donde fdlibm garantiza el rango."""
    return int(x)


# ---------------------------------------------------------------------------
# k_sin.c y k_cos.c -- los núcleos en |x| <= pi/4
#
# Reciben el argumento ya reducido partido en dos (``x`` y su cola ``y``), porque después de restar
# n*pi/2 la parte alta sola no tiene bits suficientes para que el polinomio salga a menos de un ulp.
# ---------------------------------------------------------------------------

_HALF = 5.00000000000000000000e-01  # 0x3FE00000, 0x00000000
_ONE = 1.00000000000000000000e00  # 0x3FF00000, 0x00000000

_S1 = -1.66666666666666324348e-01  # 0xBFC55555, 0x55555549
_S2 = 8.33333333332248946124e-03  # 0x3F811111, 0x1110F8A6
_S3 = -1.98412698298579493134e-04  # 0xBF2A01A0, 0x19C161D5
_S4 = 2.75573137070700676789e-06  # 0x3EC71DE3, 0x57B1FE7D
_S5 = -2.50507602534068634195e-08  # 0xBE5AE5E6, 0x8A2B9CEB
_S6 = 1.58969099521155010221e-10  # 0x3DE5D93A, 0x5ACFD57C

_C1 = 4.16666666666666019037e-02  # 0x3FA55555, 0x5555554C
_C2 = -1.38888888888741095749e-03  # 0xBF56C16C, 0x16C15177
_C3 = 2.48015872894767294178e-05  # 0x3EFA01A0, 0x19CB1590
_C4 = -2.75573143513906633035e-07  # 0xBE927E4F, 0x809C52AD
_C5 = 2.08757232129817482790e-09  # 0x3E21EE9E, 0xBDB4B1C4
_C6 = -1.13596475577881948265e-11  # 0xBDA8FAE9, 0xBE8838D4


def _kernel_sin(x: float, y: float, iy: int) -> float:
    """``__kernel_sin``: el seno en ``|x| <= pi/4`` con la cola ``y`` (``iy == 0`` si ``y`` es cero)."""
    ix = _alto(x) & 0x7FFFFFFF
    if ix < 0x3E400000:  # |x| < 2**-27
        if _entero(x) == 0:
            return x
    z = x * x
    v = z * x
    r = _S2 + z * (_S3 + z * (_S4 + z * (_S5 + z * _S6)))
    if iy == 0:
        return x + v * (_S1 + z * r)
    return x - ((z * (_HALF * y - v * r) - y) - v * _S1)


def _kernel_cos(x: float, y: float) -> float:
    """``__kernel_cos``: el coseno en ``|x| <= pi/4`` con la cola ``y``."""
    ix = _alto(x) & 0x7FFFFFFF
    if ix < 0x3E400000:  # |x| < 2**-27
        if _entero(x) == 0:
            return _ONE
    z = x * x
    r = z * (_C1 + z * (_C2 + z * (_C3 + z * (_C4 + z * (_C5 + z * _C6)))))
    if ix < 0x3FD33333:  # |x| < 0.3
        return _ONE - (0.5 * z - (z * r - x * y))
    # Con |x| grande, ``1 - z/2`` pierde bits: se resta antes un trozo exacto de z/2 (``qx``) para que
    # la cancelación ocurra entre números que la aritmética representa sin error.
    if ix > 0x3FE90000:  # |x| > 0.78125
        qx = 0.28125
    else:
        qx = _unir(ix - 0x00200000, 0)  # x/4
    iz = 0.5 * z - qx
    a = _ONE - qx
    return a - (iz - (z * r - x * y))


# ---------------------------------------------------------------------------
# k_rem_pio2.c -- Payne-Hanek
#
# Para |x| grande, restar n*pi/2 con un pi de 53 o de 99 bits no basta: el resultado se queda sin bits
# significativos. Este núcleo multiplica la mantisa de x, partida en trozos de 24 bits, por 2/pi tomada
# de una tabla de 1584 bits, y se queda solo con la parte fraccionaria. Es el camino caro y el único que
# da el cuadrante correcto en, por ejemplo, Math.cos(1e22).
# ---------------------------------------------------------------------------

#: 2/pi en base 2**24, 66 palabras de 24 bits (1584 bits en total).
_TWO_OVER_PI: tuple[int, ...] = (
    0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62, 0x95993C,
    0x439041, 0xFE5163, 0xABDEBB, 0xC561B7, 0x246E3A, 0x424DD2, 0xE00649,
    0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129, 0xA73EE8, 0x8235F5, 0x2EBB44,
    0x84E99C, 0x7026B4, 0x5F7E41, 0x3991D6, 0x398353, 0x39F49C, 0x845F8B,
    0xBDF928, 0x3B1FF8, 0x97FFDE, 0x05980F, 0xEF2F11, 0x8B5A0A, 0x6D1F6D,
    0x367ECF, 0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5,
    0xF17B3D, 0x0739F7, 0x8A5292, 0xEA6BFB, 0x5FB11F, 0x8D5D08, 0x560330,
    0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3, 0x91615E, 0xE61B08,
    0x659985, 0x5F14A0, 0x68408D, 0xFFD880, 0x4D7327, 0x310606, 0x1556CA,
    0x73A8C9, 0x60E27B, 0xC08C6B,
)  # fmt: skip

#: Cuántos términos de ``_PIO2`` hacen falta según la precisión pedida (``prec`` 0..3).
_INIT_JK: tuple[int, ...] = (2, 3, 4, 6)

#: pi/2 partido en trozos de 24 bits, para recomponer el resto en doble-doble.
_PIO2: tuple[float, ...] = (
    1.57079625129699707031e00,  # 0x3FF921FB, 0x40000000
    7.54978941586159635335e-08,  # 0x3E74442D, 0x00000000
    5.39030252995776476554e-15,  # 0x3CF84698, 0x80000000
    3.28200341580791294123e-22,  # 0x3B78CC51, 0x60000000
    1.27065575308067607349e-29,  # 0x39F01B83, 0x80000000
    1.22933308981111328932e-36,  # 0x387A2520, 0x40000000
    2.73370053816464559624e-44,  # 0x36E38222, 0x80000000
    2.16741683877804819444e-51,  # 0x3569F31D, 0x00000000
)

_TWO24 = 1.67772160000000000000e07  # 0x41700000, 0x00000000
_TWON24 = 5.96046447753906250000e-08  # 0x3E700000, 0x00000000


def _kernel_rem_pio2(x: list[float], e0: int, nx: int, prec: int) -> tuple[int, float, float]:
    """``__kernel_rem_pio2``: el resto de ``x`` módulo pi/2 y el cuadrante, por Payne-Hanek.

    ``x`` son los ``nx`` trozos de 24 bits de la mantisa y ``e0`` el exponente del primero. Devuelve
    ``(n & 7, y0, y1)``, donde el resto va partido en dos doubles como lo esperan los núcleos.
    """
    f = [0.0] * 20
    q = [0.0] * 20
    fq = [0.0] * 20
    iq = [0] * 20

    jk = _INIT_JK[prec]
    jp = jk

    # jx, jv y q0: dónde empieza la tabla y cuánto vale el bit menos significativo de iq[].
    jx = nx - 1
    jv = (e0 - 3) // 24
    if jv < 0:
        jv = 0
    q0 = e0 - 24 * (jv + 1)

    # f[0]..f[jx+jk] con el trozo de 2/pi que toca (cero antes del principio de la tabla).
    j = jv - jx
    m = jx + jk
    for i in range(m + 1):
        f[i] = 0.0 if j < 0 else float(_TWO_OVER_PI[j])
        j += 1

    # q[0]..q[jk]: la convolución de la mantisa con la tabla.
    for i in range(jk + 1):
        fw = 0.0
        for j in range(jx + 1):
            fw += x[j] * f[jx + i - j]
        q[i] = fw

    jz = jk
    ih = 0
    n = 0
    z = 0.0
    while True:
        # Destilar q[] en iq[], al revés y en trozos de 24 bits.
        i = 0
        j = jz
        z = q[jz]
        while j > 0:
            fw = float(_entero(_TWON24 * z))
            iq[i] = _entero(z - _TWO24 * fw)
            z = q[j - 1] + fw
            i += 1
            j -= 1

        # n: la parte entera, que es la que decide el cuadrante.
        z = math.ldexp(z, q0)
        z -= 8.0 * math.floor(z * 0.125)  # quitar los enteros >= 8
        n = _entero(z)
        z -= float(n)
        ih = 0
        if q0 > 0:  # hace falta iq[jz-1] para saber n
            i = iq[jz - 1] >> (24 - q0)
            n += i
            iq[jz - 1] -= i << (24 - q0)
            ih = iq[jz - 1] >> (23 - q0)
        elif q0 == 0:
            ih = iq[jz - 1] >> 23
        elif z >= 0.5:
            ih = 2

        if ih > 0:  # q > 0.5: se devuelve el complemento y se sube el cuadrante
            n += 1
            carry = 0
            for i in range(jz):
                j = iq[i]
                if carry == 0:
                    if j != 0:
                        carry = 1
                        iq[i] = 0x1000000 - j
                else:
                    iq[i] = 0xFFFFFF - j
            if q0 > 0:  # caso raro: 1 de cada 12
                if q0 == 1:
                    iq[jz - 1] &= 0x7FFFFF
                elif q0 == 2:
                    iq[jz - 1] &= 0x3FFFFF
            if ih == 2:
                z = _ONE - z
                if carry != 0:
                    z -= math.ldexp(_ONE, q0)

        # Si el resto salió exactamente cero no hay bits que mirar: hacen falta más términos.
        if z == 0.0:
            j = 0
            for i in range(jz - 1, jk - 1, -1):
                j |= iq[i]
            if j == 0:
                k = 1
                while iq[jk - k] == 0:
                    k += 1
                for i in range(jz + 1, jz + k + 1):  # añadir q[jz+1]..q[jz+k]
                    f[jx + i] = float(_TWO_OVER_PI[jv + i])
                    fw = 0.0
                    for jj in range(jx + 1):
                        fw += x[jj] * f[jx + i - jj]
                    q[i] = fw
                jz += k
                continue
        break

    # Recortar los términos que sobran, o partir z en 24 bits si queda resto.
    if z == 0.0:
        jz -= 1
        q0 -= 24
        while iq[jz] == 0:
            jz -= 1
            q0 -= 24
    else:
        z = math.ldexp(z, -q0)
        if z >= _TWO24:
            fw = float(_entero(_TWON24 * z))
            iq[jz] = _entero(z - _TWO24 * fw)
            jz += 1
            q0 += 24
            iq[jz] = _entero(fw)
        else:
            iq[jz] = _entero(z)

    # De trozos enteros a doubles.
    fw = math.ldexp(_ONE, q0)
    for i in range(jz, -1, -1):
        q[i] = fw * float(iq[i])
        fw *= _TWON24

    # Multiplicar por pi/2 término a término.
    for i in range(jz, -1, -1):
        fw = 0.0
        for k in range(min(jp, jz - i) + 1):
            fw += _PIO2[k] * q[i + k]
        fq[jz - i] = fw

    if prec == 0:
        fw = 0.0
        for i in range(jz, -1, -1):
            fw += fq[i]
        y0 = fw if ih == 0 else -fw
        return n & 7, y0, 0.0

    # prec 1 y 2 (el que usan sin y cos): el resto en dos doubles.
    fw = 0.0
    for i in range(jz, -1, -1):
        fw += fq[i]
    y0 = fw if ih == 0 else -fw
    fw = fq[0] - fw
    for i in range(1, jz + 1):
        fw += fq[i]
    y1 = fw if ih == 0 else -fw
    return n & 7, y0, y1


# ---------------------------------------------------------------------------
# e_rem_pio2.c -- la reducción de argumento
# ---------------------------------------------------------------------------

#: Palabra alta de ``n*pi/2`` para n = 1..32: si ``x`` cae justo ahí, la resta cancela y hay que afinar.
_NPIO2_HW: tuple[int, ...] = (
    0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C,
    0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C,
    0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A,
    0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
    0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB,
    0x404858EB, 0x404921FB,
)  # fmt: skip

_INVPIO2 = 6.36619772367581382433e-01  # 0x3FE45F30, 0x6DC9C883 -- 53 bits de 2/pi
_PIO2_1 = 1.57079632673412561417e00  # 0x3FF921FB, 0x54400000 -- los 33 bits altos de pi/2
_PIO2_1T = 6.07710050650619224932e-11  # 0x3DD0B461, 0x1A626331 -- pi/2 - _PIO2_1
_PIO2_2 = 6.07710050630396597660e-11  # 0x3DD0B461, 0x1A600000 -- los 33 siguientes
_PIO2_2T = 2.02226624879595063154e-21  # 0x3BA3198A, 0x2E037073
_PIO2_3 = 2.02226624871116645580e-21  # 0x3BA3198A, 0x2E000000 -- los 33 siguientes
_PIO2_3T = 8.47842766036889956997e-32  # 0x397B839A, 0x252049C1


def _rem_pio2(x: float) -> tuple[int, float, float]:
    """``__ieee754_rem_pio2``: ``x`` reducido a ``[-pi/4, pi/4]`` y en qué múltiplo de pi/2 iba.

    Devuelve ``(n, y0, y1)``: el resto partido en dos doubles y el número de pi/2 restados. Hay tres
    caminos y los tres importan: el directo (|x| <= pi/4), el medio (hasta 2^20*pi/2, con pi de 33+33+53
    bits y hasta tres pasadas) y Payne-Hanek para todo lo demás.
    """
    hx = _alto(x)
    ix = hx & 0x7FFFFFFF

    if ix <= 0x3FE921FB:  # |x| ~<= pi/4, no hay nada que reducir
        return 0, x, 0.0

    if ix < 0x4002D97C:  # |x| < 3pi/4, el caso n = +-1
        if hx > 0:
            z = x - _PIO2_1
            if ix != 0x3FF921FB:  # pi de 33+53 bits basta
                y0 = z - _PIO2_1T
                return 1, y0, (z - y0) - _PIO2_1T
            z -= _PIO2_2  # cerca de pi/2: hacen falta 33+33+53
            y0 = z - _PIO2_2T
            return 1, y0, (z - y0) - _PIO2_2T
        z = x + _PIO2_1
        if ix != 0x3FF921FB:
            y0 = z + _PIO2_1T
            return -1, y0, (z - y0) + _PIO2_1T
        z += _PIO2_2
        y0 = z + _PIO2_2T
        return -1, y0, (z - y0) + _PIO2_2T

    if ix <= 0x413921FB:  # |x| ~<= 2^20*(pi/2), tamaño medio
        t = abs(x)
        n = _entero(t * _INVPIO2 + _HALF)
        fn = float(n)
        r = t - fn * _PIO2_1
        w = fn * _PIO2_1T  # la primera pasada da 85 bits
        if n < 32 and ix != _NPIO2_HW[n - 1]:
            y0 = r - w  # lejos de un múltiplo de pi/2: no cancela
        else:
            j = ix >> 20
            y0 = r - w
            alto = _alto(y0) & 0xFFFFFFFF
            i = j - ((alto >> 20) & 0x7FF)
            if i > 16:  # cancelación: segunda pasada, 118 bits
                t = r
                w = fn * _PIO2_2
                r = t - w
                w = fn * _PIO2_2T - ((t - r) - w)
                y0 = r - w
                alto = _alto(y0) & 0xFFFFFFFF
                i = j - ((alto >> 20) & 0x7FF)
                if i > 49:  # tercera pasada, 151 bits: cubre todos los casos
                    t = r
                    w = fn * _PIO2_3
                    r = t - w
                    w = fn * _PIO2_3T - ((t - r) - w)
                    y0 = r - w
        y1 = (r - y0) - w
        if hx < 0:
            return -n, -y0, -y1
        return n, y0, y1

    if ix >= 0x7FF00000:  # x es inf o NaN
        z = x - x
        return 0, z, z

    # El resto: Payne-Hanek. Se normaliza |x| a z = scalbn(|x|, ilogb(x)-23) y se parte su mantisa en
    # tres trozos de 24 bits, que es el formato que espera el núcleo.
    bajo = _bajo(x)
    e0 = (ix >> 20) - 1046  # e0 = ilogb(z) - 23
    z = _unir(ix - _i32(e0 << 20), bajo)
    tx = [0.0, 0.0, 0.0]
    for i in range(2):
        tx[i] = float(_entero(z))
        z = (z - tx[i]) * _TWO24
    tx[2] = z
    nx = 3
    while tx[nx - 1] == 0.0:  # saltar los trozos nulos
        nx -= 1
    n, y0, y1 = _kernel_rem_pio2(tx, e0, nx, 2)
    if hx < 0:
        return -n, -y0, -y1
    return n, y0, y1


# ---------------------------------------------------------------------------
# s_sin.c y s_cos.c
# ---------------------------------------------------------------------------


def sin(x: float) -> float:
    """``Math.sin``: el seno de fdlibm, bit a bit el de V8."""
    ix = _alto(x) & 0x7FFFFFFF
    if ix <= 0x3FE921FB:  # |x| ~< pi/4
        return _kernel_sin(x, 0.0, 0)
    if ix >= 0x7FF00000:  # sin(inf) y sin(NaN) son NaN
        return x - x
    n, y0, y1 = _rem_pio2(x)
    cuadrante = n & 3
    if cuadrante == 0:
        return _kernel_sin(y0, y1, 1)
    if cuadrante == 1:
        return _kernel_cos(y0, y1)
    if cuadrante == 2:
        return -_kernel_sin(y0, y1, 1)
    return -_kernel_cos(y0, y1)


def cos(x: float) -> float:
    """``Math.cos``: el coseno de fdlibm, bit a bit el de V8."""
    ix = _alto(x) & 0x7FFFFFFF
    if ix <= 0x3FE921FB:  # |x| ~< pi/4
        return _kernel_cos(x, 0.0)
    if ix >= 0x7FF00000:  # cos(inf) y cos(NaN) son NaN
        return x - x
    n, y0, y1 = _rem_pio2(x)
    cuadrante = n & 3
    if cuadrante == 0:
        return _kernel_cos(y0, y1)
    if cuadrante == 1:
        return -_kernel_sin(y0, y1, 1)
    if cuadrante == 2:
        return -_kernel_cos(y0, y1)
    return _kernel_sin(y0, y1, 1)


# ---------------------------------------------------------------------------
# s_atan.c
# ---------------------------------------------------------------------------

#: ``atan`` de los cuatro puntos de corte, partido en alta y cola para no perder bits al sumar.
_ATANHI: tuple[float, ...] = (
    4.63647609000806093515e-01,  # atan(0.5)hi 0x3FDDAC67, 0x0561BB4F
    7.85398163397448278999e-01,  # atan(1.0)hi 0x3FE921FB, 0x54442D18
    9.82793723247329054082e-01,  # atan(1.5)hi 0x3FEF730B, 0xD281F69B
    1.57079632679489655800e00,  # atan(inf)hi 0x3FF921FB, 0x54442D18
)

_ATANLO: tuple[float, ...] = (
    2.26987774529616870924e-17,  # atan(0.5)lo 0x3C7A2B7F, 0x222F65E2
    3.06161699786838301793e-17,  # atan(1.0)lo 0x3C81A626, 0x33145C07
    1.39033110312309984516e-17,  # atan(1.5)lo 0x3C700788, 0x7AF0CBBD
    6.12323399573676603587e-17,  # atan(inf)lo 0x3C91A626, 0x33145C07
)

_AT: tuple[float, ...] = (
    3.33333333333329318027e-01,  # 0x3FD55555, 0x5555550D
    -1.99999999998764832476e-01,  # 0xBFC99999, 0x9998EBC4
    1.42857142725034663711e-01,  # 0x3FC24924, 0x920083FF
    -1.11111104054623557880e-01,  # 0xBFBC71C6, 0xFE231671
    9.09088713343650656196e-02,  # 0x3FB745CD, 0xC54C206E
    -7.69187620504482999495e-02,  # 0xBFB3B0F2, 0xAF749A6D
    6.66107313738753120669e-02,  # 0x3FB10D66, 0xA0D03D51
    -5.83357013379057348645e-02,  # 0xBFADDE2D, 0x52DEFD9A
    4.97687799461593236017e-02,  # 0x3FA97B4B, 0x24760DEB
    -3.65315727442169155270e-02,  # 0xBFA2B444, 0x2C6A6C2F
    1.62858201153657823623e-02,  # 0x3F90AD3A, 0xE322DA11
)

_HUGE = 1.0e300
_TINY = 1.0e-300


def atan(x: float) -> float:
    """``Math.atan``: el arcotangente de fdlibm (``s_atan.c``)."""
    hx = _alto(x)
    ix = hx & 0x7FFFFFFF
    if ix >= 0x44100000:  # |x| >= 2^66: ya es pi/2 salvo el signo
        bajo = _bajo(x)
        if ix > 0x7FF00000 or (ix == 0x7FF00000 and bajo != 0):
            return x + x  # NaN
        if hx > 0:
            return _ATANHI[3] + _ATANLO[3]
        return -_ATANHI[3] - _ATANLO[3]

    if ix < 0x3FDC0000:  # |x| < 0.4375
        if ix < 0x3E400000:  # |x| < 2^-27: atan(x) == x
            if _HUGE + x > _ONE:
                return x
        idx = -1
    else:
        # Reducción al intervalo donde el polinomio vale, por el punto de corte más cercano.
        x = abs(x)
        if ix < 0x3FF30000:  # |x| < 1.1875
            if ix < 0x3FE60000:  # 7/16 <= |x| < 11/16
                idx = 0
                x = (2.0 * x - _ONE) / (2.0 + x)
            else:  # 11/16 <= |x| < 19/16
                idx = 1
                x = (x - _ONE) / (x + _ONE)
        elif ix < 0x40038000:  # |x| < 2.4375
            idx = 2
            x = (x - 1.5) / (_ONE + 1.5 * x)
        else:  # 2.4375 <= |x| < 2^66
            idx = 3
            x = _dividir(-1.0, x)

    z = x * x
    w = z * z
    # La suma de i=0 a 10 de aT[i]*z**(i+1), partida en los términos pares y los impares.
    s1 = z * (_AT[0] + w * (_AT[2] + w * (_AT[4] + w * (_AT[6] + w * (_AT[8] + w * _AT[10])))))
    s2 = w * (_AT[1] + w * (_AT[3] + w * (_AT[5] + w * (_AT[7] + w * _AT[9]))))
    if idx < 0:
        return x - x * (s1 + s2)
    z = _ATANHI[idx] - ((x * (s1 + s2) - _ATANLO[idx]) - x)
    return -z if hx < 0 else z


# ---------------------------------------------------------------------------
# e_atan2.c
# ---------------------------------------------------------------------------

_PI_O_4 = 7.8539816339744827900e-01  # 0x3FE921FB, 0x54442D18
_PI_O_2 = 1.5707963267948965580e00  # 0x3FF921FB, 0x54442D18
_PI = 3.1415926535897931160e00  # 0x400921FB, 0x54442D18
_PI_LO = 1.2246467991473531772e-16  # 0x3CA1A626, 0x33145C07 -- pi - _PI


def atan2(y: float, x: float) -> float:
    """``Math.atan2``: el arcotangente de dos argumentos de fdlibm (``e_atan2.c``).

    Es la que más se desvía de la libm de MSVC (698 de 4000): el reparto en cuadrantes y las sumas de
    ``tiny`` —que están para que el redondeo caiga del lado correcto y se levante la inexactitud— no son
    los mismos en las dos implementaciones.
    """
    hx, lx = _palabras(x)
    ix = hx & 0x7FFFFFFF
    hy, ly = _palabras(y)
    iy = hy & 0x7FFFFFFF

    if (ix | (1 if lx else 0)) > 0x7FF00000 or (iy | (1 if ly else 0)) > 0x7FF00000:
        return x + y  # x o y es NaN
    if ((hx - 0x3FF00000) | lx) == 0:
        return atan(y)  # x == 1.0
    m = ((hy >> 31) & 1) | ((hx >> 30) & 2)  # 2*signo(x) + signo(y)

    if (iy | ly) == 0:  # y == 0
        if m in (0, 1):
            return y  # atan(+-0, +algo) = +-0
        if m == 2:
            return _PI + _TINY  # atan(+0, -algo) = pi
        return -_PI - _TINY  # atan(-0, -algo) = -pi

    if (ix | lx) == 0:  # x == 0
        return -_PI_O_2 - _TINY if hy < 0 else _PI_O_2 + _TINY

    if ix == 0x7FF00000:  # x es infinito
        if iy == 0x7FF00000:
            if m == 0:
                return _PI_O_4 + _TINY
            if m == 1:
                return -_PI_O_4 - _TINY
            if m == 2:
                return 3.0 * _PI_O_4 + _TINY
            return -3.0 * _PI_O_4 - _TINY
        if m == 0:
            return 0.0
        if m == 1:
            return -0.0
        if m == 2:
            return _PI + _TINY
        return -_PI - _TINY

    if iy == 0x7FF00000:  # y es infinito
        return -_PI_O_2 - _TINY if hy < 0 else _PI_O_2 + _TINY

    k = (iy - ix) >> 20
    if k > 60:  # |y/x| > 2^60: la división desbordaría sin aportar nada
        z = _PI_O_2 + 0.5 * _PI_LO
        m &= 1
    elif hx < 0 and k < -60:  # 0 > |y|/x > -2^-60
        z = 0.0
    else:
        z = atan(abs(_dividir(y, x)))

    if m == 0:
        return z  # atan(+, +)
    if m == 1:
        return -z  # atan(-, +)
    if m == 2:
        return _PI - (z - _PI_LO)  # atan(+, -)
    return (z - _PI_LO) - _PI  # atan(-, -)


# ---------------------------------------------------------------------------
# e_pow.c
#
# x**y = 2**(y*log2(x)), con log2 y 2** calculados cada uno en doble-doble para que el producto del
# medio conserve los bits que hacen falta. Casi todo el archivo son los casos especiales.
# ---------------------------------------------------------------------------

_BP: tuple[float, ...] = (1.0, 1.5)
_DP_H: tuple[float, ...] = (0.0, 5.84962487220764160156e-01)  # 0x3FE2B803, 0x40000000
_DP_L: tuple[float, ...] = (0.0, 1.35003920212974897128e-08)  # 0x3E4CFDEB, 0x43CFD006

_TWO = 2.0
_TWO53 = 9007199254740992.0  # 0x43400000, 0x00000000

# Coeficientes de (3/2)*(log(x) - 2s - 2/3*s**3).
_L1 = 5.99999999999994648725e-01  # 0x3FE33333, 0x33333303
_L2 = 4.28571428578550184252e-01  # 0x3FDB6DB6, 0xDB6FABFF
_L3 = 3.33333329818377432918e-01  # 0x3FD55555, 0x518F264D
_L4 = 2.72728123808534006489e-01  # 0x3FD17460, 0xA91D4101
_L5 = 2.30660745775561754067e-01  # 0x3FCD864A, 0x93C9DB65
_L6 = 2.06975017800338417784e-01  # 0x3FCA7E28, 0x4A454EEF

_P1 = 1.66666666666666019037e-01  # 0x3FC55555, 0x5555553E
_P2 = -2.77777777770155933842e-03  # 0xBF66C16C, 0x16BEBD93
_P3 = 6.61375632143793436117e-05  # 0x3F11566A, 0xAF25DE2C
_P4 = -1.65339022054652515390e-06  # 0xBEBBBD41, 0xC5D26BF1
_P5 = 4.13813679705723846039e-08  # 0x3E663769, 0x72BEA4D0

_LG2 = 6.93147180559945286227e-01  # 0x3FE62E42, 0xFEFA39EF
_LG2_H = 6.93147182464599609375e-01  # 0x3FE62E43, 0x00000000
_LG2_L = -1.90465429995776804525e-09  # 0xBE205C61, 0x0CA86C39
_OVT = 8.0085662595372944372e-17  # -(1024 - log2(ovfl + .5ulp))
_CP = 9.61796693925975554329e-01  # 0x3FEEC709, 0xDC3A03FD = 2/(3ln2)
_CP_H = 9.61796700954437255859e-01  # 0x3FEEC709, 0xE0000000 = (float)cp
_CP_L = -7.02846165095275826516e-09  # 0xBE3E2FE0, 0x145B01F5 = cola de cp_h
_IVLN2 = 1.44269504088896338700e00  # 0x3FF71547, 0x652B82FE = 1/ln2
_IVLN2_H = 1.44269502162933349609e00  # 0x3FF71547, 0x60000000 = 1/ln2 en 24 bits
_IVLN2_L = 1.92596299112661746887e-08  # 0x3E54AE0B, 0xF85DDF44 = cola de 1/ln2


def pow(x: float, y: float) -> float:
    """``Math.pow``: la potencia de fdlibm (``e_pow.c``), con los casos raros de JavaScript.

    Dos de esos casos no son los de C y conviene no perderlos de vista: ``pow(x, 0)`` es ``1`` aunque
    ``x`` sea ``NaN``, y ``pow(±1, ±Infinity)`` es ``NaN`` (C99 dice ``1``). Los dos salen solos del
    código de fdlibm —el primero porque la rama de ``y == 0`` va antes que la de NaN, el segundo porque
    con ``|x| == 1`` devuelve ``y - y``—, así que no hay nada que añadir encima; están comprobados.

    Sombrea el ``pow`` de las builtins dentro de este módulo, que es lo que se quiere: aquí ``pow``
    significa el de V8. Nada en el archivo llama al de Python.
    """
    hx, lx = _palabras(x)
    hy, ly = _palabras(y)
    ix = hx & 0x7FFFFFFF
    iy = hy & 0x7FFFFFFF

    if (iy | ly) == 0:  # x**0 = 1, incluso con x NaN (y aquí JavaScript coincide con C99)
        return _ONE

    nan_x = ix > 0x7FF00000 or (ix == 0x7FF00000 and lx != 0)
    nan_y = iy > 0x7FF00000 or (iy == 0x7FF00000 and ly != 0)
    if nan_x or nan_y:
        return x + y  # +-NaN

    # Si x < 0 hace falta saber si y es entero y de qué paridad: 0 no entero, 1 impar, 2 par.
    yisint = 0
    if hx < 0:
        if iy >= 0x43400000:
            yisint = 2  # tan grande que no tiene bits fraccionarios: par
        elif iy >= 0x3FF00000:
            k = (iy >> 20) - 0x3FF
            if k > 20:
                j = ly >> (52 - k)
                if ((j << (52 - k)) & 0xFFFFFFFF) == ly:
                    yisint = 2 - (j & 1)
            elif ly == 0:
                j = iy >> (20 - k)
                if (j << (20 - k)) == iy:
                    yisint = 2 - (j & 1)

    if ly == 0:  # y especial
        if iy == 0x7FF00000:  # y es +-inf
            if ((ix - 0x3FF00000) | lx) == 0:
                return y - y  # (+-1)**+-inf es NaN; en JavaScript también
            if ix >= 0x3FF00000:  # (|x|>1)**+-inf = inf, 0
                return y if hy >= 0 else 0.0
            return -y if hy < 0 else 0.0  # (|x|<1)**-+inf = inf, 0
        if iy == 0x3FF00000:  # y es +-1
            return _dividir(_ONE, x) if hy < 0 else x
        if hy == 0x40000000:  # y es 2
            return x * x
        if hy == 0x3FE00000 and hx >= 0:  # y es 0.5 y x >= +0
            return math.sqrt(x)

    ax = abs(x)
    if lx == 0 and ix in (0x7FF00000, 0, 0x3FF00000):  # x es +-0, +-inf o +-1
        z = ax
        if hy < 0:
            z = _dividir(_ONE, z)
        if hx < 0:
            if ((ix - 0x3FF00000) | yisint) == 0:
                z = _dividir(z - z, z - z)  # (-1)**(no entero) es NaN
            elif yisint == 1:
                z = -z  # (x<0)**impar = -(|x|**impar)
        return z

    n = 0 if hx < 0 else -1  # ((uint32_t)hx >> 31) - 1, o sea 0 si x < 0 y -1 si x > 0

    if (n | yisint) == 0:  # (x<0)**(no entero) es NaN
        return _dividir(x - x, x - x)

    s = _ONE  # el signo del resultado: -1 solo en (negativo)**(entero impar)
    if (n | (yisint - 1)) == 0:
        s = -_ONE

    if iy > 0x41E00000:  # |y| > 2^31: o desborda, o x está pegadísimo a 1
        if iy > 0x43F00000:  # |y| > 2^64: desborda seguro
            if ix <= 0x3FEFFFFF:
                return _HUGE * _HUGE if hy < 0 else _TINY * _TINY
            if ix >= 0x3FF00000:
                return _HUGE * _HUGE if hy > 0 else _TINY * _TINY
        if ix < 0x3FEFFFFF:
            return s * _HUGE * _HUGE if hy < 0 else s * _TINY * _TINY
        if ix > 0x3FF00000:
            return s * _HUGE * _HUGE if hy > 0 else s * _TINY * _TINY
        # Aquí |1-x| <= 2^-20: basta log(x) = x - x^2/2 + x^3/3 - x^4/4.
        t = ax - _ONE  # t tiene 20 ceros al final
        w = (t * t) * (0.5 - t * (0.3333333333333333333333 - t * 0.25))
        u = _IVLN2_H * t  # _IVLN2_H tiene 21 bits significativos
        v = t * _IVLN2_L - w * _IVLN2
        t1 = u + v
        t1 = _con_bajo(t1, 0)
        t2 = v - (t1 - u)
    else:
        n = 0
        if ix < 0x00100000:  # x subnormal: se escala para que tenga exponente
            ax *= _TWO53
            n -= 53
            ix = _alto(ax)
        n += (ix >> 20) - 0x3FF
        j = ix & 0x000FFFFF
        ix = j | 0x3FF00000  # normalizar ix al intervalo [1, 2)
        if j <= 0x3988E:
            k = 0  # |x| < sqrt(3/2)
        elif j < 0xBB67A:
            k = 1  # |x| < sqrt(3)
        else:
            k = 0
            n += 1
            ix -= 0x00100000
        ax = _con_alto(ax, ix)

        # ss = s_h + s_l = (x-1)/(x+1) o (x-1.5)/(x+1.5)
        u = ax - _BP[k]
        v = _dividir(_ONE, ax + _BP[k])
        ss = u * v
        s_h = _con_bajo(ss, 0)
        t_h = _unir(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18), 0)
        t_l = ax - (t_h - _BP[k])
        s_l = v * ((u - s_h * t_h) - s_h * t_l)
        # log(ax)
        s2 = ss * ss
        r = s2 * s2 * (_L1 + s2 * (_L2 + s2 * (_L3 + s2 * (_L4 + s2 * (_L5 + s2 * _L6)))))
        r += s_l * (s_h + ss)
        s2 = s_h * s_h
        t_h = _con_bajo(3.0 + s2 + r, 0)
        t_l = r - ((t_h - 3.0) - s2)
        # u + v = ss*(1+...)
        u = s_h * t_h
        v = s_l * t_h + t_l * ss
        # 2/(3log2)*(ss+...)
        p_h = _con_bajo(u + v, 0)
        p_l = v - (p_h - u)
        z_h = _CP_H * p_h  # _CP_H + _CP_L = 2/(3*log2)
        z_l = _CP_L * p_h + p_l * _CP + _DP_L[k]
        # log2(ax) = n + dp_h + z_h + z_l
        t = float(n)
        t1 = _con_bajo(((z_h + z_l) + _DP_H[k]) + t, 0)
        t2 = z_l - (((t1 - t) - _DP_H[k]) - z_h)

    # Partir y en y1+y2 y multiplicar (y1+y2)*(t1+t2).
    y1 = _con_bajo(y, 0)
    p_l = (y - y1) * t1 + y * t2
    p_h = y1 * t1
    z = p_l + p_h
    j, i = _palabras(z)
    if j >= 0x40900000:  # z >= 1024
        if ((j - 0x40900000) | i) != 0:
            return s * _HUGE * _HUGE  # desbordamiento
        if p_l + _OVT > z - p_h:
            return s * _HUGE * _HUGE
    elif (j & 0x7FFFFFFF) >= 0x4090CC00:  # z <= -1075
        if (((j - 0xC090CC00) & 0xFFFFFFFF) | i) != 0:
            return s * _TINY * _TINY  # desbordamiento por abajo
        if p_l <= z - p_h:
            return s * _TINY * _TINY

    # 2**(p_h+p_l)
    i = j & 0x7FFFFFFF
    k = (i >> 20) - 0x3FF
    n = 0
    if i > 0x3FE00000:  # |z| > 0.5: n = [z+0.5]
        n = _i32(j + (0x00100000 >> (k + 1)))
        k = ((n & 0x7FFFFFFF) >> 20) - 0x3FF
        t = _unir(n & ~(0x000FFFFF >> k) & 0xFFFFFFFF, 0)
        n = ((n & 0x000FFFFF) | 0x00100000) >> (20 - k)
        if j < 0:
            n = -n
        p_h -= t
    t = _con_bajo(p_l + p_h, 0)
    u = t * _LG2_H
    v = (p_l - (t - p_h)) * _LG2 + t * _LG2_L
    z = u + v
    w = v - (z - u)
    t = z * z
    t1 = z - t * (_P1 + t * (_P2 + t * (_P3 + t * (_P4 + t * _P5))))
    # V8 se desvía aquí de fdlibm, y no es cosmético: el original es
    # ``(z*t1)/(t1-two) - (w+z*w)`` y V8 escribe ``Divide(z*t1, (t1-two) - (w+z*w))``, con el término
    # ``(w+z*w)`` metido en el divisor. Cambia el resultado en 1 ulp en un 4% de los casos, así que el
    # paréntesis se copia tal cual: lo que hay que reproducir es V8, no fdlibm.
    r = _dividir(z * t1, (t1 - _TWO) - (w + z * w))
    z = _ONE - (r - z)
    j = _alto(z)
    j = _i32(j + (n << 20))
    if (j >> 20) <= 0:
        z = math.ldexp(z, n)  # salida subnormal
    else:
        z = _con_alto(z, j)
    return s * z


# ---------------------------------------------------------------------------
# e_exp.c -- exp(x) = 2**k * exp(r), con r en [-0.5 ln2, 0.5 ln2]
#
# El polinomio P1..P5 es el mismo que ya usa `pow` (fdlibm lo repite en e_pow.c, que lleva su propio
# `exp` dentro), así que aquí no se vuelve a escribir: una segunda copia de cinco constantes es un sitio
# donde una puede quedarse atrás. `_IVLN2` (1/ln2) también está arriba, por lo mismo.
# ---------------------------------------------------------------------------

_O_THRESHOLD = 7.09782712893383973096e02  # 0x40862E42, 0xFEFA39EF -- por encima, desborda
_U_THRESHOLD = -7.45133219101941108420e02  # 0xC0874910, 0xD52D3051 -- por debajo, da cero
#: ln2 partido en dos para que `x - k*ln2HI` salga exacto; el índice es el signo de x.
_LN2HI = (6.93147180369123816490e-01, -6.93147180369123816490e-01)  # 0x3FE62E42, 0xFEE00000
_LN2LO = (1.90821492927058770002e-10, -1.90821492927058770002e-10)  # 0x3DEA39EF, 0x35793C76
_HALF_F = (0.5, -0.5)
_HUGE = 1.0e300
_TWOM1000 = 9.33263618503218878990e-302  # 2**-1000 = 0x01700000, 0x00000000
_E = 2.718281828459045  # 0x4005BF0A, 0x8B145769 = Math.E, el double más cercano a e


def exp(x: float) -> float:
    """``Math.exp``: la exponencial de fdlibm (``e_exp.c``), bit a bit la de V8.

    El motor la usa para sesgar el peso de cada tamaño de globo al elegir el nominal de uno, así que un
    ulp aquí no cambia una medida: cambia **qué globo sale**, porque el peso entra en una comparación
    acumulada contra un número al azar.

    El reescalado final suma ``k`` al exponente de ``y`` tocando su palabra alta en vez de multiplicar por
    una potencia de dos, que es lo que hace fdlibm; cuando ``k < -1021`` la suma se haría sobre un
    exponente que ya no existe, y por eso ahí se desplaza 1000 y se corrige con ``2**-1000``.
    """
    # En x = 1 exactamente, y **solo** ahí, Node no devuelve lo que da la fórmula de fdlibm (que se queda
    # un ulp por encima) sino `Math.E`, el double más cercano a e. Esto no está leído en la fuente de V8
    # —no la hay aquí—, está **medido**: 2 790 000 valores comparados con Node 24.19.0 (toda la rejilla de
    # 0,001 en [-3, 3], 20 000 ulps alrededor de cada entero y medio entero, los umbrales internos de
    # e_exp.c con su vecindario, y 2,5 millones al azar) dan **una sola** diferencia, esta. Que V8 haga que
    # `Math.exp(1) === Math.E` tiene sentido —es la identidad que un motor querría garantizar— pero la
    # razón es una conjetura; el hecho, no. Sin esta línea el puerto devolvería otro bit que el motor
    # original en un punto que el argumento del motor sí alcanza (su rango medido es [-1,45, 2,03]).
    if x == 1.0:
        return _E

    hx = _alto(x) & 0xFFFFFFFF
    xsb = (hx >> 31) & 1
    hx &= 0x7FFFFFFF

    k = 0
    hi = 0.0
    lo = 0.0

    if hx >= 0x40862E42:  # |x| >= 709.78...
        if hx >= 0x7FF00000:
            if ((hx & 0xFFFFF) | _bajo(x)) != 0:
                return x + x  # NaN
            return x if xsb == 0 else 0.0  # exp(+-inf) = {inf, 0}
        if x > _O_THRESHOLD:
            return _HUGE * _HUGE
        if x < _U_THRESHOLD:
            return _TWOM1000 * _TWOM1000

    if hx > 0x3FD62E42:  # |x| > 0.5 ln2: hay que reducir
        if hx < 0x3FF0A2B2:  # y |x| < 1.5 ln2: basta un ln2
            hi = x - _LN2HI[xsb]
            lo = _LN2LO[xsb]
            k = 1 - xsb - xsb
        else:
            k = _entero(_IVLN2 * x + _HALF_F[xsb])
            t = float(k)
            hi = x - t * _LN2HI[0]  # t*ln2HI es exacto aquí
            lo = t * _LN2LO[0]
        x = hi - lo
    elif hx < 0x3E300000:  # |x| < 2**-28: exp(x) = 1 + x
        if _HUGE + x > _ONE:  # el original lo escribe así para marcar «inexacto»
            return _ONE + x
    else:
        k = 0

    t = x * x
    c = x - t * (_P1 + t * (_P2 + t * (_P3 + t * (_P4 + t * _P5))))
    if k == 0:
        return _ONE - ((x * c) / (c - 2.0) - x)
    y = _ONE - ((lo - (x * c) / (2.0 - c)) - hi)
    hy = _alto(y) & 0xFFFFFFFF
    if k >= -1021:
        return _con_alto(y, hy + (k << 20))
    return _con_alto(y, hy + ((k + 1000) << 20)) * _TWOM1000


# ---------------------------------------------------------------------------
# Math.hypot -- este no es fdlibm
# ---------------------------------------------------------------------------


def hypot(x: float, y: float) -> float:
    """``Math.hypot``: la suma de Kahan de V8, no la ``hypot`` de la libm.

    Esta es la que más se desvía de las seis (1434 de 4000), y no porque V8 sea menos preciso: la
    ``hypot`` de la libm hace un esfuerzo extra por redondear bien, y V8 hace otra cosa. Normaliza por el
    mayor de los dos en valor absoluto —para que ``x*x`` no desborde— y suma los cuadrados compensando el
    error de redondeo a lo Kahan. Como el resultado es ``sqrt(sum) * max``, cada paso cuenta: hay que
    sumar en el orden de los argumentos (primero ``x``) y con las mismas restas intermedias.

    Los casos límite son los de JavaScript: un argumento infinito da ``Infinity`` **antes** de mirar los
    NaN (``Math.hypot(NaN, Infinity)`` es ``Infinity``), y ``Math.hypot(-0, -0)`` es ``+0``.
    """
    argumentos = (x, y)

    # Primero los infinitos: ganan sobre los NaN, y además impedirían normalizar.
    for arg in argumentos:
        if math.isinf(arg):
            return _INF

    maximo = 0.0
    for arg in argumentos:
        absoluto = abs(arg)
        if absoluto > maximo:  # con NaN la comparación es falsa, y el NaN se cuela en la suma
            maximo = absoluto
    if maximo == 0.0:
        maximo = 1.0

    suma = 0.0
    compensacion = 0.0
    for arg in argumentos:
        n = abs(arg) / maximo
        sumando = n * n - compensacion
        preliminar = suma + sumando
        compensacion = (preliminar - suma) - sumando
        suma = preliminar

    # ``math.sqrt`` lanza con un argumento negativo donde la ``sqrt`` de C devuelve NaN; la suma no
    # puede salir negativa, pero sí NaN si uno de los argumentos lo era, y entonces hay que dar NaN.
    if math.isnan(suma) or suma < 0.0:
        return _NAN
    return math.sqrt(suma) * maximo
