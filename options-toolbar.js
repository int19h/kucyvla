import {
  DEFAULT_DEFINITION_OPTIONS,
  DEFINITION_TYPE_ORDER,
} from "./definition-crossword.js";
import { readDefinitionProgress } from "./definition-storage.js";
import {
  DEFAULT_RAFSI_TYPES,
  RAFSI_TYPE_ORDER,
  readSavedPuzzles,
} from "./storage.js";

const TYPE_LABELS = Object.freeze({
  gismu: "gismu",
  lujvo: "lujvo",
  cmevla: "cmevla",
  fuivla: "fu'ivla",
  cmavo: "cmavo",
});

function randomSeed() {
  const parts = new Uint32Array(3);
  crypto.getRandomValues(parts);
  return [...parts]
    .map((part) => part.toString(36).padStart(7, "0"))
    .join("-");
}

function normalizedTypes(types, order) {
  return order.filter((type) => types?.includes(type));
}

function configurationUrl(clueType, configuration, useCurrentPage = false) {
  const page = clueType === "definition" ? "./index.html" : "./rafsi.html";
  const url = useCurrentPage
    ? new URL(window.location.href)
    : new URL(page, window.location.href);
  url.search = "";
  url.searchParams.set("seed", configuration.seed);
  if (clueType === "definition") {
    url.searchParams.set("minVotes", String(configuration.minVotes));
  }
  url.searchParams.set("types", configuration.types.join(","));
  return url;
}

export function readDefinitionConfiguration() {
  const url = new URL(window.location.href);
  const seed = url.searchParams.get("seed")?.trim() || randomSeed();
  const rawMinVotes = url.searchParams.get("minVotes");
  const parsedMinVotes = rawMinVotes === null ? NaN : Number(rawMinVotes);
  const minVotes = Number.isInteger(parsedMinVotes) && parsedMinVotes >= 0
    ? parsedMinVotes
    : DEFAULT_DEFINITION_OPTIONS.minVotes;
  const rawTypes = url.searchParams.get("types");
  const requestedTypes = rawTypes === null
    ? DEFAULT_DEFINITION_OPTIONS.types
    : rawTypes.split(",");
  const selectedTypes = normalizedTypes(requestedTypes, DEFINITION_TYPE_ORDER);
  const configuration = {
    seed,
    minVotes,
    types: selectedTypes.length > 0
      ? selectedTypes
      : [...DEFAULT_DEFINITION_OPTIONS.types],
  };
  const canonicalUrl = configurationUrl("definition", configuration, true);
  if (canonicalUrl.href !== url.href) {
    window.history.replaceState(null, "", canonicalUrl);
  }
  return configuration;
}

export function readRafsiConfiguration() {
  const url = new URL(window.location.href);
  const seed = url.searchParams.get("seed")?.trim() || randomSeed();
  const rawTypes = url.searchParams.get("types");
  const requestedTypes = rawTypes === null ? DEFAULT_RAFSI_TYPES : rawTypes.split(",");
  const selectedTypes = normalizedTypes(requestedTypes, RAFSI_TYPE_ORDER);
  const configuration = {
    seed,
    types: selectedTypes.length > 0 ? selectedTypes : [...DEFAULT_RAFSI_TYPES],
  };
  const canonicalUrl = configurationUrl("rafsi", configuration, true);
  if (canonicalUrl.href !== url.href) {
    window.history.replaceState(null, "", canonicalUrl);
  }
  return configuration;
}

function truncatedSeed(seed) {
  return seed.length <= 22 ? seed : `${seed.slice(0, 19)}…`;
}

function savedPuzzleLabel(saved) {
  const count = Object.keys(saved.values).length;
  const typeSummary = saved.types.map((type) => TYPE_LABELS[type]).join("+");
  const filterSummary = saved.clueType === "definition"
    ? `${typeSummary} · ≥${saved.minVotes}`
    : typeSummary;
  return `${saved.clueType === "definition" ? "Definitions" : "Rafsi"} · ${truncatedSeed(saved.seed)} · ${filterSummary} · ${count} ${count === 1 ? "letter" : "letters"}`;
}

function savedPuzzles(storage) {
  return [
    ...readDefinitionProgress(storage).map((saved) => ({
      ...saved,
      clueType: "definition",
    })),
    ...readSavedPuzzles(storage).map((saved) => ({
      ...saved,
      clueType: "rafsi",
    })),
  ].sort((left, right) => right.updatedAt - left.updatedAt);
}

function setCheckedValues(inputs, selectedValues) {
  for (const input of inputs) {
    input.checked = selectedValues.includes(input.value);
  }
}

function selectedValues(inputs, order) {
  const checkedValues = inputs
    .filter((input) => input.checked)
    .map((input) => input.value);
  return normalizedTypes(checkedValues, order);
}

export function initializeOptionsToolbar({
  currentClueType,
  configuration,
  setStatus,
}) {
  const elements = {
    form: document.querySelector("#options-toolbar"),
    savedLoad: document.querySelector("#saved-load"),
    savedToggle: document.querySelector("#saved-toggle"),
    savedMenu: document.querySelector("#saved-menu"),
    clueType: document.querySelector("#clue-type"),
    seed: document.querySelector("#seed-input"),
    newSeed: document.querySelector("#new-seed"),
    definitionSelection: document.querySelector("#definition-word-selection"),
    rafsiSelection: document.querySelector("#rafsi-word-selection"),
    minVotes: document.querySelector("#min-votes"),
    definitionTypes: [...document.querySelectorAll('input[name="definitionWordType"]')],
    rafsiTypes: [...document.querySelectorAll('input[name="rafsiWordType"]')],
  };

  elements.clueType.value = currentClueType;
  elements.seed.value = configuration.seed;
  elements.minVotes.value = String(
    currentClueType === "definition"
      ? configuration.minVotes
      : DEFAULT_DEFINITION_OPTIONS.minVotes,
  );
  setCheckedValues(
    elements.definitionTypes,
    currentClueType === "definition"
      ? configuration.types
      : DEFAULT_DEFINITION_OPTIONS.types,
  );
  setCheckedValues(
    elements.rafsiTypes,
    currentClueType === "rafsi" ? configuration.types : DEFAULT_RAFSI_TYPES,
  );

  document.body.append(elements.savedMenu);
  let menuIsOpen = false;

  function closeSavedMenu() {
    menuIsOpen = false;
    elements.savedMenu.hidden = true;
    elements.savedLoad.setAttribute("aria-expanded", "false");
    elements.savedToggle.setAttribute("aria-expanded", "false");
  }

  function positionSavedMenu() {
    const anchor = elements.savedLoad.parentElement.getBoundingClientRect();
    const menu = elements.savedMenu;
    const edgeGap = 8;
    const width = Math.min(
      Math.max(anchor.width, menu.scrollWidth),
      window.innerWidth - edgeGap * 2,
    );
    const left = Math.max(
      edgeGap,
      Math.min(anchor.left, window.innerWidth - width - edgeGap),
    );
    menu.style.minWidth = `${anchor.width}px`;
    menu.style.maxWidth = `${window.innerWidth - edgeGap * 2}px`;
    menu.style.left = `${left}px`;
    const below = anchor.bottom + 5;
    const top = below + menu.offsetHeight <= window.innerHeight - edgeGap
      ? below
      : Math.max(edgeGap, anchor.top - menu.offsetHeight - 5);
    menu.style.top = `${top}px`;
  }

  function openSavedMenu() {
    if (elements.savedLoad.disabled) {
      return;
    }
    menuIsOpen = true;
    elements.savedMenu.hidden = false;
    elements.savedLoad.setAttribute("aria-expanded", "true");
    elements.savedToggle.setAttribute("aria-expanded", "true");
    positionSavedMenu();
    elements.savedMenu.querySelector("button")?.focus();
  }

  function toggleSavedMenu() {
    if (menuIsOpen) {
      closeSavedMenu();
    } else {
      openSavedMenu();
    }
  }

  function refreshSavedPuzzles() {
    const saved = savedPuzzles(window.localStorage);
    elements.savedMenu.replaceChildren();
    for (const state of saved) {
      const item = document.createElement("button");
      item.className = "saved-menu__item";
      item.type = "button";
      item.role = "menuitem";
      item.textContent = savedPuzzleLabel(state);
      item.addEventListener("click", () => {
        window.location.assign(configurationUrl(state.clueType, state));
      });
      elements.savedMenu.append(item);
    }
    const hasSavedPuzzles = saved.length > 0;
    elements.savedLoad.disabled = !hasSavedPuzzles;
    elements.savedToggle.disabled = !hasSavedPuzzles;
    if (!hasSavedPuzzles) {
      closeSavedMenu();
    } else if (menuIsOpen) {
      positionSavedMenu();
    }
  }

  function updateVisibleWordSelection() {
    const showDefinitions = elements.clueType.value === "definition";
    elements.definitionSelection.hidden = !showDefinitions;
    elements.rafsiSelection.hidden = showDefinitions;
  }

  elements.savedLoad.addEventListener("click", toggleSavedMenu);
  elements.savedToggle.addEventListener("click", toggleSavedMenu);
  elements.clueType.addEventListener("change", updateVisibleWordSelection);
  elements.newSeed.addEventListener("click", () => {
    const knownSeeds = new Set(savedPuzzles(window.localStorage).map((saved) => saved.seed));
    let seed = randomSeed();
    while (seed === elements.seed.value || knownSeeds.has(seed)) {
      seed = randomSeed();
    }
    elements.seed.value = seed;
    elements.seed.focus();
    elements.seed.select();
  });
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const clueType = elements.clueType.value;
    const seed = elements.seed.value.trim();
    if (!seed) {
      setStatus("Enter a seed before generating.", "warning");
      elements.seed.focus();
      return;
    }
    if (clueType === "definition") {
      const minVotes = Number(elements.minVotes.value);
      const types = selectedValues(elements.definitionTypes, DEFINITION_TYPE_ORDER);
      if (!Number.isInteger(minVotes) || minVotes < 0) {
        setStatus("Minimum votes must be a non-negative integer.", "warning");
        elements.minVotes.focus();
        return;
      }
      if (types.length === 0) {
        setStatus("Select at least one word type.", "warning");
        elements.definitionTypes[0].focus();
        return;
      }
      window.location.assign(configurationUrl("definition", { seed, minVotes, types }));
      return;
    }

    const types = selectedValues(elements.rafsiTypes, RAFSI_TYPE_ORDER);
    if (types.length === 0) {
      setStatus("Select at least one word type.", "warning");
      elements.rafsiTypes[0].focus();
      return;
    }
    window.location.assign(configurationUrl("rafsi", { seed, types }));
  });

  document.addEventListener("pointerdown", (event) => {
    if (
      menuIsOpen
      && !elements.savedMenu.contains(event.target)
      && !elements.savedLoad.parentElement.contains(event.target)
    ) {
      closeSavedMenu();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (menuIsOpen && event.key === "Escape") {
      closeSavedMenu();
      elements.savedToggle.focus();
    }
  });
  window.addEventListener("resize", () => {
    if (menuIsOpen) {
      positionSavedMenu();
    }
  });
  window.addEventListener("scroll", (event) => {
    if (event.target !== elements.savedMenu) {
      closeSavedMenu();
    }
  }, true);

  updateVisibleWordSelection();
  refreshSavedPuzzles();
  return { refreshSavedPuzzles };
}
