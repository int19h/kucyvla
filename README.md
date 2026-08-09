# Lojban crosswords

Two standalone, seeded Lojban crossword varieties:

- `index.html` uses dictionary definitions as clues. It generates a
  180-degree rotationally symmetric pattern and then fills it with a constraint
  solver.
- `rafsi.html` uses assigned rafsi as clues and their source gismu or cmavo as
  answers.

The app has no build step, runtime dependencies, or server-side component. A
static host only needs to serve this directory. For local use, serve it over
HTTP so that the browser can load the JSON data file, for example:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/` for definition clues or
`http://localhost:8000/rafsi.html` for rafsi clues.

## GitHub Pages

The repository can be published directly from the root of the `main` branch.
All runtime URLs are relative, so the site also works under a GitHub Pages
project path such as `/kucyvla/`. The `.nojekyll` marker tells GitHub Pages to
serve the files as-is.

## Behavior

- `?seed=...` selects a puzzle. Without it, the browser creates a random seed
  and updates the URL before generating the puzzle.
- The same seed and bundled dictionary produce the same layout, fill, and clue
  choices.
- Entered letters are stored locally per seed. The saved-puzzle menu lists only
  seeds for which at least one letter has been entered.
- Apostrophes are ordinary editable grid letters and may be used as crossings.
- Empty positions inside the puzzle's bounding rectangle are drawn as black
  squares. The black-square pattern is not required to be symmetrical.

### Definition crossword

- The URL records the seed, inclusive minimum vote count, and selected types:
  `?seed=example&minVotes=5&types=gismu,lujvo`.
- The default threshold is 5 votes. Gismu and lujvo are enabled by default;
  cmevla and fu'ivla are available but disabled by default.
- The gismu category includes experimental gismu. The lujvo category contains
  ordinary single-word lujvo. Compound cmavo and other multiword categories are
  never exported.
- Saved progress is keyed by the full seed and filter configuration, so two
  puzzles with the same seed but different options retain independent state.
- White-square patterns have 180-degree rotational symmetry. Parallel entries
  cannot touch: entries either cross or have black-square separation.
- The geometry is generated first. A constraint solver then fills the slots
  with distinct eligible dictionary words.

## Dictionary export

Both data files are mechanically exported from jbotci's vendored English
Lensisku snapshot:

- `data/rafsi.json` contains standard `gismu` and `cmavo` entries with assigned
  rafsi. A rafsi identical to its source word is omitted because it would
  reveal the answer.
- `data/definitions.json` contains crossword spellings, definitions, vote
  scores, and type information for gismu, lujvo, cmevla, and fu'ivla. Commas
  and boundary periods are omitted from crossword spellings, capitalization is
  folded, and apostrophes remain ordinary letters.

With `jbotci` and `cross` next to one another under the same parent directory,
refresh the export with:

```sh
npm run export-dictionary
npm run export-definitions
```

An alternate input and output path can be supplied directly:

```sh
node scripts/export-dictionary.mjs /path/to/dictionary-en.json /path/to/rafsi.json
```

The exporter records the source file's SHA-256 digest and rejects malformed
words, duplicate answers, and rafsi claimed by multiple exported answers.

## Tests

```sh
npm test
```

The tests check deterministic generation, rotational symmetry, European-style
entry separation, constraint-valid dictionary fills, filter behavior,
apostrophe handling, and independent saved state for seeds and configurations.
