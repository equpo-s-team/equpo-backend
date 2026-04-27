import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from '#a/config.js';
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
  slotId: SlotId | null;
}

// Map: teamId -> uid -> state
const presenceData = new Map<string, Map<string, PlayerRealtimeState>>();

export function initializeRealtimeServer(httpServer: HttpServer) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.allowedOrigins,
      credentials: true,
    },
  });

  io.on('connection', socket => {
    // Expected query params on connection: teamId, uid
    const teamId = socket.handshake.query.teamId as string;
    const uid = socket.handshake.query.uid as string;

    if (!teamId || !uid) {
      winston.error('Socket connection rejected due to missing teamId or uid', {
        id: socket.id,
      });
      socket.disconnect(true);
      return;
    }

    winston.info(
      `Socket connected: ${uid} in team ${teamId} (Socket ID: ${socket.id})`
    );

    socket.join(teamId);

    // Initialize map if missing
    if (!presenceData.has(teamId)) {
      presenceData.set(teamId, new Map());
    }
    const teamPresence = presenceData.get(teamId)!;

    // Remove user if they disconnect
    socket.on('disconnect', () => {
      winston.info(`Socket disconnected: ${uid} (Socket ID: ${socket.id})`);
      const existingState = teamPresence.get(uid);
      if (existingState) {
        existingState.active = false;
        existingState.updatedAt = Date.now();
        teamPresence.set(uid, existingState);
        broadcastState(teamId);
      }
    });

    socket.on(
      'claim_slot',
      (
        data: { clientId: string },
        callback: (slotId: SlotId | null) => void
      ) => {
        const candidateSlots: SlotId[] = [
          'Character_01',
          'Character_02',
          'Character_03',
          'Character_04',
          'Character_05',
          'Character_06',
        ];

        // Basic slot claiming (first available)
        const takenSlots = new Set<SlotId>();
        for (const [existingUid, state] of teamPresence.entries()) {
          if (state.active && state.slotId && existingUid !== uid) {
            takenSlots.add(state.slotId);
          }
        }

        let claimed: SlotId | null = null;
        // First check if user already has a valid slot
        const currentState = teamPresence.get(uid);
        if (currentState?.slotId && !takenSlots.has(currentState.slotId)) {
          claimed = currentState.slotId;
        } else {
          for (const slot of candidateSlots) {
            if (!takenSlots.has(slot)) {
              claimed = slot;
              break;
            }
          }
        }

        if (claimed) {
          teamPresence.set(uid, {
            ...(currentState || {
              position: { x: 0, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0 },
            }),
            active: true,
            visible: true,
            clientId: data.clientId,
            updatedAt: Date.now(),
            slotId: claimed,
          } as PlayerRealtimeState);
          broadcastState(teamId);
        }

        callback(claimed);
      }
    );

    socket.on('local_move', (state: Partial<PlayerRealtimeState>) => {
      const current = teamPresence.get(uid);
      if (current) {
        teamPresence.set(uid, {
          ...current,
          ...state,
          active: true,
          updatedAt: Date.now(),
        });
      }
    });
  });

  // Background broadcast loop to send states every 100ms
  globalThis.setInterval(() => {
    for (const [teamId, teamPresence] of presenceData.entries()) {
      const now = Date.now();
      const payload: Record<string, PlayerRealtimeState> = {};
      let changed = false;

      for (const [uid, state] of teamPresence.entries()) {
        // Only broadcast active ones, or recently deactivated
        if (state.active || now - state.updatedAt < 5000) {
          payload[uid] = state;
          changed = true;
        } else if (!state.active && now - state.updatedAt > 30000) {
          teamPresence.delete(uid); // Cleanup old state
        }
      }

      if (changed) {
        io.to(teamId).emit('state_update', payload);
      }
    }
  }, 100);
}

function broadcastState(_teamId: string) {
  // Manual trigger if needed
}
