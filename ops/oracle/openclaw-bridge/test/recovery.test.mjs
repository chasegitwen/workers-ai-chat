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
  ] }, task, { runEnded: true });
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

/* ── progress message → tool call → real final answer ── */

const phased = (phase, text) => ({
  type: "text",
  text,
  textSignature: JSON.stringify({ v: 1, id: `msg_${phase}_${text.length}`, phase }),
});
const userTurn = { role: "user", content: "检查服务器状态", __openclaw: { idempotencyKey: "run-new:user" }, idempotencyKey: "run-new:user" };
const progress = {
  role: "assistant",
  content: [phased("commentary", "正在核对服务配置和最近日志，随后汇总结论。")],
  stopReason: "stop",
  __openclaw: { runId: "run-new" },
};
const toolCall = {
  role: "assistant",
  content: [
    phased("commentary", "正在读取 systemd 状态。"),
    { type: "toolCall", id: "call_1", name: "exec", arguments: { command: "systemctl status" } },
  ],
  stopReason: "toolUse",
  __openclaw: { runId: "run-new" },
};
const toolResult = { role: "toolResult", toolCallId: "call_1", content: [{ type: "text", text: "active (running)" }], __openclaw: { runId: "run-new" } };
const finalAnswer = {
  role: "assistant",
  content: [phased("commentary", "检查完毕。"), phased("final_answer", "服务运行正常，没有发现异常。")],
  stopReason: "stop",
  __openclaw: { runId: "run-new" },
};

test("a commentary progress message with stopReason stop is never a final, even after the run ended", () => {
  const result = findRecoveredAssistantMessage({ messages: [userTurn, progress] }, task, { runEnded: true });
  assert.equal(result.message, null);
});

test("stopReason stop without an authoritative run-end signal does not complete", () => {
  const result = findRecoveredAssistantMessage({ messages: [userTurn, finalAnswer] }, task);
  assert.equal(result.message, null);
  assert.equal(result.evidence.run_ended, false);
});

test("progress and tool-call snapshots are not final while the turn continues", () => {
  for (const snapshot of [
    [userTurn, progress, toolCall],
    [userTurn, progress, toolCall, toolResult],
  ]) {
    const result = findRecoveredAssistantMessage({ messages: snapshot }, task, { runEnded: true });
    assert.equal(result.message, null);
  }
  // An earlier substantive unphased message is still not final once tool work follows it.
  const unphased = { role: "assistant", text: "服务看起来正常。", stopReason: "stop", runId: "run-new" };
  const continued = findRecoveredAssistantMessage({ messages: [userTurn, unphased, toolCall, toolResult] }, task, { runEnded: true });
  assert.equal(continued.message, null);
});

test("progress → tool call → final answer recovers only the final_answer text", () => {
  const result = findRecoveredAssistantMessage({ messages: [userTurn, progress, toolCall, toolResult, finalAnswer] }, task, { runEnded: true });
  assert.equal(result.message, finalAnswer);
  assert.equal(result.text, "服务运行正常，没有发现异常。");
  assert.equal(result.match, "matching_run_id");
});

test("a final event does not make a commentary projection the final when the real answer is not in history yet", () => {
  const projectedCommentary = {
    role: "assistant",
    content: [{ type: "text", text: "正在核对服务配置。" }],
    openclawStreamFallback: { replacementText: "正在核对服务配置。", source: "segment", itemId: "msg_1" },
    __openclaw: { runId: "run-new" },
  };
  const result = findRecoveredAssistantMessage(
    { messages: [userTurn, projectedCommentary, toolCall, toolResult] },
    task,
    { finalEventRunId: "run-new" },
  );
  assert.equal(result.message, null);
});

test("usableFinalText takes only final_answer blocks from a phased message", () => {
  assert.equal(usableFinalText(finalAnswer), "服务运行正常，没有发现异常。");
  assert.equal(usableFinalText(progress), "");
  assert.equal(usableFinalText({ role: "assistant", phase: "commentary", content: "进度说明" }), "");
});
