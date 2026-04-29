import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankFiles, loadTopFiles } from "./file-ranker.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("rankFiles", () => {
  it("ranks files by keyword match", () => {
    const files = [
      "src/auth/login.ts",
      "src/auth/token.ts",
      "src/utils/config.ts",
      "src/ui/button.tsx",
      "README.md",
    ];

    const ranked = rankFiles("修复 login.ts 中 token 过期不刷新", files);
    assert.ok(ranked.length > 0);
    // token.ts and login.ts should be at top
    const top = ranked.slice(0, 2).map((f) => f.path);
    assert.ok(top.includes("src/auth/token.ts"));
    assert.ok(top.includes("src/auth/login.ts"));
  });

  it("returns empty for no matches", () => {
    const files = ["README.md", "package.json"];
    const ranked = rankFiles("修复数据库连接池泄漏", files);
    assert.equal(ranked.length, 0);
  });

  it("scores exact name matches highest", () => {
    const files = ["src/services/token-service.ts", "src/random/token.ts", "src/auth/index.ts"];
    const ranked = rankFiles("token", files);
    assert.equal(ranked.length, 2);
    // exact match "token" in both
    assert.ok(ranked[0]!.score >= ranked[1]!.score);
  });
});

describe("loadTopFiles", () => {
  it("loads content of top N files", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-test-"));
    fs.mkdirSync(path.join(tmp, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "src/login.ts"), "export function login() {}");
    fs.writeFileSync(path.join(tmp, "src/token.ts"), "export function sign() {}");

    const ranked = rankFiles("login token", ["src/login.ts", "src/token.ts"]);
    const loaded = loadTopFiles(tmp, ranked, 2);
    assert.equal(loaded.length, 2);
    assert.ok(loaded[0]!.content?.includes("login"));
    assert.ok(loaded[1]!.content?.includes("sign"));

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
