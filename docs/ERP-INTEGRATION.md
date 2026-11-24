# Guía de Integración ERP y POS — SDM Portal

Esta guía describe cómo conectar cualquier sistema de punto de venta (POS) o ERP (SAP, Totvs, Defontana, Softland, desarrollos propios en .NET, Python, etc.) con **SDM Portal** y las balanzas electrónicas en red.

---

## 1. Conceptos Clave

1. **Autenticación con `X-Api-Key`:**
   - Todas las llamadas del ERP usan la cabecera HTTP:
     ```http
     X-Api-Key: sdm_live_xxxxxxxxxxxxxxxxxxxxxxxx
     ```
   - Las claves se crean en la sección **Integración ERP** del portal.
2. **Flujo de dos pasos (o paso único):**
   - **Paso 1:** Actualizar catálogo de productos mediante `POST /api/erp/products` o actualización rápida de precio con `POST /api/erp/products/price`.
   - **Paso 2:** Transmitir a las balanzas mediante `POST /api/erp/scales/distribute` (o activando `distribute: true` en la llamada de precio).
3. **Tipos de datos (`typeList`):**
   - `0`: Catálogo de productos y PLUs.
   - `1`: Grupos/departamentos y asociaciones de PLUs.
   - `2`: Imágenes.
   - Al incluir `0`, el backend agrega automáticamente `1` para transmitir también la agrupación de los productos.

---

## 2. Endpoints Disponibles

| Método | Endpoint | Descripción |
| :--- | :--- | :--- |
| `POST` | `/api/erp/products` | Carga masiva de productos (JSON hasta 20.000 items o CSV). |
| `GET` | `/api/erp/products` | Consulta productos y precios actuales por `shop_code`. |
| `POST` | `/api/erp/products/price` | Actualización rápida de precio unitario por PLU (con opción `distribute: true`). |
| `GET` | `/api/erp/scales` | Lista balanzas registradas y sus `termId`. |
| `GET` | `/api/erp/scales/status` | Estado en línea y telemetría de balanzas en tiempo real. |
| `POST` | `/api/erp/scales/distribute` | Transmite datos a balanzas de una sucursal o lista de `termId`. |
| `GET` | `/api/erp/shops` | Lista sucursales activas y sus códigos `shopCode`. |
| `GET` | `/api/erp/openapi.json` | Especificación OpenAPI 3.0 descargable. |

---

## 3. Ejemplos de Integración por Lenguaje

### C# / .NET (Puntos de Venta Windows)
```csharp
using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;

class Program {
    static async Task Main() {
        var client = new HttpClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", "TU_API_KEY");

        // Actualizar precio de un PLU y enviarlo a la balanza
        var json = "{\"shop_code\":\"2026\",\"goodsPlu\":\"1001\",\"price\":2190,\"distribute\":true}";
        var content = new StringContent(json, Encoding.UTF8, "application/json");

        var response = await client.PostAsync("http://localhost:8788/api/erp/products/price", content);
        var result = await response.Content.ReadAsStringAsync();
        Console.WriteLine(result);
    }
}
```

### Python
```python
import requests

API_URL = "http://localhost:8788/api/erp"
HEADERS = {"X-Api-Key": "TU_API_KEY", "Content-Type": "application/json"}

# 1. Cargar lote de productos
payload = {
    "shop_code": "2026",
    "mode": "incremental",
    "items": [
        {"plu": "1001", "name": "Plátano Granel", "price": 1290, "unit": "KG"},
        {"plu": "1002", "name": "Manzana Fuji", "price": 1890, "unit": "KG"}
    ]
}

res = requests.post(f"{API_URL}/products", json=payload, headers=HEADERS)
print("Carga:", res.json())

# 2. Distribuir a todas las balanzas de la sucursal 2026
dist = requests.post(f"{API_URL}/scales/distribute", json={
    "shopId": 3,
    "targetTermIdList": [10],
    "typeList": [0, 1, 2]
}, headers=HEADERS)
print("Distribución:", dist.json())
```

### JavaScript / Node.js
```javascript
const res = await fetch('http://localhost:8788/api/erp/products/price', {
  method: 'POST',
  headers: {
    'X-Api-Key': 'TU_API_KEY',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    shop_code: '2026',
    goodsPlu: '1001',
    price: 1990,
    distribute: true,
  }),
});
const data = await res.json();
console.log(data);
```

### cURL
```bash
curl -X POST http://localhost:8788/api/erp/products/price \
  -H "X-Api-Key: TU_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"shop_code":"2026","goodsPlu":"1001","price":1990,"distribute":true}'
```

---

## 4. Códigos de Respuesta HTTP

- `200 OK`: Operación exitosa.
- `400 Bad Request`: Parámetros inválidos o formato no soportado (ver `error.details`).
- `401 Unauthorized`: API key faltante o deshabilitada.
- `404 Not Found`: Tienda o PLU no encontrado.
- `503 Service Unavailable`: Servicio `term_admin` inaccesible.
