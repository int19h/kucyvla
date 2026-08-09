import assert from "node:assert/strict";
import test from "node:test";

import { formatDictionaryDefinition } from "../definition-format.js";

test("dictionary place and exponent notation is rendered readably", () => {
  assert.equal(
    formatDictionaryDefinition("$x_{1}$ is $10^{21}$ times $x_2$; $g_1=b_1$."),
    "x₁ is 10²¹ times x₂; g₁=b₁.",
  );
});
