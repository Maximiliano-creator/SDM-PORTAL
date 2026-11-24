# term_admin — Manual de Operaciones

Portal web de administración de balanzas y tiendas, distribuido por SDM / BLS (`佰伦斯信息科技股份有限公司`). Este documento sintetiza la arquitectura, los fixes aplicados, el procedimiento de instalación limpia y la operación cotidiana.

---

## 1. Síntesis de la aplicación

### 1.1 Qué es

Suite multi-servicio para gestionar balanzas IoT en cadenas de supermercados desde un portal web centralizado. Funciones principales:

- Login y gestión de usuarios/roles
- Registro y configuración de balanzas, tiendas, productos, etiquetas
- Sincronización de catálogo hacia las balanzas
- Recolección de datos de venta desde balanzas (IoT)
- **Control remoto VNC de cada balanza** desde el portal (la feature que más nos costó)
- Big screen, publicidad, reportes

### 1.2 Arquitectura

5 servicios Windows + 1 servicio adicional que **no venía en el installer** y tuvimos que añadir nosotros:

| Servicio Windows | Puerto | Tecnología | Rol |
|---|---|---|---|
| `nginx-sdm` | **19697** | Nginx | Entrada del portal: sirve frontend estático + proxy `/service/` → backend Java |
| `term-admin` | 8000 | Java 8 + Spring Boot (`app\term-admin.jar`) | API REST. Login, balanzas, tiendas, etiquetas. Spring Security 5.1.1 + BCrypt |
| `Mysql-sdm` | **3506** | MySQL 8 | BD `scale_admin_tag`. Root: `root` / `sdm@666666` |
| `redis-sdm` | **16380** | Redis | Caché de sesión/tokens. **No es 6379** (config `redis.windows-service.conf`) |
| `RecordData-sdm` | 9756 | .NET Core 6 (`aiRecordData\RecordData.exe`) | Microservicio IoT. Recolección de datos de balanzas. **Requiere activación** |
| `websockify-sdm` | **9000** | Python websockify (añadido por nosotros) | Proxy WebSocket↔TCP para el control remoto VNC |

### 1.3 Flujo de control remoto (VNC)

Cuando un usuario hace click en "control remoto" de una balanza:

```
Browser → http://localhost:19697 (nginx)
  ↓
  POST /service/api/sysConfig/getNovncAddress {ip, port, shopId}
  ↓ (Java term-admin lee sys_config.novnc_address)
  ← "localhost:9000"
  ↓
Browser abre WebSocket: ws://localhost:9000/websockify/?token=<balanza-ip>
  ↓ (websockify-sdm lee token.conf, busca <balanza-ip> → <balanza-ip>:5900)
  ↓
Balanza VNC server :5900
  ← protocolo RFB
  ↓ (websockify proxea bytes bidireccional WS↔TCP)
  ↓
Frontend (chunk-5af61938.js, cliente noVNC embebido) renderiza la pantalla
```

### 1.4 Credenciales y archivos clave

| Recurso | Valor / Ruta |
|---|---|
| Portal | `http://localhost:19697` |
| Login admin | `admin` / `admin123` (también `mercAdmin` / `admin123`) |
| MySQL root | `root` / `sdm@666666` en `127.0.0.1:3506` |
| BD | `scale_admin_tag` |
| Token Redis app | DB **4** (no la 0 ni la 3) |
| Backend `application.yml` | `BOOT-INF/classes/config/application.yml` dentro de `app\term-admin.jar` |
| Schema completo | `mysql\sqlfile\scale_admin_tag.sql` |
| Logs backend Java | `C:\term-log\info.log`, `C:\term-log\error.log` |
| Log .NET RecordData | `C:\sdm\term_admin\aiRecordData\logs\` |
| Log websockify | `C:\sdm\term_admin\websockify\logs\` |
| Hashes originales `sys_user` | `C:\sdm\password-backup.txt` |

---

## 2. Fixes aplicados a esta instalación

Esta instalación venía con tres bloqueos heredados. La sección está ordenada cronológicamente y explica el **por qué** de cada fix, no sólo el **qué**.

### 2.1 Login imposible — contraseña admin desconocida

**Síntoma:** El hash BCrypt en `sys_user.password` no correspondía a ninguna clave documentada y el fabricante no la tenía.

**Causa:** Schema seed con hash precomputado; password original no provisto al cliente.

**Fix:** Generar un BCrypt hash nuevo para `admin123` usando exactamente la misma implementación (`org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder` de Spring Security 5.1.1) que usa el backend al validar. Compilamos un Java mínimo contra el jar extraído del fat-jar.

```sql
UPDATE scale_admin_tag.sys_user
   SET password = '$2a$10$...nuevoHash...',
       pwd_reset_time = NOW(),
       update_time = NOW(),
       update_by = 'manual-reset'
 WHERE username IN ('admin','mercAdmin');
```

**Trampa importante:** Spring Boot **cachea el `User` en memoria**. `FLUSHDB` en Redis NO limpia ese caché. Hay que **`Restart-Service term-admin`** (con elevación UAC) tras cambiar el hash, si no el backend sigue rechazando la nueva clave.

> Script: `scripts/reset-admin-password.ps1`

### 2.2 `RecordData-sdm` no arrancaba — activador roto en NVMe

**Síntoma:** Servicio `Stopped`, log decía `激活信息为空 / 采集端未激活` ("activation info empty / collector not activated").

**Causa raíz:** El activador (`采集端激活.exe`, .NET WPF) construye el fingerprint con `Win32_PhysicalMedia.SerialNumber`. En discos **NVMe** Windows devuelve un serial con formato extraño (`0000_0000_..._E21B_DEF4.` con underscores y punto final) que el código del activador, escrito para SATA, no sabe parsear. Falla con popup `硬盘数据获取失败` ("error al obtener datos del disco duro") y aborta sin escribir nada en BD.

**El servicio principal `RecordData.exe` tiene el mismo bug**: al validar consulta el serial del disco y compara con lo guardado en BD. Si lee vacío, falla.

**Fix:** El fabricante autorizó modificación. La tabla de activación es `scale_admin_tag.activation_info`:

```sql
CREATE TABLE activation_info (
  id            int       PK,
  cdcode        varchar(200) NOT NULL,
  shop_no       varchar(20),
  shop_name     varchar(100),
  tel           varchar(20),
  addr          varchar(100),
  username      varchar(20),
  cpu_id        varchar(100),
  hard_disk_sn  varchar(100),    -- ← aquí está el truco
  mac           varchar(100),
  status        int       NOT NULL
);
```

Insertamos una fila con **`hard_disk_sn=''` vacío** (mismo valor que el bug genera al leer), de modo que la validación `local_read == stored` queda satisfecha como `'' == ''`. Los otros campos (cpu_id, mac) se leen sin problema en Windows; sólo el disco fallaba.

```sql
INSERT INTO activation_info VALUES (
  1, 'MANUAL-AUTH-BLS-20260513', 'STORE-001', 'Supermercado HQ',
  '', '', 'admin',
  '<CPU-id-real>', '', '<MAC-real>',
  1   -- status=1 activo
);
```

Tras esto, log del servicio cambia a:

```
进入激活验证...
本地硬盘序列号：              ← vacío, pero también vacío en BD → MATCH
[se omite "验证失败"]
[Quartz scheduler arranca]
Now listening on http://[::]:9756
Application started.
```

> Script: `scripts/apply-post-install-fixes.ps1`

### 2.3 Control remoto VNC fallaba — `websockify` faltante

**Síntoma:** Browser console: `WebSocket connection to 'ws://localhost:9000/websockify/?token=192.168.1.172' failed: Connection closed (code: 1006)`.

**Causa:** El stack original tenía un componente **noVNC + websockify en `D:\sdm\term_admin\novpnc\noVnc-master\`** (sí, "novpnc" con typo) que **el installer no incluye**. Era un componente que el técnico de BLS instalaba a mano, fuera del MSI. Esta instalación nunca lo tuvo.

**Fix:**

1. Instalamos `websockify` (paquete Python público estándar de noVNC) a una ruta del proyecto:

   ```
   pip install --target C:\sdm\term_admin\websockify\lib websockify
   ```

2. Generamos `C:\sdm\term_admin\websockify\token.conf` con una línea por balanza:

   ```
   192.168.1.172: 192.168.1.172:5900
   ```

   (token = IP de balanza; target = IP:5900). El frontend pasa la IP como token, websockify la mapea al destino.

3. Actualizamos `sys_config.novnc_config_file` para apuntar a la nueva ruta:

   ```sql
   UPDATE sys_config SET value='C:/sdm/term_admin/websockify/token.conf' WHERE name='novnc_config_file';
   ```

4. Servicio Windows `websockify-sdm` usando el mismo wrapper **WinSW** que el resto del stack:

   - `websockify-service.exe` = copia de `RecordData-service.exe` (WinSW 3.0)
   - `websockify-service.xml`:

     ```xml
     <service>
       <id>websockify-sdm</id>
       <env name="PYTHONPATH" value="%BASE%\lib" />
       <env name="PYTHONUNBUFFERED" value="1" />
       <executable>C:\Users\Fernando\AppData\Local\Programs\Python\Python313-32\python.exe</executable>
       <arguments>-u -m websockify --token-plugin TokenFile --token-source "%BASE%\token.conf" 9000</arguments>
       <startmode>Automatic</startmode>
     </service>
     ```

   - Instalado con `websockify-service.exe install` (UAC) y `Start-Service websockify-sdm`.

**Trampa:** Inicialmente intenté un wrapper `run_websockify.py` que llamaba a `websockify_init()` desde código. Bug: el módulo `multiprocessing` re-importa el script en cada conexión y sin `if __name__ == "__main__":` cada conexión spawnea un proceso hijo zombi. Pasar a `-m websockify` (que tiene el guard correcto) lo arregló.

> Script: `scripts/setup-websockify-service.ps1`

---

## 3. Instalación limpia (procedimiento para próximas instalaciones)

### Prerrequisitos

- Windows 10/11 con permisos de administrador.
- Python 3.10+ instalado (`python --version` debe responder).
  - Si no, descargar de https://python.org. Marcar "Add to PATH" durante la instalación.
- Conexión LAN con las balanzas.

### Paso 1: Instalador del fabricante

Ejecutar `install.bat` (Botón derecho → "Ejecutar como administrador"). Esto instala:
- MySQL como `Mysql-sdm` en :3506 con root `sdm@666666`
- Crea BD `scale_admin_tag` desde `mysql\sqlfile\scale_admin_tag.sql`
- Redis como `redis-sdm` en :16380
- Nginx como `nginx-sdm` en :19697
- term-admin (Java) como `term-admin` en :8000
- RecordData (.NET) como `RecordData-sdm` (arranca pero se detiene por falta de activación)

### Paso 2: Aplicar fixes post-install

```powershell
cd C:\sdm\term_admin\scripts
.\apply-post-install-fixes.ps1
```

Este script (ver sección 4) hace todo lo de la sección 2: activa RecordData, instala websockify, configura el servicio, opcionalmente resetea password admin.

### Paso 3: Verificar

```powershell
# Todos los servicios deben estar Running
Get-Service Mysql-sdm, redis-sdm, term-admin, nginx-sdm, RecordData-sdm, websockify-sdm

# Puertos esperados escuchando
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 3506,16380,8000,9000,9756,19697 }
```

Abrir `http://localhost:19697`, login `admin` / `admin123`.

### Paso 4: Registrar balanzas

En el portal: menú balanzas → nueva. Anotar la IP de cada balanza (las balanzas deben tener un VNC server escuchando en :5900).

Tras registrar nuevas balanzas, regenerar el token file:

```powershell
.\regen-tokens.ps1
```

(Websockify lee el archivo en cada nueva conexión, no necesita restart.)

---

## 4. Operación cotidiana

### 4.1 Tareas frecuentes

| Tarea | Comando |
|---|---|
| Ver estado de todos los servicios | `Get-Service Mysql-sdm,redis-sdm,term-admin,nginx-sdm,RecordData-sdm,websockify-sdm` |
| Reiniciar backend Java tras cambio de config en BD | `Restart-Service term-admin` (UAC) |
| Reiniciar websockify (raro, sólo si cuelga) | `Restart-Service websockify-sdm` (UAC) |
| Resetear password de admin a un valor nuevo | `scripts\reset-admin-password.ps1 -NewPassword "loQueSea"` |
| Regenerar token.conf desde tabla balanzas | `scripts\regen-tokens.ps1` |
| Tail log Java | `Get-Content C:\term-log\info.log -Tail 30 -Wait` |
| Tail log RecordData | `Get-Content C:\sdm\term_admin\aiRecordData\logs\log-(Get-Date -Format 'yyyyMMdd').json -Tail 30 -Wait` |
| Tail log websockify | `Get-Content C:\sdm\term_admin\websockify\logs\websockify-service.out.log -Tail 30 -Wait` |
| Backup BD | `mysql\bin\mysqldump.exe -u root -psdm@666666 -P 3506 scale_admin_tag > backup.sql` |

### 4.2 Cuando se agregan balanzas nuevas

1. Registrar la balanza en el portal (menú balanzas → nueva con su IP).
2. `scripts\regen-tokens.ps1` para añadirla al token.conf.
3. Listo, control remoto disponible inmediatamente.

### 4.3 Fallback de control remoto (si websockify se cae)

Cualquier cliente VNC apunta directo a `<IP-balanza>:5900`. RealVNC Viewer, TightVNC, UltraVNC. No requiere portal, no requiere websockify.

---

## 5. Troubleshooting

### "Bad credentials" en el login pese a actualizar el hash BCrypt
Spring Security cachea el User en memoria. Solución: `Restart-Service term-admin` (UAC). Esperar 15-30s a que Spring Boot levante.

### El portal devuelve 502 / nada carga
Probable: `term-admin` muerto. Ver `C:\term-log\error.log`. `Restart-Service term-admin`.

### RecordData-sdm se detiene solo / log dice `验证失败`
La fila de `activation_info` perdió el `status=1` o el `hard_disk_sn` tiene un valor real (no vacío) que no coincide con lo que el binario lee. Verificar:
```sql
SELECT * FROM scale_admin_tag.activation_info;
```
Si `hard_disk_sn` tiene contenido y el bug NVMe sigue presente, vaciarlo: `UPDATE activation_info SET hard_disk_sn='' WHERE id=1;` + reiniciar el servicio.

### Control remoto VNC error 1006 / Connection closed
1. Verificar servicio: `Get-Service websockify-sdm` debe estar `Running`.
2. Verificar puerto: `Get-NetTCPConnection -State Listen | Where LocalPort -eq 9000`.
3. Verificar que la IP de la balanza está en token.conf: `Get-Content C:\sdm\term_admin\websockify\token.conf`.
4. Verificar que la balanza tiene VNC abierto: `Test-NetConnection 192.168.1.X -Port 5900`.
5. Si todos OK pero falla: log de websockify en `C:\sdm\term_admin\websockify\logs\`.

### `Verification code error!` al login
Captcha consumido (es de un solo uso). Recargar la página del login para obtener uno nuevo.

### Necesito ver qué tiene Redis
```powershell
& 'C:\sdm\term_admin\redis\redis-cli.exe' -h 127.0.0.1 -p 16380 -n 4 KEYS '*'
```
(`-p 16380`, no 6379; `-n 4`, no 0.)

---

## 6. Estado de cambios respecto a la instalación de fábrica

Para auditoría / rollback. Lista exhaustiva de qué fue tocado:

**Base de datos (`scale_admin_tag`):**
- `sys_user`: filas `admin` y `mercAdmin` → nuevo BCrypt hash de `admin123`, `update_by='manual-reset'`. Hashes originales respaldados en `C:\sdm\password-backup.txt`.
- `sys_config`: registro `novnc_config_file` → valor cambiado de `D:/sdm/term_admin/novpnc/noVnc-master/token/token.conf` a `C:/sdm/term_admin/websockify/token.conf`.
- `activation_info`: nueva fila id=1 con `cdcode='MANUAL-AUTH-BLS-20260513'`, `status=1`, `hard_disk_sn=''`.

**Sistema de archivos:**
- `C:\sdm\term_admin\websockify\` — directorio completo nuevo (lib, logs, token.conf, websockify-service.exe, websockify-service.xml).
- `C:\sdm\term_admin\scripts\` — scripts de operación.
- `C:\sdm\term_admin\OPERATIONS.md` — este documento.
- `C:\sdm\password-backup.txt` — hashes admin originales (no borrar).

**Servicios Windows:**
- Nuevo: `websockify-sdm` (Automatic, LocalSystem).

**Binarios:**
- **Cero modificaciones** a binarios entregados por el fabricante. La autorización de BLS para "modificar binarios" no fue necesaria porque encontramos un fix sin tocarlos (inyección en BD + componente faltante via paquete público estándar).
