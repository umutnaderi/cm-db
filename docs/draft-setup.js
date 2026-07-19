const formations = {
  "4-3-3": [
    ["GK", 50, 91], ["LB", 18, 76], ["CB", 39, 79], ["CB", 61, 79], ["RB", 82, 76],
    ["CM", 27, 52], ["DM", 50, 60], ["CM", 73, 52],
    ["LW", 20, 28], ["ST", 50, 22], ["RW", 80, 28],
  ],
  "4-4-2": [
    ["GK", 50, 91], ["LB", 18, 76], ["CB", 39, 79], ["CB", 61, 79], ["RB", 82, 76],
    ["LM", 18, 49], ["CM", 40, 55], ["CM", 60, 55], ["RM", 82, 49],
    ["ST", 39, 24], ["ST", 61, 24],
  ],
  "4-2-3-1": [
    ["GK", 50, 91], ["LB", 18, 76], ["CB", 39, 79], ["CB", 61, 79], ["RB", 82, 76],
    ["DM", 39, 60], ["DM", 61, 60],
    ["LW", 20, 39], ["AM", 50, 42], ["RW", 80, 39], ["ST", 50, 20],
  ],
  "4-2-4": [
    ["GK", 50, 91], ["LB", 18, 76], ["CB", 39, 79], ["CB", 61, 79], ["RB", 82, 76],
    ["CM", 39, 56], ["CM", 61, 56],
    ["LW", 17, 29], ["ST", 40, 22], ["ST", 60, 22], ["RW", 83, 29],
  ],
  "3-5-2": [
    ["GK", 50, 91], ["CB", 28, 78], ["CB", 50, 81], ["CB", 72, 78],
    ["LWB", 14, 54], ["CM", 35, 54], ["DM", 50, 62], ["CM", 65, 54], ["RWB", 86, 54],
    ["ST", 39, 24], ["ST", 61, 24],
  ],
  "5-3-2": [
    ["GK", 50, 91], ["LWB", 12, 70], ["CB", 31, 79], ["CB", 50, 82], ["CB", 69, 79], ["RWB", 88, 70],
    ["CM", 32, 52], ["DM", 50, 60], ["CM", 68, 52],
    ["ST", 39, 24], ["ST", 61, 24],
  ],
  "4-5-1": [
    ["GK", 50, 91], ["LB", 18, 76], ["CB", 39, 79], ["CB", 61, 79], ["RB", 82, 76],
    ["LM", 15, 49], ["CM", 35, 53], ["DM", 50, 61], ["CM", 65, 53], ["RM", 85, 49],
    ["ST", 50, 22],
  ],
  "3-4-3": [
    ["GK", 50, 91], ["CB", 28, 78], ["CB", 50, 81], ["CB", 72, 78],
    ["LM", 16, 53], ["CM", 40, 57], ["CM", 60, 57], ["RM", 84, 53],
    ["LW", 20, 28], ["ST", 50, 22], ["RW", 80, 28],
  ],
};

const state = {
  formation: "4-3-3",
  style: "Balanced",
  mode: "Classic",
};

const formationChoices = document.querySelector("#formationChoices");
const styleChoices = document.querySelector("#styleChoices");
const modeChoices = document.querySelector("#modeChoices");
const pitch = document.querySelector("#formationPitch");
const caption = document.querySelector("#formationCaption");
const summary = document.querySelector("#draftSetupSummary");
const rollIntro = document.querySelector("#draftRollIntro");

Object.keys(formations).forEach((formation) => {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.value = formation;
  button.textContent = formation;
  button.classList.toggle("is-selected", formation === state.formation);
  formationChoices.append(button);
});

function renderPitch() {
  pitch.replaceChildren();
  pitch.dataset.style = state.style.toLowerCase();

  formations[state.formation].forEach(([role, x, y]) => {
    const marker = document.createElement("span");
    marker.className = "formation-player";
    marker.textContent = role;
    marker.style.left = `${x}%`;
    marker.style.top = `${y}%`;
    pitch.append(marker);
  });

  caption.textContent = `${state.formation} · ${state.style}`;
  summary.textContent = `${state.formation} · ${state.style} · ${state.mode}`;
}

function bindChoiceGroup(container, key) {
  container.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-value]");
    if (!button) return;

    state[key] = button.dataset.value;
    container.querySelectorAll("button").forEach((item) => {
      item.classList.toggle("is-selected", item === button);
    });
    renderPitch();
  });
}

bindChoiceGroup(formationChoices, "formation");
bindChoiceGroup(styleChoices, "style");
bindChoiceGroup(modeChoices, "mode");

document.querySelector("#draftRollButton").addEventListener("click", () => {
  rollIntro.textContent = `${state.formation} · ${state.style} · ${state.mode} selected. Player roll comes next.`;
});

renderPitch();
