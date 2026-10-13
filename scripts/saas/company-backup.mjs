#!/usr/bin/env node
// Company export / restore (operator tool). Run with:  node --import tsx scripts/saas/company-backup.mjs <command> [options]
//   export  --company <id> --out <dir> [--encrypt-env VAR --archive <file.enc>] [--no-objects] [--allow-remote]
//   verify  --dir <dir>                         (checks every checksum; touches no database)
//   restore --dir <dir> --company <id> [--yes] [--prune-objects] [--no-objects] [--allow-remote]      (dry run unless --yes)
//   (--no-objects: database only, for a rehearsal without object storage)
//   restore --archive <file.enc> --decrypt-env VAR --company <id> [--yes] ...
// Database: PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE (a non-local host is refused unless --allow-remote).
// Object storage: the same RAILWAY_S3_* and RAILWAY_OBJECT_PROXY_SECRET variables the application uses.
// A backup holds customer data: keep it encrypted (--encrypt-env) and off shared drives. An archive is only ever restored into ITS company.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BackupError, connectionFromEnv, exportCompany, restoreCompany, verifyArchive } from "../../server/saas/companyBackup.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLASSIFICATION = path.join(here, "table-classification.json");
const args = process.argv.slice(2);
const cmd = args.shift();
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (n) => args.includes(`--${n}`);
const log = (m) => console.log(m);
const fail = (m) => { console.error(`ERROR: ${m}`); process.exit(1); };

function openssl(mode, input, output, envVar) {
  if (!process.env[envVar]) fail(`Environment variable ${envVar} is not set.`);
  const r = spawnSync("openssl", ["enc", mode === "enc" ? "-e" : "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-salt", "-pass", `env:${envVar}`, "-in", input, "-out", output], { encoding: "utf8" });
  if (r.status !== 0) fail(`openssl failed (${mode === "enc" ? "encrypt" : "wrong passphrase or damaged archive"}).`);
}

try {
  if (cmd === "export") {
    const company = opt("company"), out = opt("out");
    if (!company || !out) fail("export needs --company and --out");
    const manifest = await exportCompany({ client: connectionFromEnv(process.env, flag("allow-remote")), companyId: company, outDir: path.resolve(out), classificationFile: CLASSIFICATION, skipObjects: flag("no-objects"), log });
    const rows = manifest.tables.reduce((s, t) => s + t.rows, 0);
    log(`Exported ${company}: ${rows} row(s) in ${manifest.tables.length} table(s), ${manifest.objects.length} document(s) -> ${out}`);
    if (manifest.skippedTables.length) log(`Not exported: ${manifest.skippedTables.map((s) => `${s.table} (${s.reason})`).join("; ")}`);
    if (opt("encrypt-env")) {
      const arch = opt("archive"); if (!arch) fail("--encrypt-env needs --archive <file>");
      const tar = path.join(os.tmpdir(), `bk-${process.pid}.tar`);
      const t = spawnSync("tar", ["-C", path.resolve(out), "-cf", tar, "."]); if (t.status !== 0) fail("tar failed");
      openssl("enc", tar, path.resolve(arch), opt("encrypt-env")); fs.rmSync(tar);
      log(`Encrypted archive written: ${arch} (AES-256-CBC, PBKDF2). The plain directory ${out} still exists: remove it when you have stored the archive.`);
    }
  } else if (cmd === "verify") {
    const dir = opt("dir"); if (!dir) fail("verify needs --dir");
    const m = verifyArchive(path.resolve(dir));
    log(`OK: ${Object.keys(m.files).length} file(s) match their checksums. Company ${m.company.id}, exported ${m.createdAt}, ${m.tables.length} table(s), ${m.objects.length} document(s).`);
  } else if (cmd === "restore") {
    const company = opt("company"); if (!company) fail("restore needs --company");
    let dir = opt("dir"), tmp;
    if (!dir) {
      const arch = opt("archive"); if (!arch || !opt("decrypt-env")) fail("restore needs --dir, or --archive with --decrypt-env");
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bk-restore-")); fs.chmodSync(tmp, 0o700);
      const tar = path.join(tmp, "a.tar"); openssl("dec", path.resolve(arch), tar, opt("decrypt-env"));
      dir = path.join(tmp, "x"); fs.mkdirSync(dir);
      if (spawnSync("tar", ["-C", dir, "-xf", tar]).status !== 0) fail("could not unpack the archive");
    }
    try {
      const report = await restoreCompany({ client: connectionFromEnv(process.env, flag("allow-remote")), dir: path.resolve(dir), companyId: company, apply: flag("yes"), pruneObjects: flag("prune-objects"), skipObjects: flag("no-objects"), classificationFile: CLASSIFICATION, log });
      log(report.applied ? `RESTORED company ${report.company}.` : `DRY RUN for company ${report.company}: nothing was changed. Add --yes to apply.`);
      for (const t of report.tables) if (t.deleted || t.inserted) log(`  ${t.name}: ${t.deleted} row(s) replaced by ${t.inserted}`);
      log(`  documents: ${report.objects.uploaded} uploaded, ${report.objects.pruned} pruned, ${report.objects.extraInStorage} in storage that the archive does not contain${flag("prune-objects") ? "" : " (kept; --prune-objects removes them)"}`);
      log(`  memberships: ${report.memberships.restored} restored${report.memberships.missingUsers.length ? `; users not in this database (not created): ${report.memberships.missingUsers.join(", ")}` : ""}`);
      for (const w of report.warnings) log(`  note: ${w}`);
    } finally { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); }
  } else {
    fail("usage: company-backup.mjs export|verify|restore (see the header of this file)");
  }
} catch (err) {
  if (err instanceof BackupError) fail(err.message);
  console.error(err); process.exit(1);
}
