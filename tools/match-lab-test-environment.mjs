// Minimal DOM for testing the existing page-module adapter in Node.
function fakeStyle() {
  const props = {};
  return {
    setProperty(name, value) { props[name] = value; },
    removeProperty(name) { delete props[name]; },
    getPropertyValue(name) { return props[name] ?? ""; },
  };
}
function fakeClassList() {
  const set = new Set();
  return {
    add: (...names) => names.forEach((name) => set.add(name)),
    remove: (...names) => names.forEach((name) => set.delete(name)),
    toggle(name, force) {
      if (force === undefined) { set.has(name) ? set.delete(name) : set.add(name); }
      else if (force) set.add(name);
      else set.delete(name);
    },
    contains: (name) => set.has(name),
  };
}
function fakeElement() {
  const el = {
    className: "", style: fakeStyle(), dataset: {}, classList: fakeClassList(),
    children: [], parentNode: null, value: "", textContent: "", innerHTML: "", hidden: false,
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    removeAttribute() {}, setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; },
    querySelector() { return fakeElement(); },
    querySelectorAll() { return []; },
    appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
    removeChild(child) { const i = el.children.indexOf(child); if (i >= 0) el.children.splice(i, 1); return child; },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    replaceChildren() { el.children = []; },
    focus() {}, click() {},
  };
  return el;
}
globalThis.document = {
  querySelector() { return fakeElement(); },
  querySelectorAll() { return []; },
  createElement() { return fakeElement(); },
  addEventListener() {},
  body: fakeElement(),
};
globalThis.window = globalThis;
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame || ((id) => clearTimeout(id));
globalThis.fetch = async () => { throw new Error("network disabled in test"); };

