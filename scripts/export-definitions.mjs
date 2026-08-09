#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const defaultSource = new URL(
  "../../jbotci/crates/jbotci-dictionary-data/data/dictionary-en.json",
  import.meta.url,
);
const defaultDestination = new URL("../data/definitions.json", import.meta.url);
const sourcePath = process.argv[2] ?? fileURLToPath(defaultSource);
const destinationPath = process.argv[3] ?? fileURLToPath(defaultDestination);
const answerPattern = /^[a-z']+$/;
const exportedType = new Map([
  ["gismu", "gismu"],
  ["experimental gismu", "gismu"],
  ["lujvo", "lujvo"],
  ["cmevla", "cmevla"],
  ["fu'ivla", "fuivla"],
]);

function normalizeAnswer(word) {
  const withoutBoundaryPeriods = word.replace(/^\.+|\.+$/g, "");
  if (withoutBoundaryPeriods.includes(".")) {
    return null;
  }
  const normalized = withoutBoundaryPeriods.toLowerCase().replaceAll(",", "");
  return answerPattern.test(normalized) ? normalized : null;
}

const sourceBytes = await readFile(sourcePath);
const source = JSON.parse(sourceBytes.toString("utf8"));
if (!Array.isArray(source)) {
  throw new TypeError("The Lensisku snapshot must be a JSON array.");
}

const entries = [];
const byAnswer = new Map();
let excludedNonWord = 0;
let deduplicated = 0;
for (const sourceEntry of source) {
  const type = exportedType.get(sourceEntry.word_type);
  if (!type) {
    continue;
  }
  const word = normalizeAnswer(sourceEntry.word);
  if (!word) {
    excludedNonWord += 1;
    continue;
  }
  if (!sourceEntry.definition || !Number.isFinite(sourceEntry.score)) {
    throw new Error(`Dictionary entry ${sourceEntry.word} lacks a definition or vote score.`);
  }
  const entry = {
    word,
    type,
    sourceType: sourceEntry.word_type,
    score: sourceEntry.score,
    definition: sourceEntry.definition,
  };
  const existing = byAnswer.get(word);
  if (existing) {
    if (entry.score > existing.entry.score) {
      entries[existing.index] = entry;
      byAnswer.set(word, {
        sourceWord: sourceEntry.word,
        entry,
        index: existing.index,
      });
      deduplicated += 1;
      continue;
    }
    if (entry.score < existing.entry.score || (
      existing.entry.type === type
      && existing.entry.definition === sourceEntry.definition
    )) {
      deduplicated += 1;
      continue;
    }
    throw new Error(`Equally ranked entries disagree after normalizing ${word}.`);
  }
  byAnswer.set(word, { sourceWord: sourceEntry.word, entry, index: entries.length });
  entries.push(entry);
}
entries.sort((left, right) => left.word < right.word ? -1 : left.word > right.word ? 1 : 0);

const counts = Object.fromEntries(
  ["gismu", "lujvo", "cmevla", "fuivla"].map((type) => [
    type,
    entries.filter((entry) => entry.type === type).length,
  ]),
);
const output = {
  formatVersion: 1,
  source: {
    project: "jbotci",
    file: "crates/jbotci-dictionary-data/data/dictionary-en.json",
    sha256: createHash("sha256").update(sourceBytes).digest("hex"),
  },
  normalization: {
    apostropheIsLetter: true,
    commasRemoved: true,
    boundaryPeriodsRemoved: true,
    embeddedPeriodsExcluded: true,
    caseFolded: true,
  },
  counts: {
    entries: entries.length,
    ...counts,
    excludedNonWord,
    deduplicated,
  },
  entries,
};

await writeFile(destinationPath, `${JSON.stringify(output)}\n`, "utf8");
process.stdout.write(
  `Exported ${entries.length} definition clues to ${destinationPath} (${excludedNonWord} non-words excluded)\n`,
);
