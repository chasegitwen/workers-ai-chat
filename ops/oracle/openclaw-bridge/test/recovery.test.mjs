import test from "node:test";
import assert from "node:assert/strict";
import { findRecoveredAssistantMessage, usableFinalText } from "../lib.mjs";

const createdAt = "2026-10-24T13:30:00.000Z";
const task = { message: "new question", created_at: createdAt, run_id: "run-new" };

test("forked old answer cannot complete the current turn", () => {
  const result = findRecoveredAssistantMessage({ messages: [
    { role: "user", text: "old question", timestamp: "2026-10-24T13:20:00Z" },
    { role: "assistant", text: "old answer", stopReason: "stop", runId: "run-old", timestamp: "2026-10-24T13:21:00Z" },
  ] }, task);
  assert.equal(result.message, null);
});

test("assistant transition text is not a final even with a terminal stop marker", () => {
  const result = findRecoveredAssistantMessage({ messages: [
    { role: "user", text: "new question", idempotencyKey: "run-new:user", timestamp: "2026-10-24T13:30:01Z" },
    { role: "assistant", text: "Let me inspect that", stopReason: "stop", timestamp: "2026-10-24T13:30:02Z" },
  ] }, task);
  assert.equal(result.message, null);
  assert.equal(result.match, "evidence_incomplete");
});

test("empty assistant final remains recovering", () => {
  const result = findRecoveredAssistantMessage({ messages: [
    { role: "user", text: "new question", idempotencyKey: "run-new:user", timestamp: "2026-10-24T13:30:01Z" },
    { role: "assistant", text: "  ", stopReason: "stop", timestamp: "2026-10-24T13:30:02Z" },
  ] }, task);
  assert.equal(result.message, null);
  assert.equal(usableFinalText(""), "");
});

test("matching durable user identity plus substantive terminal answer recovers", () => {
  const answer = { role: "assistant", text: "The verified answer is 42.", stopReason: "stop", timestamp: "2026-10-24T13:30:03Z" };
  const result = findRecoveredAssistantMessage({ messages: [
    { role: "assistant", text: "old answer", stopReason: "stop", runId: "run-old", timestamp: "2026-10-24T13:20:00Z" },
    { role: "user", text: "new question", idempotencyKey: "run-new:user", timestamp: "2026-10-24T13:30:01Z" },
    answer,
  ] }, task);
  assert.equal(result.message, answer);
  assert.equal(result.match, "matching_user_idempotency_boundary");
});

test("same question five seconds earlier without run identity is not this turn's boundary", () => {
  const result = findRecoveredAssistantMessage({ messages: [
    { role: "user", text: "new question", timestamp: "2026-10-24T13:29:55Z" },
    { role: "assistant", text: "Previous answer", stopReason: "stop", timestamp: "2026-10-24T13:29:56Z" },
  ] }, task);
  assert.equal(result.message, null);
  assert.equal(result.match, "not_found");
});

test("matching final event can supply terminal evidence, but not turn ownership", () => {
  const owned = findRecoveredAssistantMessage({ messages: [
    { role: "assistant", text: "Final from this run", runId: "run-new" },
  ] }, task, { finalEventRunId: "run-new" });
  assert.equal(owned.text, "Final from this run");

  const unowned = findRecoveredAssistantMessage({ messages: [
    { role: "assistant", text: "Old inherited answer", runId: "run-old" },
  ] }, task, { finalEventRunId: "run-new" });
  assert.equal(unowned.message, null);
});
