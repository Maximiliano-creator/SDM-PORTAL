# Operación segura de SDM Portal

Guía para instalar y operar SDM Portal en una tienda con servicios alojados localmente. SQLite continúa siendo la base de datos; no se requiere Redis ni una base de datos distribuida.

## 1. Límites y supuestos de operación

- La API escucha en `127.0.0.1` por defecto. Mantén ese valor si el portal solo se utiliza en el equipo de la tienda.
- Para acceso desde otros equipos, publica la web mediante un proxy local con HTTPS. No expongas directamente el puerto HTTP de la API a la LAN o a Internet.
- `term_admin` debe estar instalado y accesible en la dirección configurada en `TERM_ADMIN_URL`.
- Se admiten importaciones de hasta **1.000 productos por lote**. En una importación de catálogo se pueden asociar hasta 1.000 imágenes.
- Cada imagen puede ocupar hasta **5 MB**. El servidor recibe hasta **25 imágenes y 8 MB decodificados por petición**; la interfaz envía lotes para no acumular todas las imágenes en memoria.
- Las imágenes se guardan en `apps/api/data/uploads/products`. El servicio de archivos está pensado para imágenes de catálogo, no para documentos confidenciales.

## 2. Instalación inicial

Requisitos: Windows 10/11 o Windows Server, Node.js 20+, pnpm 10+ y acceso al servicio local `term_admin`.

Desde la raíz del repositorio:

```powershell
pnpm install
Copy-Item .env.example apps\api\.env
```

Edita `apps\api\.env` antes de iniciar la API:

1. Define `INITIAL_ADMIN_PASSWORD` con una contraseña única de al menos 12 caracteres. Solo se usa cuando la base de datos todavía no tiene usuarios.
2. Revisa `TERM_ADMIN_URL`, `TERM_ADMIN_USERNAME` y configura la contraseña de upstream en Configuración o en `TERM_ADMIN_PASSWORD`.
3. Conserva `HOST=127.0.0.1` para uso local y `COOKIE_SECURE=false` solo para HTTP local.
4. No compartas ni incluyas `.env`, `apps\api\data`, bases SQLite o copias de seguridad en Git.

Construye y arranca:

```powershell
pnpm --filter @sdm/shared build
pnpm build
pnpm dev
```

Al arrancar por primera vez, el sistema crea el usuario `admin`, aplica las migraciones SQLite y genera un secreto JWT local si no se proporcionó uno. Tras crear el usuario, elimina `INITIAL_ADMIN_PASSWORD` del entorno y guarda la contraseña en el gestor de contraseñas de la tienda. No se registra la contraseña en logs.

La migración de seguridad elimina una contraseña antigua de `term_admin` guardada en SQLite. Vuelve a configurar la credencial desde la pantalla **Configuración** o define `TERM_ADMIN_PASSWORD`; el portal informará claramente si falta.

## 3. Sesiones, permisos e integraciones

- El inicio de sesión usa cookies `HttpOnly`, sesiones revocables guardadas en SQLite, protección CSRF y límite persistente de intentos fallidos.
- Cambiar la contraseña del usuario invalida sus sesiones activas. Cerrar sesión también revoca la sesión en el servidor.
- Las operaciones administrativas (usuarios/configuración, tiendas, balanzas, distribución, claves ERP y auditoría) requieren el rol `admin`. Los operadores conservan las funciones de consulta y trabajo de catálogo permitidas por la aplicación.
- Las claves ERP se muestran completas una sola vez al crearlas; almacénalas en el gestor de secretos del sistema cliente. Deshabilita o elimina inmediatamente una clave que ya no se use.
- La capacidad de distribución y sincronización `full` está desactivada en una clave nueva. Autorízala solo para integraciones que la necesiten.
- Los endpoints ERP validan la clave antes de analizar cuerpos grandes. Las cargas aceptan como máximo 1.000 productos; las sincronizaciones completas no eliminan productos ausentes cuando hubo fallos parciales.

Para acceso desde otros equipos, utiliza un proxy HTTPS de confianza y configura `NODE_ENV=production`, `COOKIE_SECURE=true` y `CORS_ORIGIN` con el origen exacto del portal. Mantén la API enlazada a loopback detrás del proxy. No desactives la validación TLS ni expongas la API ERP sin controles de red y claves independientes.

## 4. Imágenes y capacidad del catálogo

1. Prepara una hoja de cálculo de hasta 1.000 productos y selecciona sus imágenes.
2. La interfaz asocia imágenes por PLU o nombre, muestra una vista previa y las transmite por lotes.
3. El servidor comprueba tamaño y firma del contenido, usa nombres derivados de hashes y escribe archivos temporales antes de moverlos a su destino.
4. Revisa productos e imágenes en el catálogo antes de ejecutar una distribución.

Los límites son por lote/petición y por archivo; no significan que el sistema deba cargar 1.000 archivos de hasta 5 MB en una única petición. Mantén espacio libre suficiente en disco para el catálogo, las imágenes y las copias de seguridad.

## 5. Copia de seguridad y restauración

Haz copias antes de actualizar la aplicación o sus migraciones. Detén la API primero para obtener un conjunto consistente de archivos. Respalda conjuntamente:

- `apps\api\data\app.db` y, si existen, `app.db-wal` y `app.db-shm`.
- `apps\api\data\uploads\`.
- `apps\api\data\.jwt-secret`.
- `apps\api\.env` de forma cifrada y con acceso restringido.

Guarda las copias fuera del equipo de operación, cifradas y con acceso limitado. Para restaurar, detén la API, restaura el conjunto respaldado a las mismas rutas y vuelve a iniciar el servicio. Prueba periódicamente la restauración en una instalación aislada.

## 6. Mantenimiento y respuesta a incidentes

- Revisa los logs del proceso y la auditoría en el portal. Los logs HTTP omiten query strings para no registrar tickets VNC.
- Si se sospecha que una cuenta fue comprometida, cambia su contraseña; esto revoca sus sesiones activas. Si se compromete una integración, deshabilita su API key y genera una nueva.
- Si se filtra la credencial de `term_admin`, cámbiala también en el servicio upstream y actualízala en SDM Portal.
- Los datos locales y el secreto JWT que estaban versionados se quitan de los próximos commits, pero pueden permanecer en el historial Git ya publicado. Antes de continuar compartiendo el repositorio, rota el secreto JWT y las credenciales/API keys que hayan estado almacenadas allí, e inicia una limpieza coordinada del historial remoto; borrar archivos en un commit nuevo no elimina versiones anteriores.
- Antes de actualizar, crea una copia de seguridad. Las migraciones se ejecutan al iniciar la API y deben distribuirse junto con el build.
- Cierra la aplicación de forma ordenada para que SQLite complete el cierre en modo WAL y se cierren las conexiones VNC.

## 7. Comprobaciones posteriores a una actualización

1. Inicia la aplicación y confirma que la API responde en `/api/health`.
2. Inicia sesión con una cuenta autorizada y verifica que cerrar sesión impide reutilizar la sesión revocada.
3. Comprueba que un operador no puede abrir las vistas administrativas ni ejecutar acciones protegidas.
4. Verifica una importación de prueba pequeña antes de procesar un lote de 1.000 productos.
5. Comprueba el espacio de disco y que la carpeta de imágenes está incluida en el proceso de respaldo.
