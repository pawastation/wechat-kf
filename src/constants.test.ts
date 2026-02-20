import { describe, expect, it } from "vitest";
import { formatError } from "./constants.js";

describe("formatError", () => {
  it("extracts message from Error instances", () => {
    expect(formatError(new Error("boom"))).toBe("boom");
  });

  it("converts string to itself", () => {
    expect(formatError("oops")).toBe("oops");
  });

  it("converts number to string", () => {
    expect(formatError(42)).toBe("42");
  });

  it("converts null to 'null'", () => {
    expect(formatError(null)).toBe("null");
  });

  it("converts undefined to 'undefined'", () => {
    expect(formatError(undefined)).toBe("undefined");
  });
});
