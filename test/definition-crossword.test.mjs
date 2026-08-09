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
const generationTestOptions = Object.freeze({
  minVotes: 5,
  types: Object.freeze(["gismu", "lujvo"]),
  gridSize: 15,
  targetWords: 17,
  minimumWords: 9,
  attempts: 16,
  minimumCandidatesPerLength: 24,
  fillNodeLimit: 80_000,
});

test("definition crosswords are deterministic for a seed and option set", () => {
  const first = generateDefinitionCrossword(
    dictionary.entries,
    "definition-determinism",
    generationTestOptions,
  );
  const second = generateDefinitionCrossword(
    dictionary.entries,
    "definition-determinism",
    generationTestOptions,
  );
  assert.deepEqual(second, first);
});

test("definition crossword generation obeys its wall-clock budget", () => {
  assert.throws(
    () => generateDefinitionCrossword(
      dictionary.entries,
      "immediate-timeout",
      {
        ...generationTestOptions,
        generationTimeLimitMilliseconds: 0,
      },
    ),
    {
      name: "DefinitionGenerationTimeoutError",
      message: /0 ms time limit/,
    },
  );
});

test("definition crosswords are symmetric, dense, separated, and dictionary-backed", () => {
  const dictionaryByWord = new Map(dictionary.entries.map((entry) => [entry.word, entry]));
  for (let index = 0; index < 40; index += 1) {
    const puzzle = generateDefinitionCrossword(
      dictionary.entries,
      `definition-sample-${index}`,
      generationTestOptions,
    );
    assert.equal(validateDefinitionPuzzle(puzzle), true);
    assert.ok(
      puzzle.entries.length >= generationTestOptions.minimumWords
      && puzzle.entries.length <= generationTestOptions.targetWords,
    );
    assert.equal(puzzle.entries.length % 2, 1);
    assert.ok(puzzle.width <= 15 && puzzle.height <= 15);
    const cellByKey = new Map(puzzle.cells.map((cell) => [cell.key, cell]));

    for (const entry of puzzle.entries) {
      const crossingCount = entry.cellKeys.filter(
        (key) => cellByKey.get(key).entryIds.length === 2,
      ).length;
      assert.ok(
        crossingCount >= 2,
        `${entry.answer} should have at least two crossings`,
      );
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
    {
      seed: "only-gismu-capability-0",
      minVotes: 5,
      types: ["gismu"],
      minimumCandidatesPerLength: 24,
    },
    {
      seed: "only-lujvo-capability-0",
      minVotes: 0,
      types: ["lujvo"],
      minimumCandidatesPerLength: 500,
    },
    {
      seed: "only-cmevla-capability-3",
      minVotes: 0,
      types: ["cmevla"],
      minimumCandidatesPerLength: 24,
    },
    {
      seed: "only-fuivla-capability-8",
      minVotes: 0,
      types: ["fuivla"],
      minimumCandidatesPerLength: 500,
    },
  ];
  for (const configuration of configurations) {
    const puzzle = generateDefinitionCrossword(
      dictionary.entries,
      configuration.seed,
      {
        ...configuration,
        gridSize: 15,
        targetWords: 9,
        minimumWords: 9,
        attempts: 16,
        fillNodeLimit: 80_000,
      },
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
