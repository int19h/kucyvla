#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const defaultSource = new URL(
  "../../jbotci/crates/jbotci-dictionary-data/data/dictionary-en.json",
  import.meta.url,
);
const defaultDestination = new URL("../data/rafsi.json", import.meta.url);
const sourcePath = process.argv[2] ?? fileURLToPath(defaultSource);
const destinationPath = process.argv[3] ?? fileURLToPath(defaultDestination);
const wordPattern = /^[a-z']+$/;

function splitRafsi(field) {
  if (field === null || field === undefined) {
    return [];
  }
  const values = Array.isArray(field) ? field : [field];
  return values.flatMap((value) => String(value).trim().split(/\s+/).filter(Boolean));
}

const sourceBytes = await readFile(sourcePath);
const source = JSON.parse(sourceBytes.toString("utf8"));
if (!Array.isArray(source)) {
  throw new TypeError("The Lensisku snapshot must be a JSON array.");
}

const entries = source
  .filter((entry) => entry.word_type === "gismu" || entry.word_type === "cmavo")
  .map((entry) => ({
    word: entry.word,
    type: entry.word_type,
    rafsi: [...new Set(splitRafsi(entry.rafsi))]
      .filter((rafsi) => rafsi !== entry.word)
      .sort(),
  }))
  .filter((entry) => entry.rafsi.length > 0)
  .sort((left, right) => left.word < right.word ? -1 : left.word > right.word ? 1 : 0);

const words = new Set();
const claimantByRafsi = new Map();
for (const entry of entries) {
  if (!wordPattern.test(entry.word)) {
    throw new Error(`Unexpected characters in dictionary word: ${entry.word}`);
  }
  if (words.has(entry.word)) {
    throw new Error(`Duplicate dictionary word: ${entry.word}`);
  }
  words.add(entry.word);

  for (const rafsi of entry.rafsi) {
    if (!wordPattern.test(rafsi)) {
      throw new Error(`Unexpected characters in rafsi: ${rafsi}`);
    }
    const claimant = claimantByRafsi.get(rafsi);
    if (claimant && claimant !== entry.word) {
      throw new Error(`Ambiguous rafsi ${rafsi}: ${claimant} and ${entry.word}`);
    }
    claimantByRafsi.set(rafsi, entry.word);
  }
}

const gismuCount = entries.filter((entry) => entry.type === "gismu").length;
const cmavoCount = entries.filter((entry) => entry.type === "cmavo").length;
const output = {
  formatVersion: 1,
  source: {
    project: "jbotci",
    file: "crates/jbotci-dictionary-data/data/dictionary-en.json",
    sha256: createHash("sha256").update(sourceBytes).digest("hex"),
  },
  selection: {
    wordTypes: ["gismu", "cmavo"],
    assignedRafsiOnly: true,
    selfIdenticalRafsiExcluded: true,
  },
  counts: {
    entries: entries.length,
    gismu: gismuCount,
    cmavo: cmavoCount,
    rafsi: entries.reduce((total, entry) => total + entry.rafsi.length, 0),
  },
  entries,
};

await writeFile(destinationPath, `${JSON.stringify(output)}\n`, "utf8");
process.stdout.write(
  `Exported ${entries.length} words (${gismuCount} gismu, ${cmavoCount} cmavo) to ${destinationPath}\n`,
);
