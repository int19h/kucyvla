export const GENERATOR_VERSION = 1;

const DEFAULT_OPTIONS = Object.freeze({
  targetWords: 18,
  minimumWords: 14,
  minimumCmavo: 3,
  maximumCmavo: 6,
  maximumDimension: 15,
  attempts: 32,
  gismuCandidates: 260,
});

const DIRECTIONS = Object.freeze({
  across: Object.freeze({ dx: 1, dy: 0 }),
  down: Object.freeze({ dx: 0, dy: 1 }),
});

const WORD_PATTERN = /^[a-z']+$/;

function coordinateKey(x, y) {
  return `${x},${y}`;
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hashSeed(text) {
  let hash = 1779033703 ^ text.length;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    hash ^= hash >>> 16;
    return hash >>> 0;
  };
}

export function createSeededRandom(seed) {
  const seedPart = hashSeed(seed);
  let a = seedPart();
  let b = seedPart();
  let c = seedPart();
  let d = seedPart();

  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const result = (a + b + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + result) | 0;
    return (result >>> 0) / 4294967296;
  };
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function prepareWords(dictionaryEntries, random, gismuCandidateCount) {
  const words = dictionaryEntries
    .filter((entry) => entry && (entry.type === "gismu" || entry.type === "cmavo"))
    .map((entry) => {
      const rafsi = [...new Set(entry.rafsi)]
        .filter((form) => form !== entry.word && WORD_PATTERN.test(form))
        .sort(compareText);
      return {
        answer: entry.word,
        type: entry.type,
        rafsi,
      };
    })
    .filter((entry) => WORD_PATTERN.test(entry.answer) && entry.rafsi.length > 0);

  const gismu = shuffled(
    words.filter((entry) => entry.type === "gismu"),
    random,
  ).slice(0, gismuCandidateCount);
  const cmavo = shuffled(
    words.filter((entry) => entry.type === "cmavo"),
    random,
  );

  return shuffled([...gismu, ...cmavo], random).map((entry) => ({
    ...entry,
    clue: entry.rafsi[Math.floor(random() * entry.rafsi.length)],
  }));
}

function emptyBoard() {
  return {
    cells: new Map(),
    minX: 0,
    maxX: -1,
    minY: 0,
    maxY: -1,
  };
}

function boardBoundsWithPlacement(board, answer, x, y, direction) {
  const { dx, dy } = DIRECTIONS[direction];
  const endX = x + dx * (answer.length - 1);
  const endY = y + dy * (answer.length - 1);
  if (board.cells.size === 0) {
    return {
      minX: Math.min(x, endX),
      maxX: Math.max(x, endX),
      minY: Math.min(y, endY),
      maxY: Math.max(y, endY),
    };
  }
  return {
    minX: Math.min(board.minX, x, endX),
    maxX: Math.max(board.maxX, x, endX),
    minY: Math.min(board.minY, y, endY),
    maxY: Math.max(board.maxY, y, endY),
  };
}

function measureBounds(bounds) {
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  return {
    width,
    height,
    area: width * height,
    imbalance: Math.abs(width - height),
  };
}

function inspectPlacement(board, answer, x, y, direction, maximumDimension) {
  const { dx, dy } = DIRECTIONS[direction];
  const perpendicularX = dy;
  const perpendicularY = dx;
  const before = board.cells.get(coordinateKey(x - dx, y - dy));
  const after = board.cells.get(
    coordinateKey(x + dx * answer.length, y + dy * answer.length),
  );

  if (before || after) {
    return null;
  }

  let crossings = 0;
  let newCells = 0;
  for (let index = 0; index < answer.length; index += 1) {
    const cellX = x + dx * index;
    const cellY = y + dy * index;
    const cell = board.cells.get(coordinateKey(cellX, cellY));
    const character = answer[index];

    if (cell) {
      if (
        cell.character !== character
        || cell.directions.has(direction)
      ) {
        return null;
      }
      crossings += 1;
      continue;
    }

    const sideOne = board.cells.get(
      coordinateKey(cellX + perpendicularX, cellY + perpendicularY),
    );
    const sideTwo = board.cells.get(
      coordinateKey(cellX - perpendicularX, cellY - perpendicularY),
    );
    if (sideOne || sideTwo) {
      return null;
    }
    newCells += 1;
  }

  if (board.cells.size > 0 && crossings === 0) {
    return null;
  }
  if (newCells === 0) {
    return null;
  }

  const bounds = boardBoundsWithPlacement(board, answer, x, y, direction);
  const dimensions = measureBounds(bounds);
  if (dimensions.width > maximumDimension || dimensions.height > maximumDimension) {
    return null;
  }

  return { crossings, newCells, bounds, ...dimensions };
}

function candidatePlacements(board, answer, maximumDimension) {
  const candidates = [];
  const seen = new Set();

  for (const cell of board.cells.values()) {
    if (cell.directions.size !== 1) {
      continue;
    }
    const existingDirection = [...cell.directions][0];
    const direction = existingDirection === "across" ? "down" : "across";
    const { dx, dy } = DIRECTIONS[direction];

    for (let index = 0; index < answer.length; index += 1) {
      if (answer[index] !== cell.character) {
        continue;
      }
      const x = cell.x - dx * index;
      const y = cell.y - dy * index;
      const key = `${x},${y},${direction}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const inspection = inspectPlacement(
        board,
        answer,
        x,
        y,
        direction,
        maximumDimension,
      );
      if (inspection) {
        candidates.push({ x, y, direction, ...inspection });
      }
    }
  }

  return candidates;
}

function placeWord(board, placement) {
  const { dx, dy } = DIRECTIONS[placement.direction];
  for (let index = 0; index < placement.answer.length; index += 1) {
    const x = placement.x + dx * index;
    const y = placement.y + dy * index;
    const key = coordinateKey(x, y);
    const existing = board.cells.get(key);
    if (existing) {
      existing.directions.add(placement.direction);
    } else {
      board.cells.set(key, {
        x,
        y,
        character: placement.answer[index],
        directions: new Set([placement.direction]),
      });
    }
  }

  const bounds = boardBoundsWithPlacement(
    board,
    placement.answer,
    placement.x,
    placement.y,
    placement.direction,
  );
  board.minX = bounds.minX;
  board.maxX = bounds.maxX;
  board.minY = bounds.minY;
  board.maxY = bounds.maxY;
}

function scoreCandidate(board, candidate, word, placements, options, random) {
  const currentArea = board.cells.size === 0
    ? 0
    : measureBounds(board).area;
  const areaGrowth = candidate.area - currentArea;
  const cmavoCount = placements.filter((entry) => entry.type === "cmavo").length;
  const expectedCmavo = Math.min(
    options.minimumCmavo,
    Math.floor((placements.length + 1) / 4),
  );
  const cmavoBonus = word.type === "cmavo" && cmavoCount < expectedCmavo ? 180 : 0;
  const longWordBonus = word.answer.length === 5 ? 8 : 0;

  return (
    candidate.crossings * 125
    - areaGrowth * 9
    - candidate.imbalance * 2
    - candidate.area * 0.06
    + cmavoBonus
    + longWordBonus
    + random() * 24
  );
}

function entryCrossings(board, placement) {
  const { dx, dy } = DIRECTIONS[placement.direction];
  let count = 0;
  for (let index = 0; index < placement.answer.length; index += 1) {
    const cell = board.cells.get(
      coordinateKey(placement.x + dx * index, placement.y + dy * index),
    );
    if (cell?.directions.size === 2) {
      count += 1;
    }
  }
  return count;
}

function scoreAttempt(board, placements, options) {
  const dimensions = measureBounds(board);
  const cmavoCount = placements.filter((entry) => entry.type === "cmavo").length;
  const totalCrossings = [...board.cells.values()]
    .filter((cell) => cell.directions.size === 2).length;
  const danglingGismu = placements.filter(
    (entry) => entry.type === "gismu" && entryCrossings(board, entry) < 2,
  ).length;
  const shortfall = Math.max(0, options.minimumCmavo - cmavoCount);

  return (
    placements.length * 1000
    + totalCrossings * 90
    - dimensions.area * 2.5
    - dimensions.imbalance * 18
    - danglingGismu * 20
    - shortfall * 1000
  );
}

function generateAttempt(dictionaryEntries, seed, attemptIndex, options) {
  const random = createSeededRandom(
    `selrafsi:${GENERATOR_VERSION}:${seed}:attempt:${attemptIndex}`,
  );
  const words = prepareWords(dictionaryEntries, random, options.gismuCandidates);
  const first = words.find((word) => word.type === "gismu") ?? words[0];
  if (!first) {
    return null;
  }

  const board = emptyBoard();
  const placements = [{
    ...first,
    x: 0,
    y: 0,
    direction: "across",
  }];
  placeWord(board, placements[0]);
  const unused = words.filter((word) => word.answer !== first.answer);

  while (placements.length < options.targetWords) {
    let best = null;
    const cmavoCount = placements.filter((entry) => entry.type === "cmavo").length;

    for (let wordIndex = 0; wordIndex < unused.length; wordIndex += 1) {
      const word = unused[wordIndex];
      if (word.type === "cmavo" && cmavoCount >= options.maximumCmavo) {
        continue;
      }
      const candidates = candidatePlacements(
        board,
        word.answer,
        options.maximumDimension,
      );
      for (const candidate of candidates) {
        const score = scoreCandidate(
          board,
          candidate,
          word,
          placements,
          options,
          random,
        );
        if (!best || score > best.score) {
          best = { wordIndex, word, candidate, score };
        }
      }
    }

    if (!best) {
      break;
    }

    const placement = { ...best.word, ...best.candidate };
    placements.push(placement);
    placeWord(board, placement);
    unused.splice(best.wordIndex, 1);
  }

  return {
    board,
    placements,
    score: scoreAttempt(board, placements, options),
  };
}

function puzzleSignature(entries) {
  const canonical = entries
    .map((entry) => [
      entry.answer,
      entry.clue,
      entry.row,
      entry.column,
      entry.direction,
    ].join(":"))
    .join("|");
  const hash = hashSeed(canonical)();
  return hash.toString(16).padStart(8, "0");
}

function finalizeAttempt(attempt, seed) {
  const { board, placements } = attempt;
  const width = board.maxX - board.minX + 1;
  const height = board.maxY - board.minY + 1;
  const normalizedEntries = placements.map((placement, index) => {
    const { dx, dy } = DIRECTIONS[placement.direction];
    const row = placement.y - board.minY;
    const column = placement.x - board.minX;
    const cellKeys = Array.from({ length: placement.answer.length }, (_, letterIndex) => (
      coordinateKey(column + dx * letterIndex, row + dy * letterIndex)
    ));
    return {
      id: `entry-${index}`,
      answer: placement.answer,
      clue: placement.clue,
      type: placement.type,
      direction: placement.direction,
      row,
      column,
      cellKeys,
    };
  });

  const startKeys = new Set(
    normalizedEntries.map((entry) => coordinateKey(entry.column, entry.row)),
  );
  const numberByKey = new Map();
  let nextNumber = 1;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const key = coordinateKey(column, row);
      if (startKeys.has(key)) {
        numberByKey.set(key, nextNumber);
        nextNumber += 1;
      }
    }
  }

  for (const entry of normalizedEntries) {
    entry.number = numberByKey.get(coordinateKey(entry.column, entry.row));
  }

  const entryIdsByCell = new Map();
  for (const entry of normalizedEntries) {
    for (const key of entry.cellKeys) {
      const entryIds = entryIdsByCell.get(key) ?? [];
      entryIds.push(entry.id);
      entryIdsByCell.set(key, entryIds);
    }
  }

  const cells = [];
  for (const cell of board.cells.values()) {
    const column = cell.x - board.minX;
    const row = cell.y - board.minY;
    const key = coordinateKey(column, row);
    cells.push({
      key,
      row,
      column,
      solution: cell.character,
      number: numberByKey.get(key) ?? null,
      entryIds: entryIdsByCell.get(key) ?? [],
    });
  }
  cells.sort((left, right) => left.row - right.row || left.column - right.column);
  normalizedEntries.sort((left, right) => (
    left.number - right.number
    || (left.direction === "across" ? -1 : 1)
  ));

  const puzzle = {
    generatorVersion: GENERATOR_VERSION,
    seed,
    width,
    height,
    signature: puzzleSignature(normalizedEntries),
    cells,
    entries: normalizedEntries,
  };
  validatePuzzle(puzzle);
  return puzzle;
}

export function generateCrossword(dictionaryEntries, seed, overrides = {}) {
  if (!Array.isArray(dictionaryEntries) || dictionaryEntries.length === 0) {
    throw new TypeError("The rafsi dictionary is empty.");
  }
  if (typeof seed !== "string" || seed.length === 0) {
    throw new TypeError("A non-empty string seed is required.");
  }

  const options = { ...DEFAULT_OPTIONS, ...overrides };
  let best = null;
  for (let attemptIndex = 0; attemptIndex < options.attempts; attemptIndex += 1) {
    const attempt = generateAttempt(dictionaryEntries, seed, attemptIndex, options);
    if (
      attempt
      && attempt.placements.length >= options.minimumWords
      && (!best || attempt.score > best.score)
    ) {
      best = attempt;
    }
  }

  if (!best) {
    throw new Error(`Could not generate a crossword for seed “${seed}”.`);
  }
  return finalizeAttempt(best, seed);
}

function directionRun(puzzle, cellMap, startCell, direction) {
  const { dx, dy } = DIRECTIONS[direction];
  const previous = cellMap.get(
    coordinateKey(startCell.column - dx, startCell.row - dy),
  );
  if (previous) {
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

export function validatePuzzle(puzzle) {
  if (!Number.isInteger(puzzle.width) || puzzle.width < 2) {
    throw new Error("Puzzle width must be at least two cells.");
  }
  if (!Number.isInteger(puzzle.height) || puzzle.height < 2) {
    throw new Error("Puzzle height must be at least two cells.");
  }
  if (!Array.isArray(puzzle.entries) || puzzle.entries.length < 2) {
    throw new Error("Puzzle must contain at least two entries.");
  }

  const cellMap = new Map(puzzle.cells.map((cell) => [cell.key, cell]));
  if (cellMap.size !== puzzle.cells.length) {
    throw new Error("Puzzle contains duplicate cells.");
  }
  const entryMap = new Map(puzzle.entries.map((entry) => [entry.id, entry]));
  if (entryMap.size !== puzzle.entries.length) {
    throw new Error("Puzzle contains duplicate entry identifiers.");
  }

  const answers = new Set();
  const clues = new Set();
  for (const entry of puzzle.entries) {
    if (answers.has(entry.answer)) {
      throw new Error(`Answer ${entry.answer} appears more than once.`);
    }
    answers.add(entry.answer);
    if (clues.has(entry.clue)) {
      throw new Error(`Clue ${entry.clue} appears more than once.`);
    }
    clues.add(entry.clue);
    if (entry.answer === entry.clue) {
      throw new Error(`Answer ${entry.answer} reveals itself.`);
    }
    if (entry.cellKeys.length !== entry.answer.length) {
      throw new Error(`Entry ${entry.answer} has the wrong number of cells.`);
    }
    for (let index = 0; index < entry.cellKeys.length; index += 1) {
      const cell = cellMap.get(entry.cellKeys[index]);
      if (!cell || cell.solution !== entry.answer[index]) {
        throw new Error(`Entry ${entry.answer} does not match its cells.`);
      }
      if (!cell.entryIds.includes(entry.id)) {
        throw new Error(`Cell ${cell.key} does not refer back to ${entry.answer}.`);
      }
    }
    if (!entry.cellKeys.some((key) => cellMap.get(key).entryIds.length === 2)) {
      throw new Error(`Entry ${entry.answer} does not cross another entry.`);
    }
  }

  for (const cell of puzzle.cells) {
    if (
      cell.row < 0
      || cell.row >= puzzle.height
      || cell.column < 0
      || cell.column >= puzzle.width
    ) {
      throw new Error(`Cell ${cell.key} lies outside the grid.`);
    }
    if (cell.entryIds.length < 1 || cell.entryIds.length > 2) {
      throw new Error(`Cell ${cell.key} has an invalid entry count.`);
    }
    if (cell.entryIds.some((entryId) => !entryMap.has(entryId))) {
      throw new Error(`Cell ${cell.key} names an unknown entry.`);
    }
  }

  const expectedRuns = new Set(
    puzzle.entries.map((entry) => `${entry.direction}:${entry.cellKeys.join("|")}`),
  );
  const actualRuns = new Set();
  for (const cell of puzzle.cells) {
    for (const direction of Object.keys(DIRECTIONS)) {
      const run = directionRun(puzzle, cellMap, cell, direction);
      if (run) {
        actualRuns.add(`${direction}:${run.join("|")}`);
      }
    }
  }
  if (
    actualRuns.size !== expectedRuns.size
    || [...actualRuns].some((run) => !expectedRuns.has(run))
  ) {
    throw new Error("Puzzle contains an unintended Across or Down run.");
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
    throw new Error("Puzzle entries are not all connected.");
  }

  return true;
}
