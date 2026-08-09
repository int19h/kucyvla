export const STORAGE_KEY = "selrafsi:puzzle-progress:v1";
const STORAGE_VERSION = 1;
const LETTER_PATTERN = /^[a-z']$/;

function normalizedValues(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => LETTER_PATTERN.test(value)),
  );
}

function normalizedPuzzle(value) {
  if (
    !value
    || typeof value.seed !== "string"
    || typeof value.signature !== "string"
  ) {
    return null;
  }
  const values = normalizedValues(value.values);
  if (Object.keys(values).length === 0) {
    return null;
  }
  return {
    seed: value.seed,
    signature: value.signature,
    values,
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
  };
}

export function readSavedPuzzles(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    if (!parsed || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.puzzles)) {
      return [];
    }
    return parsed.puzzles
      .map(normalizedPuzzle)
      .filter(Boolean)
      .sort((left, right) => (
        right.updatedAt - left.updatedAt
        || (left.seed < right.seed ? -1 : left.seed > right.seed ? 1 : 0)
      ));
  } catch {
    return [];
  }
}

export function writePuzzleProgress(
  storage,
  { seed, signature, values, updatedAt = Date.now() },
) {
  const cleanedValues = normalizedValues(values);
  const puzzles = readSavedPuzzles(storage).filter((puzzle) => puzzle.seed !== seed);
  if (Object.keys(cleanedValues).length > 0) {
    puzzles.push({ seed, signature, values: cleanedValues, updatedAt });
  }
  puzzles.sort((left, right) => right.updatedAt - left.updatedAt);

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      puzzles,
    }));
    return true;
  } catch {
    return false;
  }
}

export function removePuzzleProgress(storage, seed) {
  return writePuzzleProgress(storage, {
    seed,
    signature: "",
    values: {},
  });
}
