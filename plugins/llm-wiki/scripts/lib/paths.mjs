import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Workspace-local vault path resolution and filesystem utilities.
 *
 * Strictly scoped to workspace/project vaults: never reads `~/.llm-wiki/`
 * or `WIKI_HOME`, and stops ancestor walks strictly before `os.homedir()`.
 */

export function compareCodePoint(a, b) {
  const left = a.normalize("NFC");
  const right = b.normalize("NFC");
  return left < right ? -1 : left > right ? 1 : 0;
}

function appendPath(base, ...parts) {
  if (parts.length === 0) return base;
  return `${base}${base.endsWith(sep) ? "" : sep}${parts.join(sep)}`;
}

/**
 * Resolve the physical path of `targetPath` even when a trailing segment does
 * not exist on disk yet, detecting symlink cycles.
 */
export function realpathWithMissingTail(targetPath, seen = new Set()) {
  let current = resolve(targetPath);
  const tail = [];

  while (true) {
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) {
        const symlinkPath = appendPath(realpathSync.native(dirname(current)), basename(current));
        if (seen.has(symlinkPath)) {
          throw new Error(`Cannot resolve symlink cycle: ${targetPath}`);
        }
        seen.add(symlinkPath);
        const rawTarget = readlinkSync(current).toString();
        const resolvedTarget = isAbsolute(rawTarget)
          ? rawTarget
          : appendPath(dirname(current), rawTarget);
        return realpathWithMissingTail(appendPath(resolvedTarget, ...tail.reverse()), seen);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    try {
      return appendPath(realpathSync.native(current), ...tail.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      tail.push(basename(current));
      current = parent;
    }
  }
}

export function relativePhysicalPath(rootPath, candidatePath) {
  return relative(realpathWithMissingTail(rootPath), realpathWithMissingTail(candidatePath));
}

export function isPathWithin(rootPath, candidatePath) {
  const relation = relativePhysicalPath(rootPath, candidatePath);
  return (
    relation === "" ||
    (!isAbsolute(relation) && relation !== ".." && !relation.startsWith(`..${sep}`))
  );
}

/** Build standard `.llm-wiki/` layout paths for a vault root directory. */
export function getVaultPaths(root) {
  const absRoot = resolve(root);
  const dotWiki = join(absRoot, ".llm-wiki");
  const raw = join(dotWiki, "raw");
  const meta = join(dotWiki, "meta");
  const templates = join(dotWiki, "templates");
  return {
    root: absRoot,
    dotWiki,
    raw,
    rawSources: join(raw, "sources"),
    rawAssets: join(raw, "assets"),
    wiki: join(dotWiki, "wiki"),
    meta,
    outputs: join(dotWiki, "outputs"),
    discoveries: join(dotWiki, ".discoveries"),
    templates,
    templatesPages: join(templates, "pages"),
  };
}

/**
 * Resolve an existing workspace-local vault root.
 *
 * - When `explicitRoot` is set, only that directory is checked.
 * - Otherwise walks upward from `cwd`, stopping strictly BEFORE `os.homedir()`.
 * - Returns `null` when no workspace `.llm-wiki/config.json` is found.
 */
export function resolveVaultRoot(cwd = process.cwd(), explicitRoot) {
  if (explicitRoot !== undefined && explicitRoot !== null && String(explicitRoot).trim() !== "") {
    const candidate = resolve(String(explicitRoot));
    return existsSync(join(candidate, ".llm-wiki", "config.json")) ? candidate : null;
  }

  let homePhys = "";
  try {
    homePhys = realpathWithMissingTail(homedir());
  } catch {
    homePhys = resolve(homedir());
  }

  let current = resolve(cwd);
  while (true) {
    let currentPhys = current;
    try {
      currentPhys = realpathWithMissingTail(current);
    } catch {
      currentPhys = current;
    }

    // Never touch or fall back to `$HOME/.llm-wiki/`.
    if (currentPhys === homePhys) {
      return null;
    }

    if (existsSync(join(current, ".llm-wiki", "config.json"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/** Resolve target root for `init` (explicit `--root` or current directory). */
export function resolveInitRoot(cwd = process.cwd(), explicitRoot) {
  if (explicitRoot !== undefined && explicitRoot !== null && String(explicitRoot).trim() !== "") {
    return resolve(String(explicitRoot));
  }
  return resolve(cwd);
}

/** Ensure standard workspace `.llm-wiki/` subdirectories exist. */
export function ensureVaultStructure(paths) {
  const dirs = [
    paths.dotWiki,
    paths.raw,
    paths.rawSources,
    paths.rawAssets,
    paths.wiki,
    join(paths.wiki, "sources"),
    join(paths.wiki, "entities"),
    join(paths.wiki, "concepts"),
    join(paths.wiki, "syntheses"),
    join(paths.wiki, "analyses"),
    join(paths.wiki, "requirements"),
    paths.meta,
    paths.outputs,
    paths.discoveries,
    paths.templates,
    paths.templatesPages,
  ];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }
}

export function fmtDate(date = new Date()) {
  return date.toISOString().split("T")[0];
}

export function readJson(filePath, defaultValue) {
  try {
    if (!existsSync(filePath)) return defaultValue;
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return defaultValue;
  }
}

export function writeJson(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function readText(filePath) {
  try {
    if (!existsSync(filePath)) return "";
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

/**
 * Slugify a page title to a cross-platform, kebab-case filename stem.
 * Preserves Unicode letters/digits (including CJK), folds full-width ASCII,
 * prefixes Windows reserved device names, and suffixes `index`/`log`.
 */
export function slugify(title) {
  const slug =
    String(title ?? "")
      .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .replace(/\u3000/g, " ")
      .toLowerCase()
      .normalize("NFC")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/[\s-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/[\uD800-\uDBFF]$/, "")
      .replace(/^-+|-+$/g, "") || "untitled";

  if (/^(?:con|prn|aux|nul|com(?:[1-9¹²³])|lpt(?:[1-9¹²³]))$/.test(slug)) {
    return `_${slug}`;
  }
  return slug === "index" || slug === "log" ? `${slug}-page` : slug;
}

/** Allocate the next sequential `SRC-YYYY-MM-DD-NNN` packet ID. */
export function nextSourceId(paths, date = new Date()) {
  const today = fmtDate(date);
  const prefix = `SRC-${today}-`;
  if (!existsSync(paths.rawSources)) return `${prefix}001`;

  let maxNum = 0;
  for (const entry of readdirSync(paths.rawSources)) {
    if (!entry.startsWith(prefix)) continue;
    const suffix = entry.slice(prefix.length);
    if (/^\d+$/.test(suffix)) {
      const n = Number.parseInt(suffix, 10);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
  }
  return `${prefix}${String(maxNum + 1).padStart(3, "0")}`;
}
