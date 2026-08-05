import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const launcher = readFileSync(new URL("../extension/src/sidepanel-launcher.js", import.meta.url), "utf8");

test("dock keeps a fixed 48px rail and a 280px left flyout", () => {
  assert.match(launcher, /const RAIL_WIDTH = 48/);
  assert.match(launcher, /const FLYOUT_WIDTH = 280/);
  assert.match(launcher, /right:\$\{RAIL_WIDTH\}px/);
  assert.match(launcher, /width:min\(\$\{FLYOUT_WIDTH\}px,calc\(100vw - \$\{RAIL_WIDTH\}px\)\)/);
  assert.match(launcher, /height:100vh/);
});

test("page reserves space for both collapsed and expanded dock", () => {
  assert.match(launcher, /function pageReserve\(\)/);
  assert.match(launcher, /if \(!state\.open\) return RAIL_WIDTH/);
  assert.match(launcher, /return RAIL_WIDTH \+ Math\.min\(FLYOUT_WIDTH/);
  assert.match(launcher, /margin-right: var\(--simnet-wb-dock-reserve/);
  assert.match(launcher, /max-width: calc\(100vw - var\(--simnet-wb-dock-reserve/);
  assert.match(launcher, /transition: margin-right \.2s ease, max-width \.2s ease/);
});

test("hovering rail modules opens the flyout without moving the rail", () => {
  assert.match(launcher, /pointerenter/);
  assert.match(launcher, /openDock\(button\.dataset\.module\)/);
  assert.match(launcher, /\.flyout\.open\{/);
  assert.match(launcher, /\.rail\{position:absolute;right:0;top:0/);
  assert.match(launcher, /\.flyout\{position:fixed;right:\$\{RAIL_WIDTH\}px/);
});

test("dock exposes four requested high-density modules", () => {
  assert.match(launcher, /id: "active", label: "Active Case"/);
  assert.match(launcher, /id: "metrics", label: "Live Metrics"/);
  assert.match(launcher, /id: "scripts", label: "Talk Scripts"/);
  assert.match(launcher, /id: "matrix", label: "Case Matrix"/);
  assert.match(launcher, /function activeModuleHtml\(\)/);
  assert.match(launcher, /function metricsModuleHtml\(\)/);
  assert.match(launcher, /function scriptsModuleHtml\(\)/);
  assert.match(launcher, /function matrixModuleHtml\(\)/);
});

test("flyout has no free text fields or vertical scrolling", () => {
  assert.doesNotMatch(launcher, /<textarea\b/i);
  assert.doesNotMatch(launcher, /<input\b/i);
  assert.match(launcher, /\.flyout\{[^}]*overflow:hidden/s);
  assert.match(launcher, /\.module-stage\{[^}]*overflow:hidden/s);
  assert.match(launcher, /\.module-pane\{[^}]*overflow:hidden/s);
});

test("long explanations are moved to hover tooltips", () => {
  assert.match(launcher, /class="help" data-tip=/);
  assert.match(launcher, /\[data-tip\]:hover::after/);
  assert.match(launcher, /content:attr\(data-tip\)/);
});

test("active case actions remain click-driven and non-destructive", () => {
  assert.match(launcher, /data-highlight=/);
  assert.match(launcher, /data-start-olt-route/);
  assert.match(launcher, /data-core-action="refresh"/);
  assert.doesNotMatch(launcher, /Reset CoA|disconnect session|reboot ONU/i);
});

test("native side panel remains available only as an expanded mode", () => {
  assert.match(launcher, /data-open-native/);
  assert.match(launcher, /function openNativePanel/);
  assert.match(launcher, /SIMNET_WB_OPEN_SIDE_PANEL/);
});
