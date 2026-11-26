# SDM Portal

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-10%2B-F69220?logo=pnpm&logoColor=white)
![OS](https://img.shields.io/badge/OS-Windows%2010%2F11%20%7C%20Server-0078D6?logo=windows&logoColor=white)

Portal moderno de administración de balanzas, sucursales y catálogo de productos (PLU), construido como arquitectura **BFF (*Backend-for-Frontend*)** sobre la API del backend BLS `term_admin` (`v1.0.31_0430_beta`).

---

## Tabla de Contenidos

- [Estructura del Monorepo](#estructura-del-monorepo)
- [Requisitos](#requisitos)
- [Instalación y Desarrollo](#instalación-y-desarrollo)
- [Cómo funciona SDM Portal](#cómo-funciona-sdm-portal)
- [Cambios Realizados en esta Versión](#cambios-realizados-en-esta-versión)
- [Seguridad y operación local](#seguridad-y-operación-local)
- [Referencia Rápida de Endpoints](#referencia-rápida-de-endpoints)
- [Documentación Adicional](#documentación-adicional)

---

## Estructura del Monorepo

```text
sdm-portal/
├── apps/
│   ├── web/          # Frontend en Vite + React + TypeScript + Tailwind CSS + shadcn/ui + TanStack Query
│   └── api/          # Backend en Express + TypeScript + SQLite (better-sqlite3), sesiones/API keys y proxy WS VNC
├── packages/
│   └── shared/       # Schemas de validación Zod y tipos TypeScript compartidos (@sdm/shared)
└── docs/             # Documentación de instalación, arquitectura e integración ERP
```

---

## Requisitos

- **Node.js** `20+` (probado en `v22.17.1`)
- **pnpm** `10+` (`corepack enable` lo gestiona)
- **Sistema Operativo:** Windows 10/11 o Windows Server (target de despliegue)
- **Backend BLS `term_admin`:** Instalado y corriendo en el mismo host (`http://localhost:19697`) o accesible por red

---

## Instalación y Desarrollo

```powershell
pnpm install
pnpm --filter @sdm/shared build
pnpm dev # Levanta apps/web y apps/api en paralelo
```

> **Nota al clonar o mover el proyecto de directorio:** Ejecutar `pnpm install --force` y `pnpm --filter @sdm/shared build` antes de `pnpm dev` para regenerar los binarios y enlaces simbólicos de `node_modules/.bin`.

### URLs por Defecto

| Servicio | URL Local | Observaciones |
| :--- | :--- | :--- |
| **Web (Frontend)** | `http://localhost:5173` | Puerto por defecto de Vite; escucha solo en localhost por defecto |
| **API & WebSocket VNC** | `http://localhost:8788` | Configurable a `8080` según `.env` |
| **BLS `term_admin`** | `http://localhost:19697` | Servicio base upstream |

Para una demo temporal desde otro equipo de la misma red, habilita el acceso LAN
antes de iniciar Vite:

```powershell
$env:SDM_PORTAL_LISTEN_HOST = '0.0.0.0'
pnpm dev
```

Luego usa `http://<IP-privada-del-servidor>:5173` y permite TCP 5173 solo en el
perfil **Privado** del Firewall de Windows. Sin esa variable, Vite queda limitado
a localhost. No publiques directamente los puertos de API ni de `term_admin`.

---

## Cómo funciona SDM Portal

### 1. Arquitectura BFF con Espejo Local (SQLite)
- El frontend nunca consulta directamente a `term_admin`; todas las peticiones pasan por `apps/api`, que autentica usuarios mediante sesiones revocables en cookies `HttpOnly` y sistemas ERP mediante **`X-Api-Key`**.
- `apps/api` mantiene un espejo local en SQLite (`mirror_shops`, `mirror_scales`, `app_settings`, `erp_sync_log`, `audit_log`) que permite respuestas inmediatas, resiliencia ante microcortes del upstream y persistencia de metadatos propios que `term_admin` no almacena.

### 2. Flujo Operativo (`Tienda ➔ Balanzas`)
- Cada sucursal se identifica mediante un código único (`shopCode`, ej. `2026`).
- El catálogo de productos (PLUs) y precios se carga a nivel de tienda y se sincroniza con `term_admin`.
- La distribución hacia las balanzas electrónicas puede ejecutarse manualmente desde el portal o de forma automatizada desde un ERP externo, enviando los datos en paralelo a todas las balanzas activas de la tienda.

### 3. Acceso Remoto VNC Integrado
- El servidor API expone un proxy WebSocket en la ruta `/ws/vnc` sobre el mismo puerto HTTP del backend (`8788`), autenticando cada conexión mediante tickets temporales de un solo uso y conectándose al puerto TCP `5900` de cada balanza sin requerir puertos adicionales abiertos.

---

## Cambios Realizados en esta Versión

### 1. Módulo de Tiendas (`Stores.tsx`, `stores.ts`, `scales.ts`)
- **Simplificación de navegación:** Se ocultó el módulo independiente de *Gestión de Marcas* en el menú lateral, renombrando la sección a **Tiendas** y conservando el selector de marca comercial de forma interna al crear o editar sucursales (`/api/stores/meta`).
- **Filtrado de sucursales activas:** Tanto `GET /api/shops` como `GET /api/shops?fresh=1` excluyen estrictamente las tiendas marcadas como eliminadas en `term_admin` (`deleteFlag !== 1`), evitando que reaparezcan registros borrados.
- **Persistencia local del teléfono (`directorPhone`):** Al crear o actualizar una tienda, el teléfono de contacto se guarda en SQLite (`app_settings` con clave `shop.<id>.phone`) y se fusiona automáticamente en cada lectura, resolviendo la pérdida del dato en `term_admin`.

### 2. Integración ERP y Distribución Masiva a Balanzas (`Erp.tsx`, `erp.ts`)
- **Endpoints públicos con autenticación `X-Api-Key`:**
  - `POST /api/erp/products`: Carga masiva de hasta **1.000 productos por lote** en **JSON** o **CSV** (`?shop_code=...&mode=incremental|full`), admitiendo cabeceras en español e inglés (`plu`/`code`, `name`/`nombre`, `price`/`precio`, `unit`/`unidad`, `barcode`/`codigo_barras`). El modo `full` requiere una clave con permiso explícito.
  - `GET /api/erp/scales`: Consulta el inventario de balanzas disponibles (`termId`, `shopId`, IP, estado online).
  - `POST /api/erp/scales/distribute`: Transmite datos (`typeList`: `0` = PLUs/Productos, `1` = Grupos/departamentos y sus vínculos, `2` = Imágenes) directamente a las balanzas. Al incluir `0`, el backend agrega automáticamente `1` para que los PLUs lleguen con su agrupación.
- **Distribución automática multi-balanza por `shop_code`:** Al enviar `{"shop_code": "2026", "typeList": [0, 1, 2]}` sin especificar `targetTermIdList`, el backend detecta todas las balanzas activas de esa sucursal (`deleteFlag !== 1`) y les envía la actualización en paralelo. También soporta filtrado puntual mediante `targetTermIdList`.
- **Guía de conexión integrada en UI:** La vista **Integración ERP** incorpora una tarjeta de inicio rápido con URL base copiable, tabla resumen de endpoints y ejemplos `cURL` (JSON, CSV y distribución a balanzas) listos para copiar en un clic.

### 3. Calidad de Código, Auditoría UTF-8 y QA
- **Reparación de codificación UTF-8 (Mojibake):** Se auditaron y corrigieron las tildes y caracteres doblemente codificados en `Erp.tsx`, `Stores.tsx`, `api.ts`, `mirror.ts`, `erp.ts`, `products.ts` y `vnc.ts`.
- **Consultas concurrentes sin bloqueo:** Las verificaciones de estado en línea de múltiples balanzas (`GET /api/scales`) usan `Promise.allSettled`, asegurando que una balanza apagada o fuera de red no retrase el resto del inventario.

### 4. Administración Avanzada de Balanzas y Distribución Instantánea (`Scales.tsx`, `ScaleDetail.tsx`, `scales.ts`)
- **Actualización de IP y Nombre con Distribución Inmediata:** Al editar una balanza en la tabla o en la vista de detalle, se incluye el botón **"Guardar y Enviar Datos"**, el cual actualiza el nombre e IP en `term_admin` y sincroniza inmediatamente catálogo, precios y configuración (`typeList: [0, 1, 2]`) con la nueva dirección en un solo paso.
- **Acciones Rápidas en Fila y Vista Detalle:** Cada fila del inventario de balanzas dispone de un botón directo de envío de datos (`Send`). La página de detalle (`/balanzas/:id`) incorpora botones de edición y transmisión directa a esa balanza.

### 5. Carga Masiva de Catálogo con Auto-Vinculación de Imágenes (`CatalogImport.tsx`, `images.ts`, `Catalog.tsx`)
- **Zona de Carga de Imágenes de Productos:** Permite arrastrar o seleccionar múltiples archivos (`.jpg`, `.png`, `.webp`).
- **Motor de Coincidencia Inteligente:** Asocia automáticamente cada imagen a su PLU correspondiente comparando por nombre de producto (ej. `PLATANO.JPG` ➔ PLU `1` `PLATANO`), por código PLU (ej. `1.png`), o nombres combinados (`1_PLATANO.png`), insensible a mayúsculas y acentos.
- **Previsualización y Edición:** Muestra miniaturas en la tabla previa, gestión de imágenes sin asociar con selector manual, y visualización de fotos en la tabla principal del catálogo y en la ficha de edición rápida.
- **Almacenamiento Estático:** Las imágenes se guardan en `data/uploads/products/` y se sirven en `/uploads/products/*` con cabeceras de recurso cruzado.
- **Capacidad y validación:** Hasta 1.000 productos con imágenes asociadas; cada imagen admite hasta 5 MB y se transmite en lotes de hasta 25 elementos, con un máximo de 8 MB decodificados por petición.
- **Administración de departamentos:** La importación reutiliza o crea grupos por tienda y vincula los PLU. Desde Catálogo se pueden crear, renombrar o eliminar grupos, asignar un departamento a un producto y cambiarlo en lote. Los cambios sincronizan el `deptCode`; al eliminar un grupo no se eliminan sus productos.

### 6. Centro de Integración ERP & POS Completo (`Erp.tsx`, `erp.ts`, `docs/ERP-INTEGRATION.md`)
- **API Playground Interactivo:** Permite probar peticiones HTTP en tiempo real directamente desde el navegador seleccionando una clave API y viendo el código de estado, latencia y respuesta JSON formateada.
- **Generador de Código Multilenguaje:** Snippets dinámicos listos para copiar en **C# (.NET)**, **Python**, **Node.js**, **PHP** y **cURL**.
- **Nuevos Endpoints con `X-Api-Key`:**
  - `GET /api/erp/products`: Consulta productos y precios actuales por `shop_code`.
  - `POST /api/erp/products/price`: Actualización rápida de precio unitario con opción de distribución inmediata (`distribute: true`).
  - `GET /api/erp/shops`: Listado de sucursales activas.
  - `GET /api/erp/scales/status`: Estado y telemetría de balanzas en tiempo real.
- **Recursos para Desarrolladores:** Descarga directa de colección de Postman (`.json`), especificación OpenAPI 3.0 (`openapi.json`), plantillas CSV y JSON.

---

## Seguridad y operación local

- **Instalación segura:** copia `.env.example` a `apps\api\.env`, define `INITIAL_ADMIN_PASSWORD` (mínimo 12 caracteres) para la primera inicialización y no subas `.env`, la base SQLite ni los datos locales al repositorio.
- **Sesiones y protección de acceso:** cookies `HttpOnly`/`SameSite=Strict`, sesiones revocables, protección CSRF, límite persistente de intentos de login y roles administrativos aplicados en el servidor.
- **Menor privilegio:** claves ERP nuevas no pueden distribuir a balanzas ni ejecutar sincronizaciones completas. El administrador debe activar ese alcance solo cuando sea necesario.
- **Operación local:** por defecto la API escucha en `127.0.0.1`. Para otros equipos de la tienda, usa un proxy local con HTTPS; no expongas directamente la API HTTP.
- **Estabilidad de sincronización:** cargas limitadas a 1.000 productos; una sincronización `full` con errores no elimina productos ausentes. Las migraciones SQLite se incluyen en el build de producción.
- **Copias de seguridad:** detén la API y respalda conjuntamente `apps\api\data` (SQLite, WAL si existe, imágenes y secreto JWT) y `.env` cifrado. Ver [OPERATIONS.md](OPERATIONS.md) para restauración y respuesta ante incidentes.
- **Calidad continua:** `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` se ejecutan también en GitHub Actions.

La migración de seguridad elimina una contraseña antigua de `term_admin` que estuviera guardada en SQLite. Tras actualizar, vuelve a configurarla en **Configuración** o mediante `TERM_ADMIN_PASSWORD`. Una base de datos nueva requiere configurar la contraseña inicial del administrador antes del primer arranque.
Los archivos de datos que estaban versionados se excluyen de los nuevos commits, pero pueden persistir en el historial Git; antes de seguir compartiendo el repositorio, rota las credenciales afectadas y coordina la limpieza del historial.

---

## Referencia Rápida de Endpoints

| Método | Endpoint | Autenticación | Descripción |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/erp/products` | `X-Api-Key` | Carga masiva de PLUs (JSON o CSV) por `shop_code`. |
| `GET` | `/api/erp/products` | `X-Api-Key` | Consulta productos y precios registrados por `shop_code`. |
| `POST` | `/api/erp/products/price` | `X-Api-Key` | Cambio rápido de precio unitario por PLU (POS) con distribución opcional. |
| `GET` | `/api/erp/scales` | `X-Api-Key` | Lista balanzas registradas y sus `termId`. |
| `GET` | `/api/erp/scales/status` | `X-Api-Key` | Estado en línea y telemetría de balanzas en tiempo real. |
| `POST` | `/api/erp/scales/distribute` | `X-Api-Key` | Envía datos (`typeList: [0, 1, 2]`) a balanzas de una sucursal o lista de `termId`. |
| `GET` | `/api/erp/shops` | `X-Api-Key` | Lista sucursales activas y sus códigos `shopCode`. |
| `GET` | `/api/erp/openapi.json` | Público / API Key | Especificación OpenAPI 3.0 completa en JSON. |
| `POST` | `/api/products/images/upload` | Sesión web + CSRF | Carga por lotes de imágenes para productos. |
| `PUT` | `/api/scales/:id` | Sesión web + CSRF (admin) | Actualiza IP/nombre de balanza con distribución inmediata opcional. |
| `POST` | `/api/scales/distribute` | Sesión web + CSRF (admin) | Envío manual de datos a balanzas desde sesión de usuario. |
| `GET` | `/api/shops` | Sesión web | Lista sucursales activas con teléfonos persistidos. |
| `GET` | `/api/health` | Público | Estado del API, conexión con `term_admin` y caché SQLite. |

---

## Documentación Adicional

- [`docs/INSTALL.md`](docs/INSTALL.md) — Despliegue en cliente
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Diagrama y decisiones técnicas
- [`docs/ERP-INTEGRATION.md`](docs/ERP-INTEGRATION.md) — Cómo integrar ERPs
- `C:\sdm\API.md` — Referencia de endpoints del backend BLS