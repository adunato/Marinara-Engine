import test from "node:test";
import assert from "node:assert/strict";
import { resolveMacros, type MacroContext } from "@marinara-engine/shared";

function macroContext(variables: Record<string, string> = {}): MacroContext {
  return {
    user: "User",
    char: "Char",
    characters: ["Char"],
    variables,
  };
}

function withMockedRandom(values: number[], run: () => string): string {
  const originalRandom = Math.random;
  let index = 0;
  Math.random = () => {
    const value = values[index];
    assert.notEqual(value, undefined, "test consumed more random values than expected");
    index += 1;
    return value;
  };

  try {
    const output = run();
    assert.equal(index, values.length, "test did not consume all expected random values");
    return output;
  } finally {
    Math.random = originalRandom;
  }
}

test("random choices respect nested random macros as a single option", () => {
  const output = withMockedRandom([0.3, 0.5], () =>
    resolveMacros(
      "{{random::None::{{random::Alice::Bob::Carl}} appears.::The world ends.::{{random::Doug::Erin::Frank}} leaves.::A nearby car explodes.}}",
      macroContext(),
    ),
  );

  assert.equal(output, "Bob appears.");
});

test("random choices can resolve nested variable macros", () => {
  const output = withMockedRandom([0.2], () =>
    resolveMacros("{{random::{{getvar::actor}} leaves.::The world ends.}}", macroContext({ actor: "Doug" })),
  );

  assert.equal(output, "Doug leaves.");
});

test("setvar values can resolve nested random choices", () => {
  const ctx = macroContext();
  const output = withMockedRandom([0.8], () =>
    resolveMacros("{{setvar::actor::{{random::Alice::Bob}}}}{{getvar::actor}}", ctx),
  );

  assert.equal(output, "Bob");
  assert.equal(ctx.variables.actor, "Bob");
});

test("unweighted random choices keep equal selection behavior", () => {
  const first = withMockedRandom([0], () => resolveMacros("{{random::A::B::C}}", macroContext()));
  const middle = withMockedRandom([0.4], () => resolveMacros("{{random::A::B::C}}", macroContext()));
  const last = withMockedRandom([0.9], () => resolveMacros("{{random::A::B::C}}", macroContext()));

  assert.equal(first, "A");
  assert.equal(middle, "B");
  assert.equal(last, "C");
});

test("random choices support relative decimal weights", () => {
  const common = withMockedRandom([0.5], () => resolveMacros("{{random::Common@1::Rare@0.25}}", macroContext()));
  const rare = withMockedRandom([0.9], () => resolveMacros("{{random::Common@1::Rare@0.25}}", macroContext()));

  assert.equal(common, "Common");
  assert.equal(rare, "Rare");
});

test("random choices do not select zero-weight options", () => {
  const output = withMockedRandom([0], () => resolveMacros("{{random::Never@0::Always@1}}", macroContext()));

  assert.equal(output, "Always");
});

test("random choices with all zero weights resolve to empty text", () => {
  assert.equal(resolveMacros("Before {{random::Never@0::Also never@0}} after", macroContext()), "Before  after");
});

test("weighted random choices can resolve nested macros", () => {
  const output = withMockedRandom([0.1], () =>
    resolveMacros("{{random::{{getvar::actor}} leaves.@0.5::The world ends.@0.5}}", macroContext({ actor: "Doug" })),
  );

  assert.equal(output, "Doug leaves.");
});

test("invalid weight suffixes stay literal", () => {
  const output = withMockedRandom([0], () => resolveMacros("{{random::literal@nope::weighted@2}}", macroContext()));

  assert.equal(output, "literal@nope");
});
