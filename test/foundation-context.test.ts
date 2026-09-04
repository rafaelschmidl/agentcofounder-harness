import { describe, expect, it } from "vitest";
import { foundationDesignContext } from "../src/build-plan/foundation-context.js";
import { BASE_UI_STYLES } from "../src/build-plan/ui-styles.js";

describe("foundation design context", () => {
  it("follows changed theme tokens, typography, layout sizing and responsive breakpoints", () => {
    const changed = BASE_UI_STYLES
      .replace("--page: #f6f5f1;", "--page: #101828;\n  --custom-surface: #152238;")
      .replace('font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;', "font-family: Georgia, serif;")
      .replace("minmax(260px, 320px)", "minmax(220px, 280px)")
      .replace("max-width: 800px", "max-width: 760px");
    const context = foundationDesignContext(changed);
    expect(context).toContain("--page:#101828");
    expect(context).toContain("--custom-surface:#152238");
    expect(context).toContain("font-family:Georgia, serif");
    expect(context).toContain("minmax(220px, 280px)");
    expect(context).toContain("@media (max-width: 760px){.workspace-layout{grid-template-columns:minmax(0, 1fr);gap:24px}");
    expect(context).not.toContain("800px");
  });

  it("includes the complete palette and meaningful layout details without copying the whole stylesheet", () => {
    const context = foundationDesignContext();
    const customProperties = [...BASE_UI_STYLES.matchAll(/^\s*(--[\w-]+):/gmu)].map((match) => match[1]!);
    for (const property of customProperties) expect(context).toContain(`${property}:`);
    expect(context).toContain("@media (max-width: 560px)");
    expect(context).toContain("grid-template-columns:repeat(auto-fill, minmax(min(240px, 100%), 1fr))");
    expect(context).toContain(".record-row > :first-child{flex:1 1 100%}");
    expect(context).toContain("not the fields within one row");
    expect(context).not.toContain("@keyframes");
    expect(context.length).toBeLessThan(4_000);
    expect(context.length).toBeLessThan(BASE_UI_STYLES.length / 2);
  });

  it("fails visibly when documented layout semantics drift from the shipped selectors or cascade", () => {
    expect(() => foundationDesignContext(BASE_UI_STYLES.replace(".record-grid {", ".tile-layout {")))
      .toThrow("missing shipped selector .record-grid");
    expect(() => foundationDesignContext(BASE_UI_STYLES.replace("gap: 32px;", "column-gap: 32px;")))
      .toThrow("missing .workspace-layout property gap");
    expect(() => foundationDesignContext(BASE_UI_STYLES.replace("@layer foundation", "@layer changed")))
      .toThrow("lower-priority cascade layer");
  });
});
