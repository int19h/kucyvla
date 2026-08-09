const SUBSCRIPT_DIGITS = Object.freeze({
  0: "₀",
  1: "₁",
  2: "₂",
  3: "₃",
  4: "₄",
  5: "₅",
  6: "₆",
  7: "₇",
  8: "₈",
  9: "₉",
});
const SUPERSCRIPT_DIGITS = Object.freeze({
  0: "⁰",
  1: "¹",
  2: "²",
  3: "³",
  4: "⁴",
  5: "⁵",
  6: "⁶",
  7: "⁷",
  8: "⁸",
  9: "⁹",
});

function translatedDigits(digits, table) {
  return [...digits].map((digit) => table[digit] ?? digit).join("");
}

function formatMathSegment(segment) {
  return segment
    .replace(/_\{?(\d+)\}?/g, (_, digits) => translatedDigits(digits, SUBSCRIPT_DIGITS))
    .replace(/\^\{?(\d+)\}?/g, (_, digits) => translatedDigits(digits, SUPERSCRIPT_DIGITS))
    .replace(/[{}]/g, "");
}

export function formatDictionaryDefinition(definition) {
  return definition.replace(/\$([^$]+)\$/g, (_, segment) => formatMathSegment(segment));
}
