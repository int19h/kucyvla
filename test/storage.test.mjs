import assert from "node:assert/strict";
import test from "node:test";

import {
  rafsiConfigurationKey,
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
    types: ["gismu"],
    signature: "aaaa",
    values: { "1,1": "'" },
    updatedAt: 10,
  }), true);
  assert.equal(writePuzzleProgress(storage, {
    seed: "beta",
    types: ["gismu", "cmavo"],
    signature: "bbbb",
    values: { "2,2": "c", "2,3": "u" },
    updatedAt: 20,
  }), true);

  assert.deepEqual(readSavedPuzzles(storage), [
    {
      seed: "beta",
      types: ["gismu", "cmavo"],
      signature: "bbbb",
      values: { "2,2": "c", "2,3": "u" },
      updatedAt: 20,
    },
    {
      seed: "alpha",
      types: ["gismu"],
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
    types: ["gismu"],
    signature: "aaaa",
    values: { "1,1": "b" },
  });
  assert.equal(removePuzzleProgress(storage, {
    seed: "alpha",
    types: ["gismu"],
  }), true);
  assert.deepEqual(readSavedPuzzles(storage), []);
});

test("rafsi progress is independent for type configurations sharing a seed", () => {
  const storage = new MemoryStorage();
  const gismu = { seed: "same", types: ["gismu"] };
  const cmavo = { seed: "same", types: ["cmavo"] };
  writePuzzleProgress(storage, {
    ...gismu,
    signature: "first",
    values: { "1,1": "g" },
    updatedAt: 10,
  });
  writePuzzleProgress(storage, {
    ...cmavo,
    signature: "second",
    values: { "2,2": "c" },
    updatedAt: 20,
  });

  const saved = readSavedPuzzles(storage);
  assert.equal(saved.length, 2);
  assert.notEqual(rafsiConfigurationKey(saved[0]), rafsiConfigurationKey(saved[1]));
  removePuzzleProgress(storage, gismu);
  assert.deepEqual(readSavedPuzzles(storage).map((state) => state.types), [["cmavo"]]);
});

test("legacy rafsi progress retains its original gismu and cmavo configuration", () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({
    version: 1,
    puzzles: [{
      seed: "old",
      signature: "legacy",
      values: { "1,1": "a" },
      updatedAt: 10,
    }],
  }));
  assert.deepEqual(readSavedPuzzles(storage)[0].types, ["gismu", "cmavo"]);
});

test("invalid stored data is ignored", () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, "not json");
  assert.deepEqual(readSavedPuzzles(storage), []);

  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 999, puzzles: [] }));
  assert.deepEqual(readSavedPuzzles(storage), []);
});
