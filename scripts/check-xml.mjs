#!/usr/bin/env node
// Is the XML subedit writes actually XML?
//
// This is not a schema check and does not pretend to be one. TTML's normative schema is
// RelaxNG, published as a multi-file archive rather than a fetchable .xsd, and there is no
// public schema at all for TTXT or SAMI. What there is instead is xmllint, and the bug class
// it catches is the one that actually happens: an unescaped "&" or "<" in cue text, or a tag
// that is not closed, either of which makes the file unreadable by every XML parser in the
// world while subedit's own regex-based reader carries on unbothered.
//
// It matters most for TTXT, which has no independent reader at all (see scripts/oracles.mjs).
// Without this, nothing outside subedit ever looks at a TTXT file it produced.
//
// Run after `vitest run src/corpus/write-corpus.test.ts`.
// Usage: node scripts/check-xml.mjs

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WRITTEN = join(new URL("..", import.meta.url).pathname, ".cache/written");

// Files that must parse as XML, and what has to be in them. The structure assertions are
// deliberately shallow: enough that a file emptied of its cues, or written with the wrong root
// element, is caught, without encoding a whole schema in regular expressions.
const XML_FILES = [
  {
    file: "out.ttml",
    what: "TTML",
    requires: [
      [/<tt[\s>]/, "a <tt> root element"],
      [/xmlns\s*=\s*"http:\/\/www\.w3\.org\/ns\/ttml"/, "the TTML namespace on the root"],
      [/<body[\s>]/, "a <body>"],
      [/<p\b[^>]*\bbegin=/, "at least one <p> with a begin time"],
    ],
  },
  {
    file: "out.ttxt",
    what: "TTXT",
    requires: [
      [/<TextStream[\s>]/, "a <TextStream> root element"],
      [/<TextSample\b[^>]*sampleTime=/, "at least one <TextSample> with a sampleTime"],
    ],
  },
];

// SAMI is HTML-flavoured SGML with unclosed <P> and <SYNC> tags, so it is not XML and xmllint
// would reject a perfectly good file. Its escaping is checked by ffmpeg's reader instead.
const NOT_XML = ["out.smi"];

function main() {
  if (!existsSync(WRITTEN)) {
    console.error("No .cache/written: run `vitest run src/corpus/write-corpus.test.ts` first.");
    process.exit(1);
  }

  const failures = [];
  for (const { file, what, requires } of XML_FILES) {
    const path = join(WRITTEN, file);
    if (!existsSync(path)) {
      failures.push(`${what}: subedit wrote no ${file}`);
      continue;
    }

    try {
      execFileSync("xmllint", ["--noout", path], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      const detail = String(e.stderr ?? e.message ?? e).trim().split("\n")[0];
      failures.push(`${what}: not well-formed XML: ${detail}`);
      continue;
    }

    const text = readFileSync(path, "utf8");
    for (const [pattern, description] of requires) {
      if (!pattern.test(text)) failures.push(`${what}: parsed, but has no ${description}`);
    }
  }

  if (failures.length) {
    console.error("\nThe XML subedit wrote did not hold up:\n");
    for (const f of failures) console.error(`  ${f}`);
    console.error("");
    process.exit(1);
  }
  console.log(`${XML_FILES.length} XML formats are well-formed and structurally sound (${NOT_XML.join(", ")} is SGML, not checked here).`);
}

main();
