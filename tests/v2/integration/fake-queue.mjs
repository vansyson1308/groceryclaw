import { appendFileSync } from 'node:fs';

const file = process.env.FAKE_QUEUE_FILE;
const payload = process.argv[2] ?? '{}';
if (file) {
  appendFileSync(file, `${payload}\n`, 'utf8');
}
