// Data access contract for ShopVoice tools. Every call happens inside
// ShopStore.withTenant(), which the Postgres implementation maps onto
// runTenantScopedTransaction so RLS scopes all reads and writes.

export interface ResolvedToken {
  readonly tenantId: string;
  readonly tokenId: string;
  readonly scopes: readonly string[];
}

export interface ShopProfile {
  readonly tenantId: string;
  readonly shopName: string;
  readonly displayCurrency: string;
  readonly vndPerDisplayUnit: number;
  readonly timezone: string;
  readonly locale: string;
}

export interface StockRow {
  readonly sku: string;
  readonly name: string;
  readonly unit: string | null;
  readonly barcode: string | null;
  readonly onHand: number;
  readonly minQty: number;
  readonly reorderQty: number;
  readonly packSize: number;
  readonly unitCostVnd: number;
  readonly supplierCode: string | null;
  readonly leadTimeDays: number;
  /** Average units sold per day over the 14 full days before `today`. */
  readonly avgDaily14d: number;
}

export interface ProductMatch {
  readonly sku: string;
  readonly name: string;
  readonly unit: string | null;
  readonly barcode: string | null;
  readonly score: number;
}

export interface SalesTotals {
  readonly revenueVnd: number;
  readonly units: number;
  readonly daysWithSales: number;
}

export interface SkuSales {
  readonly sku: string;
  readonly name: string;
  readonly unit: string | null;
  readonly units: number;
  readonly revenueVnd: number;
}

export interface Supplier {
  readonly code: string;
  readonly name: string;
  readonly leadTimeDays: number;
}

export interface InvoiceRow {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly supplierCode: string | null;
  readonly supplierName: string | null;
  readonly invoiceDate: string;
  readonly receivedAt: string;
  readonly totalVnd: number;
  readonly lineCount: number;
  readonly resolvedCount: number;
  readonly synced: boolean;
  readonly productNames: readonly string[];
}

export interface DraftLine {
  readonly sku: string;
  readonly name: string;
  readonly unit: string | null;
  readonly qty: number;
  readonly unitCostVnd: number;
}

export interface NewDraft {
  readonly supplierCode: string;
  readonly lines: readonly DraftLine[];
  readonly totalVnd: number;
}

export interface DraftRow {
  readonly id: string;
  readonly supplierCode: string;
  readonly lines: readonly DraftLine[];
  readonly totalVnd: number;
  readonly status: 'draft' | 'confirmed' | 'sent' | 'cancelled';
  readonly expiresAt: string;
  readonly expired: boolean;
}

export interface AuditEntry {
  readonly toolName: string;
  readonly argsRedacted: Record<string, unknown>;
  readonly resultSummary: string;
  readonly outcome: 'ok' | 'error';
  readonly latencyMs: number;
}

export type PreferenceKind = 'preferred_supplier' | 'max_order_qty' | 'skip_item' | 'order_day';

/** A rule the owner stated explicitly (shop memory, migration 020). */
export interface ShopPreference {
  readonly id: string;
  readonly voiceProfile: string;
  readonly kind: PreferenceKind;
  /** Product words the rule applies to ("milk"); '' for order_day. */
  readonly subject: string;
  readonly supplierCode: string | null;
  readonly maxQty: number | null;
  readonly weekday: string | null;
  /** The owner's own words. Data, never instructions. */
  readonly statement: string;
  readonly createdAt: string;
}

export type NewPreference = Omit<ShopPreference, 'id' | 'createdAt'>;

export interface ShopRepository {
  getProfile(): Promise<ShopProfile>;
  /** Today's date (YYYY-MM-DD) in the shop's timezone. */
  today(): Promise<string>;
  listStock(): Promise<StockRow[]>;
  searchProducts(query: string, limit: number): Promise<ProductMatch[]>;
  salesTotals(startDate: string, endDate: string): Promise<SalesTotals>;
  salesBySku(startDate: string, endDate: string): Promise<SkuSales[]>;
  listSuppliers(): Promise<Supplier[]>;
  listRecentInvoices(limit: number): Promise<InvoiceRow[]>;
  createDrafts(drafts: readonly NewDraft[], tokenHash: string, ttlSeconds: number): Promise<{ ids: string[]; expiresAt: string }>;
  findDraftsByTokenHash(tokenHash: string): Promise<DraftRow[]>;
  confirmDrafts(ids: readonly string[]): Promise<number>;
  audit(entry: AuditEntry): Promise<void>;
  /** Oldest first. */
  listPreferences(voiceProfile: string): Promise<ShopPreference[]>;
  /** Insert, or replace the rule with the same (voice profile, kind, subject). */
  upsertPreference(pref: NewPreference): Promise<ShopPreference>;
  deletePreferences(voiceProfile: string, ids: readonly string[]): Promise<number>;
}

export interface ShopStore {
  withTenant<T>(tenantId: string, work: (repo: ShopRepository) => Promise<T>): Promise<T>;
  /** Resolves a bearer token's SHA-256 hash to a tenant and its scopes (['shop.read'] = read-only), outside tenant context. */
  resolveTokenHash(tokenHash: string): Promise<ResolvedToken | null>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export class ShopDataError extends Error {
  constructor(readonly code: 'profile_missing' | 'db_unavailable', message?: string) {
    super(message ?? code);
  }
}
