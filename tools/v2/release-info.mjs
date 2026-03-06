import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

console.log(`GroceryClaw release: v${pkg.version}`);
console.log('Release metadata:');
for (const path of [
  'CHANGELOG.md',
  'docs/saas_v2/RELEASE_NOTES_v0.1.0-rc.1.md',
  'docs/saas_v2/RELEASE_AUDIT_REPORT_RC2.md',
  'docs/saas_v2/RELEASE_AUDIT_CHECKLIST_RC2.md',
  'docs/saas_v2/DEPLOY_K8S_PREREQS.md',
  'docs/saas_v2/DEPLOY_K8S_OVERVIEW.md',
  'docs/saas_v2/VERIFY_BEFORE_CUSTOMERS.md'
]) {
  console.log(`- ${path}`);
}
