export function cleanText(text = "") {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractReadableTextFromHtml(html = "") {
  let text = html;

  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  text = text.replace(/<\/(p|div|section|article|h1|h2|h3|li|br)>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");

  text = cleanText(text);

  return text.slice(0, 60000);
}
