import { describe, expect, it } from "vitest";
import { htmlPage } from "../src/frontend/page.js";

function frontendMathRenderer(){
  const page = htmlPage();
  const scriptMatch = page.match(/<script>([\s\S]*)<\/script>/);
  expect(scriptMatch?.[1]).toBeTruthy();
  const script = scriptMatch[1];
  const utilityStart = script.indexOf("function escapeHtml");
  const utilityEnd = script.indexOf("async function libraryTextForUpload", utilityStart);
  const rendererStart = script.indexOf("function protectMarkdownCode");
  const rendererEnd = script.indexOf("function parseAssistantMarkdown", rendererStart);
  expect(utilityStart).toBeGreaterThanOrEqual(0);
  expect(utilityEnd).toBeGreaterThan(utilityStart);
  expect(rendererStart).toBeGreaterThanOrEqual(0);
  expect(rendererEnd).toBeGreaterThan(rendererStart);

  return new Function(
    script.slice(utilityStart, utilityEnd) +
    script.slice(rendererStart, rendererEnd) +
    "\nreturn { renderMathMarkup };"
  )();
}

describe("assistant Markdown math rendering", () => {
  it("renders backslash inline and display delimiters", () => {
    const { renderMathMarkup } = frontendMathRenderer();
    const rendered = renderMathMarkup(
      "Vector \\(x^T A x\\) and\n\n\\[G_{ij}=\\langle v_i,v_j\\rangle\\]"
    );

    expect(rendered).toContain("class='mathInline mathFallback'");
    expect(rendered).toContain("data-latex='x%5ET%20A%20x'");
    expect(rendered).toContain("class='mathBlock mathFallback'");
    expect(rendered).toContain("G_%7Bij%7D%3D%5Clangle%20v_i%2Cv_j%5Crangle");
    expect(rendered).not.toContain("\\(");
    expect(rendered).not.toContain("\\[");
  });

  it("continues to render dollar delimiters alongside backslash delimiters", () => {
    const { renderMathMarkup } = frontendMathRenderer();
    const rendered = renderMathMarkup(
      "Inline $a+b$ and \\(c+d\\)\n\n$$e=f$$\n\n\\[g=h\\]"
    );

    expect(rendered.match(/data-latex=/g)).toHaveLength(4);
    expect(rendered.match(/data-math-display='1'/g)).toHaveLength(2);
    expect(rendered.match(/data-math-display='0'/g)).toHaveLength(2);
  });

  it("keeps derivative primes inside the encoded math attribute", () => {
    const { renderMathMarkup } = frontendMathRenderer();
    const rendered = renderMathMarkup(
      "Transform $x \\to x'$ and derivative \\(f'(x)\\)"
    );

    expect(rendered).toContain("data-latex='x%20%5Cto%20x%27'");
    expect(rendered).toContain("data-latex='f%27(x)'");
    expect(rendered).toContain("$x \\to x&#39;$");
    expect(rendered).not.toContain("data-latex='x%20%5Cto%20x''");
  });

  it("does not render math delimiters inside inline or fenced code", () => {
    const { renderMathMarkup } = frontendMathRenderer();
    const markdown = "`\\(inline code\\)`\n\n```text\n\\[block code\\]\n```";

    expect(renderMathMarkup(markdown)).toBe(markdown);
  });

  it("leaves unmatched backslash delimiters as plain text", () => {
    const { renderMathMarkup } = frontendMathRenderer();
    const markdown = "Incomplete \\(x + y and \\[z";

    expect(renderMathMarkup(markdown)).toBe(markdown);
  });
});
