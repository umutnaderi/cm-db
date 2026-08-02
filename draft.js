import {
  API_BASE,
  createFriendRoom,
  getDraftRecords,
} from "./src/lib/retroballApi.js?v=20260801-66";
import {
  estimateServerClockOffset,
} from "./src/lib/matchPlayback.js?v=20260801-01";

const hallList = document.querySelector("#draftHallList");
const friendsModal = document.querySelector("#draftFriendsModal");
const friendsClose = document.querySelector("#draftFriendsClose");
const friendsStart = document.querySelector("#draftFriendsStart");
const friendsRoom = document.querySelector("#draftFriendsRoom");
const friendsCreateForm = document.querySelector("#draftFriendsCreateForm");
const friendsJoinForm = document.querySelector("#draftFriendsJoinForm");
const friendsName = document.querySelector("#draftFriendsName");
const friendsInvite = document.querySelector("#draftFriendsInvite");
const friendsCode = document.querySelector("#draftFriendsCode");
const friendsInvitePanel = document.querySelector("#draftFriendsInvitePanel");
const friendsInviteLink = document.querySelector("#draftFriendsInviteLink");
const friendsCopy = document.querySelector("#draftFriendsCopy");
const friendsStatus = document.querySelector("#draftFriendsStatus");
const friendsReady = document.querySelector("#draftFriendsReady");
const friendsButton = document.querySelector(".draft-play-friends");
let friendSocket = null;
let friendSession = null;
let friendRoomState = null;
let friendReady = false;
let serverOffsetMs = 0;
let clockSamples = [];
let countdownTimer = null;
let reconnectTimer = null;
let friendConnectionGeneration = 0;
let friendDraftStarted = false;
const FRIEND_SESSION_KEY = "retroball-friend-session-v1";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function playerHref(database, sourcePersonId) {
  if (!database || !sourcePersonId) return "";
  const params = new URLSearchParams({
    database: String(database),
    player: String(sourcePersonId),
  });
  return `database.html?${params}`;
}

function linkedPlayer(name, database, sourcePersonId, suffix = "") {
  const label = `${name || "—"}${suffix}`;
  const href = playerHref(database, sourcePersonId);
  return href
    ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
    : escapeHtml(label);
}

function recordLabels(record) {
  const storedStage = String(record.stage || "");
  const titanStage = storedStage.match(/(?:Titan\s*)?(\d+\/8)/i)?.[1] || "";
  return {
    mode: record.mode === "Titan Fight" || titanStage ? "Titan Fight" : "Classic",
    stage: record.champion ? "Champion" : titanStage || storedStage || "—",
  };
}

function renderRecords(records) {
  hallList.replaceChildren();
  if (!records.length) {
    hallList.innerHTML = '<li class="is-status">No saved runs yet. Be the first.</li>';
    return;
  }

  records.slice(0, 8).forEach((record, index) => {
    const labels = recordLabels(record);
    const item = document.createElement("li");
    item.innerHTML = `
      <b class="draft-hall-rank">${index + 1}</b>
      <div class="draft-hall-run">
        <strong>${escapeHtml(record.username || "Anonymous")}</strong>
        <small>${escapeHtml(record.team_name || "Ultimate XI")}</small>
        <p>
          <span>${escapeHtml(labels.mode)}</span>
          <span>${escapeHtml(labels.stage)}</span>
        </p>
        <em>
          Captain ${linkedPlayer(record.captain_name, record.captain_database, record.captain_source_person_id)}
          · Top scorer ${linkedPlayer(record.top_scorer_name, record.top_scorer_database, record.top_scorer_source_person_id, ` (${Number(record.top_scorer_goals) || 0})`)}
          · Dominator ${linkedPlayer(record.dominator_name, record.dominator_database, record.dominator_source_person_id, ` (${Number(record.dominator_awards) || 0})`)}
        </em>
      </div>
      ${record.squad_seed
        ? `<a class="draft-hall-squad" href="draft-squad.html?seed=${encodeURIComponent(record.squad_seed)}">XI</a>`
        : '<span class="draft-hall-squad is-empty">—</span>'}
    `;
    hallList.append(item);
  });
}

async function loadHallOfFame() {
  try {
    const payload = await getDraftRecords();
    renderRecords(Array.isArray(payload.items) ? payload.items : []);
  } catch {
    hallList.innerHTML = '<li class="is-status">Hall of Fame is temporarily unavailable.</li>';
  }
}

void loadHallOfFame();

function setFriendsModal(open) {
  friendsModal.hidden = !open;
  document.body.classList.toggle("is-friends-modal-open", open);
  if (open) friendsName.focus();
}

function roomWebSocketUrl(session) {
  const url = new URL(API_BASE);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/api/friend-rooms/${encodeURIComponent(session.code)}/websocket`;
  url.search = new URLSearchParams({ token: session.token, name: session.name });
  return url.href;
}

function inviteUrl(code, token) {
  const url = new URL("draft.html", window.location.href);
  url.hash = new URLSearchParams({ room: code, token, role: "guest" });
  return url.href;
}

function friendSessionHash(session) {
  return new URLSearchParams({
    room: session.code,
    token: session.token,
    role: session.role,
  }).toString();
}

function enterFriendDraft() {
  if (friendDraftStarted || !friendSession) return;
  friendDraftStarted = true;
  sessionStorage.setItem(FRIEND_SESSION_KEY, JSON.stringify(friendSession));
  window.location.href = `draft-setup.html#${friendSessionHash(friendSession)}`;
}

function parseInvitation(value) {
  try {
    const url = new URL(String(value || "").trim(), window.location.href);
    const params = new URLSearchParams(url.hash.replace(/^#/, ""));
    const code = String(params.get("room") || "").toUpperCase();
    const token = params.get("token") || "";
    const role = params.get("role") === "host" ? "host" : "guest";
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code) || !/^[A-Za-z0-9_-]{32}$/.test(token)) {
      return null;
    }
    return { code, token, role };
  } catch {
    return null;
  }
}

function renderFriendPlayer(role, player) {
  const card = friendsRoom.querySelector(`[data-friend-role="${role}"]`);
  card.querySelector("strong").textContent = player?.name || (role === "host" ? "Host" : "Guest");
  const status = card.querySelector("small");
  status.textContent = player?.connected
    ? player.ready ? "Connected · Ready" : "Connected · Not ready"
    : player?.ready ? "Offline · Ready saved" : "Offline";
  card.classList.toggle("is-connected", Boolean(player?.connected));
  card.classList.toggle("is-ready", Boolean(player?.ready));
}

function updateKickoffStatus() {
  if (!friendRoomState?.startAt) return;
  const remaining = Number(friendRoomState.startAt) - (Date.now() + serverOffsetMs);
  if (remaining > 0) {
    friendsStatus.textContent = `Both players ready. Kickoff in ${Math.max(1, Math.ceil(remaining / 1000))}...`;
  } else {
    friendsStatus.textContent = "Draft synchronized. Opening the team builder...";
    friendsReady.disabled = true;
    clearInterval(countdownTimer);
    countdownTimer = null;
    enterFriendDraft();
  }
}

function renderFriendRoom(state) {
  friendRoomState = state;
  renderFriendPlayer("host", state.players?.host);
  renderFriendPlayer("guest", state.players?.guest);
  const ownState = state.players?.[friendSession.role];
  friendReady = Boolean(ownState?.ready);
  friendsReady.textContent = friendReady ? "Cancel ready" : "Ready";
  friendsReady.disabled = !friendSocket || friendSocket.readyState !== WebSocket.OPEN || Boolean(state.startAt);
  if (state.startAt) {
    if (!countdownTimer) countdownTimer = setInterval(updateKickoffStatus, 100);
    updateKickoffStatus();
  } else if (!state.players?.host?.connected || !state.players?.guest?.connected) {
    friendsStatus.textContent = "Waiting for both players to connect.";
  } else if (!state.players.host.ready || !state.players.guest.ready) {
    friendsStatus.textContent = "Both players must press Ready before kickoff.";
  }
}

function sendClockSamples() {
  clockSamples = [];
  [0, 140, 280, 420, 560].forEach((delayMs) => {
    window.setTimeout(() => {
      if (friendSocket?.readyState === WebSocket.OPEN) {
        friendSocket.send(JSON.stringify({ type: "ping", sentAt: Date.now() }));
      }
    }, delayMs);
  });
}

function connectFriendRoom(session) {
  const generation = ++friendConnectionGeneration;
  clearTimeout(reconnectTimer);
  friendSession = session;
  friendsStart.hidden = true;
  friendsRoom.hidden = false;
  friendsCode.textContent = session.code;
  friendsInvitePanel.hidden = session.role !== "host";
  friendsCopy.disabled = session.role !== "host" || !friendsInviteLink.value;
  friendsStatus.textContent = "Connecting to the room...";
  friendsReady.disabled = true;
  if (friendSocket && friendSocket.readyState < WebSocket.CLOSING) friendSocket.close();
  friendSocket = new WebSocket(roomWebSocketUrl(session));
  friendSocket.addEventListener("open", () => {
    friendsStatus.textContent = "Connected. Waiting for room state...";
    sendClockSamples();
  });
  friendSocket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "pong") {
      clockSamples.push({
        sentAt: Number(message.sentAt),
        serverNow: Number(message.serverNow),
        receivedAt: Date.now(),
      });
      serverOffsetMs = estimateServerClockOffset(clockSamples);
      return;
    }
    if (message.type === "room-state") renderFriendRoom(message);
  });
  friendSocket.addEventListener("close", () => {
    if (generation !== friendConnectionGeneration) return;
    friendsReady.disabled = true;
    friendsStatus.textContent = "Connection lost. Reconnecting...";
    reconnectTimer = window.setTimeout(() => connectFriendRoom(session), 1_500);
  });
  friendSocket.addEventListener("error", () => {
    friendsStatus.textContent = "The live room connection failed.";
  });
}

friendsButton.addEventListener("click", () => setFriendsModal(true));
friendsClose.addEventListener("click", () => setFriendsModal(false));
friendsModal.addEventListener("click", (event) => {
  if (event.target === friendsModal) setFriendsModal(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !friendsModal.hidden) setFriendsModal(false);
});
friendsCreateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = friendsName.value.trim();
  const button = friendsCreateForm.querySelector("button");
  button.disabled = true;
  button.textContent = "Creating...";
  try {
    const room = await createFriendRoom(name);
    const session = { code: room.code, token: room.hostToken, role: "host", name };
    const hostHash = new URLSearchParams({ room: room.code, token: room.hostToken, role: "host" });
    history.replaceState(null, "", `${location.pathname}${location.search}#${hostHash}`);
    friendsInviteLink.value = inviteUrl(room.code, room.guestToken);
    friendsCopy.disabled = false;
    sessionStorage.setItem("retroball-friend-name", name);
    connectFriendRoom(session);
  } catch (error) {
    friendsStart.querySelector("p").textContent =
      error.message?.startsWith("404")
        ? "The live-room service is not available on this API deployment yet."
        : error.message || "Could not create the room.";
  } finally {
    button.disabled = false;
    button.textContent = "Create room";
  }
});
friendsJoinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const invitation = parseInvitation(friendsInvite.value);
  if (!invitation) {
    friendsInvite.setCustomValidity("Paste a valid invitation link.");
    friendsInvite.reportValidity();
    return;
  }
  friendsInvite.setCustomValidity("");
  const name = friendsName.value.trim() || sessionStorage.getItem("retroball-friend-name") || "Guest";
  sessionStorage.setItem("retroball-friend-name", name);
  history.replaceState(null, "", `${location.pathname}${location.search}${new URL(friendsInvite.value, location.href).hash}`);
  connectFriendRoom({ ...invitation, name });
});
friendsCopy.addEventListener("click", async () => {
  const invitation = friendsInviteLink.value.trim();
  if (!invitation) return;

  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(invitation);
      copied = true;
    }
  } catch {}

  if (!copied) {
    friendsInviteLink.select();
    copied = document.execCommand?.("copy") === true;
  }

  friendsCopy.textContent = copied ? "Copied" : "Select and copy";
  window.setTimeout(() => {
    friendsCopy.textContent = "Copy invitation";
  }, 1_500);
});
friendsReady.addEventListener("click", () => {
  if (friendSocket?.readyState !== WebSocket.OPEN) return;
  friendSocket.send(JSON.stringify({ type: "ready", ready: !friendReady }));
});

const invitationOnLoad = parseInvitation(window.location.href);
if (invitationOnLoad) {
  setFriendsModal(true);
  const savedName = sessionStorage.getItem("retroball-friend-name") ||
    (invitationOnLoad.role === "host" ? "Host" : "Guest");
  friendsName.value = savedName;
  connectFriendRoom({ ...invitationOnLoad, name: savedName });
}
