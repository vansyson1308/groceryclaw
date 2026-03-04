import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync("rg --files apps packages tests docs .github/workflows package.json tsconfig.base.json tsconfig.build.json .gitignore README.md", { encoding: 'utf8' })
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((s) => !s.includes('/dist/'));

const violations = [];
for (const file of files) {
  const content = readFileSync(file, 'utf8');
  if (!content.endsWith('\n')) {
    violations.push(`${file}: file must end with newline`);
  }

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (/\s+$/.test(lines[i])) {
      violations.push(`${file}:${i + 1}: trailing whitespace`);
    }
    if (/\t/.test(lines[i])) {
      violations.push(`${file}:${i + 1}: tab character found (use spaces)`);
    }
  }
}

if (violations.length > 0) {
  console.error('Format check failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log(`Format check passed for ${files.length} files.`);
