const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, LevelFormat
} = require("docx");

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };

function headerCell(text, width) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: "1B3A5C", type: ShadingType.CLEAR },
    margins: cellMargins,
    verticalAlign: "center",
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF", font: "Arial", size: 20 })] })]
  });
}

function cell(text, width, opts = {}) {
  const fill = opts.fill || undefined;
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    ...(fill ? { shading: { fill, type: ShadingType.CLEAR } } : {}),
    margins: cellMargins,
    children: [new Paragraph({ children: [new TextRun({ text, font: "Arial", size: 20, bold: opts.bold, color: opts.color })] })]
  });
}

function statusCell(status, width) {
  const colors = {
    "PASS": { fill: "D4EDDA", color: "155724" },
    "FIXED": { fill: "CCE5FF", color: "004085" },
    "N/A (no Docker)": { fill: "FFF3CD", color: "856404" },
    "PARTIAL": { fill: "FFF3CD", color: "856404" },
    "GOOD": { fill: "D4EDDA", color: "155724" },
    "COMPLIANT": { fill: "D4EDDA", color: "155724" },
    "EXCELLENT": { fill: "D4EDDA", color: "155724" },
  };
  const c = colors[status] || { fill: "F8D7DA", color: "721C24" };
  return cell(status, width, { fill: c.fill, color: c.color, bold: true });
}

const statusRows = [
  ["Local Runtime (Docker)", "N/A (no Docker)", "Docker not available in audit VM; code-level audit performed"],
  ["Database Migrations", "PASS", "All 10 V2 migrations fully idempotent with tracking table"],
  ["Health Checks", "PASS", "Gateway /healthz and /readyz verified via unit tests"],
  ["Webhook Verification", "PASS", "Mode1 HMAC-SHA256 + mode2 token verified in tests"],
  ["Queue Verification", "FIXED", "BULLMQ_QUEUE_NAME aligned; template field added to job payload"],
  ["Smoke Test", "N/A (no Docker)", "Smoke script verified correct; requires Docker compose"],
  ["TypeScript Typecheck", "FIXED", "Missing spawnSync/execSync imports and type declarations fixed"],
  ["Lint", "PASS", "36 files pass custom lint rules"],
  ["Format Check", "FIXED", "161 files had CRLF line endings; converted to LF"],
  ["Tests (104 total)", "FIXED", "91 pass, 13 skip (need real DB). Fixed 3 failures"],
  ["Restart Safety", "PASS", "Migrations idempotent; schema_migrations_v2 tracks checksums"],
  ["Config Hygiene", "FIXED", "BULLMQ_QUEUE_NAME, GATEWAY_HOST_PORT aligned in .env.example"],
  ["Network Exposure", "COMPLIANT", "Only gateway exposed; postgres/redis/admin/worker private"],
  ["Operational Safety", "FIXED", "Worker error swallowing bug fixed; errors now re-thrown"],
  ["Backup/Restore", "GOOD", "V2 scripts have --yes guard, post-restore integrity checks"],
  ["Rollback Readiness", "GOOD", "DLQ replay dry-run safe; rollback script functional"],
];

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: "1B3A5C" },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: "2E5984" },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
    ]
  },
  numbering: {
    config: [{
      reference: "bullets",
      levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }]
    }]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    headers: {
      default: new Header({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: "GroceryClaw Deployment Audit Report", font: "Arial", size: 18, color: "888888", italics: true })]
      })] })
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "Page ", font: "Arial", size: 18 }), new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 18 })]
      })] })
    },
    children: [
      // Title
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [
        new TextRun({ text: "GROCERYCLAW", font: "Arial", size: 48, bold: true, color: "1B3A5C" })
      ] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [
        new TextRun({ text: "Deployment Readiness Audit Report", font: "Arial", size: 32, color: "2E5984" })
      ] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [
        new TextRun({ text: "Version 0.1.0-rc.1  |  March 6, 2026", font: "Arial", size: 22, color: "666666" })
      ] }),
      new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "1B3A5C", space: 1 } }, spacing: { after: 400 }, children: [] }),

      // Verdict
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Final Verdict")] }),
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [9360],
        rows: [new TableRow({ children: [
          new TableCell({
            borders: { top: { style: BorderStyle.SINGLE, size: 3, color: "28A745" }, bottom: { style: BorderStyle.SINGLE, size: 3, color: "28A745" }, left: { style: BorderStyle.SINGLE, size: 3, color: "28A745" }, right: { style: BorderStyle.SINGLE, size: 3, color: "28A745" } },
            width: { size: 9360, type: WidthType.DXA },
            shading: { fill: "D4EDDA", type: ShadingType.CLEAR },
            margins: { top: 200, bottom: 200, left: 200, right: 200 },
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, children: [
                new TextRun({ text: "READY FOR STAGING ONLY", font: "Arial", size: 36, bold: true, color: "856404" })
              ] }),
              new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 100 }, children: [
                new TextRun({ text: "All code-level gates pass. Docker runtime verification pending (not available in audit environment).", font: "Arial", size: 20, color: "333333" })
              ] })
            ]
          })
        ] })]
      }),
      new Paragraph({ spacing: { after: 200 }, children: [] }),

      // Summary
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("1. Repository State Summary")] }),
      new Paragraph({ spacing: { after: 100 }, children: [
        new TextRun("GroceryClaw is a multi-tenant SaaS platform built on Node.js 20+, PostgreSQL 16, and Redis 7. The V2 architecture comprises three services (gateway, admin, worker) with a shared common package, 10 database migrations with RLS enforcement, and comprehensive test coverage (104 tests). The codebase uses a monorepo workspace structure with TypeScript compilation, BullMQ for job queuing, and Docker Compose for local development.")
      ] }),
      new Paragraph({ spacing: { after: 200 }, children: [
        new TextRun("This audit found and fixed 5 distinct issues preventing deployment readiness. All code-level verification gates now pass. Full Docker runtime verification requires an environment with Docker installed.")
      ] }),

      // Issues Found
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("2. Issues Discovered and Fixed")] }),

      // Issue 1
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Issue 1: Missing TypeScript Imports (Build Blocker)")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
        new TextRun({ text: "Root cause: ", bold: true }), new TextRun("packages/common/src/bullmq-lite.ts imported execSync but not spawnSync from node:child_process. The types-node-compat.d.ts declared spawnSync but not execSync.")
      ] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
        new TextRun({ text: "Fix: ", bold: true }), new TextRun("Added spawnSync to the import statement and execSync to the type declarations.")
      ] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 200 }, children: [
        new TextRun({ text: "Files: ", bold: true }), new TextRun("packages/common/src/bullmq-lite.ts, types-node-compat.d.ts")
      ] }),

      // Issue 2
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Issue 2: Gateway Notification Template Field Missing (Test Failure)")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
        new TextRun({ text: "Root cause: ", bold: true }), new TextRun("The gateway enqueueNotify function mapped template names to notification_type but did not include the original template name in the job payload. Tests expected lines[0].template to exist.")
      ] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
        new TextRun({ text: "Fix: ", bold: true }), new TextRun("Added template field to the enqueue payload alongside notification_type for auditability.")
      ] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 200 }, children: [
        new TextRun({ text: "File: ", bold: true }), new TextRun("apps/gateway/src/server.ts")
      ] }),

      // Issue 3
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Issue 3: Metrics Port Collision (EADDRINUSE in Tests)")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
        new TextRun({ text: "Root cause: ", bold: true }), new TextRun("Gateway and admin servers start a Prometheus metrics server on hardcoded default ports (9100/9101). Tests spawning multiple server instances collided on these ports.")
      ] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
        new TextRun({ text: "Fix: ", bold: true }), new TextRun("Assigned unique GATEWAY_METRICS_PORT and ADMIN_METRICS_PORT environment variables to every test that spawns a server process.")
      ] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 200 }, children: [
        new TextRun({ text: "Files: ", bold: true }), new TextRun("tests/v2/gateway-webhook.test.mjs, tests/v2/apps.test.mjs, tests/v2/admin-auth.test.mjs, tests/v2/admin-endpoints.test.mjs, tests/v2/admin-secrets.test.mjs, tests/v2/canary-rollout.test.mjs")
      ] }),

      // Issue 4
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Issue 4: CRLF Line Endings (Format Check Failure)")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
        new TextRun({ text: "Root cause: ", bold: true }), new TextRun("All source files had Windows CRLF line endings (\\r\\n), causing the format checker to report trailing whitespace on every line of 161 files.")
      ] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
        new TextRun({ text: "Fix: ", bold: true }), new TextRun("Converted all source files (*.ts, *.mjs, *.js, *.json, *.yml, *.md, *.sh, *.sql) to Unix LF line endings.")
      ] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 200 }, children: [
        new TextRun({ text: "Scope: ", bold: true }), new TextRun("161 files across the entire repository")
      ] }),

      // Issue 5
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Issue 5: Worker Error Swallowing (Operational Safety)")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
        new TextRun({ text: "Root cause: ", bold: true }), new TextRun("The BullMQ worker caught generic job errors (PROCESS_INBOUND_EVENT, MAP_RESOLVE, KIOTVIET_SYNC) but did not re-throw them. This silently swallowed failures, preventing BullMQ retry logic and DLQ placement.")
      ] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
        new TextRun({ text: "Fix: ", bold: true }), new TextRun("Added throw error after logging in the generic catch block so BullMQ can handle retries and dead-letter routing.")
      ] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 200 }, children: [
        new TextRun({ text: "File: ", bold: true }), new TextRun("apps/worker/src/index.ts")
      ] }),

      // Issue 6 (config)
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Issue 6: Configuration Misalignment")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
        new TextRun({ text: "Root cause: ", bold: true }), new TextRun("BULLMQ_QUEUE_NAME was 'main' in .env but 'process-inbound' in .env.example. GATEWAY_HOST_PORT was missing from .env.example despite being referenced in docker-compose.yml.")
      ] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
        new TextRun({ text: "Fix: ", bold: true }), new TextRun("Aligned .env BULLMQ_QUEUE_NAME to 'process-inbound'. Added GATEWAY_HOST_PORT=8081 to .env.example.")
      ] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 200 }, children: [
        new TextRun({ text: "Files: ", bold: true }), new TextRun("infra/compose/v2/.env, infra/compose/v2/.env.example")
      ] }),

      new Paragraph({ children: [new PageBreak()] }),

      // Status Table
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("3. Final Status Table")] }),
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [2800, 1200, 5360],
        rows: [
          new TableRow({ children: [headerCell("Gate", 2800), headerCell("Status", 1200), headerCell("Notes", 5360)] }),
          ...statusRows.map(([gate, status, notes]) =>
            new TableRow({ children: [cell(gate, 2800, { bold: true }), statusCell(status, 1200), cell(notes, 5360)] })
          )
        ]
      }),
      new Paragraph({ spacing: { after: 300 }, children: [] }),

      // Verification Evidence
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("4. Verification Evidence")] }),
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Final Gate Results")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ text: "npm run typecheck: ", bold: true }), new TextRun("PASS (zero errors)")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ text: "npm run lint: ", bold: true }), new TextRun("PASS (36 files clean)")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ text: "format-check: ", bold: true }), new TextRun("PASS (161 files clean after CRLF fix)")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 200 }, children: [new TextRun({ text: "npm run test: ", bold: true }), new TextRun("104 tests, 91 pass, 0 fail, 13 skip (require real DB)")] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Network Exposure Verification")] }),
      new Paragraph({ spacing: { after: 200 }, children: [
        new TextRun("Verified in docker-compose.yml: only the gateway service has a ports: mapping (8081:8080). PostgreSQL, Redis, admin, and worker have no host port exposure. All services communicate exclusively through the v2_private bridge network. Admin is bound to 127.0.0.1 (loopback only).")
      ] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Migration Idempotence")] }),
      new Paragraph({ spacing: { after: 200 }, children: [
        new TextRun("All 10 V2 migrations use idempotent patterns: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP POLICY IF EXISTS, ALTER TABLE ADD COLUMN IF NOT EXISTS. The schema_migrations_v2 tracking table with SHA-256 checksums prevents reapplication and detects drift.")
      ] }),

      // Recommendations
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("5. Recommendations Before Production")] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
        new TextRun({ text: "Run full Docker smoke test: ", bold: true }), new TextRun("Execute make v2-up, npm run db:v2:migrate, and make v2-smoke in an environment with Docker to verify the complete pipeline end-to-end.")
      ] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
        new TextRun({ text: "Run restart cycle test: ", bold: true }), new TextRun("Execute make v2-down followed by make v2-up and make v2-smoke twice to verify restart idempotence.")
      ] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
        new TextRun({ text: "Replace development encryption keys: ", bold: true }), new TextRun("ADMIN_MEK_B64 and WORKER_MEK_B64 currently use placeholder values. Generate real 32-byte keys for staging/production.")
      ] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [
        new TextRun({ text: "Set READYZ_STRICT=true in staging: ", bold: true }), new TextRun("The .env has READYZ_STRICT=false for development convenience. Staging and production must use strict readiness checks.")
      ] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 300 }, children: [
        new TextRun({ text: "Configure real OIDC provider: ", bold: true }), new TextRun("The admin OIDC issuer is set to https://issuer.example. Replace with a real identity provider before enabling admin in production.")
      ] }),

      new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "1B3A5C", space: 1 } }, spacing: { after: 200 }, children: [] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [
        new TextRun({ text: "End of Audit Report", font: "Arial", size: 20, color: "888888", italics: true })
      ] }),
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("/sessions/brave-nice-turing/mnt/groceryclaw/DEPLOYMENT_AUDIT_REPORT.docx", buffer);
  console.log("Report generated successfully");
});
