# V2 Repo Tree (Phase 0 Scaffold)

```text
groceryclaw/
├── apps/
│   ├── gateway/
│   │   └── src/
│   │       ├── index.ts
│   │       └── server.ts      # GET /healthz, GET /readyz
│   ├── admin/
│   │   └── src/
│   │       ├── index.ts
│   │       └── server.ts      # GET /healthz, GET /readyz (private bind default)
│   └── worker/
│       └── src/
│           └── index.ts       # worker scaffold entrypoint
├── packages/
│   └── common/
│       └── src/
│           ├── config.ts      # strict env parsing/validation
│           ├── logger.ts      # structured JSON logger
│           ├── types.ts       # shared type placeholders
│           └── index.ts
├── infra/
│   └── compose/
│       └── v2/
│           └── README.md
└── docs/
    └── saas_v2/
        └── REPO_TREE_V2.md
```

## Notes
- This scaffold is additive and does not modify legacy `n8n/` workflows or legacy compose usage.
- No queue, DB, webhook handling, parser, or third-party API logic is implemented in Phase 0.
