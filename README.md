# BiblioTech — versión con operaciones reales y BI de 4 niveles

## Requisitos
Node.js 20 o superior y npm. Conservar el mismo directorio de trabajo para ejecutar scripts y servidor.

## Iniciar
```bash
npm install
npm run init-db
npm start
```
Abrir http://localhost:3000 (no abrir el HTML directamente desde el explorador).

Datos académicos de acceso inicial (solo si el usuario todavía no existe):
- Administrador: `admin@biblioteca.com` / `admin123`
- Lector: `lector@biblioteca.com` / `lector123`

### Precaución importante
Si ya existe `biblioteca.db`, **hacer primero una copia de seguridad del archivo**. Esta versión agrega tablas de forma no destructiva y conserva las tablas existentes. El inicializador reparte el stock original de cada libro entre Centro, Norte y Sur solo cuando ese libro aún no tiene filas de inventario. Los registros anteriores de Usuarios y Libros no se sobrescriben.

## API
- `POST /api/login`, `POST /api/logout`, `GET /api/sesion`.
- `GET /api/libros`, `GET /api/libros/:id`, `GET /api/sucursales`.
- `GET /api/usuarios` (administrador).
- `GET /api/prestamos` (propios), `GET /api/prestamos?id_usuario=ID` (administrador).
- `POST /api/prestamos/:id/devolver`.
- `POST /api/operaciones` con cuerpo `{ "id_biblioteca": 1, "items": [{"id_libro": 1, "tipo":"Prestar"},{"id_libro":2,"tipo":"Comprar"}] }`.
- `GET /api/bi/sucursales` (administrador).
- `GET /api/bi/sucursales/:id/libros` (administrador).
- `GET /api/bi/sucursales/:sucursal/libros/:libro/operaciones` (administrador).
- `GET /api/bi/operaciones/:codigo` (administrador; código de operación `P-1` o `V-1`).

El frontend consume todos los endpoints con cookies HTTP-only para autenticación. La autorización se verifica también en el servidor. Las sesiones se almacenan en memoria y se cierran al reiniciar el servidor.

## Reglas de negocio
- Stock por sucursal, no se admiten cantidades negativas.
- Cada libro puede prestarse (14 días por defecto); solo libros `para_venta=1` se pueden comprar.
- Una confirmación del carrito es una transacción SQLite: si falta stock para algún ejemplar, se revierte el pedido completo.
- Las ventas tienen cabecera y detalles; el precio de la operación queda registrado.
- Una devolución restaura una unidad al stock de la sucursal original y no puede registrarse dos veces.
- El tablero solo refleja operaciones realmente registradas; aparece inicialmente sin movimientos, no se insertan operaciones ficticias.
- El cuarto nivel muestra la información de la operación y el usuario asociado.

## Prueba manual sugerida
1. Entrar como admin. El BI debería presentar inicialmente 0 operaciones en cada sucursal en una BD nueva.
2. Abrir el catálogo, revisar stock por sucursal y agregar un préstamo y una compra al carrito.
3. Seleccionar una sucursal con existencias de ambos libros y confirmar. Verificar mensaje de confirmación y stock reducido.
4. Entrar en BI y seguir Centro/Norte/Sur → libro → operación → detalle. Probar atrás/adelante del navegador.
5. Entrar en Mis Préstamos, devolver un ejemplar y verificar que reaparece en stock; intentar devolución duplicada para comprobar el control.
6. Cerrar sesión, entrar como lector y comprobar que no se visualiza el BI y que el backend rechaza rutas de admin con HTTP 403.

## Alcance y notas
- El proyecto no incluye pago bancario ni reservas: la venta queda registrada como operación académica finalizada.
- No hay inserción de transacciones ficticias. Se mantienen los 30 libros originales y sus valores de precio/venta si la base ya existía.
- Con sesiones en memoria, reiniciar Node obliga a iniciar sesión de nuevo.
- No es una solución de autenticación preparada para despliegue público; se recomienda HTTPS, protección CSRF, rate limits y almacenamiento de sesión externo en producción.
