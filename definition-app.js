import {
  DEFAULT_DEFINITION_OPTIONS,
  DEFINITION_TYPE_ORDER,
  generateDefinitionCrossword,
} from "./definition-crossword.js";
import {
  definitionConfigurationKey,
  readDefinitionProgress,
  removeDefinitionProgress,
  writeDefinitionProgress,
} from "./definition-storage.js";
import { formatDictionaryDefinition } from "./definition-format.js";

const elements = {
  puzzle: document.querySelector("#definition-puzzle"),
  seed: document.querySelector("#definition-seed"),
  progress: document.querySelector("#definition-progress"),
  status: document.querySelector("#definition-status"),
  error: document.querySelector("#definition-error"),
  grid: document.querySelector("#definition-grid"),
  acrossClues: document.querySelector("#definition-across-clues"),
  downClues: document.querySelector("#definition-down-clues"),
  acrossCount: document.querySelector("#definition-across-count"),
  downCount: document.querySelector("#definition-down-count"),
  savedPuzzles: document.querySelector("#definition-saved-puzzles"),
  newPuzzle: document.querySelector("#definition-new-puzzle"),
  checkPuzzle: document.querySelector("#definition-check"),
  clearPuzzle: document.querySelector("#definition-clear"),
  options: document.querySelector("#definition-options"),
  minVotes: document.querySelector("#min-votes"),
  typeInputs: [...document.querySelectorAll('input[name="wordType"]')],
};

const TYPE_LABELS = Object.freeze({
  gismu: "gismu",
  lujvo: "lujvo",
  cmevla: "cmevla",
  fuivla: "fu'ivla",
});

let configuration = null;
let puzzle = null;
let cellByKey = new Map();
let entryById = new Map();
let cellElementByKey = new Map();
let inputByKey = new Map();
let clueButtonByEntryId = new Map();
let savedStateByKey = new Map();
let activeCellKey = null;
let activeDirection = "across";

function randomSeed() {
  const parts = new Uint32Array(3);
  crypto.getRandomValues(parts);
  return [...parts]
    .map((part) => part.toString(36).padStart(7, "0"))
    .join("-");
}

function normalizedTypes(rawTypes) {
  return DEFINITION_TYPE_ORDER.filter((type) => rawTypes.includes(type));
}

function configurationUrl(nextConfiguration) {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("seed", nextConfiguration.seed);
  url.searchParams.set("minVotes", String(nextConfiguration.minVotes));
  url.searchParams.set("types", nextConfiguration.types.join(","));
  return url;
}

function readConfiguration() {
  const url = new URL(window.location.href);
  const seed = url.searchParams.get("seed") || randomSeed();
  const rawMinVotes = url.searchParams.get("minVotes");
  const parsedMinVotes = rawMinVotes === null ? NaN : Number(rawMinVotes);
  const minVotes = Number.isInteger(parsedMinVotes) && parsedMinVotes >= 0
    ? parsedMinVotes
    : DEFAULT_DEFINITION_OPTIONS.minVotes;
  const rawTypes = url.searchParams.get("types");
  const requestedTypes = rawTypes === null
    ? [...DEFAULT_DEFINITION_OPTIONS.types]
    : rawTypes.split(",");
  const types = normalizedTypes(requestedTypes);
  const result = {
    seed,
    minVotes,
    types: types.length > 0 ? types : [...DEFAULT_DEFINITION_OPTIONS.types],
  };
  const canonical = configurationUrl(result);
  if (canonical.href !== url.href) {
    window.history.replaceState(null, "", canonical);
  }
  return result;
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function setStatus(message, kind = "neutral") {
  elements.status.textContent = message;
  elements.status.classList.toggle("status--success", kind === "success");
  elements.status.classList.toggle("status--warning", kind === "warning");
}

function showError(error) {
  const detail = error instanceof Error ? error.message : String(error);
  elements.error.textContent = detail;
  elements.error.hidden = false;
  elements.progress.textContent = "Unavailable";
  elements.puzzle.setAttribute("aria-busy", "false");
}

function savedPuzzles() {
  return readDefinitionProgress(window.localStorage);
}

function truncatedSeed(seed) {
  return seed.length <= 22 ? seed : `${seed.slice(0, 19)}…`;
}

function savedStateLabel(state) {
  const typeSummary = state.types.map((type) => TYPE_LABELS[type]).join("+");
  const count = Object.keys(state.values).length;
  return `${truncatedSeed(state.seed)} · ${typeSummary} · ≥${state.minVotes} · ${count}`;
}

function populateSavedPuzzleSelect() {
  const saved = savedPuzzles();
  savedStateByKey = new Map(
    saved.map((state) => [definitionConfigurationKey(state), state]),
  );
  elements.savedPuzzles.replaceChildren();
  const placeholder = createElement(
    "option",
    "",
    saved.length > 0 ? "Choose a saved puzzle…" : "No saved puzzles yet",
  );
  placeholder.value = "";
  elements.savedPuzzles.append(placeholder);

  for (const state of saved) {
    const key = definitionConfigurationKey(state);
    const option = createElement("option", "", savedStateLabel(state));
    option.value = key;
    elements.savedPuzzles.append(option);
  }
  elements.savedPuzzles.disabled = saved.length === 0;
  const currentKey = definitionConfigurationKey(configuration);
  elements.savedPuzzles.value = savedStateByKey.has(currentKey) ? currentKey : "";
}

function populateOptionForm() {
  elements.minVotes.value = String(configuration.minVotes);
  for (const input of elements.typeInputs) {
    input.checked = configuration.types.includes(input.value);
  }
}

function activeEntry() {
  const cell = cellByKey.get(activeCellKey);
  if (!cell) {
    return null;
  }
  const entryId = cell.entryIds.find(
    (candidateId) => entryById.get(candidateId).direction === activeDirection,
  );
  return entryId ? entryById.get(entryId) : null;
}

function paintActiveEntry() {
  for (const element of cellElementByKey.values()) {
    element.classList.remove("cell--entry", "cell--active");
  }
  for (const button of clueButtonByEntryId.values()) {
    button.classList.remove("clue-button--active");
  }
  const entry = activeEntry();
  if (!entry) {
    return;
  }
  for (const key of entry.cellKeys) {
    cellElementByKey.get(key)?.classList.add("cell--entry");
  }
  cellElementByKey.get(activeCellKey)?.classList.add("cell--active");
  const clueButton = clueButtonByEntryId.get(entry.id);
  clueButton?.classList.add("clue-button--active");
  clueButton?.scrollIntoView({ block: "nearest" });
}

function activateCell(key, requestedDirection = activeDirection, focus = true) {
  const cell = cellByKey.get(key);
  if (!cell) {
    return;
  }
  const directions = cell.entryIds.map((entryId) => entryById.get(entryId).direction);
  activeDirection = directions.includes(requestedDirection) ? requestedDirection : directions[0];
  activeCellKey = key;
  paintActiveEntry();
  if (focus) {
    inputByKey.get(key)?.focus({ preventScroll: true });
  }
}

function activateEntry(entryId) {
  const entry = entryById.get(entryId);
  if (!entry) {
    return;
  }
  activeDirection = entry.direction;
  activeCellKey = entry.cellKeys[0];
  paintActiveEntry();
  inputByKey.get(activeCellKey)?.focus({ preventScroll: true });
}

function toggleDirection() {
  const cell = cellByKey.get(activeCellKey);
  if (!cell || cell.entryIds.length !== 2) {
    return;
  }
  activeDirection = activeDirection === "across" ? "down" : "across";
  paintActiveEntry();
}

function moveWithinEntry(delta) {
  const entry = activeEntry();
  if (!entry) {
    return;
  }
  const currentIndex = entry.cellKeys.indexOf(activeCellKey);
  const nextIndex = currentIndex + delta;
  if (nextIndex >= 0 && nextIndex < entry.cellKeys.length) {
    activateCell(entry.cellKeys[nextIndex], entry.direction);
  }
}

function directionEntryAtCell(key, direction) {
  const cell = cellByKey.get(key);
  const entryId = cell?.entryIds.find(
    (candidateId) => entryById.get(candidateId).direction === direction,
  );
  return entryId ? entryById.get(entryId) : null;
}

function handleArrow(key, direction, delta) {
  const entry = directionEntryAtCell(key, direction);
  if (!entry) {
    return;
  }
  const currentIndex = entry.cellKeys.indexOf(key);
  const nextIndex = currentIndex + delta;
  activeDirection = direction;
  activeCellKey = key;
  if (nextIndex >= 0 && nextIndex < entry.cellKeys.length) {
    activateCell(entry.cellKeys[nextIndex], direction);
  } else {
    paintActiveEntry();
  }
}

function enteredValues() {
  return Object.fromEntries(
    [...inputByKey.entries()]
      .filter(([, input]) => input.value)
      .map(([key, input]) => [key, input.value]),
  );
}

function clearCheckMarks() {
  for (const element of cellElementByKey.values()) {
    element.classList.remove("cell--wrong", "cell--correct");
  }
}

function updateProgress() {
  const filled = [...inputByKey.values()].filter((input) => input.value).length;
  const total = inputByKey.size;
  const percent = total === 0 ? 0 : Math.round((filled / total) * 100);
  elements.progress.textContent = `${filled} of ${total} letters · ${percent}%`;
  elements.clearPuzzle.disabled = filled === 0;
  setStatus(filled === total && total > 0
    ? "The grid is full. Check it when you’re ready."
    : "");
}

function persistProgress() {
  const stored = writeDefinitionProgress(window.localStorage, {
    ...configuration,
    signature: puzzle.signature,
    values: enteredValues(),
  });
  if (!stored) {
    setStatus("Progress could not be saved in this browser.", "warning");
  }
  populateSavedPuzzleSelect();
}

function handleInput(event) {
  const normalized = event.target.value
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z']/g, "")
    .slice(-1);
  event.target.value = normalized;
  clearCheckMarks();
  updateProgress();
  persistProgress();
  if (normalized) {
    moveWithinEntry(1);
  }
}

function handleKeyDown(event, key) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    toggleDirection();
    return;
  }
  const arrows = {
    ArrowLeft: ["across", -1],
    ArrowRight: ["across", 1],
    ArrowUp: ["down", -1],
    ArrowDown: ["down", 1],
  };
  if (arrows[event.key]) {
    event.preventDefault();
    handleArrow(key, ...arrows[event.key]);
    return;
  }
  if (event.key === "Backspace" && !event.currentTarget.value) {
    event.preventDefault();
    moveWithinEntry(-1);
    const input = inputByKey.get(activeCellKey);
    if (input?.value) {
      input.value = "";
      clearCheckMarks();
      updateProgress();
      persistProgress();
    }
  }
}

function renderCell(cell) {
  const element = createElement("div", "cell");
  element.dataset.key = cell.key;
  cellElementByKey.set(cell.key, element);
  if (cell.number) {
    element.append(createElement("span", "cell-number", String(cell.number)));
  }
  const input = createElement("input");
  input.type = "text";
  input.inputMode = "text";
  input.maxLength = 1;
  input.autocomplete = "off";
  input.autocapitalize = "none";
  input.spellcheck = false;
  input.setAttribute("aria-label", `Row ${cell.row + 1}, column ${cell.column + 1}`);
  input.addEventListener("input", handleInput);
  input.addEventListener("keydown", (event) => handleKeyDown(event, cell.key));
  input.addEventListener("focus", () => {
    if (activeCellKey !== cell.key) {
      activateCell(cell.key, activeDirection, false);
    }
  });
  element.append(input);
  inputByKey.set(cell.key, input);
  element.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (activeCellKey === cell.key && cell.entryIds.length === 2) {
      toggleDirection();
      input.focus({ preventScroll: true });
    } else {
      activateCell(cell.key, activeDirection);
    }
  });
  return element;
}

function renderGrid() {
  elements.grid.replaceChildren();
  elements.grid.style.setProperty("--columns", puzzle.width);
  for (let row = 0; row < puzzle.height; row += 1) {
    for (let column = 0; column < puzzle.width; column += 1) {
      const cell = cellByKey.get(`${column},${row}`);
      elements.grid.append(cell ? renderCell(cell) : createElement("div", "block"));
    }
  }
}

function renderClue(entry) {
  const item = createElement("li");
  const button = createElement("button", "clue-button definition-clue");
  button.type = "button";
  const displayedClue = formatDictionaryDefinition(entry.clue);
  button.setAttribute(
    "aria-label",
    `${entry.number} ${entry.direction}: ${displayedClue}`,
  );
  button.append(
    createElement("span", "clue-number", String(entry.number)),
    createElement("span", "clue-definition", displayedClue),
  );
  button.addEventListener("click", () => activateEntry(entry.id));
  item.append(button);
  clueButtonByEntryId.set(entry.id, button);
  return item;
}

function renderClues() {
  elements.acrossClues.replaceChildren();
  elements.downClues.replaceChildren();
  const across = puzzle.entries.filter((entry) => entry.direction === "across");
  const down = puzzle.entries.filter((entry) => entry.direction === "down");
  for (const entry of across) {
    elements.acrossClues.append(renderClue(entry));
  }
  for (const entry of down) {
    elements.downClues.append(renderClue(entry));
  }
  elements.acrossCount.textContent = `${across.length} clues`;
  elements.downCount.textContent = `${down.length} clues`;
}

function restoreProgress() {
  const key = definitionConfigurationKey(configuration);
  const state = savedPuzzles().find((candidate) => (
    definitionConfigurationKey(candidate) === key
    && candidate.signature === puzzle.signature
  ));
  for (const [cellKey, value] of Object.entries(state?.values ?? {})) {
    const input = inputByKey.get(cellKey);
    if (input) {
      input.value = value;
    }
  }
}

function checkPuzzle() {
  let wrong = 0;
  let missing = 0;
  clearCheckMarks();
  for (const [key, input] of inputByKey) {
    if (!input.value) {
      missing += 1;
    } else if (input.value !== cellByKey.get(key).solution) {
      wrong += 1;
      cellElementByKey.get(key).classList.add("cell--wrong");
    } else {
      cellElementByKey.get(key).classList.add("cell--correct");
    }
  }
  if (wrong === 0 && missing === 0) {
    setStatus("Solved! Every answer is correct.", "success");
  } else if (wrong === 0) {
    setStatus(`${missing} ${missing === 1 ? "square is" : "squares are"} still empty.`);
  } else {
    setStatus(
      `${wrong} incorrect ${wrong === 1 ? "letter" : "letters"}${missing ? ` and ${missing} empty` : ""}.`,
      "warning",
    );
  }
}

function clearPuzzle() {
  if (!window.confirm("Clear every letter entered for this puzzle and option set?")) {
    return;
  }
  for (const input of inputByKey.values()) {
    input.value = "";
  }
  clearCheckMarks();
  removeDefinitionProgress(window.localStorage, configuration);
  populateSavedPuzzleSelect();
  updateProgress();
  activateEntry(puzzle.entries[0].id);
}

function installPageControls() {
  elements.savedPuzzles.addEventListener("change", () => {
    const state = savedStateByKey.get(elements.savedPuzzles.value);
    if (state) {
      window.location.assign(configurationUrl(state));
    }
  });
  elements.newPuzzle.addEventListener("click", () => {
    const knownSeeds = new Set(savedPuzzles().map((state) => state.seed));
    let seed = randomSeed();
    while (seed === configuration.seed || knownSeeds.has(seed)) {
      seed = randomSeed();
    }
    window.location.assign(configurationUrl({ ...configuration, seed }));
  });
  elements.options.addEventListener("submit", (event) => {
    event.preventDefault();
    const minVotes = Number(elements.minVotes.value);
    const types = normalizedTypes(
      elements.typeInputs.filter((input) => input.checked).map((input) => input.value),
    );
    if (!Number.isInteger(minVotes) || minVotes < 0) {
      setStatus("Minimum votes must be a non-negative integer.", "warning");
      return;
    }
    if (types.length === 0) {
      setStatus("Select at least one word type.", "warning");
      return;
    }
    window.location.assign(configurationUrl({ ...configuration, minVotes, types }));
  });
  elements.checkPuzzle.addEventListener("click", checkPuzzle);
  elements.clearPuzzle.addEventListener("click", clearPuzzle);
}

async function loadDictionary() {
  const response = await fetch("./data/definitions.json");
  if (!response.ok) {
    throw new Error(`Dictionary request failed with status ${response.status}.`);
  }
  const dictionary = await response.json();
  if (!dictionary || !Array.isArray(dictionary.entries)) {
    throw new Error("Dictionary data has an unexpected shape.");
  }
  return dictionary.entries;
}

async function main() {
  configuration = readConfiguration();
  elements.seed.textContent = configuration.seed;
  populateOptionForm();
  populateSavedPuzzleSelect();
  installPageControls();

  try {
    const dictionaryEntries = await loadDictionary();
    puzzle = generateDefinitionCrossword(
      dictionaryEntries,
      configuration.seed,
      configuration,
    );
    cellByKey = new Map(puzzle.cells.map((cell) => [cell.key, cell]));
    entryById = new Map(puzzle.entries.map((entry) => [entry.id, entry]));
    renderGrid();
    renderClues();
    restoreProgress();
    updateProgress();
    populateSavedPuzzleSelect();
    elements.checkPuzzle.disabled = false;
    elements.puzzle.setAttribute("aria-busy", "false");
    activateEntry(puzzle.entries[0].id);
  } catch (error) {
    showError(error);
  }
}

main();
