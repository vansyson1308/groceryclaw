import { readFileSync } from 'node:fs';
import { runSql } from './db_v2_lib.mjs';

const dictionary = JSON.parse(readFileSync('db/v2/schema_dictionary.json', 'utf8'));
const expectedTables = Object.keys(dictionary.tables).sort();

const tableRows = runSql(`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema='public'
  ORDER BY table_name;
`)
  .split('\n')
  .map((x) => x.trim())
  .filter(Boolean);

const liveCoreTables = tableRows.filter((t) => expectedTables.includes(t));

for (const table of expectedTables) {
  if (!liveCoreTables.includes(table)) {
    throw new Error(`Missing expected table: ${table}`);
  }

  const expectedColumns = dictionary.tables[table].columns;

  const liveColumns = runSql(`
    SELECT column_name || ',' || data_type || ',' || is_nullable
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='${table}'
    ORDER BY column_name;
  `)
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((line) => {
      const [column_name, data_type, is_nullable] = line.split(',');
      return {
        column_name,
        data_type,
        is_nullable
      };
    });

  const liveByName = new Map(liveColumns.map((col) => [col.column_name, col]));
  const expectedNames = Object.keys(expectedColumns).sort();

  for (const columnName of expectedNames) {
    const spec = expectedColumns[columnName];
    const live = liveByName.get(columnName);
    if (!live) {
      throw new Error(`Missing column ${table}.${columnName}`);
    }

    if (live.data_type !== spec.type) {
      throw new Error(`Type mismatch ${table}.${columnName}: expected ${spec.type} got ${live.data_type}`);
    }

    const nullable = live.is_nullable === 'YES';
    if (nullable !== spec.nullable) {
      throw new Error(`Nullability mismatch ${table}.${columnName}: expected ${spec.nullable} got ${nullable}`);
    }
  }

  const extras = [...liveByName.keys()].filter((name) => !(name in expectedColumns));
  if (extras.length > 0) {
    throw new Error(`Unexpected columns in ${table}: ${extras.join(', ')}`);
  }
}

console.log('V2 schema contract check passed.');
