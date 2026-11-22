#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE = resolve(__dirname, "..", "plugins", "llm-wiki");
const DEFAULT_DEST = join(homedir(), ".gemini", "config", "plugins", "llm-wiki");

const USAGE = `Usage: install-plugin.mjs [options]

Options:
  --source <dir>   Source plugin directory (default: plugins/llm-wiki)
  --dest <dir>     Install destination (default: ~/.gemini/config/plugins/llm-wiki)
  --copy           Copy files instead of creating a symlink
  --force          Replace an existing unrelated destination
  --uninstall      Remove the installed plugin from --dest
  --help, -h       Show help`;

function parseArgs(argv) {
  const flags = { copy: false, force: false, uninstall: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--copy") flags.copy = true;
    else if (arg === "--force") flags.force = true;
    else if (arg === "--uninstall") flags.uninstall = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--source" || arg === "--dest") {
      const next = argv[i + 1];
      if (next === undefined) throw new Error(`Missing value for ${arg}`);
      flags[arg.slice(2)] = next;
      i++;
    } else if (arg.startsWith("--source=") || arg.startsWith("--dest=")) {
      const [k, v] = arg.slice(2).split("=", 2);
      flags[k] = v;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return flags;
}

function lstatSafe(targetPath) {
  try {
    return lstatSync(targetPath);
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

function resolvesToSamePath(linkPath, sourcePath) {
  try {
    const raw = readlinkSync(linkPath).toString();
    const resolvedLinkTarget = isAbsolute(raw) ? raw : resolve(dirname(linkPath), raw);
    return realpathSync(resolvedLinkTarget) === realpathSync(sourcePath);
  } catch {
    return false;
  }
}

function isOwnedCopy(destPath) {
  try {
    const manifest = JSON.parse(readFileSync(join(destPath, "plugin.json"), "utf8"));
    return manifest?.name === "llm-wiki";
  } catch {
    return false;
  }
}

function main() {
  let flags;
  try {
    flags = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }

  if (flags.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const source = resolve(flags.source ?? DEFAULT_SOURCE);
  const dest = resolve(flags.dest ?? DEFAULT_DEST);

  if (flags.uninstall) {
    const st = lstatSafe(dest);
    if (!st) {
      process.stdout.write(`Not installed at ${dest} (nothing to remove).\n`);
      return;
    }
    const safeToRemove = st.isSymbolicLink() || isOwnedCopy(dest);
    if (!safeToRemove && !flags.force) {
      process.stderr.write(
        `Error: ${dest} does not appear to be an llm-wiki install. Pass --force to remove anyway.\n`,
      );
      process.exit(1);
    }
    rmSync(dest, { recursive: true, force: true });
    process.stdout.write(`Uninstalled llm-wiki from ${dest}\n`);
    return;
  }

  if (!existsSync(join(source, "plugin.json"))) {
    process.stderr.write(`Error: Source plugin.json not found at ${source}\n`);
    process.exit(1);
  }

  mkdirSync(dirname(dest), { recursive: true });
  const existing = lstatSafe(dest);

  if (!flags.copy) {
    if (existing) {
      if (existing.isSymbolicLink() && resolvesToSamePath(dest, source)) {
        process.stdout.write(`Already linked: ${dest} -> ${source}\n`);
        return;
      }
      if (!flags.force) {
        process.stderr.write(
          `Error: Destination already exists at ${dest}. Pass --force to replace.\n`,
        );
        process.exit(1);
      }
      rmSync(dest, { recursive: true, force: true });
    }
    symlinkSync(source, dest, "dir");
    process.stdout.write(`Linked plugin: ${dest} -> ${source}\n`);
    return;
  }

  if (existing) {
    if (!flags.force) {
      process.stderr.write(
        `Error: Destination already exists at ${dest}. Pass --force to overwrite.\n`,
      );
      process.exit(1);
    }
    rmSync(dest, { recursive: true, force: true });
  }
  cpSync(source, dest, { recursive: true, dereference: true });
  process.stdout.write(`Copied plugin to ${dest}\n`);
}

main();
