import { describe, expect, it } from "vitest";
import { buildFunctionFromSource } from "../src/lib/buildFunction.js";

describe("buildFunctionFromSource", () => {
  it("builds an arrow function from source and calls it", () => {
    const fn = buildFunctionFromSource("(x) => x * 2", "fnSource");
    expect(fn(21)).toBe(42);
  });

  it("builds a function-expression from source", () => {
    const fn = buildFunctionFromSource("function (x) { return x + 1; }", "fnSource");
    expect(fn(41)).toBe(42);
  });

  it("does not share scope with the caller (only globals are visible)", () => {
    // If the built function could see local variables from this scope, this
    // would either throw a different error or accidentally succeed.
    const fn = buildFunctionFromSource("() => typeof secretLocal", "fnSource");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- deliberately shadow-tested, not referenced
    const secretLocal = "should not be visible";
    expect(fn()).toBe("undefined");
  });

  it("throws a clear error, naming the label, for invalid JS syntax", () => {
    expect(() => buildFunctionFromSource("this is not valid js (((", "myLabel")).toThrow(/myLabel/);
  });

  it("throws a clear error when the source evaluates to a non-function value", () => {
    expect(() => buildFunctionFromSource("42", "myLabel")).toThrow(/myLabel evaluated to a number, not a function/);
  });

  it("throws when the source evaluates to an object, not a function", () => {
    expect(() => buildFunctionFromSource("({ not: 'a function' })", "myLabel")).toThrow(
      /myLabel evaluated to a object, not a function/,
    );
  });

  it("propagates a runtime error thrown when the built function itself is called", () => {
    const fn = buildFunctionFromSource("() => { throw new Error('boom'); }", "fnSource");
    expect(() => fn()).toThrow("boom");
  });
});
