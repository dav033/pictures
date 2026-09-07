# Protocolo de Sanitización de Información — demo-decoracion

## 3 Fases del flujo

### Fase 1: Escoger Productos ← ENFOQUE ACTUAL
- No duplicados de referencias (mismo `id`)
- Cada producto = producto individual único
- Regla: una ref = un ítem en selección

### Fase 2: Generar Imagen
- Usar productos seleccionados de Fase 1
- Sin duplicados en el prompt

### Fase 3: Generar Cotización  
- Consolidar cantidad de referencias iguales si es necesario
- Una línea por producto único

## Puntos de Sanitización

### P1.1: Chat devuelve productos (respuesta SSE)
- Eliminar IDs duplicados → guardar primer occurrence
- Validar que no hay repeticiones

### P1.2: Decoraciones prearmadas
- Al cargar una decoración → deduplicar `elementos`
- Mostrar cada ref una sola vez

### P1.3: Selección del usuario
- Evitar agregar un producto ya seleccionado
- (Ya implementado en `alternar()`)

## Implementación

- [ ] Crear función `deduplicarProductosPorId()`
- [ ] Aplicar en respuesta del chat
- [ ] Aplicar en carga de decoraciones
- [ ] Validar en BarraSeleccion
