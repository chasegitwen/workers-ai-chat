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
    expect(page).toContain("/api/openclaw/bridge/events/stream?task_id=");
  });
});
