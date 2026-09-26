import type { KiotVietClient, KvPurchaseOrderLine } from './kiotviet-client.js';

export interface ProductRow {
  readonly sku: string;
  readonly name: string;
  readonly unit: string;
  readonly barcode: string | null;
  readonly onHand: number;
  readonly minQty: number;
  readonly price: number;
  readonly cost: number;
}

export interface Snapshot {
  /** Shop-local date, YYYY-MM-DD. */
  readonly today: string;
  readonly products: readonly ProductRow[];
  /** date -> sku -> { qty, revenue } */
  readonly sales: ReadonlyMap<string, ReadonlyMap<string, { qty: number; revenue: number }>>;
}

export interface ShopSource {
  readonly shopName: string;
  readonly currency: string;
  readonly timezone: string;
  loadSnapshot(): Promise<Snapshot>;
  /** Present only when purchase orders can be placed (not in --read-only mode). */
  readonly createPurchaseOrder?: (lines: readonly KvPurchaseOrderLine[], description: string) => Promise<{ code: string }>;
}

export function localDate(timezone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Live KiotViet data: products with inventory + last 28 days of invoices, cached briefly. */
export class KiotVietSource implements ShopSource {
  private cache: { at: number; snapshot: Snapshot } | null = null;
  readonly createPurchaseOrder?: ShopSource['createPurchaseOrder'];

  constructor(
    private readonly client: KiotVietClient,
    readonly shopName: string,
    readonly timezone = 'Asia/Ho_Chi_Minh',
    readonly currency = 'VND',
    private readonly cacheSeconds = 60,
    readOnly = false
  ) {
    if (!readOnly) {
      this.createPurchaseOrder = (lines, description) => this.client.createPurchaseOrder(lines, description);
    }
  }

  async loadSnapshot(): Promise<Snapshot> {
    if (this.cache && Date.now() - this.cache.at < this.cacheSeconds * 1000) return this.cache.snapshot;
    const today = localDate(this.timezone);
    const [products, invoices] = await Promise.all([
      this.client.listProducts(),
      this.client.listInvoices(shiftDate(today, -28), today)
    ]);
    const sales = new Map<string, Map<string, { qty: number; revenue: number }>>();
    for (const inv of invoices) {
      if (inv.status === 2) continue; // cancelled
      const date = localDate(this.timezone, new Date(inv.purchaseDate));
      const day = sales.get(date) ?? new Map<string, { qty: number; revenue: number }>();
      for (const line of inv.invoiceDetails ?? []) {
        const prev = day.get(line.productCode) ?? { qty: 0, revenue: 0 };
        day.set(line.productCode, {
          qty: prev.qty + (line.quantity ?? 0),
          revenue: prev.revenue + (line.subTotal ?? (line.price ?? 0) * (line.quantity ?? 0))
        });
      }
      sales.set(date, day);
    }
    const snapshot: Snapshot = {
      today,
      products: products.filter((p) => p.isActive !== false).map((p) => {
        const inv = p.inventories ?? [];
        return {
          sku: p.code,
          name: p.fullName ?? p.name,
          unit: p.unit || 'unit',
          barcode: p.barCode ?? null,
          onHand: inv.reduce((n, i) => n + (i.onHand ?? 0) - (i.reserved ?? 0), 0),
          minQty: p.minQuantity ?? inv.reduce((n, i) => n + (i.minQuantity ?? 0), 0),
          price: p.basePrice ?? 0,
          cost: inv[0]?.cost ?? 0
        };
      }),
      sales
    };
    this.cache = { at: Date.now(), snapshot };
    return snapshot;
  }
}

/** Deterministic in-memory shop for trying the server without KiotViet credentials (`--demo`). */
export class DemoSource implements ShopSource {
  readonly shopName = 'Demo Corner Shop';
  readonly currency = 'VND';
  readonly timezone = 'Asia/Ho_Chi_Minh';
  readonly orders: { code: string; lines: readonly KvPurchaseOrderLine[] }[] = [];
  readonly createPurchaseOrder = async (lines: readonly KvPurchaseOrderLine[]) => {
    const code = `PN${String(this.orders.length + 1).padStart(6, '0')}`;
    this.orders.push({ code, lines });
    return { code };
  };

  constructor(private readonly today: string = localDate('Asia/Ho_Chi_Minh')) {}

  async loadSnapshot(): Promise<Snapshot> {
    const catalogue: [string, string, string, number, number, number, number][] = [
      // sku, name, unit, onHand, minQty, price, daily demand
      ['SP001', 'Fresh Milk 1L', 'carton', 9, 24, 32000, 12],
      ['SP002', 'Chicken Eggs 10-pack', 'tray', 6, 20, 32000, 10],
      ['SP003', 'White Bread', 'loaf', 30, 12, 25000, 6],
      ['SP004', 'Instant Noodles', 'pack', 400, 120, 4000, 55],
      ['SP005', 'Mineral Water 500ml', 'bottle', 20, 60, 5000, 40],
      ['SP006', 'Fish Sauce 500ml', 'bottle', 44, 10, 38000, 4],
      ['SP007', 'Jasmine Rice 5kg', 'bag', 18, 6, 140000, 3],
      ['SP008', 'Cooking Oil 1L', 'bottle', 35, 10, 52000, 4],
      ['SP009', 'Cola 330ml', 'can', 150, 72, 10000, 30],
      ['SP010', 'Potato Chips', 'bag', 60, 24, 12000, 12],
      ['SP011', 'Ground Coffee 500g', 'bag', 12, 4, 95000, 1],
      ['SP012', 'Soy Sauce 500ml', 'bottle', 40, 8, 22000, 3]
    ];
    const weekday = [0.9, 0.85, 0.9, 0.95, 1.1, 1.45, 1.35];
    const sales = new Map<string, Map<string, { qty: number; revenue: number }>>();
    for (let back = 28; back >= 0; back -= 1) {
      const date = shiftDate(this.today, -back);
      const [y, m, d] = date.split('-').map(Number);
      const dow = (new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay() + 6) % 7;
      const day = new Map<string, { qty: number; revenue: number }>();
      catalogue.forEach(([sku, , , , , price, demand], i) => {
        const noise = 0.85 + ((i * 7 + back * 13) % 30) / 100;
        const qty = Math.round(demand * (weekday[dow] ?? 1) * noise * (back === 0 ? 0.6 : 1));
        day.set(sku, { qty, revenue: qty * price });
      });
      sales.set(date, day);
    }
    return {
      today: this.today,
      products: catalogue.map(([sku, name, unit, onHand, minQty, price]) => ({ sku, name, unit, barcode: null, onHand, minQty, price, cost: Math.round(price * 0.78) })),
      sales
    };
  }
}
