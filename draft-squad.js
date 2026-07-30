import { getDraftSquad } from "./src/lib/retroballApi.js?v=20260730-41";
import { formatDraftSquadText } from "./src/lib/draftSquad.js?v=20260730-41";

const nameElement = document.querySelector("#sharedSquadName");
const metaElement = document.querySelector("#sharedSquadMeta");
const seedElement = document.querySelector("#sharedSquadSeed");
const listElement = document.querySelector("#sharedSquadList");
const errorElement = document.querySelector("#sharedSquadError");
const shareButton = document.querySelector("#sharedSquadButton");
const statusElement = document.querySelector("#sharedSquadStatus");
const seed = new URLSearchParams(window.location.search).get("seed")?.trim().toUpperCase() || "";
let squad = null;

function playerHref(player) {
  if (!player.database || !player.sourcePersonId) return "";
  const params = new URLSearchParams({
    database: player.database,
    player: player.sourcePersonId,
  });
  return `database.html?${params}`;
}

function renderSquad(value) {
  squad = value;
  document.title = `${value.teamName} · Shared Draft Squad`;
  nameElement.textContent = value.teamName;
  metaElement.textContent = [value.formation, value.style].filter(Boolean).join(" · ");
  seedElement.textContent = value.seed;
  listElement.replaceChildren();
  value.players.forEach((player) => {
    const item = document.createElement("li");
    const role = document.createElement("span");
    role.textContent = player.role;
    const identity = document.createElement("div");
    const href = playerHref(player);
    const name = href ? document.createElement("a") : document.createElement("strong");
    name.textContent = player.name;
    if (href) name.href = href;
    const details = document.createElement("small");
    details.textContent = [player.club, player.season].filter(Boolean).join(" · ");
    identity.append(name, details);
    const overall = document.createElement("b");
    overall.textContent = player.overall;
    item.append(role, identity, overall);
    if (player.captain) {
      const captain = document.createElement("em");
      captain.textContent = "C";
      item.append(captain);
    }
    listElement.append(item);
  });
  shareButton.disabled = false;
}

async function shareSquad() {
  if (!squad) return;
  const text = formatDraftSquadText(squad);
  try {
    if (navigator.share) {
      await navigator.share({ title: `${squad.teamName} · Ultimate Draft`, text, url: window.location.href });
      statusElement.textContent = "Squad shared.";
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(`${text}\n\n${window.location.href}`);
      statusElement.textContent = "Squad list and link copied.";
    } else {
      statusElement.textContent = window.location.href;
    }
  } catch (error) {
    if (error?.name !== "AbortError") statusElement.textContent = "Could not share this squad.";
  }
}

shareButton.addEventListener("click", shareSquad);

if (!/^XI-[A-Z0-9]{10,18}$/.test(seed)) {
  listElement.replaceChildren();
  errorElement.hidden = false;
  errorElement.textContent = "This squad link is invalid.";
  nameElement.textContent = "Squad not found";
} else {
  getDraftSquad(seed)
    .then((payload) => renderSquad(payload.squad))
    .catch((error) => {
      listElement.replaceChildren();
      errorElement.hidden = false;
      errorElement.textContent = error.message || "This squad could not be loaded.";
      nameElement.textContent = "Squad not found";
    });
}
