import assert from "node:assert/strict";
import test from "node:test";

import {
  definitionConfigurationKey,
  readDefinitionProgress,
  removeDefinitionProgress,
  writeDefinitionProgress,
} from "../definition-storage.js";

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

test("definition progress is independent for filter configurations sharing a seed", () => {
  const storage = new MemoryStorage();
  writeDefinitionProgress(storage, {
    seed: "same",
    minVotes: 5,
    types: ["gismu", "lujvo"],
    signature: "first",
    values: { "1,1": "b" },
    updatedAt: 10,
  });
  writeDefinitionProgress(storage, {
    seed: "same",
    minVotes: 0,
    types: ["cmevla"],
    signature: "second",
    values: { "2,2": "'" },
    updatedAt: 20,
  });

  const saved = readDefinitionProgress(storage);
  assert.equal(saved.length, 2);
  assert.notEqual(
    definitionConfigurationKey(saved[0]),
    definitionConfigurationKey(saved[1]),
  );
  assert.deepEqual(saved[0].values, { "2,2": "'" });
});

test("removing one definition configuration preserves the others", () => {
  const storage = new MemoryStorage();
  const first = { seed: "same", minVotes: 5, types: ["gismu"] };
  const second = { seed: "same", minVotes: 5, types: ["lujvo"] };
  writeDefinitionProgress(storage, {
    ...first,
    signature: "first",
    values: { "1,1": "a" },
  });
  writeDefinitionProgress(storage, {
    ...second,
    signature: "second",
    values: { "2,2": "b" },
  });
  removeDefinitionProgress(storage, first);
  const saved = readDefinitionProgress(storage);
  assert.equal(saved.length, 1);
  assert.equal(definitionConfigurationKey(saved[0]), definitionConfigurationKey(second));
});
