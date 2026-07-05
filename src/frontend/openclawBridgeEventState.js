export function createOpenClawBridgeEventState() {
  return {
    seenEventIds: new Set(),
    lastSequence: -Infinity,
    final: false
  };
}

export function applyOpenClawBridgeEventState(state, event) {
  const target = state || createOpenClawBridgeEventState();
  const eventId = String(event?.event_id || "");
  if (eventId && target.seenEventIds.has(eventId)) {
    return { accepted: false, reason: "duplicate", state: target };
  }
  if (eventId) {
    target.seenEventIds.add(eventId);
  }

  const eventType = String(event?.event_type || "");
  const sequence = Number(event?.sequence);
  const hasSequence = Number.isFinite(sequence);
  if (hasSequence && sequence < target.lastSequence) {
    return { accepted: false, reason: "old_sequence", state: target };
  }
  if (target.final && eventType !== "bridge.final" && eventType !== "bridge.error") {
    return { accepted: false, reason: "after_final", state: target };
  }
  if (hasSequence) {
    target.lastSequence = Math.max(target.lastSequence, sequence);
  }
  if (eventType === "bridge.final" || eventType === "bridge.error") {
    target.final = true;
  }
  return { accepted: true, reason: "", state: target };
}
