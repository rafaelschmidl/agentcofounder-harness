/** Offline, domain-neutral defaults. Product styles own the final composition. */
export const BASE_UI_STYLES = `:root {
  --page: #f6f5f1;
  --surface: #ffffff;
  --surface-muted: #efeee9;
  --ink: #202923;
  --muted: #667168;
  --line: #dedfd7;
  --accent: #245c43;
  --accent-hover: #194631;
  --accent-soft: #e8f0e9;
  --danger: #a63232;
  --danger-soft: #fff0ee;
  --success: #256145;
  --success-soft: #edf6ef;
  color: var(--ink);
  background: var(--page);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; min-height: 100vh; }
:where(button, input, select, textarea) { font: inherit; }
:where(button, a, input, select, textarea) { -webkit-tap-highlight-color: transparent; }
:where(button, a, input, select, textarea, summary):focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 3px;
}
:where(h1, h2, h3, p) { margin-top: 0; }
:where(h1, h2, h3) { overflow-wrap: anywhere; }
h1 { margin-bottom: 0; font-size: clamp(1.65rem, 3.3vw, 2.5rem); font-weight: 720; line-height: 1.15; letter-spacing: -.045em; }
h2 { margin-bottom: .5rem; font-size: 1.15rem; line-height: 1.3; letter-spacing: -.025em; }
h3 { margin-bottom: .35rem; font-size: 1rem; line-height: 1.35; }
p { margin-bottom: .75rem; }
:where(a) { color: var(--accent); text-underline-offset: 3px; }
:where(small, .muted, .field-hint, .record-meta) { color: var(--muted); font-size: .875rem; }
:where(img, svg) { max-width: 100%; }
:where(hr) { border: 0; border-top: 1px solid var(--line); margin: 1.5rem 0; }

.app-shell { width: min(1180px, calc(100% - 64px)); margin-inline: auto; padding: 36px 0 64px; }
.app-header { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding-bottom: 28px; margin-bottom: 28px; border-bottom: 1px solid var(--line); }
.app-identity { display: flex; gap: 14px; align-items: flex-start; min-width: 0; }
.product-mark { display: grid; place-items: center; flex: 0 0 42px; height: 42px; border-radius: 12px; color: #fff; background: var(--accent); font-size: 1.35rem; font-weight: 700; line-height: 1; }
.app-heading { min-width: 0; }
.eyebrow { margin: 0 0 5px; color: var(--muted); text-transform: uppercase; letter-spacing: .12em; font-size: .68rem; font-weight: 750; }
.subtitle { max-width: 64ch; margin: 8px 0 0; color: var(--muted); font-size: .925rem; }
.app-shell > main { display: grid; gap: 24px; min-width: 0; }
.app-shell > main > * { min-width: 0; }
.header-actions { flex-shrink: 0; }
.skip-link { position: absolute; top: 8px; left: 16px; z-index: 10; padding: 10px 16px; border-radius: 6px; background: var(--surface); transform: translateY(-180%); }
.skip-link:focus { transform: translateY(0); }
.app-navigation { display: flex; flex-wrap: wrap; gap: 6px; margin: -8px 0 24px; }
.workspace-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(260px, 320px); gap: 32px; align-items: start; }
.workspace-layout > * { min-width: 0; }
.workspace-main { display: grid; gap: 24px; }
.workspace-aside { padding-left: 24px; border-left: 1px solid var(--line); }
.section-header { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 18px; }
.section-header h2 { margin: 0; }
.section-description { max-width: 64ch; margin: 5px 0 0; color: var(--muted); font-size: .875rem; }
:where(.toolbar, .filters, .actions, .form-actions, .row-actions, .header-actions) { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.toolbar { justify-content: space-between; margin-bottom: 18px; }
.filters { gap: 12px; }
.filters > * { min-width: 0; }

:where(button, .button) {
  display: inline-flex; justify-content: center; align-items: center; gap: 7px;
  min-height: 44px; padding: 9px 15px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--surface); color: var(--ink); font-size: .875rem; font-weight: 650;
  line-height: 1.3; text-align: center; text-decoration: none; cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
}
:where(button, .button):hover:not(:disabled) { background: var(--surface-muted); border-color: #b8c0b6; }
:where(button, .button):active:not(:disabled) { box-shadow: inset 0 1px 3px #17221c15; }
:where(button[type="submit"], .button-primary, [data-variant="primary"]) { background: var(--accent); border-color: var(--accent); color: #fff; }
:where(button[type="submit"], .button-primary, [data-variant="primary"]):hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }
:where(.button-ghost, [data-variant="ghost"]) { background: transparent; border-color: transparent; }
:where(.button-danger, [data-variant="danger"]) { color: var(--danger); }
:where(.button-danger, [data-variant="danger"]):hover:not(:disabled) { color: var(--danger); background: var(--danger-soft); border-color: #e6bfb8; }
:where(button):disabled { cursor: not-allowed; opacity: .48; }
:where(button[aria-pressed="true"], button[aria-selected="true"], a[aria-current="page"]) { color: var(--accent); background: var(--accent-soft); border-color: #b8ccbc; }

:where(form) { display: grid; gap: 16px; }
:where(fieldset) { min-width: 0; margin: 0; padding: 0; border: 0; }
:where(legend) { margin-bottom: 12px; font-weight: 700; }
:where(label) { display: block; color: var(--ink); font-size: .875rem; font-weight: 600; }
:where(label) > :where(input, select, textarea) { margin-top: 6px; }
:where(input, select, textarea) { display: block; width: 100%; min-width: 0; min-height: 44px; padding: 10px 12px; border: 1px solid #cfd4cb; border-radius: 7px; color: var(--ink); background: var(--surface); font-size: 1rem; line-height: 1.35; }
:where(input, textarea)::placeholder { color: #8a9288; }
:where(input, select, textarea):focus { border-color: var(--accent); }
:where(input, textarea)[readonly] { background: var(--surface-muted); }
:where(input, select, textarea):disabled { cursor: not-allowed; background: var(--surface-muted); color: var(--muted); }
:where(input, select, textarea)[aria-invalid="true"] { border-color: var(--danger); background: #fffafa; }
:where(input[type="checkbox"], input[type="radio"]) { display: inline-block; width: 18px; min-height: 18px; height: 18px; padding: 0; accent-color: var(--accent); vertical-align: middle; }
:where(input[type="hidden"]) { display: none; }
:where(textarea) { min-height: 100px; resize: vertical; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
:where(.field, .form-field) { display: grid; align-content: start; gap: 6px; }
:where(.field-hint, .field-error) { margin: 0; }
.field-error { color: var(--danger); font-size: .875rem; font-weight: 550; }
.form-actions { padding-top: 4px; }

.record-list { list-style: none; margin: 0; padding: 0; }
.record-row { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 20px 0; border-bottom: 1px solid var(--line); }
.record-row:first-child { border-top: 1px solid var(--line); }
.record-row > * { min-width: 0; }
.record-title { margin: 0 0 3px; font-size: 1rem; font-weight: 650; overflow-wrap: anywhere; }
.record-meta { margin: 0; overflow-wrap: anywhere; }
.record-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr)); gap: 20px; list-style: none; margin: 0; padding: 0; }
.table-scroll { max-width: 100%; overflow-x: auto; }
:where(table) { width: 100%; border-collapse: collapse; color: var(--ink); font-size: .875rem; }
:where(caption) { padding-bottom: 14px; text-align: left; font-weight: 700; }
:where(th) { color: var(--muted); font-size: .75rem; font-weight: 600; text-align: left; }
:where(th, td) { padding: 13px 12px; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; vertical-align: middle; }
:where(thead) { background: var(--surface-muted); }
.status-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 5px; background: var(--surface-muted); color: var(--muted); font-size: .75rem; font-weight: 650; white-space: nowrap; }
.status-badge[data-tone="success"] { color: var(--success); background: var(--success-soft); }
.status-badge[data-tone="accent"] { color: var(--accent); background: var(--accent-soft); }
.status-badge[data-tone="error"] { color: var(--danger); background: var(--danger-soft); }
.metric-inline { display: inline-flex; align-items: baseline; gap: 6px; color: var(--muted); font-size: .875rem; }
.metric-inline strong { color: var(--ink); font-size: 1.1rem; font-variant-numeric: tabular-nums; }
.empty-state { display: grid; justify-items: start; gap: 10px; padding: 36px 0; border-block: 1px solid var(--line); }
.empty-state h2 { margin: 0; }
.empty-state-copy { max-width: 48ch; color: var(--muted); font-size: .925rem; }
.empty-state-copy > :last-child { margin-bottom: 0; }
.empty-state-action { padding-top: 3px; }
.status-message { margin: 0; padding: 12px 15px; border-left: 3px solid #bcc5b8; border-radius: 0 7px 7px 0; background: var(--surface-muted); color: var(--ink); font-size: .875rem; animation: notice-enter 140ms ease-out; }
.status-message[data-tone="success"] { border-left-color: var(--success); background: var(--success-soft); color: var(--success); }
.status-message[data-tone="error"] { border-left-color: var(--danger); background: var(--danger-soft); color: var(--danger); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@keyframes notice-enter { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: translateY(0); } }
@media (max-width: 800px) {
  .workspace-layout { grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .workspace-aside { border-left: 0; border-top: 1px solid var(--line); padding: 24px 0 0; }
}
@media (max-width: 560px) {
  .app-shell { width: calc(100% - 32px); padding-top: 24px; }
  .app-header { align-items: start; flex-direction: column; gap: 18px; padding-bottom: 22px; margin-bottom: 22px; }
  .app-identity { gap: 11px; }
  .product-mark { flex-basis: 36px; height: 36px; border-radius: 10px; font-size: 1.1rem; }
  .form-grid { grid-template-columns: minmax(0, 1fr); }
  .section-header { align-items: start; }
  .record-row { flex-wrap: wrap; gap: 14px; padding: 16px 0; }
  .record-row > :first-child { flex: 1 1 100%; }
  .filters { align-items: stretch; }
  .filters > label { flex: 1 1 140px; }
  .empty-state { padding-block: 28px; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
`;
