import { describe, it, expect, afterEach } from "vitest";
import { readFile, rm, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "./fs-utils.js";

// Each test gets a unique temp directory to avoid interference
function makeTmpDir(): string {
  return join(tmpdir(), `fs-utils-test-${randomUUID()}`);
}

describe("atomicWriteFile", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    for (const dir of dirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    dirs.length = 0;
  });

  it("writes content that can be read back correctly", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    await mkdir(dir, { recursive: true });

    const filePath = join(dir, "test.txt");
    await atomicWriteFile(filePath, "hello world");

    const content = await readFile(filePath, "utf8");
    expect(content).toBe("hello world");
  });

  it("does not leave a .tmp file after successful write", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    await mkdir(dir, { recursive: true });

    const filePath = join(dir, "test.txt");
    await atomicWriteFile(filePath, "data");

    // The .tmp file should have been renamed away
    await expect(stat(filePath + ".tmp")).rejects.toThrow();
  });

  it("overwrites existing file atomically", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    await mkdir(dir, { recursive: true });

    const filePath = join(dir, "test.txt");
    await atomicWriteFile(filePath, "original");
    await atomicWriteFile(filePath, "updated");

    const content = await readFile(filePath, "utf8");
    expect(content).toBe("updated");
  });

  it("writes valid JSON that can be parsed back", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    await mkdir(dir, { recursive: true });

    const filePath = join(dir, "data.json");
    const data = { ids: ["kf_001", "kf_002"], count: 2 };
    await atomicWriteFile(filePath, JSON.stringify(data));

    const content = await readFile(filePath, "utf8");
    expect(JSON.parse(content)).toEqual(data);
  });

  it("handles unicode content correctly", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    await mkdir(dir, { recursive: true });

    const filePath = join(dir, "unicode.txt");
    const unicode = "cursor_value_\u4e2d\u6587_\ud83d\ude00";
    await atomicWriteFile(filePath, unicode);

    const content = await readFile(filePath, "utf8");
    expect(content).toBe(unicode);
  });

  it("supports custom encoding", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    await mkdir(dir, { recursive: true });

    const filePath = join(dir, "latin.txt");
    await atomicWriteFile(filePath, "hello", "utf8");

    const content = await readFile(filePath, "utf8");
    expect(content).toBe("hello");
  });
});
