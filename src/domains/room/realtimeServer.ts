/* global NodeJS, setTimeout, clearTimeout */
import { config } from '#a/config.js';
import { pubClient, redisClient, subClient } from '#a/utils/index.js';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import winston from 'winston';

export interface Vector3State {
  x: number;
  y: number;
  z: number;
}

export type SlotId =
  | 'Character_01'
  | 'Character_02'
  | 'Character_03'
  | 'Character_04'
  | 'Character_05'
  | 'Character_06';

export interface PlayerRealtimeState {
  active: boolean;
  visible: boolean;
  position: Vector3State;
  rotation: Vector3State;
  clientId: string;
  updatedAt: number;
  slotId: SlotId;
}

const REDIS_KEY_PREFIX = 'presence:team:';
const STALE_MS = 15_000;
const DISCONNECT_DELAY_MS = 2_000;

const ALL_MODELS: SlotId[] = [
  'Character_01',
  'Character_02',
  'Character_03',
  'Character_04',
  'Character_05',
  'Character_06',
];

function uidToModelId(uid: string): SlotId {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  }
  return ALL_MODELS[hash % ALL_MODELS.length];
}

// ── Shared helper: fetch active room state from Redis ────────────────────
async function getRoomState(
  redisHashKey: string
): Promise<Record<string, PlayerRealtimeState>> {
  const allPlayersRaw = await redisClient.hgetall(redisHashKey);
  const fullState: Record<string, PlayerRealtimeState> = {};
  const now = Date.now();

  for (const [key, value] of Object.entries(allPlayersRaw)) {
    const state: PlayerRealtimeState = JSON.parse(value);
    if (now - state.updatedAt < STALE_MS) {
      fullState[key] = state;
    } else {
      redisClient.hdel(redisHashKey, key).catch(() => {
        // ignore
      });
    }
  }

  return fullState;
}

// ── Pending disconnect timers ────────────────────────────────────────────
const pendingDisconnects = new Map<string, NodeJS.Timeout>();

export function initializeRealtimeServer(httpServer: HttpServer) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.allowedOrigins,
      credentials: true,
    },
    adapter: createAdapter(pubClient, subClient),
  });

  io.on('connection', (socket: Socket) => {
    const teamId = socket.handshake.query.teamId as string;
    const uid = socket.handshake.query.uid as string;

    if (!teamId || !uid) {
      winston.error('Socket connection rejected due to missing teamId or uid', {
        id: socket.id,
      });
      socket.disconnect(true);
      return;
    }

    const disconnectKey = `${teamId}:${uid}`;
    const redisHashKey = `${REDIS_KEY_PREFIX}${teamId}`;

    // Cancel any pending disconnect cleanup for this user (Strict Mode reconnect)
    const pendingTimer = pendingDisconnects.get(disconnectKey);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingDisconnects.delete(disconnectKey);
      winston.info(`Cancelled pending disconnect for ${uid} (reconnected)`);
    }

    winston.info(
      `Socket connected: ${uid} in team ${teamId} (Socket ID: ${socket.id})`
    );

    socket.join(teamId);

    // ── NOTE: initial_state is now sent inside join_room, NOT here. ──
    // This avoids a race condition where the server awaited Redis (hgetall)
    // before registering the join_room handler, causing the client's
    // join_room event to be lost if it arrived during the await.

    // ── Debounced disconnect ──────────────────────────────────────────
    socket.on('disconnect', () => {
      winston.info(
        `Socket disconnected: ${uid} (Socket ID: ${socket.id}), scheduling cleanup in ${DISCONNECT_DELAY_MS}ms`
      );

      // Snapshot the current updatedAt so we can verify later
      const disconnectedAtTs = Date.now();

      const timer = setTimeout(async () => {
        pendingDisconnects.delete(disconnectKey);
        try {
          // Safety check: if the user reconnected (or has another tab),
          // their updatedAt in Redis will be newer than our snapshot.
          const currentRaw = await redisClient.hget(redisHashKey, uid);
          if (currentRaw) {
            const current: PlayerRealtimeState = JSON.parse(currentRaw);
            if (current.updatedAt > disconnectedAtTs) {
              winston.info(
                `Skipping cleanup for ${uid} — user reconnected (updatedAt is newer)`
              );
              return;
            }
          }

          await redisClient.hdel(redisHashKey, uid);
          const roomState = await getRoomState(redisHashKey);
          io.to(teamId).emit('room_sync', roomState);
          winston.info(
            `Cleaned up disconnected user ${uid} from team ${teamId}`
          );
        } catch (err) {
          winston.error(`Error on delayed disconnect cleanup ${uid}`, err);
        }
      }, DISCONNECT_DELAY_MS);

      pendingDisconnects.set(disconnectKey, timer);
    });

    // ── join_room ─────────────────────────────────────────────────────
    socket.on('join_room', async (data: { clientId: string }) => {
      // Cancel any pending disconnect for this user
      const pt = pendingDisconnects.get(disconnectKey);
      if (pt) {
        clearTimeout(pt);
        pendingDisconnects.delete(disconnectKey);
      }

      try {
        const modelId = uidToModelId(uid);
        const existingRaw = await redisClient.hget(redisHashKey, uid);
        let newState: PlayerRealtimeState;

        if (existingRaw) {
          const existing: PlayerRealtimeState = JSON.parse(existingRaw);
          newState = {
            ...existing,
            active: true,
            visible: true,
            clientId: data.clientId,
            updatedAt: Date.now(),
          };
        } else {
          newState = {
            active: true,
            visible: true,
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            clientId: data.clientId,
            updatedAt: Date.now(),
            slotId: modelId,
          };
        }

        await redisClient.hset(redisHashKey, uid, JSON.stringify(newState));
        winston.info(
          `User ${uid} joined room ${teamId} with model ${newState.slotId}`
        );

        // Fetch the full room state AFTER storing this user
        const roomState = await getRoomState(redisHashKey);

        // Send initial_state to the joining socket (full replace on client)
        socket.emit('initial_state', roomState);

        // Broadcast room_sync to everyone ELSE so they pick up the new player
        socket.to(teamId).emit('room_sync', roomState);
      } catch (err) {
        winston.error(`Error joining room for ${uid}`, err);
      }
    });

    socket.on(
      'local_move',
      async (stateUpdate: Partial<PlayerRealtimeState>) => {
        try {
          const currentRaw = await redisClient.hget(redisHashKey, uid);
          if (currentRaw) {
            const current: PlayerRealtimeState = JSON.parse(currentRaw);
            const newState: PlayerRealtimeState = {
              ...current,
              ...stateUpdate,
              active: true,
              updatedAt: Date.now(),
            };

            await redisClient.hset(redisHashKey, uid, JSON.stringify(newState));

            socket
              .to(teamId)
              .volatile.emit('player_moved', { uid, state: newState });
          }
        } catch {
          // Suppress move errors to avoid spamming logs
        }
      }
    );
  });
}
