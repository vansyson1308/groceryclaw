import { readFileSync } from 'node:fs';
import { runSql } from './db_v2_lib.mjs';

const sql = readFileSync('db/v2/seed/001_dev_seed.sql', 'utf8');
runSql(sql);
console.log('Applied V2 dev seed: db/v2/seed/001_dev_seed.sql');
