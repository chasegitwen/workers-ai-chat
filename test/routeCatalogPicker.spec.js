import { describe, expect, it } from "vitest";
import { htmlPage } from "../src/frontend/page.js";
import { lastDeclaration, pageScript } from "./helpers/selectionHarness.js";

class FakeNode {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.listeners = {};
    this.className = "";
    this.classList = { toggle: () => {} };
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  insertAdjacentElement(_position, node) { this.inserted = node; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] || ""; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  dispatchEvent(event) { (this.listeners[event.type] || []).forEach(handler => handler(event)); return true; }
  querySelectorAll(selector) {
    const className = selector.startsWith(".") ? selector.slice(1) : "";
    return this.children.flatMap(child => [
      ...(className && child.className.split(" ").includes(className) ? [child] : []),
      ...child.querySelectorAll(selector)
    ]);
  }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  focus() { this.focused = true; }
  scrollIntoView() {}
  set innerHTML(_value) { this.children = []; }
}

class FakeSelect extends FakeNode {
  constructor(id) {
    super("select");
    this.id = id;
    this.options = [];
  }
}

function pickerApi() {
  const script = pageScript();
  const source = [
    "const routeCatalogPickers = new Map();",
    lastDeclaration(script, "syncCatalogPickerFromSelect"),
    lastDeclaration(script, "attachCatalogPicker"),
    "return { attachCatalogPicker, syncCatalogPickerFromSelect };"
  ].join("\n");
  const document = {
    createElement: tag => new FakeNode(tag),
    addEventListener() {}
  };
  return new Function("document", "MutationObserver", source)(document, undefined);
}

describe("Agent and Hermes catalog-style route pickers", () => {
  it("covers every route select with 16px+ catalog picker styling", () => {
    const html = htmlPage();
    const ids = [
      "openClawProviderSelect", "openClawAgentSelect", "openClawBaseModelSelect",
      "hermesInstanceSelect", "hermesAgentSelect", "hermesProviderSelect", "hermesModelSelect"
    ];
    ids.forEach(id => expect(html).toContain(`id="${id}" class="modelSelectNative"`));
    expect(html).toContain(".routeCatalogPicker{position:relative;min-width:0;font-size:max(16px,1rem)}");
    expect(lastDeclaration(pageScript(), "initRouteCatalogPickers")).toContain("].forEach(attachCatalogPicker)");
  });

  it("updates the native select and dispatches its existing change path", () => {
    const select = new FakeSelect("openClawAgentSelect");
    select.setAttribute("aria-label", "OpenClaw Agent");
    select.options = [
      { value: "main", textContent: "Main", disabled: false },
      { value: "ops", textContent: "Ops", disabled: false }
    ];
    select.value = "main";
    let selectedByExistingHandler = "";
    select.addEventListener("change", () => { selectedByExistingHandler = select.value; });

    const picker = pickerApi().attachCatalogPicker(select);
    picker.choose("ops");

    expect(select.value).toBe("ops");
    expect(selectedByExistingHandler).toBe("ops");
    expect(picker.label.textContent).toBe("Ops");
    expect(picker.popup.hidden).toBe(true);
  });

  it("stops Escape at the picker instead of closing the sidebar", () => {
    const select = new FakeSelect("hermesModelSelect");
    select.options = [{ value: "luna", textContent: "Luna", disabled: false }];
    select.value = "luna";
    const picker = pickerApi().attachCatalogPicker(select);
    picker.popup.hidden = false;
    let stopped = false;
    picker.filter.dispatchEvent({
      type: "keydown", key: "Escape", preventDefault() {}, stopPropagation() { stopped = true; }
    });
    expect(stopped).toBe(true);
    expect(picker.popup.hidden).toBe(true);
  });
});
