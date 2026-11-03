// Loaded as a file (not inline) so the strict CSP needs no 'unsafe-inline'.
// Resolve the theme before first paint to avoid a flash. Mirrors
// useTheme.ts: a stored value (including pre-1.1 "paper"/"void")
// wins; otherwise follow the OS. If both fail, the hardcoded
// data-theme="dark" above stays, matching the config default.
var paintTheme = null;
try {
  var stored = localStorage.getItem("kensaku.theme");
  var map = { paper: "light", light: "light", void: "dark", dark: "dark" };
  // A stored but unrecognized value is "dark", exactly like
  // normalizeTheme() in useTheme.ts (never the OS).
  if (stored) paintTheme = map[stored] || "dark";
} catch (e) { /* storage unavailable */ }
if (!paintTheme) {
  try {
    paintTheme = window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  } catch (e) { /* no matchMedia; keep the hardcoded default */ }
}
if (paintTheme) document.documentElement.dataset.theme = paintTheme;
