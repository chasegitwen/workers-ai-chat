import { describe, expect, it } from "vitest";
import { htmlPage } from "../src/frontend/page.js";

function element() {
  const classes = new Set(["active", "open"]);
  return {
    hidden: false, innerHTML: "old task", dataset: { mode: "task" },
    classList: { remove: value => classes.delete(value), contains: value => classes.has(value) }
  };
}

function ui({ model = "claude", conversationId = null, tasks = [], activeTask = null } = {}) {
  const script = htmlPage().match(/<script>([\s\S]*)<\/script>/)[1];
  const targetStart = script.indexOf("function isOpenClawModelTarget");
  const targetEnd = script.indexOf("function selectedOpenClawRuntimeBinding", targetStart);
  const scopeStart = script.indexOf("function openClawTaskConversationId");
  const scopeEnd = script.indexOf("function openClawTaskStatusLabel", scopeStart);
  const visibilityStart = script.indexOf("function syncOpenClawTaskVisibility");
  const visibilityEnd = script.indexOf("async function fetchOpenClawTasksForConversation", visibilityStart);
  const toggle = element();
  const panel = element();
  const banner = element();
  const controls = new Function("modelSelect", "currentConversationId", "openClawTasks", "activeOpenClawTask",
    "openClawTaskHistoryToggle", "openClawTaskHistoryPanel", "openClawTaskBanner",
    "const modelOptions = [{id:'claude',provider:'cloudflare-proxied'}," +
      "{id:'llama',provider:'workers-ai'},{id:'glm',provider:'glm'}," +
      "{id:'openclaw-seattle',provider:'openclaw-seattle'}];\n" +
    "const ignoredOpenClawTaskIds = new Set();\n" +
    "function currentPendingOpenClawTask(){ return openClawTasks[0] || null; }\n" +
    script.slice(targetStart, targetEnd) + script.slice(scopeStart, scopeEnd) +
    script.slice(visibilityStart, visibilityEnd) +
    "\nreturn {syncOpenClawTaskVisibility,renderOpenClawTaskBanner};"
  )({ value: model }, conversationId, tasks, activeTask, toggle, panel, banner);
  return { ...controls, toggle, panel, banner };
}

describe("OpenClaw task UI visibility", () => {
  it("starts with the task history entry hidden before models load", () => {
    expect(htmlPage()).toContain('class="openClawTaskHistoryToggle" type="button" hidden');
  });

  it.each(["claude", "llama", "glm"])("hides task UI in a new %s conversation", model => {
    const state = ui({ model });
    state.renderOpenClawTaskBanner();
    expect(state.toggle.hidden).toBe(true);
    expect(state.panel.hidden).toBe(true);
    expect(state.toggle.classList.contains("active")).toBe(false);
    expect(state.banner.classList.contains("open")).toBe(false);
    expect(state.banner.innerHTML).toBe("");
  });

  it("shows the entry for a selected OpenClaw model before a task exists", () => {
    const state = ui({ model: "openclaw-seattle" });
    state.syncOpenClawTaskVisibility();
    expect(state.toggle.hidden).toBe(false);
  });

  it.each(["conversationId", "conversation_id"])("retains task history for mixed-model conversations using %s", key => {
    const state = ui({ conversationId: "current", tasks: [{ id: "task", [key]: "current" }] });
    state.syncOpenClawTaskVisibility();
    expect(state.toggle.hidden).toBe(false);
  });

  it("retains the entry for an active task in the current conversation", () => {
    const state = ui({ conversationId: "current", activeTask: { id: "task", conversationId: "current" } });
    state.syncOpenClawTaskVisibility();
    expect(state.toggle.hidden).toBe(false);
  });

  it.each([null, "new"])("does not display stale task state after switching to %s", conversationId => {
    const oldTask = { id: "old-task", conversationId: "old" };
    const state = ui({ conversationId, tasks: [oldTask], activeTask: oldTask });
    state.renderOpenClawTaskBanner();
    expect(state.toggle.hidden).toBe(true);
    expect(state.panel.hidden).toBe(true);
    expect(state.banner.innerHTML).toBe("");
    expect(state.banner.classList.contains("open")).toBe(false);
  });
});
