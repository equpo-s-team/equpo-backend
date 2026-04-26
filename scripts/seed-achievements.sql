-- Seed the 10 built-in achievements.
-- Keys (name column) must match ACHIEVEMENT_KEYS in achievementConstants.ts.
-- Uses ON CONFLICT to be idempotent.

INSERT INTO public.achievement (name, description, icon_url, created_at, updated_at)
VALUES
  ('primer-paso',
   'Completar tu primera tarea en la columna Done.',
   NULL, NOW(), NOW()),

  ('nueva-alianza',
   'Invitar al menos a 3 usuarios a tu tablero.',
   NULL, NOW(), NOW()),

  ('vida-nueva',
   'Recuperar tu porcentaje de vida inicial (60%) hasta 100% por primera vez.',
   NULL, NOW(), NOW()),

  ('la-voz-de-todos',
   'Participar en una videollamada con mas de 5 miembros.',
   NULL, NOW(), NOW()),

  ('sinergia',
   'Completar una tarea en colaboracion con al menos 2 companeros.',
   NULL, NOW(), NOW()),

  ('subida-de-nivel',
   'Alcanzar tu primer nivel de XP.',
   NULL, NOW(), NOW()),

  ('tiempo-de-resurgir',
   'Alcanza menos del 20% de la vida del ambiente.',
   NULL, NOW(), NOW()),

  ('red-de-trabajo',
   'Crear 3 grupos de trabajo distintos.',
   NULL, NOW(), NOW()),

  ('mentor-virtual',
   'Se observador en al menos 3 equipos.',
   NULL, NOW(), NOW()),

  ('velocidad-luz',
   'Mover una tarea de To Do a Done en menos de 1 hora.',
   NULL, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
