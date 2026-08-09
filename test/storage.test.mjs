import assert from "node:assert/strict";
import test from "node:test";

import {
  readSavedPuzzles,
  removePuzzleProgress,
  STORAGE_KEY,
  writePuzzleProgress,
} from "../storage.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

test("progress is retained independently for every seed", () => {
  const storage = new MemoryStorage();
  assert.equal(writePuzzleProgress(storage, {
    seed: "alpha",
    signature: "aaaa",
    values: { "1,1": "'" },
    updatedAt: 10,
  }), true);
  assert.equal(writePuzzleProgress(storage, {
    seed: "beta",
    signature: "bbbb",
    values: { "2,2": "c", "2,3": "u" },
    updatedAt: 20,
  }), true);

  assert.deepEqual(readSavedPuzzles(storage), [
    {
      seed: "beta",
      signature: "bbbb",
      values: { "2,2": "c", "2,3": "u" },
      updatedAt: 20,
    },
    {
      seed: "alpha",
      signature: "aaaa",
      values: { "1,1": "'" },
      updatedAt: 10,
    },
  ]);
});

test("empty progress removes a seed from storage", () => {
  const storage = new MemoryStorage();
  writePuzzleProgress(storage, {
    seed: "alpha",
    signature: "aaaa",
    values: { "1,1": "b" },
  });
  assert.equal(removePuzzleProgress(storage, "alpha"), true);
  assert.deepEqual(readSavedPuzzles(storage), []);
});

test("invalid stored data is ignored", () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, "not json");
  assert.deepEqual(readSavedPuzzles(storage), []);

  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 999, puzzles: [] }));
  assert.deepEqual(readSavedPuzzles(storage), []);
});
