class AbilityPixel {
  constructor(canvas, context, x, y, color, speed, delay) {
    this.canvas = canvas;
    this.context = context;
    this.x = x;
    this.y = y;
    this.color = color;
    this.speed = (Math.random() * 0.8 + 0.1) * speed;
    this.size = 0;
    this.sizeStep = Math.random() * 0.4 + 0.08;
    this.minimumSize = 0.5;
    this.maximumPixelSize = 2;
    this.maximumSize =
      Math.random() * (this.maximumPixelSize - this.minimumSize)
      + this.minimumSize;
    this.delay = delay;
    this.counter = 0;
    this.counterStep =
      Math.random() * 4 + (canvas.width + canvas.height) * 0.01;
    this.idle = true;
    this.reverse = false;
    this.shimmering = false;
  }

  draw() {
    const offset = this.maximumPixelSize * 0.5 - this.size * 0.5;
    this.context.fillStyle = this.color;
    this.context.fillRect(
      this.x + offset,
      this.y + offset,
      this.size,
      this.size,
    );
  }

  appear() {
    this.idle = false;
    if (this.counter <= this.delay) {
      this.counter += this.counterStep;
      return;
    }

    if (this.size >= this.maximumSize) this.shimmering = true;
    if (this.shimmering) {
      if (this.size >= this.maximumSize) this.reverse = true;
      if (this.size <= this.minimumSize) this.reverse = false;
      this.size += this.reverse ? -this.speed : this.speed;
    } else {
      this.size += this.sizeStep;
    }
    this.draw();
  }

  disappear() {
    this.shimmering = false;
    this.counter = 0;
    if (this.size <= 0) {
      this.size = 0;
      this.idle = true;
      return;
    }
    this.size -= 0.1;
    this.draw();
  }
}

class AbilityPixelCanvas extends HTMLElement {
  connectedCallback() {
    if (this.canvas) return;

    this.parentBox = this.parentElement;
    const shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      :host {
        display: block;
        inline-size: 100%;
        block-size: 100%;
        overflow: hidden;
      }
      canvas {
        display: block;
        inline-size: 100%;
        block-size: 100%;
      }
    `;
    this.canvas = document.createElement("canvas");
    shadow.append(style, this.canvas);
    this.context = this.canvas.getContext("2d");
    this.reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    this.previousTime = performance.now();
    this.frameInterval = 1000 / 60;

    this.resizeObserver = new ResizeObserver(() => this.initialize());
    this.resizeObserver.observe(this);
    this.parentBox?.addEventListener("pointerenter", this);
    this.parentBox?.addEventListener("pointerleave", this);
    this.parentBox?.addEventListener("focusin", this);
    this.parentBox?.addEventListener("focusout", this);
    this.initialize();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver?.disconnect();
    this.parentBox?.removeEventListener("pointerenter", this);
    this.parentBox?.removeEventListener("pointerleave", this);
    this.parentBox?.removeEventListener("focusin", this);
    this.parentBox?.removeEventListener("focusout", this);
    this.parentBox = null;
  }

  handleEvent(event) {
    if (event.type === "pointerenter" || event.type === "focusin") {
      this.start("appear");
    } else if (event.type === "pointerleave" || event.type === "focusout") {
      this.start("disappear");
    }
  }

  palette() {
    const styles = getComputedStyle(this.parentBox || this);
    const colors = ["--ability-dark", "--ability-mid", "--ability-light"]
      .map((name) => styles.getPropertyValue(name).trim())
      .filter(Boolean);
    return colors.length ? colors : ["#584827", "#c7a03c", "#f9de90"];
  }

  initialize() {
    const bounds = this.getBoundingClientRect();
    const width = Math.floor(bounds.width);
    const height = Math.floor(bounds.height);
    if (!width || !height) return;

    this.canvas.width = width;
    this.canvas.height = height;
    const gap = Math.min(24, Math.max(4, Number(this.dataset.gap) || 4));
    const speed = this.reducedMotion
      ? 0
      : Math.min(100, Math.max(0, Number(this.dataset.speed) || 20)) * 0.001;
    const colors = this.palette();
    this.pixels = [];

    for (let x = 0; x < width; x += gap) {
      for (let y = 0; y < height; y += gap) {
        const distance = this.reducedMotion
          ? 0
          : Math.hypot(x - width / 2, y - height / 2);
        this.pixels.push(new AbilityPixel(
          this.canvas,
          this.context,
          x,
          y,
          colors[Math.floor(Math.random() * colors.length)],
          speed,
          distance,
        ));
      }
    }
  }

  start(action) {
    if (!this.pixels?.length) return;
    cancelAnimationFrame(this.animationFrame);
    if (this.reducedMotion) {
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (action === "appear") {
        this.pixels.forEach((pixel) => {
          pixel.size = pixel.maximumSize;
          pixel.draw();
        });
      }
      return;
    }
    this.animationFrame = requestAnimationFrame((time) =>
      this.animate(action, time));
  }

  animate(action, time) {
    const elapsed = time - this.previousTime;
    if (elapsed >= this.frameInterval) {
      this.previousTime = time - (elapsed % this.frameInterval);
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.pixels.forEach((pixel) => pixel[action]());
    }

    if (action === "disappear" && this.pixels.every((pixel) => pixel.idle)) {
      return;
    }
    this.animationFrame = requestAnimationFrame((nextTime) =>
      this.animate(action, nextTime));
  }
}

if ("customElements" in window && !customElements.get("ability-pixel-canvas")) {
  customElements.define("ability-pixel-canvas", AbilityPixelCanvas);
}
