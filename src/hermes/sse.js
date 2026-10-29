// Incremental parser for the Hermes run event stream.
//
// Hermes frames are `id: <seq>\ndata: <json>\n\n`; the event name lives in data.event and
// comment frames (`: open`, `: keepalive`, `: stream closed`) carry no data. The parser is
// tolerant of CRLF, split chunks and an `event:` line, and never throws on bad JSON.

export function createSseParser() {
  let buffer = "";

  function parseFrame(frame) {
    let id = null;
    let eventName = "";
    const dataLines = [];
    let comment = null;
    for (const rawLine of frame.split("\n")) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (!line) continue;
      if (line.startsWith(":")) {
        comment = line.slice(1).trim();
        continue;
      }
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "id") id = value;
      else if (field === "event") eventName = value;
      else if (field === "data") dataLines.push(value);
    }
    if (!dataLines.length) {
      return comment !== null ? { type: "comment", comment } : null;
    }
    const raw = dataLines.join("\n");
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return { type: "invalid", id, raw: raw.slice(0, 200) };
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { type: "invalid", id, raw: raw.slice(0, 200) };
    }
    const seq = Number.isInteger(data.seq) ? data.seq : (/^\d+$/.test(String(id ?? "")) ? Number(id) : null);
    return { type: "event", id, seq, event: String(data.event || eventName || ""), data };
  }

  return {
    push(chunk) {
      buffer += String(chunk || "").replace(/\r\n/g, "\n");
      const frames = [];
      let index = buffer.indexOf("\n\n");
      while (index !== -1) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const parsed = parseFrame(frame);
        if (parsed) frames.push(parsed);
        index = buffer.indexOf("\n\n");
      }
      return frames;
    },
    flush() {
      const rest = buffer;
      buffer = "";
      const parsed = rest.trim() ? parseFrame(rest) : null;
      return parsed ? [parsed] : [];
    }
  };
}

export function formatSseFrame(payload, id = null) {
  const prefix = id === null || id === undefined ? "" : "id: " + id + "\n";
  return prefix + "data: " + JSON.stringify(payload) + "\n\n";
}
