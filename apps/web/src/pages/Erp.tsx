import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Activity,
  BookOpen,
  Check,
  Code2,
  Copy,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Server,
  Terminal,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiClient } from '@/lib/queryClient';

function statusBadge(status: string) {
  if (status === 'success') return <Badge variant="success">Éxito</Badge>;
  if (status === 'partial') return <Badge variant="secondary">Parcial</Badge>;
  if (status === 'failed') return <Badge variant="destructive">Falló</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 px-2 text-xs"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success('Copiado al portapapeles');
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copiado' : label}
    </Button>
  );
}

export function ErpPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Centro de Integración ERP & POS</h2>
        <p className="text-sm text-muted-foreground">
          Conecta cualquier sistema POS o ERP externo con SDM Portal para sincronizar productos, actualizar precios y transmitir datos en tiempo real a las balanzas electrónicas.
        </p>
      </div>

      <ErpMetricsCard />
      <ApiPlaygroundCard />
      <ConnectionGuideCard />
      <CodeGeneratorCard />
      <DeveloperResourcesCard />
      <ApiKeysCard />
      <SyncLogCard />
    </div>
  );
}

// =================== Métricas Generales ===================

function ErpMetricsCard() {
  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const r = await apiClient.health();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    refetchInterval: 15_000,
  });

  const keysQuery = useQuery({
    queryKey: ['erp-keys'],
    queryFn: async () => {
      const r = await apiClient.erpKeys();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
  });

  const syncLogQuery = useQuery({
    queryKey: ['erp-sync-log'],
    queryFn: async () => {
      const r = await apiClient.erpSyncLog(100);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    refetchInterval: 15_000,
  });

  const isUpstreamUp = healthQuery.data?.upstream?.termAdmin === 'up';
  const activeKeys = (keysQuery.data ?? []).filter((k) => k.enabled === 1).length;
  const syncs = syncLogQuery.data ?? [];
  const totalProductsSync = syncs.reduce((acc, s) => acc + (s.total || 0), 0);
  const successCount = syncs.filter((s) => s.status === 'success').length;
  const successRate = syncs.length > 0 ? Math.round((successCount / syncs.length) * 100) : 100;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Server className="h-4 w-4" /> Upstream term_admin
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Badge variant={isUpstreamUp ? 'success' : 'destructive'}>
            {isUpstreamUp ? 'Conectado' : 'Sin conexión'}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">
            {healthQuery.data?.upstream?.termAdminVersion ?? 'v1.0'}
          </span>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <KeyRound className="h-4 w-4" /> Claves API Activas
        </div>
        <div className="mt-2 text-2xl font-bold">{activeKeys}</div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Activity className="h-4 w-4" /> PLUs Procesados
        </div>
        <div className="mt-2 text-2xl font-bold">{totalProductsSync.toLocaleString('es-CL')}</div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Check className="h-4 w-4" /> Tasa de Éxito
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-2xl font-bold">{successRate}%</span>
          <span className="text-xs text-muted-foreground">({syncs.length} lotes)</span>
        </div>
      </Card>
    </div>
  );
}

// =================== API Playground (Probador en Vivo) ===================

type PlaygroundAction =
  | 'push_products'
  | 'update_price'
  | 'get_products'
  | 'distribute_scales'
  | 'list_scales'
  | 'list_shops';

function ApiPlaygroundCard() {
  const apiBaseUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname}:8788`
      : 'http://localhost:8788';

  const keysQuery = useQuery({
    queryKey: ['erp-keys'],
    queryFn: async () => {
      const r = await apiClient.erpKeys();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
  });

  const [selectedKey, setSelectedKey] = useState<string>('');
  const [action, setAction] = useState<PlaygroundAction>('update_price');
  const [shopCode, setShopCode] = useState('2026');
  const [goodsPlu, setGoodsPlu] = useState('1001');
  const [price, setPrice] = useState('1990');
  const [distribute, setDistribute] = useState(true);
  const [targetTermId, setTargetTermId] = useState('10');

  const [loading, setLoading] = useState(false);
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [responseDuration, setResponseDuration] = useState<number | null>(null);
  const [responseBody, setResponseBody] = useState<string | null>(null);

  const activeKeys = (keysQuery.data ?? []).filter((k) => k.enabled === 1);

  async function executeTest() {
    if (!selectedKey) {
      toast.error('Seleccioná o ingresá una clave API');
      return;
    }

    setLoading(true);
    setResponseStatus(null);
    setResponseBody(null);
    const start = Date.now();

    let method = 'GET';
    let url = `${apiBaseUrl}/api/erp/scales`;
    let body: string | undefined = undefined;

    if (action === 'push_products') {
      method = 'POST';
      url = `${apiBaseUrl}/api/erp/products`;
      body = JSON.stringify(
          {
            shop_code: shopCode,
            mode: 'incremental',
            items: [
              {
                plu: goodsPlu,
                name: 'Producto Prueba SDM',
                price: Number(price) || 1990,
                unit: 'KG',
              },
            ],
          },
          null,
          2,
        );
    } else if (action === 'update_price') {
      method = 'POST';
      url = `${apiBaseUrl}/api/erp/products/price`;
      body = JSON.stringify({
        shop_code: shopCode,
        goodsPlu,
        price: Number(price) || 1990,
        distribute,
      });
    } else if (action === 'get_products') {
      method = 'GET';
      url = `${apiBaseUrl}/api/erp/products?shop_code=${encodeURIComponent(shopCode)}${goodsPlu ? `&goodsPlu=${encodeURIComponent(goodsPlu)}` : ''}`;
    } else if (action === 'distribute_scales') {
      method = 'POST';
      url = `${apiBaseUrl}/api/erp/scales/distribute`;
      body = JSON.stringify({
        shopId: -1,
        targetTermIdList: [Number(targetTermId) || 10],
        typeList: [0, 1, 2],
      });
    } else if (action === 'list_scales') {
      method = 'GET';
      url = `${apiBaseUrl}/api/erp/scales`;
    } else if (action === 'list_shops') {
      method = 'GET';
      url = `${apiBaseUrl}/api/erp/shops`;
    }

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'X-Api-Key': selectedKey,
          'Content-Type': 'application/json',
        },
        body,
      });
      const duration = Date.now() - start;
      const data = await res.json().catch(() => ({ raw: 'Respuesta no es JSON' }));
      setResponseStatus(res.status);
      setResponseDuration(duration);
      setResponseBody(JSON.stringify(data, null, 2));
      if (res.ok) toast.success(`HTTP ${res.status}: Respuesta recibida en ${duration} ms`);
      else toast.error(`HTTP ${res.status}: Petición rechazada`);
    } catch (err) {
      setResponseStatus(0);
      setResponseDuration(Date.now() - start);
      setResponseBody(err instanceof Error ? err.message : String(err));
      toast.error('No se pudo conectar al API');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Play className="h-4 w-4 text-primary" /> API Playground: Probador Interactivo en Vivo
            </CardTitle>
            <CardDescription>
              Ejecuta llamadas reales a los endpoints usando tu API Key y comprueba la respuesta al instante.
            </CardDescription>
          </div>
          <Badge variant="outline" className="font-mono text-xs">
            Host: {apiBaseUrl}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Clave API (X-Api-Key)</Label>
            {activeKeys.length > 0 ? (
              <Input
                placeholder="sdm_live_... o selecciona clave"
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                className="font-mono text-xs"
              />
            ) : (
              <Input
                placeholder="Ingresa tu X-Api-Key..."
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                className="font-mono text-xs"
              />
            )}
            {activeKeys.length > 0 && (
              <div className="flex gap-1 flex-wrap pt-1">
                {activeKeys.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => setSelectedKey(k.key_prefix)}
                    className="text-[10px] text-primary underline truncate max-w-[120px]"
                    title={k.name}
                  >
                    Usar {k.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Operación a Probar</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm"
              value={action}
              onChange={(e) => setAction(e.target.value as PlaygroundAction)}
            >
              <option value="update_price">POST /products/price (Cambiar precio PLU)</option>
              <option value="get_products">GET /products (Consultar catálogo)</option>
              <option value="push_products">POST /products (Carga masiva JSON)</option>
              <option value="distribute_scales">POST /scales/distribute (Enviar a balanza)</option>
              <option value="list_scales">GET /scales (Inventario de balanzas)</option>
              <option value="list_shops">GET /shops (Sucursales activas)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Tienda (shop_code)</Label>
            <Input
              value={shopCode}
              onChange={(e) => setShopCode(e.target.value)}
              placeholder="2026"
              className="text-xs"
            />
          </div>

          {action === 'update_price' && (
            <div className="space-y-1.5">
              <Label className="text-xs">PLU y Nuevo Precio</Label>
              <div className="flex gap-1.5">
                <Input
                  value={goodsPlu}
                  onChange={(e) => setGoodsPlu(e.target.value)}
                  placeholder="PLU"
                  className="w-20 text-xs"
                />
                <Input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="Precio"
                  className="flex-1 text-xs"
                />
              </div>
              <label className="flex items-center gap-1.5 text-[11px] cursor-pointer pt-0.5 text-muted-foreground">
                <input
                  type="checkbox"
                  checked={distribute}
                  onChange={(e) => setDistribute(e.target.checked)}
                />
                Transmitir a balanza inmediatamente
              </label>
            </div>
          )}

          {action === 'distribute_scales' && (
            <div className="space-y-1.5">
              <Label className="text-xs">ID Balanza (termId)</Label>
              <Input
                value={targetTermId}
                onChange={(e) => setTargetTermId(e.target.value)}
                placeholder="10"
                className="text-xs"
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t pt-3">
          <Button
            size="sm"
            onClick={executeTest}
            disabled={loading || !selectedKey}
            className="gap-2"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {loading ? 'Ejecutando petición…' : 'Ejecutar Petición en Vivo'}
          </Button>
          {responseStatus !== null && (
            <div className="flex items-center gap-2 text-xs">
              <Badge variant={responseStatus >= 200 && responseStatus < 300 ? 'success' : 'destructive'}>
                HTTP {responseStatus}
              </Badge>
              {responseDuration !== null && (
                <span className="text-muted-foreground">{responseDuration} ms</span>
              )}
            </div>
          )}
        </div>

        {responseBody && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">Respuesta HTTP:</span>
              <CopyButton text={responseBody} label="Copiar JSON" />
            </div>
            <pre className="max-h-60 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
              <code>{responseBody}</code>
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =================== Generador de Código Multilenguaje ===================

function CodeGeneratorCard() {
  const apiBaseUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname}:8788`
      : 'http://localhost:8788';

  const [lang, setLang] = useState<'curl' | 'python' | 'csharp' | 'node' | 'php'>('csharp');

  const snippets = {
    csharp: `// Conexión POS / ERP en C# (.NET Core / Framework)
using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;

class Program {
    static async Task Main() {
        var client = new HttpClient();
        client.DefaultRequestHeaders.Add("X-Api-Key", "TU_API_KEY");

        // 1. Actualización rápida de precio con distribución automática a balanzas
        var jsonPrice = @"{
            ""shop_code"": ""2026"",
            ""goodsPlu"": ""1001"",
            ""price"": 1990,
            ""distribute"": true
        }";

        var content = new StringContent(jsonPrice, Encoding.UTF8, "application/json");
        var res = await client.PostAsync("${apiBaseUrl}/api/erp/products/price", content);
        var responseString = await res.Content.ReadAsStringAsync();
        Console.WriteLine(responseString);
    }
}`,
    python: `# Integración POS / ERP en Python
import requests

API_BASE = "${apiBaseUrl}/api/erp"
HEADERS = {
    "X-Api-Key": "TU_API_KEY",
    "Content-Type": "application/json"
}

# 1. Cargar productos masivamente
payload = {
    "shop_code": "2026",
    "mode": "incremental",
    "items": [
        {"plu": "1001", "name": "Manzana Fuji", "price": 1890, "unit": "KG"},
        {"plu": "1002", "name": "Platano Granel", "price": 1290, "unit": "KG"}
    ]
}

res = requests.post(f"{API_BASE}/products", json=payload, headers=HEADERS)
print("Respuesta:", res.status_code, res.json())

# 2. Transmitir de inmediato a las balanzas
requests.post(f"{API_BASE}/scales/distribute", json={
    "shopId": 3,
    "targetTermIdList": [10],
    "typeList": [0, 1, 2]
}, headers=HEADERS)`,
    node: `// Node.js / JavaScript (fetch)
const res = await fetch('${apiBaseUrl}/api/erp/products/price', {
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
console.log(data);`,
    php: `<?php
// PHP con cURL
$ch = curl_init('${apiBaseUrl}/api/erp/products/price');
$payload = json_encode([
    'shop_code' => '2026',
    'goodsPlu'  => '1001',
    'price'     => 1990,
    'distribute'=> true
]);

curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'X-Api-Key: TU_API_KEY',
    'Content-Type: application/json'
]);

$response = curl_exec($ch);
curl_close($ch);
echo $response;`,
    curl: `# Actualizar precio y enviar a balanza
curl -X POST "${apiBaseUrl}/api/erp/products/price" \\
  -H "X-Api-Key: TU_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"shop_code":"2026","goodsPlu":"1001","price":1990,"distribute":true}'

# Consultar catálogo actual
curl -X GET "${apiBaseUrl}/api/erp/products?shop_code=2026" \\
  -H "X-Api-Key: TU_API_KEY"`,
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Code2 className="h-4 w-4 text-primary" /> Generador de Código de Conexión
            </CardTitle>
            <CardDescription>
              Ejemplos listos para copiar e incorporar en el conector de tu ERP o POS.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant={lang === 'csharp' ? 'default' : 'outline'}
              onClick={() => setLang('csharp')}
            >
              C# (.NET)
            </Button>
            <Button
              size="sm"
              variant={lang === 'python' ? 'default' : 'outline'}
              onClick={() => setLang('python')}
            >
              Python
            </Button>
            <Button
              size="sm"
              variant={lang === 'node' ? 'default' : 'outline'}
              onClick={() => setLang('node')}
            >
              Node.js
            </Button>
            <Button
              size="sm"
              variant={lang === 'php' ? 'default' : 'outline'}
              onClick={() => setLang('php')}
            >
              PHP
            </Button>
            <Button
              size="sm"
              variant={lang === 'curl' ? 'default' : 'outline'}
              onClick={() => setLang('curl')}
            >
              cURL
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex justify-end">
          <CopyButton text={snippets[lang]} label={`Copiar ${lang.toUpperCase()}`} />
        </div>
        <pre className="max-h-72 overflow-x-auto rounded-md bg-muted p-4 font-mono text-xs">
          <code>{snippets[lang]}</code>
        </pre>
      </CardContent>
    </Card>
  );
}

// =================== Descargas y Recursos para Desarrolladores ===================

function DeveloperResourcesCard() {
  const apiBaseUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname}:8788`
      : 'http://localhost:8788';

  function downloadFile(filename: string, content: string, type = 'application/json') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Descargado: ${filename}`);
  }

  function downloadPostmanCollection() {
    const collection = {
      info: {
        name: 'SDM Portal ERP API',
        description: 'Colección oficial de peticiones para integración con balanzas inteligentes SDM.',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        {
          name: '1. Actualizar Precio Unitario (POS)',
          request: {
            method: 'POST',
            header: [
              { key: 'X-Api-Key', value: '{{SDM_API_KEY}}', type: 'text' },
              { key: 'Content-Type', value: 'application/json', type: 'text' },
            ],
            body: {
              mode: 'raw',
              raw: JSON.stringify(
                { shop_code: '2026', goodsPlu: '1001', price: 1990, distribute: true },
                null,
                2,
              ),
            },
            url: { raw: `${apiBaseUrl}/api/erp/products/price` },
          },
        },
        {
          name: '2. Consultar Productos y Precios',
          request: {
            method: 'GET',
            header: [{ key: 'X-Api-Key', value: '{{SDM_API_KEY}}', type: 'text' }],
            url: { raw: `${apiBaseUrl}/api/erp/products?shop_code=2026` },
          },
        },
        {
          name: '3. Carga Masiva de Productos (JSON)',
          request: {
            method: 'POST',
            header: [
              { key: 'X-Api-Key', value: '{{SDM_API_KEY}}', type: 'text' },
              { key: 'Content-Type', value: 'application/json', type: 'text' },
            ],
            body: {
              mode: 'raw',
              raw: JSON.stringify(
                {
                  shop_code: '2026',
                  mode: 'incremental',
                  items: [
                    { plu: '1001', name: 'Manzana Fuji', price: 1890, unit: 'KG' },
                    { plu: '1002', name: 'Plátano Granel', price: 1290, unit: 'KG' },
                  ],
                },
                null,
                2,
              ),
            },
            url: { raw: `${apiBaseUrl}/api/erp/products` },
          },
        },
        {
          name: '4. Transmitir Datos a Balanzas',
          request: {
            method: 'POST',
            header: [
              { key: 'X-Api-Key', value: '{{SDM_API_KEY}}', type: 'text' },
              { key: 'Content-Type', value: 'application/json', type: 'text' },
            ],
            body: {
              mode: 'raw',
              raw: JSON.stringify(
                { shopId: 3, targetTermIdList: [10], typeList: [0, 1, 2] },
                null,
                2,
              ),
            },
            url: { raw: `${apiBaseUrl}/api/erp/scales/distribute` },
          },
        },
        {
          name: '5. Listar Balanzas Registradas',
          request: {
            method: 'GET',
            header: [{ key: 'X-Api-Key', value: '{{SDM_API_KEY}}', type: 'text' }],
            url: { raw: `${apiBaseUrl}/api/erp/scales` },
          },
        },
        {
          name: '6. Listar Sucursales Activas',
          request: {
            method: 'GET',
            header: [{ key: 'X-Api-Key', value: '{{SDM_API_KEY}}', type: 'text' }],
            url: { raw: `${apiBaseUrl}/api/erp/shops` },
          },
        },
      ],
    };
    downloadFile('sdm-portal-erp.postman_collection.json', JSON.stringify(collection, null, 2));
  }

  function downloadSampleCsv() {
    const csv = `plu,name,price,unit,barcode,dept_code
1001,Platano Granel,1290,KG,,FRUTAS
1002,Manzana Fuji,1890,KG,,FRUTAS
1003,Pan Marraqueta,1490,KG,2001003000000,PANADERIA
1004,Queso Chanco,7990,KG,,LACTEOS`;
    downloadFile('ejemplo_productos_sdm.csv', csv, 'text/csv');
  }

  function downloadSampleJson() {
    const sample = {
      shop_code: '2026',
      mode: 'incremental',
      items: [
        { plu: '1001', name: 'Platano Granel', price: 1290, unit: 'KG', dept_code: 'FRUTAS' },
        { plu: '1002', name: 'Manzana Fuji', price: 1890, unit: 'KG', dept_code: 'FRUTAS' },
        { plu: '1003', name: 'Pan Marraqueta', price: 1490, unit: 'KG', barcode: '2001003000000' },
      ],
    };
    downloadFile('ejemplo_productos_sdm.json', JSON.stringify(sample, null, 2));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Download className="h-4 w-4 text-primary" /> Recursos y Descargas para Desarrolladores
        </CardTitle>
        <CardDescription>
          Archivos de configuración y plantillas para acelerar el desarrollo del conector POS / ERP.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
          <Button variant="outline" className="h-auto flex-col items-start gap-1 p-3 text-left" onClick={downloadPostmanCollection}>
            <div className="font-semibold text-xs flex items-center gap-1.5">
              <Download className="h-3.5 w-3.5 text-primary" /> Postman Collection
            </div>
            <p className="text-[11px] text-muted-foreground">Importar colección completa en Postman o Insomnia</p>
          </Button>

          <Button
            variant="outline"
            className="h-auto flex-col items-start gap-1 p-3 text-left"
            onClick={async () => {
              const res = await fetch(`${apiBaseUrl}/api/erp/openapi.json`);
              const data = await res.json();
              downloadFile('sdm_openapi_spec.json', JSON.stringify(data, null, 2));
            }}
          >
            <div className="font-semibold text-xs flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5 text-primary" /> OpenAPI 3.0 Spec
            </div>
            <p className="text-[11px] text-muted-foreground">Swagger / OpenAPI en formato JSON</p>
          </Button>

          <Button variant="outline" className="h-auto flex-col items-start gap-1 p-3 text-left" onClick={downloadSampleJson}>
            <div className="font-semibold text-xs flex items-center gap-1.5">
              <Terminal className="h-3.5 w-3.5 text-primary" /> Plantilla JSON
            </div>
            <p className="text-[11px] text-muted-foreground">Ejemplo de lote de productos en JSON</p>
          </Button>

          <Button variant="outline" className="h-auto flex-col items-start gap-1 p-3 text-left" onClick={downloadSampleCsv}>
            <div className="font-semibold text-xs flex items-center gap-1.5">
              <Terminal className="h-3.5 w-3.5 text-primary" /> Plantilla CSV
            </div>
            <p className="text-[11px] text-muted-foreground">Ejemplo de carga masiva en CSV</p>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// =================== Guía Resumida de Conexión ===================

function ConnectionGuideCard() {
  const apiBaseUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname}:8788`
      : 'http://localhost:8788';

  const endpoints = [
    {
      method: 'POST',
      path: '/api/erp/products/price',
      auth: 'X-Api-Key',
      purpose: 'Cambio rápido de precio de un solo PLU (POS) con distribución opcional a balanzas.',
    },
    {
      method: 'POST',
      path: '/api/erp/products',
      auth: 'X-Api-Key',
      purpose: 'Carga masiva de productos (JSON o CSV) por shop_code. Crea y actualiza catálogo.',
    },
    {
      method: 'GET',
      path: '/api/erp/products',
      auth: 'X-Api-Key',
      purpose: 'Consulta productos y precios actuales registrados para una tienda (?shop_code=2026).',
    },
    {
      method: 'POST',
      path: '/api/erp/scales/distribute',
      auth: 'X-Api-Key',
      purpose: 'Transmite catálogo, etiquetas o configuración directamente a las balanzas en red.',
    },
    {
      method: 'GET',
      path: '/api/erp/scales',
      auth: 'X-Api-Key',
      purpose: 'Lista las balanzas registradas con su termId, IP y estado de conexión.',
    },
    {
      method: 'GET',
      path: '/api/erp/shops',
      auth: 'X-Api-Key',
      purpose: 'Lista sucursales activas y sus códigos shopCode para mapeo automático.',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-4 w-4 text-primary" /> Tabla de Endpoints para ERP y POS
            </CardTitle>
            <CardDescription>
              Todos los endpoints admiten autenticación mediante la cabecera <code>X-Api-Key</code>.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-1.5">
            <span className="text-xs text-muted-foreground">URL Base:</span>
            <code className="font-mono text-xs font-semibold">{apiBaseUrl}</code>
            <CopyButton text={apiBaseUrl} label="Copiar URL" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Método</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead className="w-28">Auth</TableHead>
                <TableHead>Función</TableHead>
                <TableHead className="w-24 text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {endpoints.map((ep) => (
                <TableRow key={ep.method + ep.path}>
                  <TableCell>
                    <Badge variant={ep.method === 'POST' ? 'default' : 'secondary'} className="font-mono text-[11px]">
                      {ep.method}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs font-medium">{ep.path}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{ep.auth}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{ep.purpose}</TableCell>
                  <TableCell className="text-right">
                    <CopyButton text={`${apiBaseUrl}${ep.path}`} label="Copiar URL" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// =================== API Keys ===================

function ApiKeysCard() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [revealKey, setRevealKey] = useState<string | null>(null);

  const keysQuery = useQuery({
    queryKey: ['erp-keys'],
    queryFn: async () => {
      const r = await apiClient.erpKeys();
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
  });

  const createKey = useMutation({
    mutationFn: async (name: string) => {
      const r = await apiClient.createErpKey(name);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    onSuccess: (data) => {
      setRevealKey(data.key);
      setNewName('');
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ['erp-keys'] });
      toast.success('API key creada');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleKey = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      const r = await apiClient.toggleErpKey(id, enabled);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['erp-keys'] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const removeKey = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiClient.deleteErpKey(id);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['erp-keys'] });
      toast.success('API key eliminada');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const keys = keysQuery.data ?? [];

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4" /> Gestión de Claves de Acceso (API Keys)
            </CardTitle>
            <CardDescription>
              Crea una clave por cada sistema cliente (ej. POS-Local, ERP-SAP, Script-Precios).
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Nueva API key
          </Button>
        </CardHeader>
        <CardContent>
          {keysQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Cargando...</div>
          ) : keys.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Todavía no hay API keys generadas. Crea una para habilitar conexiones externas.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Prefijo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Creada</TableHead>
                  <TableHead>Último uso</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell className="font-mono text-xs">{k.key_prefix}...</TableCell>
                    <TableCell>
                      <Badge variant={k.enabled ? 'success' : 'secondary'}>
                        {k.enabled ? 'Activa' : 'Inactiva'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {k.created_at}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {k.last_used_at ?? '—'}
                    </TableCell>
                    <TableCell className="space-x-1 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          toggleKey.mutate({ id: k.id, enabled: !k.enabled })
                        }
                        title={k.enabled ? 'Deshabilitar' : 'Habilitar'}
                      >
                        {k.enabled ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (window.confirm(`¿Eliminar API key "${k.name}"?`)) {
                            removeKey.mutate(k.id);
                          }
                        }}
                        title="Eliminar"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva API key</DialogTitle>
            <DialogDescription>
              Asigna un nombre que identifique al sistema cliente (ej. "POS-Caja-1", "ERP-SAP", "Conector-Precios").
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="erp-key-name">Nombre Identificador</Label>
            <Input
              id="erp-key-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="POS-Caja-1"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => createKey.mutate(newName.trim())}
              disabled={newName.trim().length < 2 || createKey.isPending}
            >
              {createKey.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Crear Clave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revealKey !== null} onOpenChange={(o) => !o && setRevealKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copia la API key ahora</DialogTitle>
            <DialogDescription>
              Esta es la única vez que se muestra la clave completa. Guárdala en las variables de entorno de tu sistema.
            </DialogDescription>
          </DialogHeader>
          {revealKey && (
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded-md border bg-muted px-3 py-2 font-mono text-xs">
                {revealKey}
              </code>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await navigator.clipboard.writeText(revealKey);
                  toast.success('Copiada al portapapeles');
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setRevealKey(null)}>
              <Check className="mr-1 h-4 w-4" /> Ya la guardé
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// =================== Historial de Sincronizaciones ===================

function SyncLogCard() {
  const [detailId, setDetailId] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ['erp-sync-log'],
    queryFn: async () => {
      const r = await apiClient.erpSyncLog(100);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    refetchInterval: 15_000,
  });

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Historial de Sincronizaciones ERP</CardTitle>
            <CardDescription>
              Registro detallado de lotes y peticiones recibidas con sus tiempos de respuesta y resultados.
            </CardDescription>
          </div>
          <Button size="sm" variant="ghost" onClick={() => q.refetch()}>
            <RefreshCw className="mr-1 h-4 w-4" /> Refrescar
          </Button>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <div className="text-sm text-muted-foreground">Cargando...</div>
          ) : (q.data ?? []).length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Sin sincronizaciones aún. Realiza un envío de prueba desde el probador interactivo superior.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha / Hora</TableHead>
                  <TableHead>Origen</TableHead>
                  <TableHead>API key</TableHead>
                  <TableHead>Tienda</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Creados</TableHead>
                  <TableHead className="text-right">Actualizados</TableHead>
                  <TableHead className="text-right">Fallaron</TableHead>
                  <TableHead className="text-right">Duración</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(q.data ?? []).map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setDetailId(row.id)}
                  >
                    <TableCell className="text-xs text-muted-foreground">
                      {row.started_at}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{row.source}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{row.api_key_name ?? '—'}</TableCell>
                    <TableCell className="text-sm">{row.shop_code ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.total}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.created}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.updated}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.failed}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                      {row.duration_ms != null ? `${row.duration_ms} ms` : '—'}
                    </TableCell>
                    <TableCell>{statusBadge(row.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <SyncDetailDialog id={detailId} onClose={() => setDetailId(null)} />
    </>
  );
}

function SyncDetailDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['erp-sync-log-detail', id],
    queryFn: async () => {
      const r = await apiClient.erpSyncLogDetail(id!);
      if (!r.ok) throw new Error(r.error.message);
      return r.data;
    },
    enabled: id !== null,
  });

  let errors: { row: number; plu: string; error: string }[] | { message: string } | null = null;
  if (q.data?.errors_json) {
    try {
      errors = JSON.parse(q.data.errors_json);
    } catch {
      errors = null;
    }
  }

  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Detalle de Sincronización #{id}</DialogTitle>
          <DialogDescription>
            {q.data?.started_at} · {q.data?.api_key_name ?? '—'} · {q.data?.shop_code ?? '—'}
          </DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <div className="text-sm text-muted-foreground">Cargando...</div>
        ) : q.data ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Origen" value={q.data.source} />
              <Stat label="Modo" value={q.data.mode} />
              <Stat label="Estado" value={q.data.status} />
              <Stat
                label="Duración"
                value={q.data.duration_ms != null ? `${q.data.duration_ms} ms` : '—'}
              />
              <Stat label="Total" value={String(q.data.total)} />
              <Stat label="Creados" value={String(q.data.created)} />
              <Stat label="Actualizados" value={String(q.data.updated)} />
              <Stat label="Fallaron" value={String(q.data.failed)} />
            </div>
            {Array.isArray(errors) && errors.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Errores reportados ({errors.length})
                </div>
                <div className="max-h-72 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Fila</TableHead>
                        <TableHead>PLU</TableHead>
                        <TableHead>Detalle Error</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {errors.map((e, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs">{e.row}</TableCell>
                          <TableCell className="font-mono text-xs">{e.plu}</TableCell>
                          <TableCell className="text-xs text-destructive">{e.error}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
            {errors && !Array.isArray(errors) && 'message' in errors && (
              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-xs text-destructive">
                {errors.message}
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}
