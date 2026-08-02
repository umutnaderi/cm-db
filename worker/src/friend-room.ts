import { DurableObject } from "cloudflare:workers";

type Role = "host" | "guest";

interface ConnectionAttachment {
  role: Role;
  name: string;
  joinedAt: number;
}

interface StoredRoom extends Record<string, SqlStorageValue> {
  code: string;
  host_token_hash: string;
  guest_token_hash: string;
  host_name: string;
  guest_name: string;
  host_ready: number;
  guest_ready: number;
  start_at: number | null;
  host_squad_json: string | null;
  guest_squad_json: string | null;
  match_seed: string | null;
  match_start_at: number | null;
  created_at: number;
}

interface CreateRoomInput {
  code: string;
  hostTokenHash: string;
  guestTokenHash: string;
  hostName: string;
}

const ROOM_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MAX_SQUAD_BYTES = 450_000;

function safeName(value: unknown, fallback: string): string {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 24);
  return name || fallback;
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function matchSeed(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(36).padStart(2, "0")).join("").toUpperCase();
}

function serializedSquad(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const squad = value as Record<string, unknown>;
  if (!Array.isArray(squad.players) || squad.players.length !== 11) return null;
  if (!squad.players.some((entry) => Boolean((entry as Record<string, unknown>)?.isCaptain))) {
    return null;
  }
  const serialized = JSON.stringify(squad);
  return serialized.length <= MAX_SQUAD_BYTES ? serialized : null;
}

export class FriendMatchRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS room (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          code TEXT NOT NULL,
          host_token_hash TEXT NOT NULL,
          guest_token_hash TEXT NOT NULL,
          host_name TEXT NOT NULL,
          guest_name TEXT NOT NULL DEFAULT 'Guest',
          host_ready INTEGER NOT NULL DEFAULT 0,
          guest_ready INTEGER NOT NULL DEFAULT 0,
          start_at INTEGER,
          host_squad_json TEXT,
          guest_squad_json TEXT,
          match_seed TEXT,
          match_start_at INTEGER,
          created_at INTEGER NOT NULL
        )
      `);
      const columns = new Set(
        this.ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(room)")
          .toArray().map((column) => column.name),
      );
      for (const [name, definition] of [
        ["host_squad_json", "TEXT"],
        ["guest_squad_json", "TEXT"],
        ["match_seed", "TEXT"],
        ["match_start_at", "INTEGER"],
      ] as const) {
        if (!columns.has(name)) {
          this.ctx.storage.sql.exec(`ALTER TABLE room ADD COLUMN ${name} ${definition}`);
        }
      }
    });
  }

  async createRoom(input: CreateRoomInput): Promise<boolean> {
    const existing = this.room();
    if (existing) return false;
    const createdAt = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO room (
        singleton, code, host_token_hash, guest_token_hash,
        host_name, guest_name, created_at
      ) VALUES (1, ?, ?, ?, ?, 'Guest', ?)`,
      input.code,
      input.hostTokenHash,
      input.guestTokenHash,
      safeName(input.hostName, "Host"),
      createdAt,
    );
    await this.ctx.storage.setAlarm(createdAt + ROOM_LIFETIME_MS);
    return true;
  }

  async publicState(): Promise<Record<string, unknown> | null> {
    const room = this.room();
    return room ? this.statePayload(room, false) : null;
  }

  private room(): StoredRoom | null {
    return this.ctx.storage.sql.exec<StoredRoom>(
      "SELECT * FROM room WHERE singleton = 1",
    ).toArray()[0] || null;
  }

  private connections(): ConnectionAttachment[] {
    return this.ctx.getWebSockets().map((socket) =>
      socket.deserializeAttachment() as ConnectionAttachment).filter(Boolean);
  }

  private statePayload(room = this.room(), includeMatch = true): Record<string, unknown> {
    if (!room) return { type: "room-state", missing: true, serverNow: Date.now() };
    const connections = this.connections();
    return {
      type: "room-state",
      code: room.code,
      serverNow: Date.now(),
      startAt: room.start_at,
      phase: room.match_start_at ? "match" : room.start_at ? "draft" : "lobby",
      players: {
        host: {
          name: room.host_name,
          ready: Boolean(room.host_ready),
          squadReady: Boolean(room.host_squad_json),
          connected: connections.some((connection) => connection.role === "host"),
        },
        guest: {
          name: room.guest_name,
          ready: Boolean(room.guest_ready),
          squadReady: Boolean(room.guest_squad_json),
          connected: connections.some((connection) => connection.role === "guest"),
        },
      },
      match: includeMatch && room.host_squad_json && room.guest_squad_json
        ? {
            seed: room.match_seed,
            startAt: room.match_start_at,
            hostTeam: JSON.parse(room.host_squad_json),
            guestTeam: JSON.parse(room.guest_squad_json),
          }
        : null,
    };
  }

  private broadcast(payload = this.statePayload()): void {
    const message = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // A close event will remove an unavailable connection.
      }
    }
  }

  private roleForToken(room: StoredRoom, tokenHash: string): Role | null {
    if (constantTimeEqual(tokenHash, room.host_token_hash)) return "host";
    if (constantTimeEqual(tokenHash, room.guest_token_hash)) return "guest";
    return null;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const room = this.room();
    if (!room) return new Response("Room not found", { status: 404 });
    const url = new URL(request.url);
    const role = this.roleForToken(room, request.headers.get("x-room-token-hash") || "");
    if (!role) return new Response("Invalid room token", { status: 403 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const name = safeName(url.searchParams.get("name"), role === "host" ? "Host" : "Guest");
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role, name, joinedAt: Date.now() } satisfies ConnectionAttachment);
    this.ctx.storage.sql.exec(
      role === "host"
        ? "UPDATE room SET host_name = ? WHERE singleton = 1"
        : "UPDATE room SET guest_name = ? WHERE singleton = 1",
      name,
    );
    server.send(JSON.stringify({ type: "welcome", role, serverNow: Date.now() }));
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > MAX_SQUAD_BYTES + 8_192) return;
    const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
    if (!attachment) return;
    let payload: {
      type?: string;
      ready?: boolean;
      sentAt?: number;
      name?: string;
      squad?: unknown;
    };
    try {
      payload = JSON.parse(message) as typeof payload;
    } catch {
      return;
    }
    if (payload.type === "ping") {
      socket.send(JSON.stringify({
        type: "pong",
        sentAt: Number(payload.sentAt) || 0,
        serverNow: Date.now(),
      }));
      return;
    }
    if (payload.type === "set-name") {
      const name = safeName(payload.name, attachment.role === "host" ? "Host" : "Guest");
      socket.serializeAttachment({ ...attachment, name });
      this.ctx.storage.sql.exec(
        attachment.role === "host"
          ? "UPDATE room SET host_name = ? WHERE singleton = 1"
          : "UPDATE room SET guest_name = ? WHERE singleton = 1",
        name,
      );
      this.broadcast();
      return;
    }
    if (payload.type === "submit-squad") {
      const squad = serializedSquad(payload.squad);
      if (!squad) {
        socket.send(JSON.stringify({ type: "room-error", message: "A completed eleven and captain are required." }));
        return;
      }
      this.ctx.storage.sql.exec(
        attachment.role === "host"
          ? "UPDATE room SET host_squad_json = ? WHERE singleton = 1"
          : "UPDATE room SET guest_squad_json = ? WHERE singleton = 1",
        squad,
      );
      const submittedRoom = this.room();
      if (
        submittedRoom?.host_squad_json && submittedRoom.guest_squad_json &&
        !submittedRoom.match_start_at
      ) {
        this.ctx.storage.sql.exec(
          "UPDATE room SET match_seed = ?, match_start_at = ? WHERE singleton = 1",
          matchSeed(),
          Date.now() + 12_000,
        );
      }
      this.broadcast();
      return;
    }
    if (payload.type !== "ready") return;
    this.ctx.storage.sql.exec(
      attachment.role === "host"
        ? "UPDATE room SET host_ready = ? WHERE singleton = 1"
        : "UPDATE room SET guest_ready = ? WHERE singleton = 1",
      payload.ready ? 1 : 0,
    );
    const room = this.room();
    if (room && room.host_ready && room.guest_ready && room.start_at === null) {
      const startAt = Date.now() + 5_000;
      this.ctx.storage.sql.exec(
        "UPDATE room SET start_at = ? WHERE singleton = 1",
        startAt,
      );
    }
    this.broadcast();
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    socket.close(code, reason);
    this.broadcast();
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    socket.close(1011, "WebSocket error");
    this.broadcast();
  }

  async alarm(): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      socket.close(1001, "Room expired");
    }
    this.ctx.storage.sql.exec("DELETE FROM room");
  }
}
