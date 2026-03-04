import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync("rg --files apps packages -g '*.ts' -g '*.tsx' -g '*.mts' -g '*.cts'", { encoding: 'utf8' })
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((s) => !s.includes('/dist/') && !s.endsWith('.d.ts'));

const issues = [];

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  if (content.includes(' as any') || content.includes(': any') || content.includes('<any>')) {
    issues.push(`${file}: avoid explicit any in V2 scaffold code`);
  }
  if (content.includes('TODO: NEEDS VERIFICATION')) {
    issues.push(`${file}: forbidden marker TODO: NEEDS VERIFICATION`);
  }
}

if (issues.length > 0) {
  console.error('Lint check failed:');
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log(`Lint check passed for ${files.length} files.`);
