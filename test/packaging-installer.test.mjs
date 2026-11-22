import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const PLUGIN_DIR = join(REPO_ROOT, "plugins", "llm-wiki");
const INSTALLER_PATH = join(REPO_ROOT, "scripts", "install-plugin.mjs");

function runInstaller(args) {
  try {
    const stdout = execFileSync(process.execPath, [INSTALLER_PATH, ...args], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

function collectAllNames(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    out.push({ name: entry.name, path: full });
    if (entry.isDirectory()) collectAllNames(full, out);
  }
  return out;
}

test("packaging: valid Antigravity manifest, 11 Style-1 skills, and zero forbidden/ambient artifacts", () => {
  const manifest = JSON.parse(readFileSync(join(PLUGIN_DIR, "plugin.json"), "utf8"));
  const allowedTopLevel = new Set(["name", "displayName", "description", "version", "suggestedPrompts"]);
  for (const key of Object.keys(manifest)) {
    assert.equal(allowedTopLevel.has(key), true, `Unexpected manifest field: ${key}`);
  }
  assert.equal(manifest.name, "llm-wiki");
  assert.equal(manifest.displayName, "LLM Wiki");
  assert.equal(typeof manifest.description, "string");
  assert.equal(manifest.description.length > 10, true);
  assert.equal(Array.isArray(manifest.suggestedPrompts), true);
  assert.equal(manifest.suggestedPrompts.length, 3);

  const topEntries = readdirSync(PLUGIN_DIR).sort();
  assert.deepEqual(topEntries, ["README.md", "plugin.json", "scripts", "skills", "templates"]);

  const expectedSkills = [
    "llm-wiki",
    "wiki-capture",
    "wiki-digest",
    "wiki-discover",
    "wiki-init",
    "wiki-ingest",
    "wiki-lint",
    "wiki-query",
    "wiki-req",
    "wiki-run",
    "wiki-status",
  ].sort();
  const actualSkills = readdirSync(join(PLUGIN_DIR, "skills")).sort();
  assert.deepEqual(actualSkills, expectedSkills);

  for (const skill of actualSkills) {
    const skillMd = readFileSync(join(PLUGIN_DIR, "skills", skill, "SKILL.md"), "utf8");
    assert.match(skillMd, /^---\n[\s\S]*?\n---/);
    assert.equal(skillMd.includes(`name: ${skill}\n`), true, `Skill ${skill} name mismatch`);
    assert.equal(skillMd.includes("description:"), true, `Skill ${skill} missing description`);
    if (skill !== "llm-wiki") {
      assert.equal(
        skillMd.includes("../../scripts/wiki.mjs"),
        true,
        `Skill ${skill} must reference ../../scripts/wiki.mjs`,
      );
    }
  }

  const forbidden = new Set([
    "hooks.json",
    "mcp_config.json",
    "rules",
    "agents",
    ".claude-plugin",
    ".pi",
    ".omp",
  ]);
  for (const entry of collectAllNames(PLUGIN_DIR)) {
    assert.equal(forbidden.has(entry.name), false, `Forbidden entry present: ${entry.path}`);
  }
});

test("installer: symlink idempotency, conflict protection, --force, --copy, and --uninstall", () => {
  const base = mkdtempSync(join(tmpdir(), "llm-wiki-install-"));
  const dest = join(base, "plugins", "llm-wiki");
  const decoy = join(base, "decoy");

  try {
    // 1. Default symlink install + idempotent re-run
    const first = runInstaller(["--dest", dest]);
    assert.equal(first.code, 0);
    assert.equal(lstatSync(dest).isSymbolicLink(), true);
    assert.equal(realpathSync(dest), realpathSync(PLUGIN_DIR));

    const second = runInstaller(["--dest", dest]);
    assert.equal(second.code, 0);

    // 2. Uninstall removes symlink without touching source
    const un1 = runInstaller(["--uninstall", "--dest", dest]);
    assert.equal(un1.code, 0);
    assert.equal(existsSync(dest), false);
    assert.equal(existsSync(join(PLUGIN_DIR, "plugin.json")), true);

    // 3. Protect unrelated existing destination without --force
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "keep.txt"), "user data", "utf8");
    const blocked = runInstaller(["--dest", dest]);
    assert.notEqual(blocked.code, 0);
    assert.equal(readFileSync(join(dest, "keep.txt"), "utf8"), "user data");

    // 4. --force replaces unrelated destination
    const forced = runInstaller(["--force", "--dest", dest]);
    assert.equal(forced.code, 0);
    assert.equal(lstatSync(dest).isSymbolicLink(), true);

    // 5. --copy installs standalone directory + --uninstall cleans it up
    mkdirSync(decoy, { recursive: true });
    const copied = runInstaller(["--copy", "--force", "--dest", dest]);
    assert.equal(copied.code, 0);
    assert.equal(lstatSync(dest).isSymbolicLink(), false);
    assert.equal(existsSync(join(dest, "scripts", "wiki.mjs")), true);

    const un2 = runInstaller(["--uninstall", "--dest", dest]);
    assert.equal(un2.code, 0);
    assert.equal(existsSync(dest), false);
    assert.equal(existsSync(join(PLUGIN_DIR, "plugin.json")), true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
