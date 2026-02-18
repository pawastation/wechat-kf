import { describe, it, expect } from "vitest";
import { markdownToUnicode } from "./unicode-format.js";

describe("markdownToUnicode", () => {
  it("converts **bold** to Unicode Mathematical Bold", () => {
    const result = markdownToUnicode("**hello**");
    // Should be different from plain "hello"
    expect(result).not.toBe("hello");
    // Each char should be a multi-byte Unicode char
    expect([...result].length).toBe(5);
  });

  it("converts *italic* to Unicode Mathematical Italic", () => {
    const result = markdownToUnicode("*hello*");
    expect(result).not.toBe("hello");
    expect([...result].length).toBe(5);
  });

  it("converts ***bold italic*** to Unicode Mathematical Bold Italic", () => {
    const result = markdownToUnicode("***hello***");
    expect(result).not.toBe("hello");
    expect([...result].length).toBe(5);
  });

  it("bold, italic, and bold-italic produce different outputs", () => {
    const bold = markdownToUnicode("**abc**");
    const italic = markdownToUnicode("*abc*");
    const boldItalic = markdownToUnicode("***abc***");
    expect(bold).not.toBe(italic);
    expect(bold).not.toBe(boldItalic);
    expect(italic).not.toBe(boldItalic);
  });

  it("preserves Chinese characters unchanged", () => {
    const result = markdownToUnicode("**你好** world");
    expect(result).toContain("你好");
    expect(result).toContain("world");
  });

  it("converts bold with mixed Chinese and English", () => {
    const result = markdownToUnicode("**Hello 你好**");
    expect(result).toContain("你好");
    // "Hello" should be converted (not plain ASCII)
    expect(result).not.toContain("Hello");
  });

  it("preserves inline code unchanged", () => {
    const result = markdownToUnicode("use `**not bold**` here");
    expect(result).toContain("**not bold**");
  });

  it("preserves code blocks unchanged", () => {
    const result = markdownToUnicode("```\n**not bold**\n```");
    expect(result).toContain("**not bold**");
  });

  it("converts # headings to bold", () => {
    const result = markdownToUnicode("# Hello");
    // Should not contain the # prefix
    expect(result).not.toContain("#");
    // Should not be plain "Hello"
    expect(result).not.toBe("Hello");
  });

  it("converts - list items to bullet points", () => {
    const result = markdownToUnicode("- item one\n- item two");
    expect(result).toBe("• item one\n• item two");
  });

  it("converts > blockquotes", () => {
    const result = markdownToUnicode("> quote here");
    expect(result).toBe("┃ quote here");
  });

  it("converts [text](url) links", () => {
    const result = markdownToUnicode("[click here](https://example.com)");
    expect(result).toBe("click here (https://example.com)");
  });

  it("strips ~~ strikethrough markers", () => {
    const result = markdownToUnicode("~~deleted~~");
    expect(result).toBe("deleted");
  });

  it("handles empty input", () => {
    expect(markdownToUnicode("")).toBe("");
    expect(markdownToUnicode(null as any)).toBe(null);
  });

  it("converts bold digits to different characters", () => {
    const result = markdownToUnicode("**123**");
    expect(result).not.toBe("123");
    expect([...result].length).toBe(3);
  });

  it("handles italic h specially (U+210E)", () => {
    const result = markdownToUnicode("*h*");
    expect(result).toBe("\u210E");
  });

  it("leaves plain text unchanged", () => {
    expect(markdownToUnicode("just plain text")).toBe("just plain text");
  });

  it("handles horizontal rules", () => {
    const result = markdownToUnicode("---");
    expect(result).toBe("─────────");
  });
});
