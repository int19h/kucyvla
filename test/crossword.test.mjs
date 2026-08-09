import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { generateCrossword, validatePuzzle } from "../crossword.js";

const dictionary = JSON.parse(
  await readFile(new URL("../data/rafsi.json", import.meta.url), "utf8"),
);

test("the same seed produces exactly the same crossword", () => {
  const first = generateCrossword(dictionary.entries, "determinism-check");
  const second = generateCrossword(dictionary.entries, "determinism-check");
  assert.deepEqual(second, first);
});

test("different seeds produce different crosswords", () => {
  const first = generateCrossword(dictionary.entries, "one-seed");
  const second = generateCrossword(dictionary.entries, "another-seed");
  assert.notEqual(second.signature, first.signature);
});

test("generated crosswords satisfy layout and dictionary invariants", () => {
  const rafsiByWord = new Map(
    dictionary.entries.map((entry) => [entry.word, new Set(entry.rafsi)]),
  );

  for (let index = 0; index < 60; index += 1) {
    const puzzle = generateCrossword(dictionary.entries, `sample-${index}`);
    assert.equal(validatePuzzle(puzzle), true);
    assert.ok(puzzle.entries.length >= 14);
    assert.ok(puzzle.width <= 15);
    assert.ok(puzzle.height <= 15);
    const cmavoCount = puzzle.entries.filter((entry) => entry.type === "cmavo").length;
    assert.ok(cmavoCount >= 3);
    assert.ok(cmavoCount <= 6);

    for (const entry of puzzle.entries) {
      assert.ok(rafsiByWord.get(entry.answer)?.has(entry.clue));
      assert.notEqual(entry.answer, entry.clue);
    }
  }
});

test("apostrophes can be used as ordinary crossing letters", () => {
  const dictionaryEntries = [
    { word: "ab'cd", type: "gismu", rafsi: ["abc"] },
    { word: "ef'gh", type: "gismu", rafsi: ["efg"] },
  ];
  const puzzle = generateCrossword(dictionaryEntries, "apostrophe-crossing", {
    targetWords: 2,
    minimumWords: 2,
    minimumCmavo: 0,
    maximumCmavo: 0,
    maximumDimension: 7,
    attempts: 2,
    gismuCandidates: 2,
  });
  const crossing = puzzle.cells.find(
    (cell) => cell.solution === "'" && cell.entryIds.length === 2,
  );
  assert.ok(crossing, "the two answers should cross on their apostrophe");
});
