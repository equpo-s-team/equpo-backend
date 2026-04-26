/**
 * Canonical achievement keys.
 *
 * These must match the `name` column values seeded into
 * `public.achievement` via `scripts/seed-achievements.sql`.
 */
export const ACHIEVEMENT_KEYS = {
  PRIMER_PASO: 'primer-paso',
  NUEVA_ALIANZA: 'nueva-alianza',
  VIDA_NUEVA: 'vida-nueva',
  LA_VOZ_DE_TODOS: 'la-voz-de-todos',
  SINERGIA: 'sinergia',
  SUBIDA_DE_NIVEL: 'subida-de-nivel',
  TIEMPO_DE_RESURGIR: 'tiempo-de-resurgir',
  RED_DE_TRABAJO: 'red-de-trabajo',
  MENTOR_VIRTUAL: 'mentor-virtual',
  VELOCIDAD_LUZ: 'velocidad-luz',
} as const;

export type AchievementKey =
  (typeof ACHIEVEMENT_KEYS)[keyof typeof ACHIEVEMENT_KEYS];
