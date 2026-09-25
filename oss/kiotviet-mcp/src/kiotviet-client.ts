// Minimal KiotViet Public API client (https://public.kiotapi.com).
// Auth: OAuth2 client_credentials at https://id.kiotviet.vn/connect/token
// with scope PublicApi.Access; every call sends `Authorization: Bearer` and
// the `Retailer` header. Response shapes follow the public API manual and
// are read defensively (missing fields fall back to safe defaults).

export interface KiotVietConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly retailer: string;
  readonly baseUrl?: string;
  readonly tokenUrl?: string;
  readonly branchId?: number;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
}

export interface KvInventory {
  readonly branchId?: number;
  readonly onHand?: number;
  readonly reserved?: number;
  readonly cost?: number;
  readonly minQuantity?: number;
  readonly maxQuantity?: number;
}

export interface KvProduct {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly fullName?: string;
  readonly barCode?: string;
  readonly unit?: string;
  readonly basePrice?: number;
  readonly isActive?: boolean;
  readonly minQuantity?: number;
  readonly inventories?: readonly KvInventory[];
}

export interface KvInvoiceDetail {
  readonly productCode: string;
  readonly productName?: string;
  readonly quantity: number;
  readonly price?: number;
  readonly subTotal?: number;
}

export interface KvInvoice {
  readonly id: number;
  readonly code: string;
  readonly purchaseDate: string;
  readonly total?: number;
  readonly status?: number;
  readonly invoiceDetails?: readonly KvInvoiceDetail[];
}

export interface KvPurchaseOrderLine {
  readonly productCode: string;
  readonly quantity: number;
  readonly price: number;
}

export class KiotVietError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

interface Paged<T> {
  total?: number;
  data?: T[];
}

export class KiotVietClient {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly baseUrl: string;
  private readonly tokenUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: KiotVietConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://public.kiotapi.com').replace(/\/$/, '');
    this.tokenUrl = config.tokenUrl ?? 'https://id.kiotviet.vn/connect/token';
    this.fetchImpl = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const res = await this.fetchImpl(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        scopes: 'PublicApi.Access',
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret
      }).toString(),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!res.ok) throw new KiotVietError(res.status, `kiotviet_token_failed:${res.status}`);
    const body = await res.json() as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new KiotVietError(502, 'kiotviet_token_missing');
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        retailer: this.config.retailer,
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (res.status === 401) this.token = null;
    if (!res.ok) throw new KiotVietError(res.status, `kiotviet_http_${res.status}`);
    return await res.json() as T;
  }

  private async paginate<T>(path: string, params: Record<string, string>, maxItems: number): Promise<T[]> {
    const out: T[] = [];
    const pageSize = 100;
    for (let currentItem = 0; currentItem < maxItems; currentItem += pageSize) {
      const qs = new URLSearchParams({ ...params, pageSize: String(pageSize), currentItem: String(currentItem) });
      const page = await this.request<Paged<T>>('GET', `${path}?${qs.toString()}`);
      const data = Array.isArray(page.data) ? page.data : [];
      out.push(...data);
      if (data.length < pageSize || out.length >= (page.total ?? Number.POSITIVE_INFINITY)) break;
    }
    return out;
  }

  /** GET /products?includeInventory=true (paged). */
  listProducts(maxItems = 2000): Promise<KvProduct[]> {
    return this.paginate<KvProduct>('/products', { includeInventory: 'true', orderBy: 'name', orderDirection: 'Asc' }, maxItems);
  }

  /** GET /invoices between two dates (ISO yyyy-mm-dd), with line details. */
  listInvoices(fromDate: string, toDate: string, maxItems = 5000): Promise<KvInvoice[]> {
    return this.paginate<KvInvoice>('/invoices', {
      fromPurchaseDate: fromDate,
      toPurchaseDate: toDate,
      includePayment: 'false',
      includeInvoiceDelivery: 'false'
    }, maxItems);
  }

  /** POST /purchaseorders. Only called after an explicit two-step confirmation. */
  async createPurchaseOrder(lines: readonly KvPurchaseOrderLine[], description: string): Promise<{ id: string; code: string }> {
    const body = {
      purchaseDate: new Date().toISOString(),
      branchId: this.config.branchId ?? 1,
      description,
      paidAmount: 0,
      isApplyPurchaseTax: false,
      purchaseOrderDetails: lines.map((l) => ({ productCode: l.productCode, quantity: l.quantity, price: l.price }))
    };
    const res = await this.request<{ id?: number; code?: string }>('POST', '/purchaseorders', body);
    return { id: String(res.id ?? ''), code: res.code ?? String(res.id ?? '') };
  }
}
