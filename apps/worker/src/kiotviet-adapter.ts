export interface KiotvietSyncPayload {
  readonly tenant_id: string;
  readonly canonical_invoice_id: string;
  readonly correlation_id: string;
  readonly items: readonly {
    readonly sku: string;
    readonly quantity: number;
  }[];
}

export interface KiotvietAdapter {
  upsertImportDraft: (
    payload: KiotvietSyncPayload,
    authToken?: string
  ) => Promise<{ externalReferenceId: string; raw: Record<string, unknown> }>;
}

export class HttpKiotvietAdapter implements KiotvietAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly apiToken: string,
    private readonly timeoutMs: number
  ) {}

  async upsertImportDraft(payload: KiotvietSyncPayload, authToken?: string): Promise<{ externalReferenceId: string; raw: Record<string, unknown> }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/imports/draft`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${authToken ?? this.apiToken}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (res.status === 429) throw new Error('kv_rate_limited');
      if (res.status >= 500) throw new Error('kv_server_error');
      if (!res.ok) throw new Error('kv_non_retriable');

      const parsed = await res.json() as { external_reference_id?: string };
      const externalReferenceId = parsed.external_reference_id;
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
