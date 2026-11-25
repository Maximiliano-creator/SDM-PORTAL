import type {
  ApiFailure,
  AuthSession,
  BulkPriceUpdate,
  LoginRequest,
  Order,
  OrderFilters,
  PagedResponse,
  PanStatDay,
  PriceUpdate,
  Product,
  ProductFilters,
  Scale,
  Shop,
  User,
} from '@sdm/shared';

export interface Brand {
  id: number;
  name: string;
  areaDetail?: string;
  phone?: string;
  status: boolean;
  deleteFlag?: number;
  createTime?: string;
  updateTime?: string;
}

export interface StoreMeta {
  depts: { id: number; name: string }[];
  users: { id: number; name: string; phone: string }[];
}

export interface OrdersSummary {
  totalSales: number;
  itemsCount: number;
  ticketsCount: number;
  avgTicket: number;
  byDay: { date: string; sales: number; items: number }[];
  topProducts: {
    goodsPlu: string;
    goodsName: string;
    sales: number;
    quantity: number;
  }[];
  truncated: boolean;
  sampled: number;
  totalAvailable: number;
}

export interface AuditEntry {
  id: number;
  username: string | null;
  action: string;
  target: string | null;
  ip: string | null;
  request_id: string | null;
  created_at: string;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface HealthInfo {
  status: 'up' | 'degraded' | 'down';
  version: string;
  uptime: number;
  upstream: {
    termAdmin: 'up' | 'down' | 'unknown';
    termAdminVersion: string | null;
    termAdminError: string | null;
  };
  mirror?: {
    stale: boolean;
    staleAfterMs: number;
    datasets: {
      dataset: string;
      lastSyncAt: string | null;
      lastSuccessAt: string | null;
      lastStatus: 'ok' | 'error' | null;
      lastError: string | null;
      ageSeconds: number | null;
      stale: boolean;
      rows: number | null;
    }[];
  };
}

export interface SettingsMap {
  [key: string]: string;
}

export interface UpstreamTest {
  reachable: boolean;
  version: string | null;
  error: string | null;
}

export interface ProductGroup {
  id: number;
  shopId: number;
  pid: number;
  groupNum: number;
  groupName: string;
  sortNo?: number;
  enabled?: boolean;
}

export interface ProductGroupSyncResult {
  group?: ProductGroup;
  updatedProducts?: number;
  failedProducts: number;
  errors: { goodsPlu: string; error: string }[];
}

export interface BulkDepartmentResult {
  requested: number;
  found: number;
  updated: number;
  failed: number;
  errors: { shopGoodId: number; goodsPlu: string; error: string }[];
}

type UnauthorizedHandler = () => void;

let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  onUnauthorized = handler;
}

function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const cookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('sdm_csrf='));
  return cookie?.slice('sdm_csrf='.length) ?? null;
}

export class ApiClient {
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
      const csrfToken = getCsrfToken();
      if (csrfToken) headers['x-csrf-token'] = csrfToken;
    }

    const res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json: ApiResponse<T>;
    try {
      json = (await res.json()) as ApiResponse<T>;
    } catch {
      return {
        ok: false,
        error: { code: 'BAD_JSON', message: `Respuesta no JSON (HTTP ${res.status})` },
      };
    }
    // Auto-handle SOLO 401 de NUESTRO auth (token vencido/invÃƒÂ¡lido).
    // 401/502 de upstream BLS no deben kickear al usuario.
    if (
      res.status === 401 &&
      path !== '/api/auth/login' &&
      !json.ok &&
      (json.error.code === 'NO_TOKEN' || json.error.code === 'INVALID_TOKEN') &&
      onUnauthorized
    ) {
      onUnauthorized();
    }
    return json;
  }

  login(body: LoginRequest) {
    return this.request<AuthSession>('POST', '/api/auth/login', body);
  }

  branding() {
    return this.request<{ appName: string }>('GET', '/api/auth/branding');
  }

  me() {
    return this.request<User>('GET', '/api/auth/me');
  }

  logout() {
    return this.request<{ loggedOut: true }>('POST', '/api/auth/logout');
  }

  health() {
    return this.request<HealthInfo>('GET', '/api/health');
  }

  mirrorSync() {
    return this.request<{ datasets: unknown[] }>('POST', '/api/mirror/sync');
  }

  scales() {
    return this.request<Scale[]>('GET', '/api/scales');
  }

  scale(id: number) {
    return this.request<Scale>('GET', `/api/scales/${id}`);
  }

  shops() {
    return this.request<Shop[]>('GET', `/api/shops?fresh=1&_t=${Date.now()}`);
  }

  storeMeta() {
    return this.request<StoreMeta>('GET', `/api/stores/meta?_t=${Date.now()}`);
  }

  createShop(body: Record<string, unknown>) {
    return this.request<unknown>('POST', '/api/shops', body);
  }

  updateShop(id: number, body: Record<string, unknown>) {
    return this.request<unknown>('PUT', `/api/shops/${id}`, body);
  }

  deleteShops(shopIds: number[]) {
    return this.request<unknown>('DELETE', '/api/shops', { shopIds });
  }

  brands(name?: string) {
    const q = name ? `?name=${encodeURIComponent(name)}` : '';
    return this.request<Brand[]>('GET', `/api/brands${q}`);
  }

  createBrand(body: { name: string; areaDetail?: string; phone?: string; status: boolean }) {
    return this.request<unknown>('POST', '/api/brands', body);
  }

  updateBrand(id: number, body: { name?: string; areaDetail?: string; phone?: string; status?: boolean }) {
    return this.request<unknown>('PUT', `/api/brands/${id}`, body);
  }

  deleteBrands(ids: number[]) {
    return this.request<unknown>('DELETE', '/api/brands', { ids });
  }

  settings() {
    return this.request<SettingsMap>('GET', '/api/settings');
  }

  saveSettings(values: Partial<SettingsMap>) {
    return this.request<{ changed: string[] }>('PUT', '/api/settings', values);
  }

  testUpstream() {
    return this.request<UpstreamTest>('POST', '/api/settings/test-upstream');
  }

  products(filters: Partial<ProductFilters>) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
    }
    return this.request<PagedResponse<Product>>('GET', `/api/products?${sp.toString()}`);
  }

  product(id: number) {
    return this.request<Product>('GET', `/api/products/${id}`);
  }

  updatePrice(body: PriceUpdate) {
    return this.request<{ shopGoodId: number }>('POST', '/api/products/price', body);
  }

  updateProduct(
    id: number,
    body: {
      goodsPlu?: string;
      goodsName?: string;
      itemCode?: string | null;
      priceModel?: number;
      unitName?: string | null;
      deptCode?: string | null;
      groupId?: number | null;
      price?: number;
      memberPrice?: number | null;
      promotionPrice?: number | null;
    },
  ) {
    return this.request<{ shopGoodId: number }>('PUT', `/api/products/${id}`, body);
  }

  productGroups(shopId: number) {
    return this.request<ProductGroup[]>('GET', `/api/product-groups?shopId=${shopId}`);
  }

  createProductGroup(body: { shopId: number; groupName: string }) {
    return this.request<ProductGroup>('POST', '/api/product-groups', body);
  }

  updateProductGroup(id: number, body: { shopId: number; groupName: string }) {
    return this.request<ProductGroupSyncResult>('PUT', `/api/product-groups/${id}`, body);
  }

  deleteProductGroup(id: number, shopId: number) {
    return this.request<{
      deleted: boolean;
      unassignedProducts: number;
      failedProducts: number;
      errors: { goodsPlu: string; error: string }[];
    }>('DELETE', `/api/product-groups/${id}`, { shopId });
  }

  bulkUpdateDepartment(body: {
    shopGoodIds: number[];
    groupId: number | null;
    shopId?: number;
  }) {
    return this.request<BulkDepartmentResult>('POST', '/api/products/bulk-department', body);
  }

  deleteProducts(shopGoodIds: number[]) {
    return this.request<{ deleted: number }>('DELETE', '/api/products', { shopGoodIds });
  }

  bulkUpdatePrice(body: BulkPriceUpdate) {
    return this.request<{
      requested: number;
      found: number;
      success: number;
      failed: number;
      errors: { shopGoodId: number; error: string }[];
    }>('POST', '/api/products/bulk-price', body);
  }

  orders(filters: Partial<OrderFilters>) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
    }
    return this.request<PagedResponse<Order>>('GET', `/api/orders?${sp.toString()}`);
  }

  ordersSummary(filters: Partial<OrderFilters>) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
    }
    return this.request<OrdersSummary>('GET', `/api/orders/summary?${sp.toString()}`);
  }

  statsDaily(filters: Partial<OrderFilters>) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
    }
    return this.request<PagedResponse<PanStatDay>>('GET', `/api/stats/daily?${sp.toString()}`);
  }

  audit(limit = 100) {
    return this.request<AuditEntry[]>('GET', `/api/audit?limit=${limit}`);
  }

  erpKeys() {
    return this.request<
      {
        id: number;
        name: string;
        key_prefix: string;
        can_distribute: number;
        enabled: number;
        created_at: string;
        created_by: number | null;
        last_used_at: string | null;
      }[]
    >('GET', '/api/erp/keys');
  }

  createErpKey(name: string, canDistribute = false) {
    return this.request<{
      id: number;
      name: string;
      key: string;
      prefix: string;
      createdAt: string;
    }>('POST', '/api/erp/keys', { name, canDistribute });
  }

  toggleErpKey(id: number, changes: { enabled?: boolean; canDistribute?: boolean }) {
    return this.request<{ id: number; enabled?: boolean; canDistribute?: boolean }>(
      'PATCH',
      `/api/erp/keys/${id}`,
      changes,
    );
  }

  deleteErpKey(id: number) {
    return this.request<{ id: number; deleted: true }>('DELETE', `/api/erp/keys/${id}`);
  }

  erpSyncLog(limit = 50) {
    return this.request<
      {
        id: number;
        api_key_id: number | null;
        api_key_name: string | null;
        source: string;
        shop_code: string | null;
        mode: string;
        status: string;
        total: number;
        created: number;
        updated: number;
        deleted: number;
        failed: number;
        duration_ms: number | null;
        client_ip: string | null;
        request_id: string | null;
        started_at: string;
        ended_at: string | null;
      }[]
    >('GET', `/api/erp/sync-log?limit=${limit}`);
  }

  erpSyncLogDetail(id: number) {
    return this.request<{
      id: number;
      api_key_id: number | null;
      api_key_name: string | null;
      source: string;
      shop_code: string | null;
      mode: string;
      status: string;
      total: number;
      created: number;
      updated: number;
      deleted: number;
      failed: number;
      duration_ms: number | null;
      errors_json: string | null;
      client_ip: string | null;
      request_id: string | null;
      started_at: string;
      ended_at: string | null;
    }>('GET', `/api/erp/sync-log/${id}`);
  }

  vncTicket(termId: number) {
    return this.request<{
      ticket: string;
      termId: number;
      termName: string;
      ip: string;
      port: number;
      expiresInMs: number;
      wsPath: string;
      tokenRegistered?: boolean;
      upstreamStatus?: number | null;
    }>('POST', `/api/vnc/${termId}/ticket`);
  }

  vncSessions(limit = 50) {
    return this.request<
      {
        id: number;
        user_id: number | null;
        username: string | null;
        term_id: number;
        ip: string;
        started_at: string;
        ended_at: string | null;
        ended_reason: string | null;
        bytes_up: number;
        bytes_down: number;
      }[]
    >('GET', `/api/vnc/sessions?limit=${limit}`);
  }

  distributeScaleData(body: {
    shopId?: number;
    targetTermIdList: number[];
    typeList: (0 | 1 | 2)[];
  }) {
    return this.request<{
      sent: boolean;
      targetTermIdList: number[];
      typeList: number[];
      upstreamResult: unknown;
    }>('POST', '/api/scales/distribute', body);
  }

  createScale(body: Partial<Scale> & Record<string, unknown>) {
    return this.request<unknown>('POST', '/api/scales', body);
  }

  updateScale(
    id: number,
    body: Partial<Scale> & Record<string, unknown> & {
      distributeImmediately?: boolean;
      typeList?: (0 | 1 | 2)[];
    },
  ) {
    return this.request<{
      scale: Scale;
      upstreamResult: unknown;
      distributed: boolean;
      distributeResult: unknown;
      /** El upstream aceptó la operación y la IP quedó aplicada. */
      verified?: boolean;
      previousIp?: string | null;
      appliedIp?: string | null;
    }>('PUT', `/api/scales/${id}`, body);
  }

  deleteScale(id: number) {
    return this.request<unknown>('DELETE', `/api/scales/${id}`);
  }

  checkScaleStatus(id: number) {
    return this.request<{ statusRes: unknown; scale: Scale | null }>('POST', `/api/scales/${id}/check-status`);
  }

  discoverScales(body?: Record<string, unknown>) {
    return this.request<unknown>('POST', '/api/scales/discover', body ?? {});
  }

  uploadImages(items: { name: string; data: string; size?: number }[]) {
    return this.request<{
      total: number;
      items: { originalName: string; filename: string; path: string; url: string; size: number }[];
    }>('POST', '/api/products/images/upload', { items });
  }

  importProducts(body: {
    shopCode: string;
    mode: 'full' | 'incremental';
    items: Record<string, unknown>[];
  }) {
    return this.request<{
      mode: string;
      total: number;
      created: number;
      updated: number;
      deleted: number;
      failed: number;
      success: number;
      skippedExisting: number;
      skippedDuplicate: number;
      grouping: {
        groupsCreated: number;
        associated: number;
        failed: number;
        errors: {
          department: string;
          plu?: string;
          pluCount?: number;
          error: string;
        }[];
      };
      errors: { row: number; plu: string; error: string }[];
    }>('POST', '/api/import/products', body);
  }
}

