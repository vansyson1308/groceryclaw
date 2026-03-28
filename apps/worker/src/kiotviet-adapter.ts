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

export interface KiotvietAdapter {
  createPurchaseOrder: (
    payload: KiotvietSyncPayload,
    opts: KiotvietSyncOpts
  ) => Promise<{ externalReferenceId: string; raw: Record<string, unknown> }>;
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
      if (!res.ok) throw new Error('kv_non_retriable');

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
}

export function isRetriableKiotvietError(message: string): boolean {
  return message === 'kv_rate_limited' || message === 'kv_server_error' || message === 'kv_timeout';
}
