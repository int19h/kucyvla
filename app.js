import { generateCrossword } from "./crossword.js";
import {
  initializeOptionsToolbar,
  readRafsiConfiguration,
} from "./options-toolbar.js";
import {
  rafsiConfigurationKey,
  readSavedPuzzles,
  removePuzzleProgress,
  writePuzzleProgress,
} from "./storage.js";

const elements = {
  puzzle: document.querySelector("#puzzle"),
  progress: document.querySelector("#progress"),
  status: document.querySelector("#status"),
  error: document.querySelector("#error"),
  grid: document.querySelector("#grid"),
  acrossClues: document.querySelector("#across-clues"),
  downClues: document.querySelector("#down-clues"),
  acrossCount: document.querySelector("#across-count"),
  downCount: document.querySelector("#down-count"),
  checkPuzzle: document.querySelector("#check-puzzle"),
  clearPuzzle: document.querySelector("#clear-puzzle"),
};

let configuration = null;
let puzzle = null;
let optionsToolbar = null;
let cellByKey = new Map();
let entryById = new Map();
let cellElementByKey = new Map();
let inputByKey = new Map();
let clueButtonByEntryId = new Map();
let activeCellKey = null;
let activeDirection = "across";

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
  elements.error.textContent = `The puzzle could not be loaded. ${detail}`;
  elements.error.hidden = false;
  elements.progress.textContent = "Unavailable";
  elements.puzzle.setAttribute("aria-busy", "false");
}

function savedPuzzles() {
  return readSavedPuzzles(window.localStorage);
}

function editableKeysForEntry(entry) {
  return entry.cellKeys.filter((key) => inputByKey.has(key));
}

function activeEntry() {
  if (!activeCellKey) {
    return null;
  }
  const cell = cellByKey.get(activeCellKey);
  if (!cell) {
    return null;
  }
  const id = cell.entryIds.find(
    (entryId) => entryById.get(entryId).direction === activeDirection,
  );
  return id ? entryById.get(id) : null;
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
  revealClueButton(clueButton);
}

function revealClueButton(button) {
  const list = button?.closest(".clue-list");
  const item = button?.parentElement;
  if (!list || !item) {
    return;
  }
  if (item.offsetTop < list.scrollTop) {
    list.scrollTop = item.offsetTop;
  } else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
    list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
  }
}

function focusNearestEditable(entry, preferredKey = null) {
  const editableKeys = editableKeysForEntry(entry);
  if (editableKeys.length === 0) {
    return;
  }
  const key = preferredKey && inputByKey.has(preferredKey)
    ? preferredKey
    : editableKeys[0];
  inputByKey.get(key).focus({ preventScroll: true });
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
    const entry = activeEntry();
    focusNearestEditable(entry, key);
  }
}

function activateEntry(entryId) {
  const entry = entryById.get(entryId);
  if (!entry) {
    return;
  }
  activeDirection = entry.direction;
  activeCellKey = editableKeysForEntry(entry)[0] ?? entry.cellKeys[0];
  paintActiveEntry();
  focusNearestEditable(entry, activeCellKey);
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
  const editableKeys = editableKeysForEntry(entry);
  const currentIndex = editableKeys.indexOf(activeCellKey);
  const nextIndex = currentIndex + delta;
  if (nextIndex >= 0 && nextIndex < editableKeys.length) {
    activateCell(editableKeys[nextIndex], entry.direction);
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
  activeDirection = direction;
  activeCellKey = key;
  const editableKeys = editableKeysForEntry(entry);
  const currentIndex = editableKeys.indexOf(key);
  const nextIndex = currentIndex + delta;
  if (nextIndex >= 0 && nextIndex < editableKeys.length) {
    activateCell(editableKeys[nextIndex], direction);
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
  if (filled === total && total > 0) {
    setStatus("The grid is full. Check it when you’re ready.");
  } else {
    setStatus("");
  }
}

function persistProgress() {
  const values = enteredValues();
  const stored = writePuzzleProgress(window.localStorage, {
    seed: puzzle.seed,
    types: configuration.types,
    signature: puzzle.signature,
    values,
  });
  if (!stored) {
    setStatus("Progress could not be saved in this browser.", "warning");
  }
  optionsToolbar.refreshSavedPuzzles();
}

function handleInput(event, key) {
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
  input.addEventListener("input", (event) => handleInput(event, cell.key));
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
    const currentCell = cellByKey.get(cell.key);
    const isSameCell = activeCellKey === cell.key;
    if (isSameCell && currentCell.entryIds.length === 2) {
      toggleDirection();
      focusNearestEditable(activeEntry(), cell.key);
    } else {
      activateCell(cell.key, activeDirection);
    }
  });
  return element;
}

function renderGrid() {
  elements.grid.replaceChildren();
  elements.grid.style.setProperty("--columns", puzzle.width);
  elements.grid.setAttribute("aria-rowcount", String(puzzle.height));
  elements.grid.setAttribute("aria-colcount", String(puzzle.width));

  for (let row = 0; row < puzzle.height; row += 1) {
    for (let column = 0; column < puzzle.width; column += 1) {
      const key = `${column},${row}`;
      const cell = cellByKey.get(key);
      if (cell) {
        elements.grid.append(renderCell(cell));
      } else {
        elements.grid.append(createElement("div", "block"));
      }
    }
  }
}

function renderClue(entry) {
  const item = createElement("li");
  const button = createElement("button", "clue-button");
  button.type = "button";
  button.dataset.entryId = entry.id;
  button.setAttribute(
    "aria-label",
    `${entry.number} ${entry.direction}, rafsi ${entry.clue}, ${entry.answer.length} letters`,
  );
  button.append(
    createElement("span", "clue-number", String(entry.number)),
    createElement("span", "clue-rafsi", entry.clue),
    createElement("span", "clue-length", `(${entry.answer.length})`),
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
  const key = rafsiConfigurationKey(configuration);
  const state = savedPuzzles().find(
    (candidate) => (
      rafsiConfigurationKey(candidate) === key
      && candidate.signature === puzzle.signature
    ),
  );
  if (!state) {
    return;
  }
  for (const [key, value] of Object.entries(state.values)) {
    const input = inputByKey.get(key);
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
    const cell = cellByKey.get(key);
    if (!input.value) {
      missing += 1;
    } else if (input.value !== cell.solution) {
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
    const missingMessage = missing > 0 ? ` and ${missing} empty` : "";
    setStatus(`${wrong} incorrect ${wrong === 1 ? "letter" : "letters"}${missingMessage}.`, "warning");
  }
}

function clearPuzzle() {
  if (!window.confirm("Clear every letter entered for this seed?")) {
    return;
  }
  for (const input of inputByKey.values()) {
    input.value = "";
  }
  clearCheckMarks();
  removePuzzleProgress(window.localStorage, configuration);
  optionsToolbar.refreshSavedPuzzles();
  updateProgress();
  const firstEntry = puzzle.entries[0];
  activateEntry(firstEntry.id);
}

function installPageControls() {
  elements.checkPuzzle.addEventListener("click", checkPuzzle);
  elements.clearPuzzle.addEventListener("click", clearPuzzle);
}

async function loadDictionary() {
  const response = await fetch("./data/rafsi.json");
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
  configuration = readRafsiConfiguration();
  optionsToolbar = initializeOptionsToolbar({
    currentClueType: "rafsi",
    configuration,
    setStatus,
  });
  installPageControls();

  try {
    const dictionaryEntries = await loadDictionary();
    const selectedTypes = new Set(configuration.types);
    const eligibleEntries = dictionaryEntries.filter(
      (entry) => selectedTypes.has(entry.type),
    );
    const includesGismu = selectedTypes.has("gismu");
    const includesCmavo = selectedTypes.has("cmavo");
    puzzle = generateCrossword(eligibleEntries, configuration.seed, {
      minimumCmavo: includesGismu && includesCmavo ? 3 : 0,
      maximumCmavo: includesCmavo ? (includesGismu ? 6 : Infinity) : 0,
    });
    cellByKey = new Map(puzzle.cells.map((cell) => [cell.key, cell]));
    entryById = new Map(puzzle.entries.map((entry) => [entry.id, entry]));
    renderGrid();
    renderClues();
    restoreProgress();
    updateProgress();
    optionsToolbar.refreshSavedPuzzles();
    elements.checkPuzzle.disabled = false;
    elements.puzzle.setAttribute("aria-busy", "false");
    activateEntry(puzzle.entries[0].id);
  } catch (error) {
    showError(error);
  }
}

main();
