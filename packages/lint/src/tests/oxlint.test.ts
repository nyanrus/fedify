/**
 * Integration test for the oxlint plugin entry.
 *
 * Spawns the oxlint binary against a tmpdir fixture that violates
 * `actor-id-required`, parses the JSON diagnostics, and asserts the
 * `@fedify/lint/actor-id-required` rule fires.
 *
 * Skipped when the `oxlint` binary is not on PATH or the built plugin is
 * missing under `dist/`.
 */
import { ok } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pluginPath = resolve(here, "../../dist/oxlint.js");
const pluginBuilt = existsSync(pluginPath);

function findOxlint(): string | null {
  const candidate = resolve(here, "../../../../node_modules/.bin/oxlint");
  if (existsSync(candidate)) return candidate;
  const where = spawnSync(
    process.platform === "win32" ? "where" : "which",
    ["oxlint"],
    { encoding: "utf8" },
  );
  if (where.status === 0 && where.stdout) {
    return where.stdout.trim().split(/\r?\n/)[0];
  }
  return null;
}

const oxlintBin = findOxlint();
const skipReason = !pluginBuilt
  ? "skip: dist/oxlint.js missing — run `pnpm build` first"
  : !oxlintBin
  ? "skip: oxlint binary not found on PATH"
  : null;

const BAD_CODE =
  `import { createFederation, InProcessMessageQueue, MemoryKvStore } from "@fedify/fedify";
import { Person } from "@fedify/vocab";

const federation = createFederation<void>({
  kv: new MemoryKvStore(),
  queue: new InProcessMessageQueue(),
});

federation.setActorDispatcher("/users/{identifier}", (_ctx, _identifier) => {
  return new Person({
    name: "Bad Actor",
  });
});
`;

interface OxlintJsonDiagnostic {
  code?: string;
  message?: string;
  severity?: string;
}

interface OxlintJsonReport {
  diagnostics?: OxlintJsonDiagnostic[];
}

test(
  "oxlint plugin: actor-id-required fires on missing id",
  { skip: skipReason ?? false },
  () => {
    const dir = mkdtempSync(join(tmpdir(), "fedify-lint-oxlint-"));
    writeFileSync(
      join(dir, ".oxlintrc.json"),
      JSON.stringify({
        jsPlugins: [pluginPath],
        rules: {
          "@fedify/lint/actor-id-required": "error",
        },
      }),
    );
    writeFileSync(join(dir, "federation.ts"), BAD_CODE);

    const result = spawnSync(
      oxlintBin!,
      ["--format=json", "."],
      { cwd: dir, encoding: "utf8" },
    );

    ok(
      result.status !== 0,
      `Expected non-zero exit, got ${result.status}. stderr: ${result.stderr}`,
    );

    let payload: OxlintJsonReport;
    try {
      payload = JSON.parse(result.stdout) as OxlintJsonReport;
    } catch (err) {
      throw new Error(
        `Failed to parse oxlint JSON output: ${(err as Error).message}\n` +
          `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
      );
    }

    const codes = (payload.diagnostics ?? []).map((d) => d.code ?? "");
    const matched = codes.some((code) =>
      code === "@fedify/lint(actor-id-required)" ||
      code.includes("actor-id-required")
    );
    ok(
      matched,
      `Expected @fedify/lint(actor-id-required) diagnostic, got: ${
        codes.join(", ") || "(none)"
      }`,
    );
  },
);
