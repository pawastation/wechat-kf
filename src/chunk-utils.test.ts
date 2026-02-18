import { describe, it, expect } from "vitest";
import { chunkText } from "./chunk-utils.js";

describe("chunkText", () => {
  it("returns single-element array for short text under limit", () => {
    expect(chunkText("hello", 10)).toEqual(["hello"]);
  });

  it("returns single-element array for text exactly at limit", () => {
    const text = "a".repeat(20);
    expect(chunkText(text, 20)).toEqual([text]);
  });

  it("returns empty array for empty string", () => {
    expect(chunkText("", 100)).toEqual([]);
  });

  it("returns empty array for whitespace-only string", () => {
    expect(chunkText("   ", 100)).toEqual([]);
  });

  it("returns empty array when limit is 0", () => {
    expect(chunkText("hello", 0)).toEqual([]);
  });

  it("returns empty array when limit is negative", () => {
    expect(chunkText("hello", -5)).toEqual([]);
  });

  it("splits at newline boundaries when possible", () => {
    const text = "line one\nline two\nline three";
    const chunks = chunkText(text, 15);
    // "line one" (8) fits, "line two" (8) fits, "line three" (10) fits
    // First chunk: "line one\nline t" would be 15 chars, but should split at \n
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(15);
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
  });

  it("splits at space boundaries when no newline available", () => {
    const text = "word1 word2 word3 word4 word5";
    const chunks = chunkText(text, 12);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(12);
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
    // Rejoining should recover all words
    const rejoined = chunks.join(" ");
    expect(rejoined).toBe(text);
  });

  it("hard-splits when no whitespace found (long URL)", () => {
    const url = "https://example.com/" + "a".repeat(100);
    const chunks = chunkText(url, 30);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(30);
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it("handles Chinese text (multi-byte) by character count not byte count", () => {
    // Each Chinese character is 1 char in JS string, but 3 bytes in UTF-8
    const text = "你好世界测试文本这是一段中文";
    expect(text.length).toBe(14);
    const chunks = chunkText(text, 5);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(5);
      expect(chunk.length).toBeGreaterThan(0);
    }
    // All characters preserved
    expect(chunks.join("")).toBe(text);
  });

  it("all chunks are within the limit for multi-chunk split", () => {
    const text = "The quick brown fox jumps over the lazy dog. ".repeat(20);
    const limit = 50;
    const chunks = chunkText(text, limit);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(limit);
    }
  });

  it("never returns empty chunks", () => {
    const text = "hello\n\n\n\nworld";
    const chunks = chunkText(text, 6);
    for (const chunk of chunks) {
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
  });

  it("trims whitespace at chunk boundaries", () => {
    const text = "chunk one   \n   chunk two";
    const chunks = chunkText(text, 15);
    for (const chunk of chunks) {
      expect(chunk).toBe(chunk.trim());
    }
  });

  it("handles text with mixed newlines and spaces", () => {
    const text = "First paragraph with some text.\n\nSecond paragraph here.\n\nThird one.";
    const chunks = chunkText(text, 35);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(35);
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it("handles single character limit", () => {
    const text = "abc";
    const chunks = chunkText(text, 1);
    expect(chunks).toEqual(["a", "b", "c"]);
  });

  it("preserves content across chunks (no data loss)", () => {
    const text = "Hello World! This is a test of the chunking system.";
    const chunks = chunkText(text, 15);
    // All original non-whitespace characters should appear in the joined result
    const joined = chunks.join(" ");
    for (const word of text.split(/\s+/)) {
      expect(joined).toContain(word);
    }
  });
});
