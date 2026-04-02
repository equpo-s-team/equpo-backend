# Equpo Backend API (TypeScript + Node ESM)

Backend API para operaciones de equipo con RBAC real (roles en DB) y un endpoint interno de sistema.

## Implementacion actual

- Stack: `Node.js`, `Express`, `TypeScript`, `PostgreSQL`, `Firebase Admin`.
- Flujo de ejecucion: compilar `src` a `dist` con `tsc` y ejecutar `node dist/index.js`.
- Resolucion de imports internos:
  - TypeScript: `tsconfig.json` con `paths: { "#a/*": ["src/*"] }`
  - Runtime Node: `package.json` con `imports: { "#a/*": "./dist/*" }`

## Por que usamos `#a/*` y no `@/...`

- En backend Node ESM puro, `tsconfig paths` no alcanza para runtime.
- `@/...` funciona bien en frontend (Vite/bundler), pero Node no lo resuelve de forma nativa.
- `#a/*` es el formato de subpath imports soportado por Node mediante `package.json#imports`.

> Nota: `#/...` es inválido en Node para internal imports. Debe tener nombre, por ejemplo `#a/...`.

## Por que los imports en `.ts` terminan en `.js`

- El proyecto usa `moduleResolution: "NodeNext"`.
- En ESM, Node requiere specifier final real de runtime (`.js`), no `.ts`.
- TypeScript entiende esto y compila correctamente a `dist/*.js` sin romper tipos.

Ejemplo valido en source TS:

```ts
import { config } from '#a/config.js';

```

## Instalacion

```bash
npm install
```

## Variables de entorno

Minimas para arrancar:

- `DATABASE_URL`
- `SYSTEM_API_KEY`

Opcionales habituales:

- `PORT` (default `8080`)
- `API_PREFIX` (default `/api/v1`)
- `ALLOWED_ORIGINS` (csv, default `http://localhost:5173`)

## Comandos de desarrollo y ejecucion

```bash
npm run build
npm run test
npm start
```

```bash
npm run dev
```

## Estructura general de carpetas (objetivo)

```text
equpo-backend/
  src/
    app.ts
    index.ts
    config.ts
    db.ts
    auth.ts
    systemAuth.ts
    constants/
    domains/
      <dominio>/
        schemas/
        guards/
        index.ts
    types/
    utils/
  test/
  dist/
```

### Proposito de organizacion

- Separar claramente capa HTTP (`app.ts`) de reglas de negocio por dominio (`src/domains/*`).
- Centralizar infraestructura compartida (`config.ts`, `db.ts`, `auth.ts`, `systemAuth.ts`).
- Mantener tipado reutilizable en `src/types` y helpers genéricos en `src/utils`.
- Dejar `dist/` solo como artefacto de compilacion (no editar manualmente).

### Que debe ir en cada carpeta

- `src/index.ts`: punto de entrada del proceso (arranque del server).
- `src/app.ts`: wiring de rutas, middlewares globales y error handler.
- `src/config.ts`: lectura/validacion de variables de entorno.
- `src/db.ts`: pool y utilidades de transaccion (`withTransaction`).
- `src/auth.ts`: auth de usuario final (Firebase Bearer token).
- `src/systemAuth.ts`: auth interna system-to-system (`x-system-key`).
- `src/constants/`: constantes transversales (ej. codigos HTTP).
- `src/domains/<dominio>/schemas/`: validaciones zod (params/body) del dominio.
- `src/domains/<dominio>/guards/`: permisos/reglas de acceso DB-backed del dominio.
- `src/domains/<dominio>/index.ts`: barrel exports del dominio.
- `src/types/`: tipos compartidos y augmentations (ej. `req.user`).
- `src/utils/`: funciones utilitarias genéricas (ej. `assertBody`).
- `test/`: pruebas de unidad/integracion del backend.
- `dist/`: salida de compilacion TypeScript para runtime de Node.

### Reglas practicas para ubicar codigo nuevo

- Si agregas un endpoint nuevo: valida en `schemas`, autoriza en `guards`, conecta en `app.ts`.
- Si agregas validacion reutilizable global: va en `src/utils`.
- Si agregas tipo reutilizable de varias capas: va en `src/types`.
- Si agregas una regla de negocio especifica de entidad: va en `src/domains/<dominio>`.

### Mini ejemplo (solo referencia para futuras features reales)

> Este flujo es **solo un ejemplo** para guiar implementaciones futuras. No es una feature real ya creada.

Supongamos que quieres agregar `POST /api/v1/teams/:teamId/goals` para crear una meta de equipo.

Orden recomendado de archivos a tocar:

1. `src/domains/team/schemas/createTeamGoalSchema.ts`
   - Definir schema zod del body (`name`, `target`, etc.).
2. `src/domains/team/schemas/index.ts`
   - Exportar el schema nuevo en el barrel del dominio.
3. `src/domains/team/guards/` (solo si aplica una regla nueva)
   - Reusar `assertTeamPermission` si basta con leader/collaborator.
   - Crear guard nuevo si la regla de acceso es distinta.
4. `src/app.ts`
   - Agregar ruta `POST /teams/:teamId/goals`.
   - Parsear params con zod (`teamIdParam`).
   - Validar body con `assertBody(createTeamGoalSchema, req.body)`.
   - Aplicar guard de permisos.
   - Ejecutar SQL dentro de `withTransaction(...)`.
   - Responder con `201` y payload consistente.
5. `src/constants/httpStatusCodes.ts` (solo si necesitas un status no existente)
   - Normalmente no hace falta tocarlo.
6. `test/` (ej. `test/team-goals.test.js`)
   - Cubrir validacion del schema y casos basicos de permisos/errores.
7. `README.md` (opcional)
   - Documentar endpoint nuevo si queda expuesto para consumo.

Checklist rapido de cierre para esa feature:

- `npm run lint:fix`
- `npm run lint`
- `npm test`
- `npm run build`

## Endpoints principales

- `GET /health`
- `GET /api/v1/health`
- `POST /api/v1/teams`
- `PATCH /api/v1/teams/:teamId`
- `POST /api/v1/teams/:teamId/members`
- `PATCH /api/v1/teams/:teamId/members/:userUid/role`
- `POST /api/v1/teams/:teamId/rewards`
- `POST /api/v1/teams/:teamId/achievements`
- `POST /api/v1/internal/users/:userUid/rewards` (`x-system-key`)

## Auth y boundary

- Endpoints de cliente: `Authorization: Bearer <firebase-id-token>`.
- Endpoint interno: `x-system-key`.
- No mezclar `requireSystem` en rutas user-facing.

## Convenciones de tipos y errores

- `req.user` se tipa via declaration merging en `src/types/express.d.ts`.
- Errores de dominio/validacion usan `EqupoError` (`status`, `details`).
- Contrato de error: `{ error, details? }`.

## Formato y lint

- Formato preferido por reglas del repo:

```bash
npm run lint:fix
```

- Alternativa de formato (Prettier):

```bash
npm run format
```

- Revision de codigo con lint (sin auto-fix):

```bash
npm run lint
```
