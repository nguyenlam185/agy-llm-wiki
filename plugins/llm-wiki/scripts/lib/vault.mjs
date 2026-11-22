import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { parseKnowledgeDocument, parseMarkdownFrontmatter } from "./frontmatter.mjs";
import { compareCodePoint, relativePhysicalPath } from "./paths.mjs";

const RESERVED_NAMES = new Set(["index", "log"]);

function diag(severity, code, path, message) {
  return { severity, code, path, message };
}

function isReservedName(filename) {
  const lower = filename.toLowerCase();
  return lower === "index.md" || lower === "log.md";
}

export function readVaultConfig(paths) {
  const configPath = join(paths.dotWiki, "config.json");
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("config.json must contain an object");
    }
    return { ok: true, config: parsed };
  } catch (error) {
    return {
      ok: false,
      diagnostic: diag(
        "error",
        "config_invalid_knowledge_format",
        "config.json",
        `Cannot read valid wiki config: ${error.message}`,
      ),
    };
  }
}

export function inspectVaultFormat(paths) {
  const diagnostics = [];
  let blocking = false;

  const configResult = readVaultConfig(paths);
  if (!configResult.ok) {
    return {
      knowledgeFormat: "legacy",
      diagnostics: [configResult.diagnostic],
      blocking: true,
    };
  }

  const rawFormat = configResult.config.knowledge_format;
  let format;
  if (rawFormat === undefined) {
    format = "legacy";
  } else if (rawFormat === "legacy" || rawFormat === "okf-0.2") {
    format = rawFormat;
  } else {
    return {
      knowledgeFormat: "legacy",
      diagnostics: [
        diag(
          "error",
          "config_invalid_knowledge_format",
          "config.json",
          `Invalid knowledge_format value: ${JSON.stringify(rawFormat)}`,
        ),
      ],
      blocking: true,
    };
  }

  const rootIndexPath = join(paths.wiki, "index.md");
  if (format === "okf-0.2") {
    let rootContent;
    try {
      rootContent = readFileSync(rootIndexPath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") {
        diagnostics.push(
          diag("error", "okf_version_mismatch", "wiki/index.md", `Cannot read OKF root index: ${error.message}`),
        );
        blocking = true;
      }
    }
    if (rootContent !== undefined) {
      const fm = parseMarkdownFrontmatter(rootContent, "index.md");
      if (!fm.ok || fm.mapping.okf_version !== "0.2") {
        diagnostics.push(
          diag(
            "error",
            "okf_version_mismatch",
            "wiki/index.md",
            fm.ok
              ? 'OKF root index must declare okf_version "0.2"'
              : `Malformed OKF root index: ${fm.diagnostics[0].message}`,
          ),
        );
        blocking = true;
      }
    }
  } else {
    try {
      const rootContent = readFileSync(rootIndexPath, "utf8");
      const fm = parseMarkdownFrontmatter(rootContent, "index.md");
      if (fm.ok && fm.mapping.okf_version !== undefined && fm.mapping.okf_version !== "0.2") {
        diagnostics.push(
          diag(
            "error",
            "okf_version_mismatch",
            "wiki/index.md",
            `Root index declares unsupported okf_version "${fm.mapping.okf_version}"`,
          ),
        );
        blocking = true;
      }
    } catch {
      // Missing root index in legacy mode is acceptable.
    }
  }

  return { knowledgeFormat: format, diagnostics, blocking };
}

export function inspectWritableVault(paths) {
  if (!existsSync(paths.dotWiki)) {
    return {
      ok: false,
      diagnostics: [
        diag(
          "error",
          "config_invalid_knowledge_format",
          paths.dotWiki,
          "No workspace wiki vault found. Run `init` first.",
        ),
      ],
    };
  }
  const state = inspectVaultFormat(paths);
  if (state.blocking) return { ok: false, diagnostics: state.diagnostics };
  return { ok: true, format: state.knowledgeFormat };
}

export function isGeneratedOkfPath(filePath, paths) {
  const state = inspectVaultFormat(paths);
  if (state.blocking || state.knowledgeFormat !== "okf-0.2") return false;
  const rel = relativePhysicalPath(paths.wiki, filePath);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
  const parts = rel.split(sep);
  const name = parts.at(-1)?.toLowerCase();
  return name === "index.md" || (parts.length === 1 && name === "log.md");
}

function collectMarkdownFiles(dir, wikiRoot) {
  const files = [];
  const diagnostics = [];
  if (!existsSync(dir)) return { files, diagnostics };

  let entries;
  try {
    entries = readdirSync(dir).sort(compareCodePoint);
  } catch (error) {
    diagnostics.push(
      diag(
        "error",
        "frontmatter_parse_error",
        relative(wikiRoot, dir).replace(/\\/g, "/") || ".",
        `Failed to scan knowledge directory: ${error.message}`,
      ),
    );
    return { files, diagnostics };
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    try {
      const st = lstatSync(fullPath);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        const child = collectMarkdownFiles(fullPath, wikiRoot);
        files.push(...child.files);
        diagnostics.push(...child.diagnostics);
      } else if (st.isFile() && entry.toLowerCase().endsWith(".md") && !isReservedName(entry)) {
        files.push(fullPath);
      }
    } catch (error) {
      diagnostics.push(
        diag(
          "error",
          "frontmatter_parse_error",
          relative(wikiRoot, fullPath).replace(/\\/g, "/"),
          `Failed to inspect knowledge path: ${error.message}`,
        ),
      );
    }
  }
  return { files, diagnostics };
}

export function discoverKnowledgeDocuments(paths) {
  const diagnostics = [];
  const documents = [];
  let blocking = false;
  const seenIds = new Map();

  const scan = collectMarkdownFiles(paths.wiki, paths.wiki);
  diagnostics.push(...scan.diagnostics);
  if (scan.diagnostics.length > 0) blocking = true;

  for (const file of scan.files) {
    const physicalPath = relative(paths.wiki, file).replace(/\\/g, "/");
    const normalizedPath = physicalPath.normalize("NFC");
    const id = normalizedPath.replace(/\.md$/, "");

    const filename = (normalizedPath.split("/").pop() ?? "").replace(/\.md$/i, "").toLowerCase();
    if (RESERVED_NAMES.has(filename)) continue;

    const collisionKey = id.toLowerCase();
    const existing = seenIds.get(collisionKey);
    if (existing && existing.physicalPath !== physicalPath) {
      diagnostics.push(
        diag(
          "error",
          "concept_identity_collision",
          physicalPath,
          `Identity collision between ${existing.physicalPath} and ${physicalPath}`,
        ),
      );
      blocking = true;
      continue;
    }
    seenIds.set(collisionKey, { id, physicalPath });

    try {
      const content = readFileSync(file, "utf8");
      const result = parseKnowledgeDocument(content, normalizedPath);
      if (!result.ok) {
        diagnostics.push(...result.diagnostics);
        blocking = true;
        continue;
      }
      if (result.diagnostics.length > 0) diagnostics.push(...result.diagnostics);
      documents.push({
        ...result.document,
        id,
        path: normalizedPath,
        absolutePath: file,
      });
    } catch (error) {
      diagnostics.push(
        diag("error", "frontmatter_parse_error", normalizedPath, `Failed to read file: ${error.message}`),
      );
      blocking = true;
    }
  }

  documents.sort((a, b) => compareCodePoint(a.id, b.id));
  return { documents, diagnostics, blocking };
}
