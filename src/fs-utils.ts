/**
 * File-system utilities — atomic write via temp file + rename.
 *
 * On POSIX systems, `rename()` within the same filesystem is atomic,
 * so the target file is never left in a partially-written state.
 */

import { rename, writeFile } from "node:fs/promises";

export async function atomicWriteFile(
  filePath: string,
  content: string,
  encoding: BufferEncoding = "utf8",
): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, content, encoding);
  await rename(tmpPath, filePath); // atomic on the same filesystem
}
