import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  _reset,
  registerKfId,
  getKnownKfIds,
  loadKfIds,
  setStateDir,
  listAccountIds,
  resolveAccount,
  getChannelConfig,
} from "./accounts.js";

function makeTmpDir(): string {
  return join(tmpdir(), `accounts-test-${randomUUID()}`);
}

describe("accounts state isolation", () => {
  afterEach(() => {
    _reset();
  });

  it("_reset clears all discovered kfids", async () => {
    await registerKfId("kf_001");
    await registerKfId("kf_002");
    expect(getKnownKfIds()).toHaveLength(2);

    _reset();
    expect(getKnownKfIds()).toHaveLength(0);
  });

  it("_reset allows fresh state to accumulate", async () => {
    await registerKfId("kf_first");
    _reset();

    await registerKfId("kf_second");
    const ids = getKnownKfIds();
    expect(ids).toEqual(["kf_second"]);
    expect(ids).not.toContain("kf_first");
  });

  it("state does not leak between tests (test A: register kf_leak_a)", async () => {
    await registerKfId("kf_leak_a");
    expect(getKnownKfIds()).toContain("kf_leak_a");
  });

  it("state does not leak between tests (test B: kf_leak_a absent)", () => {
    // afterEach _reset ensures kf_leak_a from previous test is gone
    expect(getKnownKfIds()).not.toContain("kf_leak_a");
    expect(getKnownKfIds()).toHaveLength(0);
  });
});

describe("registerKfId", () => {
  afterEach(() => {
    _reset();
  });

  it("adds a kfid to the known set", async () => {
    await registerKfId("kf_abc");
    expect(getKnownKfIds()).toContain("kf_abc");
  });

  it("is idempotent — duplicate registration does not add twice", async () => {
    await registerKfId("kf_dup");
    await registerKfId("kf_dup");
    expect(getKnownKfIds().filter((id) => id === "kf_dup")).toHaveLength(1);
  });

  it("skips empty string registration", async () => {
    await registerKfId("");
    expect(getKnownKfIds()).toHaveLength(0);
  });
});

describe("loadKfIds", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    _reset();
    for (const dir of dirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    dirs.length = 0;
  });

  it("loads persisted kfids from JSON file", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "wechat-kf-kfids.json"),
      JSON.stringify(["kf_loaded_1", "kf_loaded_2"]),
    );

    await loadKfIds(dir);
    const ids = getKnownKfIds();
    expect(ids).toContain("kf_loaded_1");
    expect(ids).toContain("kf_loaded_2");
  });

  it("handles missing state file gracefully", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    await mkdir(dir, { recursive: true });

    // No kfids file exists — should not throw
    await loadKfIds(dir);
    expect(getKnownKfIds()).toHaveLength(0);
  });

  it("merges loaded kfids with already registered ones", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "wechat-kf-kfids.json"),
      JSON.stringify(["kf_from_file"]),
    );

    await registerKfId("kf_in_memory");
    await loadKfIds(dir);

    const ids = getKnownKfIds();
    expect(ids).toContain("kf_from_file");
    expect(ids).toContain("kf_in_memory");
  });

  it("sets stateDir so subsequent registerKfId persists to disk", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    await mkdir(dir, { recursive: true });

    await loadKfIds(dir);
    await registerKfId("kf_persisted");

    // Verify the file was written
    const data = await readFile(join(dir, "wechat-kf-kfids.json"), "utf8");
    const ids = JSON.parse(data);
    expect(ids).toContain("kf_persisted");
  });
});

describe("listAccountIds", () => {
  afterEach(() => {
    _reset();
  });

  it("returns ['default'] when no kfids are discovered", () => {
    const cfg = { channels: { "wechat-kf": {} } };
    expect(listAccountIds(cfg)).toEqual(["default"]);
  });

  it("returns discovered kfids when available", async () => {
    await registerKfId("kf_x");
    await registerKfId("kf_y");
    const cfg = { channels: { "wechat-kf": {} } };
    const ids = listAccountIds(cfg);
    expect(ids).toContain("kf_x");
    expect(ids).toContain("kf_y");
    expect(ids).not.toContain("default");
  });
});

describe("resolveAccount", () => {
  afterEach(() => {
    _reset();
  });

  it("recovers original case kfId from lowercased accountId", async () => {
    await registerKfId("wkABC123XYZ");
    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp1",
          appSecret: "sec",
          token: "tok",
          encodingAESKey: "key",
        },
      },
    };
    const account = resolveAccount(cfg, "wkabc123xyz");
    expect(account.openKfId).toBe("wkABC123XYZ");
  });

  it("returns undefined openKfId for 'default' accountId", () => {
    const cfg = { channels: { "wechat-kf": {} } };
    const account = resolveAccount(cfg, "default");
    expect(account.openKfId).toBeUndefined();
  });

  it("uses default port and path when not configured", () => {
    const cfg = { channels: { "wechat-kf": {} } };
    const account = resolveAccount(cfg);
    expect(account.webhookPort).toBe(9999);
    expect(account.webhookPath).toBe("/wechat-kf");
  });
});

describe("getChannelConfig", () => {
  it("returns channel config from nested structure", () => {
    const cfg = {
      channels: { "wechat-kf": { corpId: "test_corp" } },
    };
    const result = getChannelConfig(cfg);
    expect(result.corpId).toBe("test_corp");
  });

  it("returns empty object when channel config is missing", () => {
    const result = getChannelConfig({});
    expect(result).toEqual({});
  });
});
