export function filterEmptySystemMessages(messages) {
  return (messages || []).filter(message => {
    if (message?.role !== "system") {
      return true;
    }

    return String(message.content || "").trim().length > 0;
  });
}
