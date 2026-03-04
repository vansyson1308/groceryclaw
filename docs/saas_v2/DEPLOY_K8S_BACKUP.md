# Kubernetes Backup & Restore (V2)

## Recommended path (production)

Use **managed Postgres backups** from your cloud provider first:
- Enable automated daily backups.
- Keep at least 7–14 days retention (per policy).
- Test point-in-time restore regularly.

Then add logical dumps (`pg_dump`) as a second safety layer.

## Option A: managed database snapshots (recommended)

1. Enable backups in provider console.
2. Set retention policy.
3. Run quarterly restore drill into a staging DB.
4. Run schema contract checks after restore.

## Option B: logical `pg_dump` CronJob (advanced)

Template (disabled by default):
- `infra/k8s/backup/pgdump-cronjob.example.yaml`

How to use:
1. Create PVC `groceryclaw-backup-pvc`.
2. Ensure `app-secrets.POSTGRES_URL` points to the DB.
3. Set `spec.suspend: false`.
4. Apply:

```bash
kubectl apply -f infra/k8s/backup/pgdump-cronjob.example.yaml
kubectl get cronjob -n groceryclaw-v2
```

## Restore workflow (logical dump)

```bash
# 1) copy dump out of PVC/job volume if needed
# 2) restore into target DB using existing repo script
DB_V2_RESTORE_URL='postgres://...' npm run db:v2:restore -- --yes backups/v2/latest.dump

# 3) verify schema contract
DATABASE_URL='postgres://...' npm run db:v2:schema:contract
```

## Safety notes

- Never print full DB URLs with credentials in shared logs.
- Encrypt backup storage at rest.
- Restrict backup file access to ops/security roles.
- Keep restore drill evidence in incident/change records.
