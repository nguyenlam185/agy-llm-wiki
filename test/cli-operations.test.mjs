import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "plugins", "llm-wiki", "scripts", "wiki.mjs");

function makeTempDir(prefix = "llm-wiki-cli-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function runCli(args, { cwd, input } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI_PATH, ...args], {
      cwd,
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

function runCliJson(args, opts = {}) {
  const res = runCli([...args, "--json"], opts);
  const parsed = JSON.parse(res.stdout);
  return { ...res, json: parsed };
}

async function runCliJsonAsync(args, { cwd } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI_PATH, ...args, "--json"], {
      cwd,
      encoding: "utf8",
    });
    return { code: 0, stdout, stderr, json: JSON.parse(stdout) };
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      json: JSON.parse(err.stdout || "{}"),
    };
  }
}

/** Build a tiny valid single-page PDF containing readable ASCII text for pdftotext. */
function buildMinimalPdfBuffer(text) {
  const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET\n`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}endstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += obj;
  }
  const xrefPos = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

test("CLI init: fresh initialization and idempotent re-run preserve pages", () => {
  const root = makeTempDir();
  try {
    const first = runCliJson(["init", "--root", root, "--topic", "AI Systems", "--mode", "company"]);
    assert.equal(first.code, 0);
    assert.equal(first.json.ok, true);
    assert.equal(first.json.created, true);
    assert.equal(first.json.knowledgeFormat, "okf-0.2");
    assert.equal(existsSync(join(root, ".llm-wiki", "WIKI_SCHEMA.md")), true);
    assert.equal(existsSync(join(root, ".llm-wiki", "templates", "pages", "concept.md")), true);

    const customPage = join(root, ".llm-wiki", "wiki", "concepts", "keep-me.md");
    writeFileSync(customPage, "---\ntype: concept\ntitle: Keep Me\n---\n\nPreserved.\n", "utf8");

    const second = runCliJson(["init", "--root", root, "--topic", "AI Systems v2", "--mode", "company"]);
    assert.equal(second.code, 0);
    assert.equal(second.json.created, false);
    assert.match(readFileSync(customPage, "utf8"), /Preserved\./);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI capture: text, stdin, files (html/json/xml/pdf/binary), URL, and path privacy", async () => {
  const root = makeTempDir();
  const fixtures = makeTempDir("llm-wiki-fixtures-");
  const server = http.createServer((req, res) => {
    if (req.url === "/article") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><head><title>Web Article</title></head><body><p>Hello <b>Wiki</b>.</p></body></html>");
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    assert.equal(runCliJson(["init", "--root", root, "--topic", "Capture Test"]).code, 0);

    // Missing input fails with non-zero JSON error
    const emptyCap = runCliJson(["capture", "--root", root]);
    assert.notEqual(emptyCap.code, 0);
    assert.equal(emptyCap.json.ok, false);

    // Text and stdin
    const txtCap = runCliJson(["capture", "--root", root, "--text", "Inline note", "--title", "Inline"]);
    assert.equal(txtCap.code, 0);
    assert.match(txtCap.json.sourceId, /^SRC-\d{4}-\d{2}-\d{2}-001$/);

    const stdinCap = runCliJson(["capture", "--root", root, "--stdin", "--title", "From Stdin"], {
      input: "Piped body content",
    });
    assert.equal(stdinCap.code, 0);
    assert.equal(readFileSync(stdinCap.json.extractedPath, "utf8"), "Piped body content");

    // HTML, JSON, XML local files
    const htmlFile = join(fixtures, "sample.html");
    writeFileSync(htmlFile, "<html><head><title>Doc</title></head><body><nav>Menu</nav><p>Real body</p></body></html>");
    const htmlCap = runCliJson(["capture", "--root", root, "--file", htmlFile]);
    assert.equal(htmlCap.code, 0);
    const htmlExtracted = readFileSync(htmlCap.json.extractedPath, "utf8");
    assert.match(htmlExtracted, /# Doc/);
    assert.doesNotMatch(htmlExtracted, /Menu/);

    const jsonFile = join(fixtures, "data.json");
    writeFileSync(jsonFile, JSON.stringify({ title: "API Spec", version: "2.0", items: ["a", "b"] }));
    const jsonCap = runCliJson(["capture", "--root", root, "--file", jsonFile]);
    assert.equal(jsonCap.code, 0);
    assert.match(readFileSync(jsonCap.json.extractedPath, "utf8"), /# API Spec/);

    const xmlFile = join(fixtures, "feed.xml");
    writeFileSync(xmlFile, "<doc><title>XML Note</title><p>Parsed XML text</p></doc>");
    const xmlCap = runCliJson(["capture", "--root", root, "--file", xmlFile]);
    assert.equal(xmlCap.code, 0);
    assert.match(readFileSync(xmlCap.json.extractedPath, "utf8"), /Parsed XML text/);

    // Local PDF extraction via pdftotext
    const pdfFile = join(fixtures, "sample.pdf");
    writeFileSync(pdfFile, buildMinimalPdfBuffer("Hello LLM Wiki PDF"));
    const pdfCap = runCliJson(["capture", "--root", root, "--file", pdfFile]);
    assert.equal(pdfCap.code, 0);
    assert.equal(pdfCap.json.extractionStatus, "success");
    assert.match(readFileSync(pdfCap.json.extractedPath, "utf8"), /Hello LLM Wiki PDF/);

    // Binary magic bytes guard (PNG header)
    const pngFile = join(fixtures, "image.png");
    writeFileSync(pngFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]));
    const pngCap = runCliJson(["capture", "--root", root, "--file", pngFile]);
    assert.equal(pngCap.code, 0);
    assert.equal(pngCap.json.extractionStatus, "unsupported");
    assert.equal(pngCap.json.extractor, "magicBytes");

    // Host-local file path MUST NOT leak into public logs
    const metaLog = readFileSync(join(root, ".llm-wiki", "meta", "log.md"), "utf8");
    const wikiLog = readFileSync(join(root, ".llm-wiki", "wiki", "log.md"), "utf8");
    assert.equal(metaLog.includes(fixtures), false);
    assert.equal(wikiLog.includes(fixtures), false);

    // URL capture & 404 failure cleanup (async so in-process HTTP server can reply)
    const urlCap = await runCliJsonAsync(["capture", "--root", root, "--url", `http://127.0.0.1:${port}/article`]);
    assert.equal(urlCap.code, 0);
    assert.match(readFileSync(urlCap.json.extractedPath, "utf8"), /Hello \*\*Wiki\*\*/);

    const badUrlCap = await runCliJsonAsync(["capture", "--root", root, "--url", `http://127.0.0.1:${port}/missing`]);
    assert.notEqual(badUrlCap.code, 0);
    assert.equal(badUrlCap.json.ok, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
    rmSync(fixtures, { recursive: true, force: true });
  }
});

test("CLI pending, ensure, search (CJK + whole-word + >50 links-first), lint --fix, status, and log", () => {
  const root = makeTempDir();
  try {
    assert.equal(runCliJson(["init", "--root", root, "--topic", "Knowledge Graph"]).code, 0);

    // Configure customType + add 3 sources
    const cfgPath = join(root, ".llm-wiki", "config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    cfg.customTypes = { decision: "decisions" };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf8");

    const s1 = runCliJson(["capture", "--root", root, "--text", "Source one", "--title", "One"]).json.sourceId;
    const s2 = runCliJson(["capture", "--root", root, "--text", "Source two", "--title", "Two"]).json.sourceId;

    // Mark s1 synthesized by editing status in wiki/sources/s1.md
    const s1Page = join(root, ".llm-wiki", "wiki", "sources", `${s1}.md`);
    writeFileSync(s1Page, readFileSync(s1Page, "utf8").replace("status: skeleton", "status: synthesized"), "utf8");
    assert.equal(runCliJson(["rebuild", "--root", root]).code, 0);

    const pend = runCliJson(["pending", "--root", root, "--batch", "5"]);
    assert.equal(pend.code, 0);
    assert.deepEqual(pend.json.pending.map((p) => p.id), [s2]);

    // ensure: reserved field protection, customType, idempotency
    const bodyWithFm = [
      "---",
      "type: hacked",
      "title: Hacked Title",
      "created: 1999-01-01",
      "domain: systems",
      "---",
      "",
      "Decision referencing [[concepts/missing-hub]] and [[concepts/another-missing]].",
    ].join("\n");
    const dec = runCliJson([
      "ensure",
      "--root",
      root,
      "--type",
      "decision",
      "--title",
      "Use Go",
      "--body",
      bodyWithFm,
    ]);
    assert.equal(dec.code, 0);
    assert.equal(dec.json.created, true);
    assert.equal(dec.json.id, "decisions/use-go");
    const decRaw = readFileSync(dec.json.path, "utf8");
    assert.match(decRaw, /type: decision/);
    assert.match(decRaw, /title: Use Go/);
    assert.match(decRaw, /domain: systems/);
    assert.doesNotMatch(decRaw, /1999-01-01/);

    const decAgain = runCliJson(["ensure", "--root", root, "--type", "decision", "--title", "Use Go"]);
    assert.equal(decAgain.code, 0);
    assert.equal(decAgain.json.created, false);

    // Search: whole-word vs substring & CJK matching
    runCliJson([
      "ensure",
      "--root",
      root,
      "--type",
      "concept",
      "--title",
      "History Notes",
      "--body",
      "A history lesson referencing [[concepts/missing-hub]].\n\n> ⚠️ **Contradiction:** A says X, B says Y.",
    ]);
    runCliJson([
      "ensure",
      "--root",
      root,
      "--type",
      "concept",
      "--title",
      "Go Language",
      "--body",
      "Golang concurrency and Go channels.",
    ]);
    runCliJson([
      "ensure",
      "--root",
      root,
      "--type",
      "concept",
      "--title",
      "知識グラフ",
      "--body",
      "日本語の知識グラフによる検索。",
    ]);

    const goSearch = runCliJson(["search", "--root", root, "to go"]);
    assert.equal(goSearch.code, 0);
    assert.equal(goSearch.json.results.some((r) => r.id === "concepts/history-notes"), false);
    assert.equal(
      goSearch.json.results.some((r) => r.id === "concepts/go-language" || r.id === "decisions/use-go"),
      true,
    );

    const cjkSearch = runCliJson(["search", "--root", root, "知識グラフ"]);
    assert.equal(cjkSearch.code, 0);
    assert.equal(cjkSearch.json.results[0].id, "concepts/知識グラフ");

    const filtered = runCliJson(["search", "--root", root, "go", "--type", "decision"]);
    assert.equal(filtered.code, 0);
    assert.deepEqual(filtered.json.results.map((r) => r.type), ["decision"]);

    // Lint --fix: missing-hub cited twice -> stub created; contradiction preserved
    const lintRes = runCliJson(["lint", "--root", root, "--fix"]);
    assert.equal(lintRes.code, 0);
    assert.equal(lintRes.json.contradictions, 1);
    assert.deepEqual(lintRes.json.createdStubs, ["concepts/missing-hub"]);
    assert.equal(existsSync(join(root, ".llm-wiki", "wiki", "concepts", "missing-hub.md")), true);
    assert.equal(existsSync(lintRes.json.reportPath), true);
    assert.equal(existsSync(join(root, ".llm-wiki", ".discoveries", "gaps.json")), true);

    // Log guard rejects reserved field override
    const badLog = runCliJson([
      "log",
      "--root",
      root,
      "--kind",
      "query",
      "--details",
      '{"kind":"override","timestamp":"bad"}',
    ]);
    assert.notEqual(badLog.code, 0);
    assert.equal(badLog.json.ok, false);

    const goodLog = runCliJson(["log", "--root", root, "--kind", "query", "--details", '{"q":"go"}']);
    assert.equal(goodLog.code, 0);

    // Status reflects updated stats
    const st = runCliJson(["status", "--root", root]);
    assert.equal(st.code, 0);
    assert.equal(st.json.knowledgeFormat, "okf-0.2");
    assert.equal(st.json.pendingSources, 1);
    assert.equal(st.json.totalPages >= 6, true);

    // >50 pages triggers links-first mode automatically
    for (let i = 0; i < 50; i++) {
      const p = join(root, ".llm-wiki", "wiki", "concepts", `filler-${i}.md`);
      writeFileSync(p, `---\ntype: concept\ntitle: Filler ${i}\n---\n\nFiller page ${i}.\n`, "utf8");
    }
    assert.equal(runCliJson(["rebuild", "--root", root]).code, 0);
    const largeSearch = runCliJson(["search", "--root", root, "Go"]);
    assert.equal(largeSearch.code, 0);
    assert.equal(largeSearch.json.linksOnly, true);
    assert.equal("snippet" in largeSearch.json.results[0], true);
    assert.equal("preview" in largeSearch.json.results[0], false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
