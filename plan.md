# Plan de Implementación - Sistema de Gamificación Equpo

## Resumen

Implementar sistema completo de gamificación que incluye:
- XP y niveles para usuarios (con crecimiento exponencial)
- Moneda virtual para equipos
- Sistema de logros con popup de notificación

---

## 1. Especificación de Reglas de Negocio

### 1.1 XP por Tarea Completada

| Prioridad de Tarea | XP para Usuario |
|-------------------|-----------------|
| Baja (low)        | 15 XP           |
| Media (medium)    | 30 XP           |
| Alta (high)       | 60 XP           |

### 1.2 Fórmula de Nivel

- **Nivel 1 → 2**: 100 XP requeridas
- **Nivel N → N+1**: `100 × (1.5)^(N-1)` XP requeridas (crecimiento exponencial)

Ejemplo:
- Nivel 1→2: 100 XP
- Nivel 2→3: 150 XP
- Nivel 3→4: 225 XP
- Nivel 4→5: 338 XP
- Nivel 5→6: 506 XP

### 1.3 Moneda Virtual para Equipos

| Prioridad de Tarea | Moneda para Equipo |
|-------------------|-------------------|
| Baja (low)        | 10 monedas        |
| Media (medium)    | 15 monedas        |
| Alta (high)       | 20 monedas        |

### 1.4 Logros (Achievements)

| ID  | Nombre | Descripción | Criterio de Desbloqueo |
|-----|--------|-------------|------------------------|
| `first_step` | Primer paso | Completar tu primera tarea en la columna Done | Mover 1 tarea a Done |
| `new_alliance` | Nueva alianza | Invitar al menos a 3 usuarios a tu tablero | 3+ miembros en el equipo |
| `new_life` | Vida nueva | Recuperar tu porcentaje de vida inicial (60%) hasta 100% por primera vez | Life de <60% a 100% |
| `voice_of_all` | La voz de todos | Participar en una videollamada con más de 5 miembros | 6+ usuarios en video llamada |
| `synergy` | Sinergia | Completar una tarea en colaboración con al menos 2 compañeros | Tarea con 3+ asignados |
| `level_up` | Subida de nivel | Alcanzar tu primer nivel de XP | Llegar a nivel 2 |
| `time_to_rise` | Tiempo de resurgir | Alcanza menos del 20% de la vida | Life < 20% |
| `work_network` | Red de trabajo | Crear 3 grupos de trabajo distintos | 3+ grupos creados |
| `virtual_mentor` | Mentor virtual | Ser observador en al menos 3 equipos | Rol spectator en 3+ equipos |
| `light_speed` | Velocidad luz | Mover una tarea de To Do a Done en menos de 1 hora | Timestamp diferencia < 1h |
| `zen_board` | Zen Board | Mantener tu tablero sin tareas pendientes por 24 horas | 0 tareas en Todo por 24h |

---

## 2. Cambios en la Base de Datos

### 2.1 Tabla `achievement` (definiciones)

```sql
CREATE TABLE IF NOT EXISTS public.achievement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  description TEXT,
  icon_url VARCHAR(500),
  achievement_key VARCHAR(50) UNIQUE NOT NULL, -- ej: 'first_step', 'level_up'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.2 Tabla `user_achievement` (logros desbloqueados)

```sql
CREATE TABLE IF NOT EXISTS public.user_achievement (
  user_uid VARCHAR(255) NOT NULL,
  achievement_id UUID NOT NULL REFERENCES public.achievement(id),
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_uid, achievement_id)
);
```

### 2.3 Tabla `user_life` (seguimiento de vida para logros)

```sql
CREATE TABLE IF NOT EXISTS public.user_life (
  user_uid VARCHAR(255) PRIMARY KEY,
  current_life INTEGER NOT NULL DEFAULT 60, -- porcentaje 0-100
  reached_100_from_low BOOLEAN DEFAULT FALSE, -- para logro "Vida nueva"
  reached_below_20 BOOLEAN DEFAULT FALSE, -- para logro "Tiempo de resurgir"
  last_checked TIMESTAMPTZ DEFAULT NOW()
);
```

### 2.4 Tabla `task_completion_time` (para logro Velocidad luz)

```sql
-- Se usará la tabla task existente, agregando columnas si es necesario
ALTER TABLE public.task ADD COLUMN IF NOT EXISTS todo_started_at TIMESTAMPTZ;
```

### 2.5 Tabla `zen_board_log` (para logro Zen Board)

```sql
CREATE TABLE IF NOT EXISTS public.zen_board_log (
  user_uid VARCHAR(255) NOT NULL,
  team_id UUID NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  completed BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (user_uid, team_id, started_at)
);
```

### 2.6 Script de migración inicial

**Archivo:** `C:\Users\pipet\WebstormProjects\equpo-backend\migrations\002_gamification.sql`

```sql
-- Insertar logros base
INSERT INTO public.achievement (name, description, icon_url, achievement_key) VALUES
  ('Primer paso', 'Completar tu primera tarea en la columna Done', '/achievements/first-step.svg', 'first_step'),
  ('Nueva alianza', 'Invitar al menos a 3 usuarios a tu tablero', '/achievements/new-alliance.svg', 'new_alliance'),
  ('Vida nueva', 'Recuperar tu porcentaje de vida inicial (60%) hasta 100% por primera vez', '/achievements/new-life.svg', 'new_life'),
  ('La voz de todos', 'Participar en una videollamada con más de 5 miembros', '/achievements/voice-of-all.svg', 'voice_of_all'),
  ('Sinergia', 'Completar una tarea en colaboración con al menos 2 compañeros', '/achievements/synergy.svg', 'synergy'),
  ('Subida de nivel', 'Alcanzar tu primer nivel de XP', '/achievements/level-up.svg', 'level_up'),
  ('Tiempo de resurgir', 'Alcanza menos del 20% de la vida', '/achievements/time-to-rise.svg', 'time_to_rise'),
  ('Red de trabajo', 'Crear 3 grupos de trabajo distintos', '/achievements/work-network.svg', 'work_network'),
  ('Mentor virtual', 'Ser observador en al menos 3 equipos', '/achievements/virtual-mentor.svg', 'virtual_mentor'),
  ('Velocidad luz', 'Mover una tarea de To Do a Done en menos de 1 hora', '/achievements/light-speed.svg', 'light_speed'),
  ('Zen Board', 'Mantener tu tablero sin tareas pendientes por 24 horas', '/achievements/zen-board.svg', 'zen_board');
```

---

## 3. Backend - Implementación

### 3.1 Utilitarios de XP y Niveles

**Archivo:** `C:\Users\pipet\WebstormProjects\equpo-backend\src\domains\gamification\utils\xpUtils.ts`

```typescript
/**
 * Calcula la XP requerida para subir del nivel N al nivel N+1
 * Fórmula: 100 × (1.5)^(N-1)
 */
export function calculateXPForLevel(level: number): number {
  if (level < 1) level = 1;
  return Math.floor(100 * Math.pow(1.5, level - 1));
}

/**
 * Calcula el nuevo nivel y XP después de ganar XP
 * Returns: { newLevel, newXP, levelsGained }
 */
export function calculateLevelUp(currentLevel: number, currentXP: number, gainedXP: number) {
  let newLevel = currentLevel;
  let remainingXP = currentXP + gainedXP;
  let xpForNextLevel = calculateXPForLevel(newLevel);
  
  while (remainingXP >= xpForNextLevel) {
    remainingXP -= xpForNextLevel;
    newLevel++;
    xpForNextLevel = calculateXPForLevel(newLevel);
  }
  
  return {
    newLevel,
    newXP: remainingXP,
    levelsGained: newLevel - currentLevel,
    xpForNextLevel,
  };
}

/**
 * Obtiene XP por prioridad de tarea
 */
export function getXPForPriority(priority: 'low' | 'medium' | 'high'): number {
  const xpMap = {
    low: 15,
    medium: 30,
    high: 60,
  };
  return xpMap[priority];
}

/**
 * Obtiene moneda virtual por prioridad de tarea
 */
export function getCurrencyForPriority(priority: 'low' | 'medium' | 'high'): number {
  const currencyMap = {
    low: 10,
    medium: 15,
    high: 20,
  };
  return currencyMap[priority];
}
```

### 3.2 Servicio de Logros

**Archivo:** `C:\Users\pipet\WebstormProjects\equpo-backend\src\domains\achievement\services\achievementService.ts`

```typescript
import { Pool } from 'pg';

export interface AchievementCheckResult {
  unlocked: boolean;
  achievement?: {
    id: string;
    name: string;
    description: string;
    icon_url: string;
    achievement_key: string;
  };
}

export class AchievementService {
  constructor(private pool: Pool) {}

  /**
   * Verifica y desbloquea un logro si el usuario cumple los criterios
   */
  async checkAndUnlock(
    userId: string,
    achievementKey: string,
    client?: any
  ): Promise<AchievementCheckResult> {
    const queryClient = client || this.pool;
    
    // Verificar si ya tiene el logro
    const existing = await queryClient.query(
      `SELECT ua.*, a.name, a.description, a.icon_u_r_l, a.achievement_key
       FROM public.user_achievement ua
       JOIN public.achievement a ON a.id = ua.achievement_id
       WHERE ua.user_uid = $1 AND a.achievement_key = $2`,
      [userId, achievementKey]
    );

    if (existing.rows.length > 0) {
      return { unlocked: false }; // Ya lo tiene
    }

    // Verificar si cumple los criterios (depende del logro)
    const meetsCriteria = await this.checkAchievementCriteria(userId, achievementKey, queryClient);
    
    if (!meetsCriteria) {
      return { unlocked: false };
    }

    // Desbloquear logro
    const result = await queryClient.query(
      `INSERT INTO public.user_achievement (user_uid, achievement_id)
       SELECT $1, id FROM public.achievement WHERE achievement_key = $2
       RETURNING user_uid, achievement_id`,
      [userId, achievementKey]
    );

    if (result.rows.length === 0) {
      return { unlocked: false };
    }

    // Obtener datos del logro desbloqueado
    const achievementData = await queryClient.query(
      `SELECT id, name, description, icon_url, achievement_key
       FROM public.achievement
       WHERE achievement_key = $1`,
      [achievementKey]
    );

    return {
      unlocked: true,
      achievement: achievementData.rows[0],
    };
  }

  private async checkAchievementCriteria(
    userId: string,
    achievementKey: string,
    client: any
  ): Promise<boolean> {
    switch (achievementKey) {
      case 'first_step':
        return this.checkFirstStep(userId, client);
      case 'new_alliance':
        return this.checkNewAlliance(userId, client);
      case 'new_life':
        return this.checkNewLife(userId, client);
      case 'level_up':
        return this.checkLevelUp(userId, client);
      case 'time_to_rise':
        return this.checkTimeToRise(userId, client);
      case 'work_network':
        return this.checkWorkNetwork(userId, client);
      case 'virtual_mentor':
        return this.checkVirtualMentor(userId, client);
      case 'light_speed':
        return this.checkLightSpeed(userId, client);
      case 'zen_board':
        return this.checkZenBoard(userId, client);
      default:
        return false;
    }
  }

  private async checkFirstStep(userId: string, client: any): Promise<boolean> {
    // Verificar si completó al menos 1 tarea
    const result = await client.query(
      `SELECT COUNT(*) as count FROM public.task
       WHERE assigned_user_uid = $1 AND status = 'done'`,
      [userId]
    );
    return parseInt(result.rows[0].count) >= 1;
  }

  private async checkNewAlliance(userId: string, client: any): Promise<boolean> {
    // Verificar si ha invitado 3+ usuarios a algún equipo
    const result = await client.query(
      `SELECT team_id, COUNT(*) as member_count
       FROM public.team_membership
       WHERE user_uid = $1 AND role IN ('leader', 'member')
       GROUP BY team_id
       HAVING COUNT(*) >= 3`,
      [userId]
    );
    return result.rows.length > 0;
  }

  private async checkNewLife(userId: string, client: any): Promise<boolean> {
    // Verificar si llegó a 100% de vida después de estar bajo
    const result = await client.query(
      `SELECT reached_100_from_low FROM public.user_life WHERE user_uid = $1`,
      [userId]
    );
    return result.rows.length > 0 && result.rows[0].reached_100_from_low;
  }

  private async checkLevelUp(userId: string, client: any): Promise<boolean> {
    // Verificar si alcanzó nivel 2 o más
    const result = await client.query(
      `SELECT level FROM public.user WHERE uid = $1`,
      [userId]
    );
    return result.rows.length > 0 && result.rows[0].level >= 2;
  }

  private async checkTimeToRise(userId: string, client: any): Promise<boolean> {
    // Verificar si llegó a menos del 20% de vida
    const result = await client.query(
      `SELECT current_life FROM public.user_life WHERE user_uid = $1`,
      [userId]
    );
    return result.rows.length > 0 && result.rows[0].current_life < 20;
  }

  private async checkWorkNetwork(userId: string, client: any): Promise<boolean> {
    // Verificar si creó 3+ grupos
    const result = await client.query(
      `SELECT COUNT(DISTINCT id) as count FROM public.group
       WHERE creator_uid = $1`,
      [userId]
    );
    return parseInt(result.rows[0].count) >= 3;
  }

  private async checkVirtualMentor(userId: string, client: any): Promise<boolean> {
    // Verificar si es spectator en 3+ equipos
    const result = await client.query(
      `SELECT COUNT(DISTINCT team_id) as count FROM public.team_membership
       WHERE user_uid = $1 AND role = 'spectator'`,
      [userId]
    );
    return parseInt(result.rows[0].count) >= 3;
  }

  private async checkLightSpeed(userId: string, client: any): Promise<boolean> {
    // Verificar si movió una tarea de To Do a Done en < 1 hora
    const result = await client.query(
      `SELECT id FROM public.task
       WHERE assigned_user_uid = $1 
       AND status = 'done'
       AND todo_started_at IS NOT NULL
       AND EXTRACT(EPOCH FROM (completed_at - todo_started_at)) < 3600
       LIMIT 1`,
      [userId]
    );
    return result.rows.length > 0;
  }

  private async checkZenBoard(userId: string, client: any): Promise<boolean> {
    // Verificar si mantuvo tablero sin tareas pendientes por 24h
    const result = await client.query(
      `SELECT id FROM public.zen_board_log
       WHERE user_uid = $1 AND completed = true
       LIMIT 1`,
      [userId]
    );
    return result.rows.length > 0;
  }

  /**
   * Obtiene todos los logros de un usuario
   */
  async getUserAchievements(userId: string): Promise<any[]> {
    const result = await this.pool.query(
      `SELECT a.id, a.name, a.description, a.icon_u_r_l, a.achievement_key,
              ua.unlocked_at
       FROM public.achievement a
       LEFT JOIN public.user_achievement ua 
         ON ua.achievement_id = a.id AND ua.user_uid = $1
       ORDER BY ua.unlocked_at DESC NULLS LAST`,
      [userId]
    );
    return result.rows;
  }
}
```

### 3.3 Servicio de Gamificación

**Archivo:** `C:\Users\pipet\WebstormProjects\equpo-backend\src\domains\gamification\services\gamificationService.ts`

```typescript
import { Pool } from 'pg';
import {
  calculateLevelUp,
  getXPForPriority,
  getCurrencyForPriority,
} from '../utils/xpUtils';
import { AchievementService } from '../../achievement/services/achievementService';

export interface TaskCompletionReward {
  xpGained: number;
  currencyGained: number;
  newLevel: number;
  newXP: number;
  levelsGained: number;
  unlockedAchievements: any[];
}

export class GamificationService {
  constructor(
    private pool: Pool,
    private achievementService: AchievementService
  ) {}

  /**
   * Procesa la recompensa por completar una tarea
   */
  async processTaskCompletion(
    taskId: string,
    userId: string,
    teamId: string,
    priority: 'low' | 'medium' | 'high'
  ): Promise<TaskCompletionReward> {
    const xpGained = getXPForPriority(priority);
    const currencyGained = getCurrencyForPriority(priority);

    const reward = await this.pool.transaction(async (client) => {
      // 1. Obtener XP y nivel actuales del usuario
      const userResult = await client.query(
        `SELECT level, experience_points FROM public.user WHERE uid = $1`,
        [userId]
      );

      if (userResult.rows.length === 0) {
        throw new Error('Usuario no encontrado');
      }

      const { level: currentLevel, experience_points: currentXP } = userResult.rows[0];

      // 2. Calcular nuevo nivel y XP
      const { newLevel, newXP, levelsGained } = calculateLevelUp(
        currentLevel,
        currentXP,
        xpGained
      );

      // 3. Actualizar usuario
      await client.query(
        `UPDATE public.user 
         SET level = $1, experience_points = $2, updated_at = NOW()
         WHERE uid = $3`,
        [newLevel, newXP, userId]
      );

      // 4. Actualizar moneda del equipo
      await client.query(
        `UPDATE public.team 
         SET virtual_currency = virtual_currency + $1, updated_at = NOW()
         WHERE id = $2`,
        [currencyGained, teamId]
      );

      // 5. Marcar tarea como completada (si no lo está ya)
      await client.query(
        `UPDATE public.task 
         SET status = 'done', completed_at = NOW()
         WHERE id = $1 AND status != 'done'`,
        [taskId]
      );

      // 6. Verificar logros
      const unlockedAchievements = await this.checkAchievements(userId, client);

      // 7. Si subió de nivel, verificar logro "Subida de nivel"
      if (levelsGained > 0) {
        const levelUpAchievement = await this.achievementService.checkAndUnlock(
          userId,
          'level_up',
          client
        );
        if (levelUpAchievement.unlocked && levelUpAchievement.achievement) {
          unlockedAchievements.push(levelUpAchievement.achievement);
        }
      }

      return {
        xpGained,
        currencyGained,
        newLevel,
        newXP,
        levelsGained,
        unlockedAchievements,
      };
    });

    return reward;
  }

  private async checkAchievements(userId: string, client: any): Promise<any[]> {
    const achievementsToCheck = [
      'first_step',
      'new_alliance',
      'new_life',
      'time_to_rise',
      'work_network',
      'virtual_mentor',
      'light_speed',
      'zen_board',
    ];

    const unlocked: any[] = [];

    for (const key of achievementsToCheck) {
      const result = await this.achievementService.checkAndUnlock(userId, key, client);
      if (result.unlocked && result.achievement) {
        unlocked.push(result.achievement);
      }
    }

    return unlocked;
  }

  /**
   * Actualiza el timestamp de cuando una tarea entra en To Do
   */
  async markTaskStarted(taskId: string): Promise<void> {
    await this.pool.query(
      `UPDATE public.task 
       SET todo_started_at = NOW()
       WHERE id = $1 AND todo_started_at IS NULL`,
      [taskId]
    );
  }

  /**
   * Actualiza el estado de vida del usuario
   */
  async updateUserLife(userId: string, newLife: number): Promise<{ reachedBelow20: boolean; reached100FromLow: boolean }> {
    let reachedBelow20 = false;
    let reached100FromLow = false;

    await this.pool.transaction(async (client) => {
      // Obtener estado actual
      const currentResult = await client.query(
        `SELECT current_life, reached_100_from_low FROM public.user_life WHERE user_uid = $1`,
        [userId]
      );

      const currentLife = currentResult.rows.length > 0 ? currentResult.rows[0].current_life : 60;
      const alreadyReached100 = currentResult.rows.length > 0 && currentResult.rows[0].reached_100_from_low;

      // Verificar si cayó bajo 20%
      if (newLife < 20 && currentLife >= 20) {
        reachedBelow20 = true;
      }

      // Verificar si llegó a 100% desde bajo
      if (newLife === 100 && currentLife < 100 && !alreadyReached100) {
        reached100FromLow = true;
      }

      // Actualizar o insertar
      await client.query(
        `INSERT INTO public.user_life (user_uid, current_life, reached_100_from_low, reached_below_20, last_checked)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_uid) DO UPDATE SET
           current_life = EXCLUDED.current_life,
           reached_100_from_low = COALESCE(EXCLUDED.reached_100_from_low, public.user_life.reached_100_from_low),
           reached_below_20 = COALESCE(EXCLUDED.reached_below_20, public.user_life.reached_below_20),
           last_checked = NOW()`,
        [userId, newLife, reached100FromLow, reachedBelow20]
      );
    });

    return { reachedBelow20, reached100FromLow };
  }
}
```

### 3.4 Actualizar Endpoint de Task Update

**Archivo:** `C:\Users\pipet\WebstormProjects\equpo-backend\src\app.ts`

Modificar el endpoint `PATCH /teams/:teamId/tasks/:taskId` para:

1. Detectar cuando una tarea se mueve a 'done'
2. Llamar a `GamificationService.processTaskCompletion()`
3. Retornar las recompensas en la respuesta

```typescript
// Después de actualizar la tarea exitosamente:
const oldStatus = task.rows[0].status;
const newStatus = input.status ?? oldStatus;

// Si la tarea se completó (cambió a done)
if (oldStatus !== 'done' && newStatus === 'done' && task.rows[0].assigned_user_uid) {
  const gamificationService = new GamificationService(pool, new AchievementService(pool));
  
  const reward = await gamificationService.processTaskCompletion(
    taskId,
    task.rows[0].assigned_user_uid,
    teamId,
    task.rows[0].priority
  );

  // Incluir recompensa en la respuesta
  response.reward = reward;
}

// Si la tarea se movió a 'todo', marcar el timestamp
if (oldStatus !== 'todo' && newStatus === 'todo') {
  await gamificationService.markTaskStarted(taskId);
}
```

### 3.5 Endpoint para Logros

**Archivo:** `C:\Users\pipet\WebstormProjects\equpo-backend\src\app.ts`

Agregar endpoints:

```typescript
// GET /teams/:teamId/achievements - Obtener todos los logros del equipo
api.get('/teams/:teamId/achievements', requireUser, userRateLimit, async (req, res, next) => {
  const { teamId } = req.params;
  const userId = req.user?.uid;

  const achievementService = new AchievementService(pool);
  const achievements = await achievementService.getUserAchievements(userId);

  res.json({ achievements });
});

// POST /teams/:teamId/achievements - Crear nuevo logro (admin only)
api.post('/teams/:teamId/achievements', requireUser, adminRateLimit, async (req, res, next) => {
  // ... implementación existente ...
});
```

---

## 4. Frontend - Implementación

### 4.1 Componente de Popup de Logro

**Archivo:** `C:\Users\pipet\WebstormProjects\equpo-Frontend\src\features\achievements\components\AchievementPopup.tsx`

```tsx
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Sparkles } from 'lucide-react';

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon_url: string;
}

interface AchievementPopupProps {
  achievement: Achievement | null;
  onClose: () => void;
}

export const AchievementPopup: React.FC<AchievementPopupProps> = ({ achievement, onClose }) => {
  useEffect(() => {
    if (achievement) {
      const timer = setTimeout(onClose, 5000); // Auto-close after 5s
      return () => clearTimeout(timer);
    }
  }, [achievement, onClose]);

  if (!achievement) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 100, x: '-50%' }}
        animate={{ opacity: 1, y: 0, x: '-50%' }}
        exit={{ opacity: 0, y: 100, x: '-50%' }}
        className="fixed bottom-8 left-1/2 z-50 bg-gradient-to-r from-purple-600 to-blue-600 
                   rounded-2xl shadow-2xl p-6 min-w-[320px] max-w-md"
      >
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 bg-yellow-400/30 rounded-full animate-ping" />
            <div className="relative bg-white/20 rounded-full p-3">
              <Trophy className="w-8 h-8 text-yellow-300" />
            </div>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-yellow-300" />
              <span className="text-xs font-bold text-yellow-200 uppercase tracking-wider">
                ¡Logro Desbloqueado!
              </span>
            </div>
            <h3 className="text-lg font-bold text-white mt-1">{achievement.name}</h3>
            <p className="text-sm text-white/80 mt-1">{achievement.description}</p>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
```

### 4.2 Actualizar TeamBoard para Mostrar Popup

**Archivo:** `C:\Users\pipet\WebstormProjects\equpo-Frontend\src\features\board\TeamBoard.jsx`

Agregar estado y lógica para el popup:

```javascript
import { AchievementPopup } from '../achievements/components/AchievementPopup';

// En el componente TeamBoard:
const [unlockedAchievement, setUnlockedAchievement] = useState(null);

const moveCard = async (cardId, fromColumnId, toColumnId, position) => {
  // ... código existente ...
  
  if (toColumnId === 'done') {
    play('taskCompleted');
    
    try {
      const response = await updateTask.mutateAsync({
        teamId,
        taskId: cardId,
        payload: { status: nextStatus },
      });
      
      // Si hay recompensa en la respuesta
      if (response?.reward) {
        const { unlockedAchievements } = response.reward;
        if (unlockedAchievements && unlockedAchievements.length > 0) {
          // Mostrar el primer logro desbloqueado
          setUnlockedAchievement(unlockedAchievements[0]);
        }
      }
    } catch (err) {
      console.error('Failed to update task status:', err);
    }
  }
};

// En el return:
return (
  <>
    {/* ... resto del board ... */}
    <AchievementPopup 
      achievement={unlockedAchievement}
      onClose={() => setUnlockedAchievement(null)}
    />
  </>
);
```

### 4.3 Página de Logros en TeamsHub

**Archivo:** `C:\Users\pipet\WebstormProjects\equpo-Frontend\src\features\team\TeamsHub.tsx`

Agregar sección de logros:

```tsx
import { useQuery } from '@tanstack/react-query';
import { Trophy, Lock } from 'lucide-react';

// En TeamsHub, agregar nueva sección:
const AchievementsSection = () => {
  const { data: achievements, isLoading } = useQuery({
    queryKey: ['achievements', teamId],
    queryFn: async () => {
      const response = await fetch(`/api/teams/${teamId}/achievements`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      return data.achievements;
    },
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {achievements?.map((achievement) => (
        <div
          key={achievement.id}
          className={`p-4 rounded-xl border-2 transition-all ${
            achievement.unlocked_at
              ? 'border-purple-500 bg-purple-500/10'
              : 'border-gray-700 bg-gray-800/50 grayscale'
          }`}
        >
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg ${
              achievement.unlocked_at 
                ? 'bg-purple-500/20' 
                : 'bg-gray-700'
            }`}>
              {achievement.unlocked_at ? (
                <Trophy className="w-6 h-6 text-purple-400" />
              ) : (
                <Lock className="w-6 h-6 text-gray-500" />
              )}
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-white">{achievement.name}</h4>
              {achievement.unlocked_at ? (
                <p className="text-sm text-gray-400 mt-1">{achievement.description}</p>
              ) : (
                <p className="text-sm text-gray-600 mt-1 italic">???</p>
              )}
              {achievement.unlocked_at && (
                <p className="text-xs text-gray-500 mt-2">
                  Desbloqueado: {new Date(achievement.unlocked_at).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
```

### 4.4 Actualizar UserProfileCard

**Archivo:** `C:\Users\pipet\WebstormProjects\equpo-Frontend\src\features\team\components\user\UserProfileCard.tsx`

Actualizar la fórmula de XP para que coincida con el backend:

```typescript
// Reemplazar la fórmula actual:
const experienceToNextLevel = useMemo(() => {
  // Fórmula: 100 × (1.5)^(level-1)
  return Math.floor(100 * Math.pow(1.5, level - 1));
}, [level]);
```

---

## 5. Tareas Pendientes por Implementar

### Backend
- [ ] Crear archivo de migración `migrations/002_gamification.sql`
- [ ] Crear `src/domains/gamification/utils/xpUtils.ts`
- [ ] Crear `src/domains/achievement/services/achievementService.ts`
- [ ] Crear `src/domains/gamification/services/gamificationService.ts`
- [ ] Actualizar `src/app.ts` para integrar gamificación en task update
- [ ] Agregar endpoint GET `/teams/:teamId/achievements`
- [ ] Ejecutar migración en base de datos

### Frontend
- [ ] Crear `src/features/achievements/components/AchievementPopup.tsx`
- [ ] Actualizar `TeamBoard.jsx` para mostrar popup al completar tarea
- [ ] Agregar sección de logros en `TeamsHub.tsx`
- [ ] Actualizar `UserProfileCard.tsx` con nueva fórmula de XP
- [ ] Agregar query de React Query para logros

---

## 6. Consideraciones Adicionales

### 6.1 Vida del Usuario
El sistema de vida no está implementado en este plan. Se requiere:
- Definir cómo se pierde vida (tareas vencidas, inactividad, etc.)
- Definir cómo se recupera vida (completar tareas, daily login, etc.)
- Implementar cron job para verificar tareas vencidas

### 6.2 Video Llamadas
El logro "La voz de todos" requiere integración con sistema de video llamadas:
- Necesita tracking de participantes en video llamadas
- Contador de duración y número de participantes

### 6.3 Tareas Colaborativas
El logro "Sinergia" requiere:
- Sistema de múltiples asignados por tarea (actualmente solo hay `assigned_user_uid`)
- Tabla intermedia `task_assignment` para N:N

### 6.4 Zen Board
El logro "Zen Board" requiere:
- Cron job que verifique cada 24h si hay tareas en Todo
- Sistema de notificaciones para recordar al usuario

---

## 7. Testing

### Tests Unitarios Backend
- `xpUtils.test.ts`: Probar cálculo de XP y niveles
- `achievementService.test.ts`: Probar cada criterio de logro
- `gamificationService.test.ts`: Proceso completo de task completion

### Tests de Integración
- Flujo completo: completar tarea → ganar XP → subir nivel → desbloquear logro
- Popup aparece en frontend

### Tests E2E
- Mover tarea a Done en UI
- Verificar popup de logro
- Verificar actualización de XP/nivel en UserProfileCard

---

## 8. Cronograma Estimado

| Fase | Tareas | Duración Estimada |
|------|--------|-------------------|
| 1. DB Schema | Migración, tablas | 2 horas |
| 2. Backend Core | Utils, Services | 4 horas |
| 3. Backend API | Endpoints, integración | 3 horas |
| 4. Frontend Core | Popup, actualizaciones | 3 horas |
| 5. Frontend UI | Página de logros | 2 horas |
| 6. Testing | Unitarios, integración | 3 horas |
| **Total** | | **~17 horas** |
