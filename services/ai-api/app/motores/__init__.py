"""Los motores de estructura migrados 1 a 1 desde `clasificador-decoraciones`.

Ese repositorio es el dueño de cómo se arma una decoración: aquí no se inventa geometría, ni patrones, ni
dibujo. Lo que vive en este paquete es lo que comparten los tres motores migrados (arco, columna y guirnalda):
la semántica de JavaScript que Python no trae de serie y la resolución de los colores canónicos del catálogo.

Cada motor concreto vive en su propio paquete (`app.arco`, `app.columna`, `app.guirnalda`) con un módulo por
archivo del original, para que un cambio allá se encuentre aquí sin buscar.
"""
