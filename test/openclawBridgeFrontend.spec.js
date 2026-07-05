import { describe, expect, it } from "vitest";
import { htmlPage } from "../src/frontend/page.js";
import {
  applyOpenClawBridgeEventState,
  createOpenClawBridgeEventState
} from "../src/frontend/openclawBridgeEventState.js";

describe("OpenClaw bridge frontend SSE state", () => {
  it("ignores duplicate event_id values", () => {
    const state = createOpenClawBridgeEventState();
    const event = {
      event_id: "evt_duplicate",
      event_type: "bridge.activity",
      sequence: 1
    };

    expect(applyOpenClawBridgeEventState(state, event).accepted).toBe(true);
    expect(applyOpenClawBridgeEventState(state, event)).toMatchObject({
      accepted: false,
      reason: "duplicate"
    });
  });

  it("does not let old sequence events overwrite newer frontend state", () => {
    const state = createOpenClawBridgeEventState();

    expect(applyOpenClawBridgeEventState(state, {
      event_id: "evt_new",
      event_type: "bridge.activity",
      sequence: 10
    }).accepted).toBe(true);
    expect(applyOpenClawBridgeEventState(state, {
      event_id: "evt_old",
      event_type: "bridge.activity",
      sequence: 9
    })).toMatchObject({
      accepted: false,
      reason: "old_sequence"
    });
  });

  it("keeps final state from being overwritten by later activity", () => {
    const state = createOpenClawBridgeEventState();

    expect(applyOpenClawBridgeEventState(state, {
      event_id: "evt_final",
      event_type: "bridge.final",
      sequence: 20
    }).accepted).toBe(true);
    expect(applyOpenClawBridgeEventState(state, {
      event_id: "evt_late_activity",
      event_type: "bridge.activity",
      sequence: 21
    })).toMatchObject({
      accepted: false,
      reason: "after_final"
    });
  });

  it("keeps polling fallback wired when EventSource cannot be used or fails", () => {
    const page = htmlPage();

    expect(page).toContain("typeof EventSource === \"undefined\"");
    expect(page).toContain("startOpenClawReconnectPolling(taskId)");
    expect(page).toContain("openClawTaskScopeParams");
    expect(page).toContain("/api/openclaw/bridge/events/stream?\" + params.toString()");
    expect(page).toContain("params.set(\"project_id\", projectId)");
    expect(page).toContain("params.set(\"runtime_id\", runtimeId)");
  });

  it("exposes project selector and scopes conversation requests by project_id", () => {
    const page = htmlPage();

    expect(page).toContain("id=\"projectSelect\"");
    expect(page).toContain("fetch(\"/api/projects\"");
    expect(page).toContain("\"/openclaw-runtimes\"");
    expect(page).toContain("runtimeCapabilityLabel");
    expect(page).toContain("renderRuntimeBinding");
    expect(page).toContain("runtimeCanBeBridgeDefault");
    expect(page).toContain("data-runtime-default=");
    expect(page).toContain("data-runtime-agent=");
    expect(page).toContain("Cannot set disabled, unverified, or Bridge-unsupported runtime as default.");
    expect(page).toContain("updateProjectRuntimeBinding");
    expect(page).toContain("project_id:activeProjectId || DEFAULT_PROJECT_ID");
    expect(page).toContain("fetch(\"/api/conversations?\" + params.toString())");
    expect(page).toContain("projectSelect.addEventListener(\"change\", () => switchProject(projectSelect.value))");
  });
});
