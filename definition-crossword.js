import { createSeededRandom } from "./crossword.js";

export const DEFINITION_GENERATOR_VERSION = 1;
export const DEFINITION_TYPE_ORDER = Object.freeze([
  "gismu",
  "lujvo",
  "cmevla",
  "fuivla",
]);
export const DEFAULT_DEFINITION_OPTIONS = Object.freeze({
  minVotes: 5,
  types: Object.freeze(["gismu", "lujvo"]),
  gridSize: 15,
  targetWords: 17,
  minimumWords: 9,
  attempts: 16,
  minimumLength: 3,
  maximumLength: 15,
  minimumCandidatesPerLength: 24,
  fillNodeLimit: 80_000,
});

const DIRECTIONS = Object.freeze({
  across: Object.freeze({ dx: 1, dy: 0 }),
  down: Object.freeze({ dx: 0, dy: 1 }),
});
const ANSWER_PATTERN = /^[a-z']+$/;

function coordinateKey(column, row) {
  return `${column},${row}`;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizedOptions(overrides) {
  const options = { ...DEFAULT_DEFINITION_OPTIONS, ...overrides };
  const types = DEFINITION_TYPE_ORDER.filter((type) => options.types?.includes(type));
  if (types.length === 0) {
    throw new Error("Select at least one word type.");
  }
  const minVotes = Number(options.minVotes);
  if (!Number.isInteger(minVotes) || minVotes < 0) {
    throw new Error("Minimum votes must be a non-negative integer.");
  }
  if (options.gridSize % 2 !== 1 || options.gridSize < 7) {
    throw new Error("The symmetric grid size must be an odd number of at least seven.");
  }
  if (options.targetWords % 2 !== 1 || options.minimumWords % 2 !== 1) {
    throw new Error("Symmetric interlock word counts must be odd.");
  }
  return { ...options, minVotes, types };
}

function eligibleEntries(dictionaryEntries, options) {
  const selectedTypes = new Set(options.types);
  const seen = new Set();
  return dictionaryEntries
    .filter((entry) => (
      entry
      && selectedTypes.has(entry.type)
      && Number.isFinite(entry.score)
      && entry.score >= options.minVotes
      && typeof entry.word === "string"
      && ANSWER_PATTERN.test(entry.word)
      && entry.word.length >= options.minimumLength
      && entry.word.length <= options.maximumLength
      && typeof entry.definition === "string"
      && entry.definition.length > 0
    ))
    .sort((left, right) => (
      compareText(left.word, right.word)
      || right.score - left.score
    ))
    .filter((entry) => {
      if (seen.has(entry.word)) {
        return false;
      }
      seen.add(entry.word);
      return true;
    });
}

function groupByLength(entries) {
  const result = new Map();
  for (const entry of entries) {
    const values = result.get(entry.word.length) ?? [];
    values.push(entry);
    result.set(entry.word.length, values);
  }
  return result;
}

function positionCharactersByLength(entriesByLength) {
  return new Map([...entriesByLength].map(([length, entries]) => [
    length,
    Array.from({ length }, (_, index) => new Set(entries.map((entry) => entry.word[index]))),
  ]));
}

function emptyPatternBoard(size) {
  return {
    size,
    cells: new Map(),
    slots: [],
  };
}

function clonePatternBoard(board) {
  return {
    size: board.size,
    cells: new Map([...board.cells].map(([key, cell]) => [key, {
      ...cell,
      directions: new Set(cell.directions),
      slotIds: [...cell.slotIds],
    }])),
    slots: board.slots.map((slot) => ({ ...slot })),
  };
}

function slotCells(slot) {
  const { dx, dy } = DIRECTIONS[slot.direction];
  return Array.from({ length: slot.length }, (_, index) => ({
    column: slot.column + dx * index,
    row: slot.row + dy * index,
    index,
  }));
}

function inspectSlot(board, slot, requireCrossing = true) {
  const { dx, dy } = DIRECTIONS[slot.direction];
  const perpendicularX = dy;
  const perpendicularY = dx;
  const endColumn = slot.column + dx * (slot.length - 1);
  const endRow = slot.row + dy * (slot.length - 1);
  if (
    slot.column < 0
    || slot.row < 0
    || endColumn < 0
    || endRow < 0
    || slot.column >= board.size
    || slot.row >= board.size
    || endColumn >= board.size
    || endRow >= board.size
  ) {
    return null;
  }

  if (
    board.cells.has(coordinateKey(slot.column - dx, slot.row - dy))
    || board.cells.has(coordinateKey(endColumn + dx, endRow + dy))
  ) {
    return null;
  }

  let crossings = 0;
  let newCells = 0;
  for (const position of slotCells(slot)) {
    const key = coordinateKey(position.column, position.row);
    const cell = board.cells.get(key);
    if (cell) {
      if (cell.directions.has(slot.direction) || cell.directions.size >= 2) {
        return null;
      }
      crossings += 1;
    } else {
      if (
        board.cells.has(coordinateKey(
          position.column + perpendicularX,
          position.row + perpendicularY,
        ))
        || board.cells.has(coordinateKey(
          position.column - perpendicularX,
          position.row - perpendicularY,
        ))
      ) {
        return null;
      }
      newCells += 1;
    }
  }

  if ((requireCrossing && crossings === 0) || newCells === 0) {
    return null;
  }
  return { crossings, newCells };
}

function placeSlot(board, slot) {
  const id = `slot-${board.slots.length}`;
  const storedSlot = { ...slot, id };
  board.slots.push(storedSlot);
  for (const position of slotCells(storedSlot)) {
    const key = coordinateKey(position.column, position.row);
    const existing = board.cells.get(key);
    if (existing) {
      existing.directions.add(storedSlot.direction);
      existing.slotIds.push(id);
    } else {
      board.cells.set(key, {
        column: position.column,
        row: position.row,
        directions: new Set([storedSlot.direction]),
        slotIds: [id],
      });
    }
  }
  return storedSlot;
}

function rotatedSlot(slot, size) {
  if (slot.direction === "across") {
    return {
      length: slot.length,
      direction: slot.direction,
      column: size - slot.column - slot.length,
      row: size - 1 - slot.row,
    };
  }
  return {
    length: slot.length,
    direction: slot.direction,
    column: size - 1 - slot.column,
    row: size - slot.row - slot.length,
  };
}

function sameSlot(left, right) {
  return left.length === right.length
    && left.direction === right.direction
    && left.column === right.column
    && left.row === right.row;
}

function boardBounds(board) {
  const cells = [...board.cells.values()];
  const columns = cells.map((cell) => cell.column);
  const rows = cells.map((cell) => cell.row);
  const minColumn = Math.min(...columns);
  const maxColumn = Math.max(...columns);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const width = maxColumn - minColumn + 1;
  const height = maxRow - minRow + 1;
  return {
    minColumn,
    maxColumn,
    minRow,
    maxRow,
    width,
    height,
    area: width * height,
  };
}

function slotPositionIndex(slot, column, row) {
  if (slot.direction === "across") {
    return row === slot.row ? column - slot.column : null;
  }
  return column === slot.column ? row - slot.row : null;
}

function crossingHasCharacterSupport(board, slot, charactersByLength) {
  const newCharacters = charactersByLength.get(slot.length);
  for (const position of slotCells(slot)) {
    const cell = board.cells.get(coordinateKey(position.column, position.row));
    if (!cell) {
      continue;
    }
    for (const existingId of cell.slotIds) {
      const existingSlot = board.slots.find((candidate) => candidate.id === existingId);
      const existingIndex = slotPositionIndex(
        existingSlot,
        position.column,
        position.row,
      );
      const existingCharacters = charactersByLength.get(existingSlot.length)[existingIndex];
      if (![...newCharacters[position.index]].some((character) => (
        existingCharacters.has(character)
      ))) {
        return false;
      }
    }
  }
  return true;
}

function pairCandidates(
  board,
  lengths,
  lengthUsage,
  countsByLength,
  charactersByLength,
  random,
) {
  const candidates = [];
  const seen = new Set();
  const currentArea = boardBounds(board).area;

  for (const cell of board.cells.values()) {
    if (cell.directions.size !== 1) {
      continue;
    }
    const existingDirection = [...cell.directions][0];
    const direction = existingDirection === "across" ? "down" : "across";
    const { dx, dy } = DIRECTIONS[direction];

    for (const length of lengths) {
      for (let crossingIndex = 0; crossingIndex < length; crossingIndex += 1) {
        const first = {
          length,
          direction,
          column: cell.column - dx * crossingIndex,
          row: cell.row - dy * crossingIndex,
        };
        const partner = rotatedSlot(first, board.size);
        if (sameSlot(first, partner)) {
          continue;
        }
        const canonicalPair = [
          `${first.column},${first.row},${first.direction},${first.length}`,
          `${partner.column},${partner.row},${partner.direction},${partner.length}`,
        ].sort().join("|");
        if (seen.has(canonicalPair)) {
          continue;
        }
        seen.add(canonicalPair);

        const firstInspection = inspectSlot(board, first);
        if (
          !firstInspection
          || firstInspection.crossings !== 1
          || !crossingHasCharacterSupport(board, first, charactersByLength)
        ) {
          continue;
        }
        const trial = clonePatternBoard(board);
        placeSlot(trial, first);
        const partnerInspection = inspectSlot(trial, partner);
        if (
          !partnerInspection
          || partnerInspection.crossings !== 1
          || !crossingHasCharacterSupport(trial, partner, charactersByLength)
        ) {
          continue;
        }
        placeSlot(trial, partner);
        const bounds = boardBounds(trial);
        const areaGrowth = bounds.area - currentArea;
        const availability = countsByLength.get(length) ?? 0;
        const usage = lengthUsage.get(length) ?? 0;
        const score = (
          -areaGrowth * 3.2
          - Math.abs(bounds.width - bounds.height) * 3
          - usage * 18
          + Math.log2(availability + 1) * 4
          + random() * 28
        );
        candidates.push({ first, partner, trial, score });
      }
    }
  }

  return candidates;
}

function chooseCentralLength(lengths, countsByLength, random) {
  const oddLengths = lengths
    .filter((length) => length % 2 === 1)
    .sort((left, right) => (
      (countsByLength.get(right) ?? 0) - (countsByLength.get(left) ?? 0)
      || left - right
    ));
  if (oddLengths.length === 0) {
    return null;
  }
  const choiceRange = Math.min(3, oddLengths.length);
  return oddLengths[Math.floor(random() * random() * choiceRange)];
}

function generatePattern(entriesByLength, seed, attemptIndex, options) {
  const random = createSeededRandom(
    `definition:${DEFINITION_GENERATOR_VERSION}:${seed}:pattern:${attemptIndex}`,
  );
  const viableLengths = [...entriesByLength]
    .filter(([length, entries]) => (
      length >= options.minimumLength
      && length <= options.maximumLength
      && entries.length >= options.minimumCandidatesPerLength
    ))
    .map(([length]) => length)
    .sort((left, right) => left - right);
  const countsByLength = new Map(
    [...entriesByLength].map(([length, entries]) => [length, entries.length]),
  );
  const charactersByLength = positionCharactersByLength(entriesByLength);
  const centralLength = chooseCentralLength(viableLengths, countsByLength, random);
  if (!centralLength) {
    return null;
  }

  let board = emptyPatternBoard(options.gridSize);
  const center = Math.floor(options.gridSize / 2);
  const central = {
    length: centralLength,
    direction: "across",
    column: center - Math.floor(centralLength / 2),
    row: center,
  };
  if (!inspectSlot(board, central, false)) {
    return null;
  }
  placeSlot(board, central);
  const lengthUsage = new Map([[centralLength, 1]]);

  while (board.slots.length + 2 <= options.targetWords) {
    const candidates = pairCandidates(
      board,
      viableLengths,
      lengthUsage,
      countsByLength,
      charactersByLength,
      random,
    );
    if (candidates.length === 0) {
      break;
    }
    candidates.sort((left, right) => right.score - left.score);
    const selected = candidates[0];
    board = selected.trial;
    lengthUsage.set(
      selected.first.length,
      (lengthUsage.get(selected.first.length) ?? 0) + 2,
    );
  }

  if (board.slots.length < options.minimumWords) {
    return null;
  }
  return board;
}

function normalizePattern(board) {
  const bounds = boardBounds(board);
  const slots = board.slots.map((slot) => ({
    ...slot,
    column: slot.column - bounds.minColumn,
    row: slot.row - bounds.minRow,
  }));
  const cells = [...board.cells.values()].map((cell) => ({
    column: cell.column - bounds.minColumn,
    row: cell.row - bounds.minRow,
    directions: [...cell.directions],
    slotIds: [...cell.slotIds],
  }));
  return {
    width: bounds.width,
    height: bounds.height,
    slots,
    cells,
  };
}

function crossingConstraints(pattern) {
  const slotById = new Map(pattern.slots.map((slot) => [slot.id, slot]));
  const constraints = new Map(pattern.slots.map((slot) => [slot.id, []]));
  const cellPositionsBySlot = new Map(
    pattern.slots.map((slot) => [
      slot.id,
      new Map(slotCells(slot).map((position) => [
        coordinateKey(position.column, position.row),
        position.index,
      ])),
    ]),
  );

  for (const cell of pattern.cells.filter((candidate) => candidate.slotIds.length === 2)) {
    const [firstId, secondId] = cell.slotIds;
    const key = coordinateKey(cell.column, cell.row);
    const firstIndex = cellPositionsBySlot.get(firstId).get(key);
    const secondIndex = cellPositionsBySlot.get(secondId).get(key);
    constraints.get(firstId).push({
      ownIndex: firstIndex,
      otherId: secondId,
      otherIndex: secondIndex,
    });
    constraints.get(secondId).push({
      ownIndex: secondIndex,
      otherId: firstId,
      otherIndex: firstIndex,
    });
  }

  return { constraints, slotById };
}

function fillPattern(pattern, entriesByLength, seed, attemptIndex, options) {
  const random = createSeededRandom(
    `definition:${DEFINITION_GENERATOR_VERSION}:${seed}:fill:${attemptIndex}`,
  );
  const { constraints } = crossingConstraints(pattern);
  const initialDomains = new Map(pattern.slots.map((slot) => [
    slot.id,
    shuffled(entriesByLength.get(slot.length) ?? [], random),
  ]));
  let visitedNodes = 0;

  function allArcs() {
    return [...constraints].flatMap(([fromId, values]) => (
      values.map((constraint) => ({ fromId, constraint }))
    ));
  }

  function propagate(domains) {
    const queue = allArcs();
    while (queue.length > 0) {
      const { fromId, constraint } = queue.shift();
      const fromDomain = domains.get(fromId);
      const otherDomain = domains.get(constraint.otherId);
      const revised = fromDomain.filter((entry) => otherDomain.some((other) => (
        entry.word !== other.word
        && entry.word[constraint.ownIndex] === other.word[constraint.otherIndex]
      )));
      if (revised.length === 0) {
        return false;
      }
      if (revised.length === fromDomain.length) {
        continue;
      }
      domains.set(fromId, revised);
      for (const neighborConstraint of constraints.get(fromId)) {
        if (neighborConstraint.otherId === constraint.otherId) {
          continue;
        }
        const reverse = constraints.get(neighborConstraint.otherId).find(
          (candidate) => candidate.otherId === fromId,
        );
        queue.push({ fromId: neighborConstraint.otherId, constraint: reverse });
      }
    }
    return true;
  }

  function search(domains) {
    visitedNodes += 1;
    if (visitedNodes > options.fillNodeLimit) {
      return null;
    }
    if (!propagate(domains)) {
      return null;
    }

    let selectedSlot = null;
    for (const slot of pattern.slots) {
      const domain = domains.get(slot.id);
      if (domain.length === 1) {
        continue;
      }
      if (
        !selectedSlot
        || domain.length < domains.get(selectedSlot.id).length
        || (
          domain.length === domains.get(selectedSlot.id).length
          && constraints.get(slot.id).length > constraints.get(selectedSlot.id).length
        )
      ) {
        selectedSlot = slot;
      }
    }
    if (!selectedSlot) {
      const values = [...domains.values()].map((domain) => domain[0]);
      if (new Set(values.map((entry) => entry.word)).size !== values.length) {
        return null;
      }
      return new Map(pattern.slots.map((slot) => [slot.id, domains.get(slot.id)[0]]));
    }

    for (const entry of domains.get(selectedSlot.id)) {
      const nextDomains = new Map(
        [...domains].map(([slotId, domain]) => [slotId, [...domain]]),
      );
      nextDomains.set(selectedSlot.id, [entry]);
      let duplicateEmptiedDomain = false;
      for (const [slotId, domain] of nextDomains) {
        if (slotId === selectedSlot.id) {
          continue;
        }
        const withoutDuplicate = domain.filter((candidate) => candidate.word !== entry.word);
        if (withoutDuplicate.length === 0) {
          duplicateEmptiedDomain = true;
          break;
        }
        nextDomains.set(slotId, withoutDuplicate);
      }
      if (duplicateEmptiedDomain) {
        continue;
      }
      const result = search(nextDomains);
      if (result) {
        return result;
      }
    }
    return null;
  }

  return search(initialDomains);
}

function finalizePuzzle(pattern, assignments, seed, options) {
  const startKeys = new Set(
    pattern.slots.map((slot) => coordinateKey(slot.column, slot.row)),
  );
  const numberByKey = new Map();
  let nextNumber = 1;
  for (let row = 0; row < pattern.height; row += 1) {
    for (let column = 0; column < pattern.width; column += 1) {
      const key = coordinateKey(column, row);
      if (startKeys.has(key)) {
        numberByKey.set(key, nextNumber);
        nextNumber += 1;
      }
    }
  }

  const entries = pattern.slots.map((slot) => {
    const assigned = assignments.get(slot.id);
    const cellKeys = slotCells(slot).map((position) => (
      coordinateKey(position.column, position.row)
    ));
    return {
      id: slot.id,
      answer: assigned.word,
      clue: assigned.definition,
      type: assigned.type,
      score: assigned.score,
      number: numberByKey.get(coordinateKey(slot.column, slot.row)),
      direction: slot.direction,
      row: slot.row,
      column: slot.column,
      cellKeys,
    };
  });
  entries.sort((left, right) => (
    left.number - right.number
    || (left.direction === "across" ? -1 : 1)
  ));

  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const cells = pattern.cells.map((cell) => {
    let solution = null;
    for (const slotId of cell.slotIds) {
      const entry = entryById.get(slotId);
      const index = entry.cellKeys.indexOf(coordinateKey(cell.column, cell.row));
      const character = entry.answer[index];
      if (solution !== null && solution !== character) {
        throw new Error("Filled entries disagree at a crossing.");
      }
      solution = character;
    }
    const key = coordinateKey(cell.column, cell.row);
    return {
      key,
      row: cell.row,
      column: cell.column,
      solution,
      number: numberByKey.get(key) ?? null,
      entryIds: [...cell.slotIds],
    };
  }).sort((left, right) => left.row - right.row || left.column - right.column);

  const canonical = entries.map((entry) => (
    `${entry.answer}:${entry.row}:${entry.column}:${entry.direction}`
  )).join("|");
  const puzzle = {
    generatorVersion: DEFINITION_GENERATOR_VERSION,
    seed,
    options: {
      minVotes: options.minVotes,
      types: [...options.types],
    },
    width: pattern.width,
    height: pattern.height,
    signature: hashText(canonical),
    cells,
    entries,
  };
  validateDefinitionPuzzle(puzzle);
  return puzzle;
}

export function generateDefinitionCrossword(dictionaryEntries, seed, overrides = {}) {
  if (!Array.isArray(dictionaryEntries) || dictionaryEntries.length === 0) {
    throw new TypeError("The definition dictionary is empty.");
  }
  if (typeof seed !== "string" || seed.length === 0) {
    throw new TypeError("A non-empty string seed is required.");
  }
  const options = normalizedOptions(overrides);
  const eligible = eligibleEntries(dictionaryEntries, options);
  const entriesByLength = groupByLength(eligible);
  const viableLengths = [...entriesByLength]
    .filter(([, entries]) => entries.length >= options.minimumCandidatesPerLength);
  if (eligible.length < options.minimumWords || viableLengths.length === 0) {
    throw new Error(
      `Only ${eligible.length} words meet these filters; lower the vote threshold or select more word types.`,
    );
  }

  for (
    let targetWords = options.targetWords;
    targetWords >= options.minimumWords;
    targetWords -= 2
  ) {
    const targetOptions = {
      ...options,
      targetWords,
      minimumWords: targetWords,
    };
    for (let attemptIndex = 0; attemptIndex < options.attempts; attemptIndex += 1) {
      const attemptKey = `${targetWords}-${attemptIndex}`;
      const rawPattern = generatePattern(entriesByLength, seed, attemptKey, targetOptions);
      if (!rawPattern) {
        continue;
      }
      const pattern = normalizePattern(rawPattern);
      const assignments = fillPattern(
        pattern,
        entriesByLength,
        seed,
        attemptKey,
        targetOptions,
      );
      if (assignments) {
        return finalizePuzzle(pattern, assignments, seed, options);
      }
    }
  }
  throw new Error(
    "No symmetric grid could be filled for these settings. Try another seed, a lower vote threshold, or more word types.",
  );
}

function directionRun(cellMap, startCell, direction) {
  const { dx, dy } = DIRECTIONS[direction];
  if (cellMap.has(coordinateKey(startCell.column - dx, startCell.row - dy))) {
    return null;
  }
  const keys = [];
  let column = startCell.column;
  let row = startCell.row;
  while (cellMap.has(coordinateKey(column, row))) {
    keys.push(coordinateKey(column, row));
    column += dx;
    row += dy;
  }
  return keys.length >= 2 ? keys : null;
}

export function validateDefinitionPuzzle(puzzle) {
  if (puzzle.width < 3 || puzzle.height < 3) {
    throw new Error("Definition crossword grid is too small.");
  }
  const cellMap = new Map(puzzle.cells.map((cell) => [cell.key, cell]));
  const entryMap = new Map(puzzle.entries.map((entry) => [entry.id, entry]));
  if (cellMap.size !== puzzle.cells.length || entryMap.size !== puzzle.entries.length) {
    throw new Error("Definition crossword contains duplicate identifiers.");
  }

  for (const cell of puzzle.cells) {
    const rotatedKey = coordinateKey(
      puzzle.width - 1 - cell.column,
      puzzle.height - 1 - cell.row,
    );
    if (!cellMap.has(rotatedKey)) {
      throw new Error(`Grid is not rotationally symmetric at ${cell.key}.`);
    }
    if (cell.entryIds.length < 1 || cell.entryIds.length > 2) {
      throw new Error(`Cell ${cell.key} has an invalid entry count.`);
    }
  }

  const expectedRuns = new Set();
  const answers = new Set();
  for (const entry of puzzle.entries) {
    if (answers.has(entry.answer)) {
      throw new Error(`Answer ${entry.answer} appears more than once.`);
    }
    answers.add(entry.answer);
    if (entry.answer.length !== entry.cellKeys.length) {
      throw new Error(`Entry ${entry.answer} has the wrong length.`);
    }
    for (let index = 0; index < entry.cellKeys.length; index += 1) {
      const cell = cellMap.get(entry.cellKeys[index]);
      if (!cell || cell.solution !== entry.answer[index] || !cell.entryIds.includes(entry.id)) {
        throw new Error(`Entry ${entry.answer} does not match its cells.`);
      }
    }
    if (!entry.cellKeys.some((key) => cellMap.get(key).entryIds.length === 2)) {
      throw new Error(`Entry ${entry.answer} is disconnected.`);
    }
    expectedRuns.add(`${entry.direction}:${entry.cellKeys.join("|")}`);
  }

  const actualRuns = new Set();
  for (const cell of puzzle.cells) {
    for (const direction of Object.keys(DIRECTIONS)) {
      const run = directionRun(cellMap, cell, direction);
      if (run) {
        actualRuns.add(`${direction}:${run.join("|")}`);
      }
    }
  }
  if (
    actualRuns.size !== expectedRuns.size
    || [...actualRuns].some((run) => !expectedRuns.has(run))
  ) {
    throw new Error("Grid contains adjacent words without black-square separation.");
  }

  const visited = new Set([puzzle.entries[0].id]);
  const pending = [puzzle.entries[0].id];
  while (pending.length > 0) {
    const entry = entryMap.get(pending.pop());
    for (const key of entry.cellKeys) {
      for (const neighborId of cellMap.get(key).entryIds) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          pending.push(neighborId);
        }
      }
    }
  }
  if (visited.size !== puzzle.entries.length) {
    throw new Error("Definition crossword is not connected.");
  }
  return true;
}
