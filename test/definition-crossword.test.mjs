import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  generateDefinitionCrossword,
  validateDefinitionPuzzle,
} from "../definition-crossword.js";

const dictionary = JSON.parse(
  await readFile(new URL("../data/definitions.json", import.meta.url), "utf8"),
);

test("definition crosswords are deterministic for a seed and option set", () => {
  const options = { minVotes: 5, types: ["gismu", "lujvo"] };
  const first = generateDefinitionCrossword(dictionary.entries, "definition-determinism", options);
  const second = generateDefinitionCrossword(dictionary.entries, "definition-determinism", options);
  assert.deepEqual(second, first);
});

test("definition crosswords are symmetric, separated, and dictionary-backed", () => {
  const dictionaryByWord = new Map(dictionary.entries.map((entry) => [entry.word, entry]));
  for (let index = 0; index < 40; index += 1) {
    const puzzle = generateDefinitionCrossword(dictionary.entries, `definition-sample-${index}`);
    assert.equal(validateDefinitionPuzzle(puzzle), true);
    assert.ok(puzzle.entries.length >= 9 && puzzle.entries.length <= 17);
    assert.equal(puzzle.entries.length % 2, 1);
    assert.ok(puzzle.width <= 15 && puzzle.height <= 15);

    for (const entry of puzzle.entries) {
      const dictionaryEntry = dictionaryByWord.get(entry.answer);
      assert.ok(dictionaryEntry);
      assert.equal(entry.clue, dictionaryEntry.definition);
      assert.ok(dictionaryEntry.score >= 5);
      assert.ok(["gismu", "lujvo"].includes(dictionaryEntry.type));
    }
  }
});

test("each word-type-only configuration can generate when its pool is large enough", () => {
  const configurations = [
    { seed: "only-gismu", minVotes: 5, types: ["gismu"] },
    { seed: "only-lujvo", minVotes: 5, types: ["lujvo"] },
    { seed: "only-cmevla", minVotes: 0, types: ["cmevla"] },
    { seed: "only-fuivla", minVotes: 0, types: ["fuivla"] },
  ];
  for (const configuration of configurations) {
    const puzzle = generateDefinitionCrossword(
      dictionary.entries,
      configuration.seed,
      configuration,
    );
    assert.ok(puzzle.entries.length >= 9);
    assert.ok(puzzle.entries.every((entry) => entry.type === configuration.types[0]));
  }
});

test("a filter with too few eligible words fails clearly", () => {
  assert.throws(
    () => generateDefinitionCrossword(dictionary.entries, "sparse", {
      minVotes: 5,
      types: ["cmevla"],
    }),
    /Only 1 words meet these filters/,
  );
});
