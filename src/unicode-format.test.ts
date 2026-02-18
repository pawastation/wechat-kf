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

  it("preserves code blocks unchanged with visual markers", () => {
    const result = markdownToUnicode("```\n**not bold**\n```");
    expect(result).toContain("**not bold**");
    expect(result).toContain("━━━ code ━━━");
    expect(result).toContain("━━━━━━━━━━━━");
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

  // --- P2-03 new tests ---

  it("heading with inline italic: # Hello *world* → all bold", () => {
    const result = markdownToUnicode("# Hello *world*");
    // Should not contain # or *
    expect(result).not.toContain("#");
    expect(result).not.toContain("*");
    // Both Hello and world should be bold (not plain ASCII)
    expect(result).not.toContain("Hello");
    expect(result).not.toContain("world");
    // Length should match "Hello world" = 11 chars (space passes through)
    expect([...result].length).toBe(11);
  });

  it("heading with inline bold: ## Title **emphasis** → all bold", () => {
    const result = markdownToUnicode("## Title **emphasis**");
    expect(result).not.toContain("#");
    expect(result).not.toContain("*");
    expect(result).not.toContain("Title");
    expect(result).not.toContain("emphasis");
  });

  it("* list items are not treated as italic", () => {
    const result = markdownToUnicode("* first item\n* second item");
    expect(result).toBe("• first item\n• second item");
  });

  it("mixed - and * list items", () => {
    const result = markdownToUnicode("- alpha\n* beta\n- gamma");
    expect(result).toBe("• alpha\n• beta\n• gamma");
  });

  it("![alt](url) converts to [alt](url) not !alt (url)", () => {
    const result = markdownToUnicode("![screenshot](https://img.example.com/a.png)");
    expect(result).toBe("screenshot (https://img.example.com/a.png)");
  });

  it("image with empty alt text", () => {
    const result = markdownToUnicode("![](https://img.example.com/a.png)");
    expect(result).toBe(" (https://img.example.com/a.png)");
  });

  it("task list: - [x] done → ☑ done", () => {
    const result = markdownToUnicode("- [x] done\n- [ ] todo");
    expect(result).toBe("\u2611 done\n\u2610 todo");
  });

  it("task list with indentation", () => {
    const result = markdownToUnicode("  - [x] sub-done\n  - [ ] sub-todo");
    expect(result).toBe("  \u2611 sub-done\n  \u2610 sub-todo");
  });

  it("code block has visual separation markers", () => {
    const result = markdownToUnicode("before\n```js\nconsole.log('hi');\n```\nafter");
    expect(result).toContain("━━━ code ━━━");
    expect(result).toContain("console.log('hi');");
    expect(result).toContain("━━━━━━━━━━━━");
    expect(result).toContain("before");
    expect(result).toContain("after");
  });

  it("escape characters: \\* and \\_ are preserved literally", () => {
    const result = markdownToUnicode("not \\*italic\\* here");
    expect(result).toBe("not *italic* here");
  });

  it("escape characters: \\# is preserved literally", () => {
    const result = markdownToUnicode("\\# not a heading");
    expect(result).toBe("# not a heading");
  });

  it("escape backslash: \\\\ is preserved as single backslash", () => {
    const result = markdownToUnicode("path\\\\here");
    expect(result).toBe("path\\here");
  });

  it("multiline bold: **across\\nlines** is converted", () => {
    const result = markdownToUnicode("**line one\nline two**");
    // Should be converted (not plain ASCII)
    expect(result).not.toContain("line one");
    expect(result).not.toContain("line two");
  });

  it("multiline bold italic: ***across\\nlines*** is converted", () => {
    const result = markdownToUnicode("***first\nsecond***");
    expect(result).not.toContain("first");
    expect(result).not.toContain("second");
  });

  it("large text does not cause regex backtracking issues", () => {
    // Build a large string with repetitive markdown patterns
    const bigText = Array.from({ length: 500 }, (_, i) => `**bold${i}** and *italic${i}*`).join("\n");
    const start = Date.now();
    const result = markdownToUnicode(bigText);
    const elapsed = Date.now() - start;
    // Should complete in reasonable time (< 2 seconds)
    expect(elapsed).toBeLessThan(2000);
    // Sanity check: no plain "bold0" should remain
    expect(result).not.toContain("bold0");
  });

  it("combined: image, link, task list, heading in one input", () => {
    const input = [
      "# My Doc",
      "",
      "![logo](https://x.com/logo.png)",
      "",
      "- [x] Task done",
      "- [ ] Task pending",
      "",
      "[click](https://example.com)",
      "",
      "```",
      "code here",
      "```",
    ].join("\n");
    const result = markdownToUnicode(input);
    // heading converted
    expect(result).not.toContain("#");
    // image converted to link format
    expect(result).toContain("logo (https://x.com/logo.png)");
    // task list converted
    expect(result).toContain("\u2611 Task done");
    expect(result).toContain("\u2610 Task pending");
    // link converted
    expect(result).toContain("click (https://example.com)");
    // code block with markers
    expect(result).toContain("━━━ code ━━━");
    expect(result).toContain("code here");
  });
});
