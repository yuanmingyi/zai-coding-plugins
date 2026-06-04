import { describe, expect, it } from "vitest";

import { renderTemplate } from "../arbitrary/renderTemplate.js";

describe("arbitrary/renderTemplate", () => {
  it("substitutes a single placeholder", () => {
    expect(renderTemplate("Hello {{name}}!", { name: "world" })).toBe(
      "Hello world!",
    );
  });

  it("substitutes multiple distinct placeholders", () => {
    expect(
      renderTemplate("{{a}} + {{b}} = {{c}}", { a: "1", b: "2", c: "3" }),
    ).toBe("1 + 2 = 3");
  });

  it("substitutes the same placeholder more than once", () => {
    expect(renderTemplate("{{x}}-{{x}}", { x: "go" })).toBe("go-go");
  });

  it("treats empty string as a valid value", () => {
    expect(renderTemplate("[{{tag}}]", { tag: "" })).toBe("[]");
  });

  it("throws when a placeholder has no matching key", () => {
    expect(() => renderTemplate("Hi {{missing}}", {})).toThrow(/missing/);
  });

  it("throws when data contains a key with no placeholder", () => {
    expect(() =>
      renderTemplate("Hi {{name}}", { name: "x", extra: "y" }),
    ).toThrow(/extra/);
  });

  it("throws when a data value is null or undefined", () => {
    expect(() => renderTemplate("{{x}}", { x: null })).toThrow();
    expect(() => renderTemplate("{{x}}", { x: undefined })).toThrow();
  });

  it("preserves literal braces that are not placeholder syntax", () => {
    expect(renderTemplate("{not a var} {{x}}", { x: "ok" })).toBe(
      "{not a var} ok",
    );
  });

  it("allows placeholders adjacent to other characters", () => {
    expect(renderTemplate("pre{{v}}post", { v: "MID" })).toBe("preMIDpost");
  });

  it("does not re-process placeholder syntax that appears inside a substituted value", () => {
    // Pins the non-injection contract: values containing {{...}} render literally.
    expect(renderTemplate("{{x}}", { x: "{{y}}" })).toBe("{{y}}");
  });
});
