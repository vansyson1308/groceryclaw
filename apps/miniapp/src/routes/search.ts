// Product search moved to @groceryclaw/common so the ShopVoice MCP server can
// reuse the same tenant-scoped pg_trgm matching.
export { searchProducts, findByBarcode } from '../../../../packages/common/dist/index.js';
export type { SearchDeps, ProductResult } from '../../../../packages/common/dist/index.js';
