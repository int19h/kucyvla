import { DEFINITION_TYPE_ORDER } from "./definition-crossword.js";

export const DEFINITION_STORAGE_KEY = "lojban-definition-crossword:progress:v1";
const STORAGE_VERSION = 1;
const LETTER_PATTERN = /^[a-z']$/;

function normalizeTypes(types) {
  return DEFINITION_TYPE_ORDER.filter((type) => types?.includes(type));
}

function normalizeValues(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => LETTER_PATTERN.test(value)),
  );
}

function normalizeState(value) {
  const types = normalizeTypes(value?.types);
  const values = normalizeValues(value?.values);
  if (
    !value
    || typeof value.seed !== "string"
    || typeof value.signature !== "string"
    || !Number.isInteger(value.minVotes)
    || value.minVotes < 0
    || types.length === 0
    || Object.keys(values).length === 0
  ) {
    return null;
  }
  return {
    seed: value.seed,
    minVotes: value.minVotes,
    types,
    signature: value.signature,
    values,
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
  };
}

export function definitionConfigurationKey({ seed, minVotes, types }) {
  return JSON.stringify([seed, minVotes, normalizeTypes(types)]);
}

export function readDefinitionProgress(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(DEFINITION_STORAGE_KEY) ?? "null");
    if (!parsed || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.puzzles)) {
      return [];
    }
    return parsed.puzzles
      .map(normalizeState)
      .filter(Boolean)
      .sort((left, right) => {
        const timeDifference = right.updatedAt - left.updatedAt;
        if (timeDifference !== 0) {
          return timeDifference;
        }
        const leftKey = definitionConfigurationKey(left);
        const rightKey = definitionConfigurationKey(right);
        return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
      });
  } catch {
    return [];
  }
}

export function writeDefinitionProgress(
  storage,
  { seed, minVotes, types, signature, values, updatedAt = Date.now() },
) {
  const configuration = { seed, minVotes, types: normalizeTypes(types) };
  const key = definitionConfigurationKey(configuration);
  const cleanedValues = normalizeValues(values);
  const puzzles = readDefinitionProgress(storage).filter(
    (puzzle) => definitionConfigurationKey(puzzle) !== key,
  );
  if (Object.keys(cleanedValues).length > 0) {
    puzzles.push({
      ...configuration,
      signature,
      values: cleanedValues,
      updatedAt,
    });
  }
  puzzles.sort((left, right) => right.updatedAt - left.updatedAt);

  try {
    storage.setItem(DEFINITION_STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      puzzles,
    }));
    return true;
  } catch {
    return false;
  }
}

export function removeDefinitionProgress(storage, configuration) {
  return writeDefinitionProgress(storage, {
    ...configuration,
    signature: "",
    values: {},
  });
}
