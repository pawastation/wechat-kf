import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  _reset,
  deleteKfId,
  disableKfId,
  enableKfId,
  getChannelConfig,
  getEnabledKfIds,
  getKnownKfIds,
  isKfIdEnabled,
  listAccountIds,
  loadKfIds,
  registerKfId,
  resolveAccount,
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
    await writeFile(join(dir, "wechat-kf-kfids.json"), JSON.stringify(["kf_loaded_1", "kf_loaded_2"]));

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
    await writeFile(join(dir, "wechat-kf-kfids.json"), JSON.stringify(["kf_from_file"]));

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

// ══════════════════════════════════════════════
// P3-06: account enable/disable/delete
// ══════════════════════════════════════════════

describe("disableKfId / enableKfId", () => {
  afterEach(() => {
    _reset();
  });

  it("disableKfId adds a kfid to the disabled set", async () => {
    await registerKfId("kf_abc");
    expect(isKfIdEnabled("kf_abc")).toBe(true);

    const changed = await disableKfId("kf_abc");
    expect(changed).toBe(true);
    expect(isKfIdEnabled("kf_abc")).toBe(false);
  });

  it("disableKfId is idempotent — returns false on duplicate", async () => {
    await registerKfId("kf_abc");
    await disableKfId("kf_abc");
    const changed = await disableKfId("kf_abc");
    expect(changed).toBe(false);
  });

  it("disableKfId skips empty string", async () => {
    const changed = await disableKfId("");
    expect(changed).toBe(false);
  });

  it("enableKfId re-enables a disabled kfid", async () => {
    await registerKfId("kf_abc");
    await disableKfId("kf_abc");
    expect(isKfIdEnabled("kf_abc")).toBe(false);

    const changed = await enableKfId("kf_abc");
    expect(changed).toBe(true);
    expect(isKfIdEnabled("kf_abc")).toBe(true);
  });

  it("enableKfId returns false when kfid is not disabled", async () => {
    await registerKfId("kf_abc");
    const changed = await enableKfId("kf_abc");
    expect(changed).toBe(false);
  });

  it("enableKfId skips empty string", async () => {
    const changed = await enableKfId("");
    expect(changed).toBe(false);
  });

  it("handles case-insensitive kfid lookup for disable/enable", async () => {
    await registerKfId("wkABC123");
    await disableKfId("wkabc123"); // lowercase
    expect(isKfIdEnabled("wkABC123")).toBe(false);
    expect(isKfIdEnabled("wkabc123")).toBe(false);

    await enableKfId("WKABC123"); // uppercase
    expect(isKfIdEnabled("wkABC123")).toBe(true);
  });
});

describe("getEnabledKfIds", () => {
  afterEach(() => {
    _reset();
  });

  it("returns all kfids when none are disabled", async () => {
    await registerKfId("kf_1");
    await registerKfId("kf_2");
    expect(getEnabledKfIds()).toEqual(["kf_1", "kf_2"]);
  });

  it("excludes disabled kfids", async () => {
    await registerKfId("kf_1");
    await registerKfId("kf_2");
    await disableKfId("kf_1");
    expect(getEnabledKfIds()).toEqual(["kf_2"]);
  });

  it("returns empty array when all are disabled", async () => {
    await registerKfId("kf_1");
    await disableKfId("kf_1");
    expect(getEnabledKfIds()).toEqual([]);
  });
});

describe("isKfIdEnabled", () => {
  afterEach(() => {
    _reset();
  });

  it("returns true for unknown kfids (not in disabled set)", () => {
    expect(isKfIdEnabled("kf_unknown")).toBe(true);
  });

  it("returns false for disabled kfids", async () => {
    await registerKfId("kf_abc");
    await disableKfId("kf_abc");
    expect(isKfIdEnabled("kf_abc")).toBe(false);
  });

  it("returns true after re-enabling", async () => {
    await registerKfId("kf_abc");
    await disableKfId("kf_abc");
    await enableKfId("kf_abc");
    expect(isKfIdEnabled("kf_abc")).toBe(true);
  });
});

describe("deleteKfId", () => {
  afterEach(() => {
    _reset();
  });

  it("removes kfid from discovered set and disables it", async () => {
    await registerKfId("kf_abc");
    expect(getKnownKfIds()).toContain("kf_abc");

    const wasKnown = await deleteKfId("kf_abc");
    expect(wasKnown).toBe(true);
    expect(getKnownKfIds()).not.toContain("kf_abc");
    expect(isKfIdEnabled("kf_abc")).toBe(false);
  });

  it("returns false for unknown kfid but still disables it", async () => {
    const wasKnown = await deleteKfId("kf_unknown");
    expect(wasKnown).toBe(false);
    expect(isKfIdEnabled("kf_unknown")).toBe(false);
  });

  it("skips empty string", async () => {
    const wasKnown = await deleteKfId("");
    expect(wasKnown).toBe(false);
  });

  it("prevents re-registration via registerKfId (disabled set blocks)", async () => {
    await registerKfId("kf_abc");
    await deleteKfId("kf_abc");

    // registerKfId adds to discoveredKfIds, but disabledKfIds still blocks
    await registerKfId("kf_abc");
    expect(getKnownKfIds()).toContain("kf_abc");
    // It is in discovered set again, but still disabled
    expect(isKfIdEnabled("kf_abc")).toBe(false);
    // And excluded from enabled list
    expect(getEnabledKfIds()).not.toContain("kf_abc");
  });

  it("handles case-insensitive kfid lookup", async () => {
    await registerKfId("wkABC123");
    const wasKnown = await deleteKfId("wkabc123"); // lowercase
    expect(wasKnown).toBe(true);
    expect(getKnownKfIds()).not.toContain("wkABC123");
  });
});

describe("disabled kfid persistence", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    _reset();
    for (const dir of dirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    dirs.length = 0;
  });

  it("persists disabled kfids to disk", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    await mkdir(dir, { recursive: true });
    await loadKfIds(dir);

    await registerKfId("kf_1");
    await disableKfId("kf_1");

    const data = await readFile(join(dir, "wechat-kf-disabled-kfids.json"), "utf8");
    const ids = JSON.parse(data);
    expect(ids).toContain("kf_1");
  });

  it("loads disabled kfids from disk on startup", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "wechat-kf-disabled-kfids.json"), JSON.stringify(["kf_disabled"]));
    await writeFile(join(dir, "wechat-kf-kfids.json"), JSON.stringify(["kf_disabled", "kf_active"]));

    await loadKfIds(dir);

    expect(getKnownKfIds()).toContain("kf_disabled");
    expect(getKnownKfIds()).toContain("kf_active");
    expect(isKfIdEnabled("kf_disabled")).toBe(false);
    expect(isKfIdEnabled("kf_active")).toBe(true);
    expect(getEnabledKfIds()).toEqual(["kf_active"]);
  });

  it("handles missing disabled kfids file gracefully", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    await mkdir(dir, { recursive: true });

    await loadKfIds(dir);
    // No disabled file — all kfids should be enabled
    await registerKfId("kf_1");
    expect(isKfIdEnabled("kf_1")).toBe(true);
  });

  it("deleteKfId persists both discovered and disabled sets", async () => {
    const dir = makeTmpDir();
    dirs.push(dir);
    await mkdir(dir, { recursive: true });
    await loadKfIds(dir);

    await registerKfId("kf_1");
    await registerKfId("kf_2");
    await deleteKfId("kf_1");

    const discoveredData = await readFile(join(dir, "wechat-kf-kfids.json"), "utf8");
    const disabledData = await readFile(join(dir, "wechat-kf-disabled-kfids.json"), "utf8");
    expect(JSON.parse(discoveredData)).not.toContain("kf_1");
    expect(JSON.parse(discoveredData)).toContain("kf_2");
    expect(JSON.parse(disabledData)).toContain("kf_1");
  });
});

describe("_reset clears disabled state", () => {
  afterEach(() => {
    _reset();
  });

  it("_reset clears disabled kfids alongside discovered kfids", async () => {
    await registerKfId("kf_001");
    await disableKfId("kf_001");
    expect(isKfIdEnabled("kf_001")).toBe(false);

    _reset();
    // After reset, the disabled set is also cleared
    expect(isKfIdEnabled("kf_001")).toBe(true);
    expect(getKnownKfIds()).toHaveLength(0);
  });
});

describe("listAccountIds with disabled accounts", () => {
  afterEach(() => {
    _reset();
  });

  it("excludes disabled kfids from listing but keeps default", async () => {
    await registerKfId("kf_x");
    await registerKfId("kf_y");
    await disableKfId("kf_x");

    const cfg = { channels: { "wechat-kf": {} } };
    const ids = listAccountIds(cfg);
    expect(ids).toEqual(["default", "kf_y"]);
  });

  it("returns ['default'] when all kfids are disabled", async () => {
    await registerKfId("kf_x");
    await disableKfId("kf_x");

    const cfg = { channels: { "wechat-kf": {} } };
    expect(listAccountIds(cfg)).toEqual(["default"]);
  });
});

describe("resolveAccount with disabled accounts", () => {
  afterEach(() => {
    _reset();
  });

  it("returns enabled: false for a disabled kfid", async () => {
    await registerKfId("kf_abc");
    await disableKfId("kf_abc");

    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp1",
          appSecret: "sec",
          token: "tok",
          encodingAESKey: "key",
          enabled: true,
        },
      },
    };
    const account = resolveAccount(cfg, "kf_abc");
    expect(account.enabled).toBe(false);
  });

  it("returns enabled from config when kfid is not disabled", async () => {
    await registerKfId("kf_abc");

    const cfg = {
      channels: {
        "wechat-kf": {
          corpId: "corp1",
          appSecret: "sec",
          token: "tok",
          encodingAESKey: "key",
          enabled: true,
        },
      },
    };
    const account = resolveAccount(cfg, "kf_abc");
    expect(account.enabled).toBe(true);
  });

  it("does not affect 'default' accountId even if disabled", async () => {
    // The 'default' account should not be affected by the disabled set
    const cfg = {
      channels: {
        "wechat-kf": {
          enabled: true,
        },
      },
    };
    const account = resolveAccount(cfg, "default");
    expect(account.enabled).toBe(true);
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

  it("returns ['default', ...kfIds] when kfids are discovered", async () => {
    await registerKfId("kf_x");
    await registerKfId("kf_y");
    const cfg = { channels: { "wechat-kf": {} } };
    const ids = listAccountIds(cfg);
    expect(ids).toEqual(["default", "kf_x", "kf_y"]);
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

  it("uses default path when not configured", () => {
    const cfg = { channels: { "wechat-kf": {} } };
    const account = resolveAccount(cfg);
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
