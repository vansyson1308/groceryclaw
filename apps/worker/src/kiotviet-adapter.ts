export interface KiotvietSyncPayload {
  readonly tenant_id: string;
  readonly canonical_invoice_id: string;
  readonly correlation_id: string;
  readonly items: readonly {
    readonly sku: string;
    readonly quantity: number;
    readonly price: number;
  }[];
}

export interface KiotvietSyncOpts {
  readonly authToken: string;
  readonly retailer: string;
  readonly branchId?: number;
  readonly description?: string;
}

export interface KiotvietProduct {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly barCode?: string;
  readonly categoryName?: string;
  readonly basePrice?: number;
  readonly unit?: string;
  readonly isActive?: boolean;
}

export interface KiotvietAdapter {
  createPurchaseOrder: (
    payload: KiotvietSyncPayload,
    opts: KiotvietSyncOpts
  ) => Promise<{ externalReferenceId: string; raw: Record<string, unknown> }>;
  listProducts: (
    opts: { authToken: string; retailer: string },
    page?: { pageSize?: number; currentItem?: number }
  ) => Promise<{ total: number; data: KiotvietProduct[] }>;
}

export class HttpKiotvietAdapter implements KiotvietAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number
  ) {}

  async createPurchaseOrder(payload: KiotvietSyncPayload, opts: KiotvietSyncOpts): Promise<{ externalReferenceId: string; raw: Record<string, unknown> }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const body = {
        purchaseDate: new Date().toISOString(),
        branchId: opts.branchId ?? 1,
        description: opts.description ?? `GroceryClaw sync: ${payload.canonical_invoice_id}`,
        paidAmount: 0,
        isApplyPurchaseTax: false,
        purchaseOrderDetails: payload.items.map((item) => ({
          productCode: item.sku,
          quantity: item.quantity,
          price: item.price
        }))
      };

      const res = await fetch(`${this.baseUrl}/purchaseorders`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${opts.authToken}`,
          retailer: opts.retailer
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (res.status === 429) throw new Error('kv_rate_limited');
      if (res.status >= 500) throw new Error('kv_server_error');
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`kv_non_retriable:${res.status}:${errBody.slice(0, 200)}`);
      }

      const parsed = await res.json() as { id?: number; code?: string };
      const externalReferenceId = parsed.code ?? String(parsed.id ?? '');
      if (!externalReferenceId) throw new Error('kv_invalid_response');
      return { externalReferenceId, raw: parsed as Record<string, unknown> };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('kv_timeout');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async listProducts(
    opts: { authToken: string; retailer: string },
    page?: { pageSize?: number; currentItem?: number }
  ): Promise<{ total: number; data: KiotvietProduct[] }> {
    const pageSize = page?.pageSize ?? 100;
    const currentItem = page?.currentItem ?? 0;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = `${this.baseUrl}/products?pageSize=${pageSize}&currentItem=${currentItem}&orderBy=createdDate&orderDirection=Desc&includeInventory=false`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          authorization: `Bearer ${opts.authToken}`,
          retailer: opts.retailer
        },
        signal: controller.signal
      });

      if (res.status === 429) throw new Error('kv_rate_limited');
      if (res.status >= 500) throw new Error('kv_server_error');
      if (!res.ok) throw new Error('kv_non_retriable');

      const parsed = await res.json() as { total?: number; pageSize?: number; data?: KiotvietProduct[] };
      return {
        total: parsed.total ?? 0,
        data: Array.isArray(parsed.data) ? parsed.data : []
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('kv_timeout');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function isRetriableKiotvietError(message: string): boolean {
  return message === 'kv_rate_limited' || message === 'kv_server_error' || message === 'kv_timeout';
}
