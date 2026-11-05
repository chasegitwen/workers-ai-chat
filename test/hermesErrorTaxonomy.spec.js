import { describe, expect, it } from "vitest";
import {
  buildHermesErrorRecord,
  classifyHermesError,
  HERMES_ERROR_CATEGORIES,
  parseErrorCategory
} from "../src/hermes/errorTaxonomy.js";

describe("Hermes error taxonomy", () => {
  it.each([
    ["provider_model", { originalCode:"hermes_unknown_model" }],
    ["tool_execution", { timelineToolError:true }],
    ["network_timeout_sse", { originalCode:"hermes_timeout" }],
    ["api_auth", { originalCode:"hermes_upstream_auth", httpStatus:401 }],
    ["runtime_unavailable", { upstreamCode:"runtime_draining" }],
    ["user_cancel_or_approval", { status:"cancelled" }],
    ["unknown_execution", { status:"unknown", statusDetail:"upstream_not_found" }],
    ["worker_d1_adapter", { originalCode:"hermes_no_database" }],
    ["unrecognized", { originalCode:"novel_failure" }]
  ])("maps observed signals to %s", (category, input) => {
    expect(classifyHermesError(input).category).toBe(category);
  });

  it("exports and validates the stable category ids", () => {
    expect(HERMES_ERROR_CATEGORIES).toHaveLength(9);
    expect(HERMES_ERROR_CATEGORIES.every(id => parseErrorCategory(id) === id)).toBe(true);
    expect(parseErrorCategory("made_up")).toBe("");
  });

  it("never classifies from HTTP status alone", () => {
    const authLooking = classifyHermesError({ httpStatus:401 });
    const unavailableLooking = classifyHermesError({ httpStatus:503 });
    expect(authLooking.category).toBe("unrecognized");
    expect(unavailableLooking.category).toBe("unrecognized");
    expect(authLooking.categoryConfidence).toBe("inferred");
  });

  it("keeps facts separate from inference and redacts secrets", () => {
    const record = buildHermesErrorRecord({
      runId:"hrun_" + "a".repeat(32), sourceLayer:"worker", originalCode:"novel_failure",
      httpStatus:502, summary:"Authorization: Bearer secret-token token=private-value"
    });
    expect(record).toMatchObject({
      originalCode:"novel_failure", httpStatus:502, category:"unrecognized", categoryConfidence:"inferred"
    });
    expect(record.facts).toContain("Observed HTTP status: 502 (supporting fact only)");
    expect(record.inference).toMatch(/^Inferred:/);
    expect(record.summary).not.toMatch(/secret-token|private-value/);
  });

  it("labels approval as a waiting state rather than a failed fault", () => {
    const record = buildHermesErrorRecord({ status:"waiting_for_approval", summary:"waiting" });
    expect(record).toMatchObject({
      category:"user_cancel_or_approval", categoryConfidence:"confirmed", kind:"waiting", isFault:false
    });
    expect(record.suggestion).toMatch(/not a production fault/i);
  });

  it("marks ambiguous network submissions as inferred and forbids automatic replacement", () => {
    const record = buildHermesErrorRecord({
      originalCode:"hermes_network_error", status:"submission_unknown", ambiguous:true
    });
    expect(record).toMatchObject({ category:"network_timeout_sse", categoryConfidence:"inferred" });
    expect(record.suggestion).toMatch(/do not automatically create or POST a replacement Run/i);
  });

  it("tells unknown executions to reconcile without automatic retry", () => {
    const record = buildHermesErrorRecord({ status:"submission_unknown", originalCode:"hermes_submission_unknown" });
    expect(record.category).toBe("unknown_execution");
    expect(record.suggestion).toMatch(/do not automatically create or POST a replacement Run/i);
  });
});
