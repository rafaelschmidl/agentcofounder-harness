import { BASE_UI_STYLES } from "./ui-styles.js";

const LAYOUT_PROPERTIES: Record<string, readonly string[]> = {
  ".app-shell": ["width", "padding"],
  ".app-header": ["display", "gap", "padding-bottom", "margin-bottom"],
  ".workspace-layout": ["grid-template-columns", "gap"],
  ".workspace-aside": ["padding-left", "border-left"],
  ".record-row": ["display", "align-items", "gap", "padding"],
  ".record-grid": ["grid-template-columns", "gap"],
  ".form-grid": ["grid-template-columns", "gap"],
};

interface StyleRule {
  selector: string;
  declarations: Array<[string, string]>;
}

// This extracts flat declarations from our controlled foundation, not arbitrary user CSS.
function rules(source: string): StyleRule[] {
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map((match) => ({
    selector: match[1]!.trim(),
    declarations: match[2]!.split(";").flatMap((declaration) => {
      const separator = declaration.indexOf(":");
      return separator < 0 ? [] : [[declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim()] as [string, string]];
    }),
  }));
}

function requireRule(available: readonly StyleRule[], selector: string): StyleRule {
  const rule = available.find((candidate) => candidate.selector === selector);
  if (!rule) throw new Error(`Foundation design context is missing shipped selector ${selector}`);
  return rule;
}

function project(rule: StyleRule, properties?: readonly string[]): string {
  const values = new Map(rule.declarations);
  const names = properties ?? [...values.keys()];
  const declarations = names.map((name) => {
    const value = values.get(name);
    if (value === undefined) throw new Error(`Foundation design context is missing ${rule.selector} property ${name}`);
    return `${name}:${value}`;
  });
  return `${rule.selector}{${declarations.join(";")}}`;
}

function mediaBlocks(source: string): Array<{ condition: string; content: string }> {
  return [...source.matchAll(/@media\s*([^{}]+)\{/gu)].map((match) => {
    const start = match.index + match[0].length;
    let depth = 1;
    let end = start;
    for (; end < source.length && depth > 0; end += 1) {
      if (source[end] === "{") depth += 1;
      if (source[end] === "}") depth -= 1;
    }
    if (depth !== 0) throw new Error("Unclosed foundation media rule");
    return { condition: match[1]!.trim(), content: source.slice(start, end - 1) };
  });
}

/** Compact builder-facing design API; values always come from the shipped stylesheet. */
export function foundationDesignContext(styles = BASE_UI_STYLES): string {
  if (!/@layer\s+foundation\s*\{/u.test(styles)) throw new Error("Foundation styles must retain their lower-priority cascade layer");
  const available = rules(styles);
  const root = requireRule(available, ":root");
  const theme = project(root, [
    ...root.declarations.map(([name]) => name).filter((name) => name.startsWith("--")),
    "font-family", "line-height",
  ]);
  const type = project(requireRule(available, "h1"), ["font-size", "font-weight", "line-height", "letter-spacing"]);
  const layouts = Object.entries(LAYOUT_PROPERTIES).map(([selector, properties]) => project(requireRule(available, selector), properties));
  const controls = project(requireRule(available, ":where(input, select, textarea)"), ["min-height", "font-size"]);
  const responsive = mediaBlocks(styles).flatMap(({ condition, content }) => {
    const relevant = rules(content).filter(({ selector }) => selector in LAYOUT_PROPERTIES || selector.startsWith(".record-row >"));
    if (relevant.length === 0) return [];
    return [`@media ${condition}{${relevant.map((rule) => project(rule)).join("")}}`];
  });
  return [
    "## Foundation design API — shipped defaults, not a required appearance",
    "Unlayered src/product/styles.css overrides @layer foundation, including its mobile rules. Set a coherent :root palette (page, surfaces, ink, muted, lines, accent and status colors), choose system font stacks for body/headings, and change layout selectors to serve this product. Accent changes alone retain the default theme. Preserve contrast, focus, control targets and reduced-motion behavior when overriding.",
    "Shared visual rules: one signature accent used sparingly; neutrals from a single base hue at varying opacities, never pure #000000 or #FFFFFF; body text at least 4.5:1 contrast, buttons and CTAs at least 3:1; never three or more competing saturated hues. Realize a spec visual direction by overriding these :root variables; when the spec carries no visual direction, keep this default palette unchanged.",
    "AppShell supplies a header with an initial-letter mark and a main region; it is optional. workspace-layout is a main/aside arrangement, not a mandatory page. record-list/record-row form a list with item actions; record-grid lays out whole records as tiles, not the fields within one row. form-grid arranges form fields. Use custom classes where these arrangements do not fit.",
    "Default values and responsive overrides (all derived from the installed foundation):",
    "```css",
    theme,
    type,
    controls,
    ...layouts,
    ...responsive,
    "```",
  ].join("\n");
}
