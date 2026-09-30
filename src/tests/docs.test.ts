import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";

describe("project documentation", () => {
  it("keeps V1 frozen while documenting the approved V1.1 metadata scope", () => {
    const root = cwd();
    const roadmap = resolve(root, "ROADMAP.md");

    expect(existsSync(roadmap)).toBe(true);
    const roadmapText = readFileSync(roadmap, "utf8");
    expect(roadmapText).toContain("1.0.x Maintenance");
    expect(roadmapText).toContain("V1.1 development is active only");
    expect(existsSync(resolve(root, "RELEASE_NOTES_V1.0.0.md"))).toBe(true);
    expect(existsSync(resolve(root, "V1_HOTFIX_BACKLOG.md"))).toBe(true);
    expect(existsSync(resolve(root, "V1_1_BACKLOG.md"))).toBe(true);
    expect(existsSync(resolve(root, "docs/BACKUP_AND_RECOVERY.md"))).toBe(true);
    expect(existsSync(resolve(root, "docs/PRIVACY.md"))).toBe(true);
    expect(existsSync(resolve(root, "docs/V1_1_JMCOMIC_LOCAL_BRIDGE.md"))).toBe(true);
    expect(existsSync(resolve(root, "docs/V1_1_JMCOMIC_METADATA_FOUNDATION.md"))).toBe(true);
  });

  it("limits the asset protocol to generated image caches", () => {
    const config = JSON.parse(readFileSync(resolve(cwd(), "src-tauri/tauri.conf.json"), "utf8"));

    expect(config.app.security.assetProtocol).toEqual({
      enable: true,
      scope: ["$APPCACHE/reader-pages/**", "$APPCACHE/thumbnails/**"],
    });
  });
});
