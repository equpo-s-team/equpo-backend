<div align="center">
  <img src="./public/img/equpoLogo.png" alt="Equpo Logo" width="180"/>

  <h1>equpo - Backend</h1>

  <p>
    Collaborative platform API for team management, RBAC, and real-time data synchronization.
  </p>

  <p>
  <img src="https://img.shields.io/badge/Node.js-LTS-green" />
  <img src="https://img.shields.io/badge/TypeScript-Strict-blue" />
  <img src="https://img.shields.io/badge/PostgreSQL-15+-blue" />
  <img src="https://img.shields.io/badge/Express-4-lightgrey" />
  <a href="https://github.com/equpo-s-team/equpo-frontend">
    <img src="https://img.shields.io/badge/frontend-repository-blue" />
  </a>

</p>

</div>

---

## About

Equpo Backend is the server-side API for the Equpo platform. It provides robust business logic, role-based access control (RBAC), data persistence, and real-time synchronization capabilities for team management, collaborative workflows, and organizational features.

This document serves as both a technical reference and an onboarding guide for developers. It covers system overview, architecture, project structure, setup instructions, development conventions, database schema, API endpoints, and operational considerations.

---

## 1. Project Overview

- **Description:** RESTful API built with Express.js, TypeScript, and Node.js ESM that serves as the backend for the Equpo platform. It provides authentication, team management, task workflows, rewards systems, real-time communication infrastructure, and administrative operations.
- **System goal:** Deliver scalable, secure, and maintainable business logic for team collaboration with strong authorization controls and real-time data consistency.
- **Problem it solves:** Centralizes backend operations for team management, permission enforcement, data integrity, and cross-domain transaction handling into a production-ready API service.

### Technology Stack

- **Runtime:** Node.js (LTS recommended)
- **Framework:** Express.js 4.x
- **Language:** TypeScript (strict mode)
- **Database:** PostgreSQL 15+
- **ORM/Query Builder:** Raw SQL with parameterized queries
- **Authentication:** Firebase Admin SDK (bearer token validation)
- **System Auth:** Custom x-system-key header validation
- **Validation:** Zod (schema validation)
- **Logging:** Winston
- **Rate Limiting:** Custom middleware with Redis-backed tokens (configurable)
- **Real-time Sync:** Firestore Admin (denormalized state sync)
- **Other:** CORS middleware, compression, structured error handling

---

## 2. Architecture Overview

- **Architectural style:** Domain-driven design (DDD) with layered architecture. The codebase is organized by business domains (team, task, reward, achievement, room, user, ai), with clear separation between HTTP handlers, business logic, data access, and validation.

### Principles Applied

- **Separation of Concerns:** HTTP routing, validation, business logic, and data access are clearly separated into different layers.
- **Single Responsibility:** Each handler focuses on a single operation; guards enforce authorization; schemas validate inputs; firestore sync maintains eventual consistency.
- **Domain Isolation:** Each domain has its own handlers, schemas, guards, and firestore sync logic.
- **Transaction Safety:** SQL operations within domains use transactional boundaries via `withTransaction()` to ensure data consistency.
- **Error Standardization:** All errors follow the `EqupoError` contract for consistent API responses.

### Key Decisions

- **PostgreSQL as Source of Truth:** All critical data is persisted in PostgreSQL with ACID guarantees. Firestore serves as a denormalized read-only copy for frontend real-time subscriptions.
- **Role-Based Access Control (RBAC):** Roles (`admin`, `leader`, `collaborator`, `spectator`, `member`) are stored in the database, not derived from JWT claims, enabling dynamic permission changes.
- **Domain-Driven Structure:** Business logic is organized by domain (team, task, reward, etc.) rather than by technical layer, improving maintainability and discoverability.
- **Rate Limiting Per User:** Applied globally to prevent abuse while maintaining fair access.
- **Firestore Real-time Sync:** Selected collections are mirrored to Firestore for subscriptions, but Firestore is never the source of truth for critical operations.
- **System Endpoints:** Separate internal endpoints (`/internal/*`) accept system-to-system authentication via `x-system-key` header, enabling async jobs and integrations.

### Data Flow

```
Client (Firebase Auth Token)
    ↓
Express Middleware (requireUser)
    ↓
Route Handler
    ↓
Zod Schema Validation
    ↓
Authorization Guard (RBAC from DB)
    ↓
Business Logic (SQL Transaction)
    ↓
PostgreSQL (Source of Truth)
    ↓
Firestore Sync (Denormalization)
    ↓
Response to Client
```

---

## 3. Project Structure

### Relevant Structure (Summary)

```
equpo-backend/
├── src/
│   ├── app.ts                         # Express app setup, routing, error handler
│   ├── index.ts                       # Server entry point
│   ├── config.ts                      # Environment variables and config validation
│   ├── db.ts                          # PostgreSQL pool and transaction utilities
│   ├── auth.ts                        # Firebase token validation middleware
│   ├── systemAuth.ts                  # System-to-system key validation
│   ├── firebaseAdmin.ts               # Firebase Admin SDK initialization
│   ├── constants/
│   │   └── httpStatusCodes.ts         # HTTP status code constants
│   ├── domains/                       # Domain-driven modules
│   │   ├── team/
│   │   │   ├── handlers/              # HTTP endpoint handlers
│   │   │   │   ├── createTeam.ts
│   │   │   │   ├── updateTeam.ts
│   │   │   │   ├── inviteTeamMember.ts
│   │   │   │   ├── createInvitationCode.ts
│   │   │   │   ├── joinTeamWithInviteCode.ts
│   │   │   │   ├── getTeamInvitePreview.ts
│   │   │   │   ├── removeTeamMember.ts
│   │   │   │   ├── updateTeamMemberRole.ts
│   │   │   │   ├── deleteTeam.ts
│   │   │   │   ├── getMyTeams.ts
│   │   │   │   └── getTeamMembers.ts
│   │   │   ├── schemas/               # Zod validation schemas
│   │   │   │   ├── createTeamSchema.ts
│   │   │   │   ├── updateTeamSchema.ts
│   │   │   │   ├── createInvitationCodeSchema.ts
│   │   │   │   └── index.ts
│   │   │   ├── guards/                # Authorization checks
│   │   │   │   ├── assertTeamPermission.ts
│   │   │   │   └── index.ts
│   │   │   ├── firestore/             # Firestore sync logic
│   │   │   │   ├── teamFirestore.ts
│   │   │   │   └── index.ts
│   │   │   └── index.ts               # Barrel export
│   │   ├── task/
│   │   │   ├── handlers/
│   │   │   ├── schemas/
│   │   │   ├── guards/
│   │   │   ├── firestore/
│   │   │   └── index.ts
│   │   ├── reward/
│   │   ├── achievement/
│   │   ├── room/
│   │   ├── user/
│   │   ├── ai/
│   │   └── index.ts                   # Domain barrel exports
│   ├── types/
│   │   ├── auth.ts                    # Auth-related types
│   │   ├── AuthenticatedRequest.ts    # Express Request with user property
│   │   ├── EqupoError.ts              # Standard error type
│   │   └── express.d.ts               # Express type augmentation
│   └── utils/
│       ├── assertBody.ts              # Body validation helper
│       ├── endpoint.ts                # Endpoint wrapper with error handling
│       ├── rateLimit.ts               # Rate limiting middleware
│       └── index.ts
├── test/                              # Integration and unit tests
├── dist/                              # Compiled JavaScript (generated)
├── package.json
├── tsconfig.json
├── jsconfig.json
├── eslint.config.js
└── Dockerfile
```

### Domain Organization Pattern

Each domain follows this structure:

```
domains/<domain>/
├── handlers/              # HTTP endpoint handlers for this domain
├── schemas/               # Zod validation schemas
├── guards/                # Authorization logic
├── firestore/             # Firestore sync/denormalization
├── utils.ts (optional)    # Domain-specific utilities
├── <domain>Constants.ts   # Domain constants (enum values, defaults)
└── index.ts               # Barrel export
```

**Example: Team Domain**

- `handlers/`: `createTeam`, `updateTeam`, `inviteTeamMember`, `createInvitationCode`, etc.
- `schemas/`: `createTeamSchema`, `updateTeamSchema`, `inviteTeamMemberSchema`, etc.
- `guards/`: `assertTeamPermission` (verify user is admin/leader), `assertGroupBelongsToTeam`, etc.
- `firestore/`: `teamFirestore.ts` (sync team changes to Firestore), `teamFirestoreMapper.ts` (data shape transformations).

---

## 4. Database Schema Overview

### Core Tables

**teams**
```sql
id UUID PRIMARY KEY
name VARCHAR(255) NOT NULL
description TEXT
photo_url VARCHAR(512)
owner_uid VARCHAR(255) NOT NULL
created_at TIMESTAMP DEFAULT NOW()
updated_at TIMESTAMP DEFAULT NOW()
```

**team_membership**
```sql
team_id UUID REFERENCES teams(id)
user_uid VARCHAR(255)
role VARCHAR(50) -- admin, leader, collaborator, spectator, member
joined_at TIMESTAMP DEFAULT NOW()
PRIMARY KEY (team_id, user_uid)
```

**invitation_codes**
```sql
id UUID PRIMARY KEY
team_id UUID REFERENCES teams(id)
code VARCHAR(50) UNIQUE NOT NULL
role VARCHAR(50) -- default role when user joins
created_by VARCHAR(255) NOT NULL
expires_at TIMESTAMP
max_uses INT
current_uses INT DEFAULT 0
created_at TIMESTAMP DEFAULT NOW()
UNIQUE (team_id, code)
```

**tasks**
```sql
id UUID PRIMARY KEY
team_id UUID REFERENCES teams(id)
created_by VARCHAR(255) NOT NULL
title VARCHAR(255) NOT NULL
description TEXT
status VARCHAR(50) -- pending, in_progress, completed
recurrence VARCHAR(50) -- optional
due_date TIMESTAMP
created_at TIMESTAMP DEFAULT NOW()
updated_at TIMESTAMP DEFAULT NOW()
```

**task_steps**
```sql
id UUID PRIMARY KEY
task_id UUID REFERENCES tasks(id)
step_number INT
title VARCHAR(255) NOT NULL
is_completed BOOLEAN DEFAULT FALSE
created_at TIMESTAMP DEFAULT NOW()
```

**task_commentaries**
```sql
id UUID PRIMARY KEY
task_id UUID REFERENCES tasks(id)
author_uid VARCHAR(255) NOT NULL
content TEXT NOT NULL
created_at TIMESTAMP DEFAULT NOW()
updated_at TIMESTAMP DEFAULT NOW()
```

**groups** (for room/collaboration)
```sql
id UUID PRIMARY KEY
team_id UUID REFERENCES teams(id)
name VARCHAR(255) NOT NULL
description TEXT
created_at TIMESTAMP DEFAULT NOW()
updated_at TIMESTAMP DEFAULT NOW()
```

**group_membership**
```sql
group_id UUID REFERENCES groups(id)
user_uid VARCHAR(255)
joined_at TIMESTAMP DEFAULT NOW()
PRIMARY KEY (group_id, user_uid)
```

**achievements**
```sql
id UUID PRIMARY KEY
team_id UUID REFERENCES teams(id)
name VARCHAR(255) NOT NULL
description TEXT
icon_url VARCHAR(512)
reward_points INT
created_at TIMESTAMP DEFAULT NOW()
```

**achievement_unlocks**
```sql
id UUID PRIMARY KEY
achievement_id UUID REFERENCES achievements(id)
user_uid VARCHAR(255)
unlocked_at TIMESTAMP DEFAULT NOW()
```

**rewards**
```sql
id UUID PRIMARY KEY
team_id UUID REFERENCES teams(id) (nullable for system rewards)
recipient_uid VARCHAR(255) NOT NULL
points INT NOT NULL
reason VARCHAR(255)
granted_by VARCHAR(255) (nullable for system grants)
created_at TIMESTAMP DEFAULT NOW()
```

---

## 5. Setup and Installation

### Requirements

- **Node.js** LTS (v18+ recommended; use `.nvmrc` for version pinning)
- **npm** or **pnpm** (npm included with Node.js)
- **PostgreSQL** 15+ (local or remote)
- **Firebase Project** (for Admin SDK credentials)

### Environment Variables

Create a `.env` file in the project root with the following required variables:

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/equpo

# Firebase Admin SDK (download from Firebase Console → Service Accounts)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxx@your-project.iam.gserviceaccount.com

# System Authentication
SYSTEM_API_KEY=your-secret-system-key

# Server Configuration
PORT=8080
API_PREFIX=/api/v1
NODE_ENV=development

# CORS Configuration
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=120
RATE_LIMIT_BLOCK_MS=60000
RATE_LIMIT_MAX_BLOCK_MS=900000

# Logging
LOG_LEVEL=debug
```

### Installation

```bash
npm install
```

### Database Setup

1. Ensure PostgreSQL is running and accessible via `DATABASE_URL`.
2. Run migrations or create tables (if a migration tool is configured; otherwise, execute provided SQL schema files):

```bash
# Example: If using a migration tool
npm run migrate
```

3. Verify connection:

```bash
npm run build && node dist/db.js
```

### Development Server

```bash
npm run dev
```

The server will start on `http://localhost:8080` (or the configured `PORT`).

---

## 6. Available Scripts

- **`npm run build`** — Compile TypeScript to JavaScript in `dist/`.
- **`npm start`** — Run compiled server from `dist/index.js`.
- **`npm run dev`** — Start development server with hot reload (requires `tsx` or similar).
- **`npm test`** — Run test suite (unit and integration tests).
- **`npm run lint`** — Run ESLint to check code quality.
- **`npm run lint:fix`** — Auto-fix linting issues.
- **`npm run format`** — Format code with Prettier.
- **`npm run format:check`** — Check if code matches Prettier formatting.
- **`npm run check`** — Run all validation checks (lint + format check + typecheck).
- **`npm run typecheck`** — Run TypeScript type checking without emitting.

These commands should be executed in CI pipelines to enforce code quality before merging.

---

## 7. Development Guidelines

### Code Conventions

- Use **strict TypeScript** for type safety (`strict: true` in `tsconfig.json`).
- Define shared types in `src/types/`.
- Use **Zod** for runtime schema validation.
- All database queries must be **parameterized** (no string interpolation).
- Wrap database operations in **transactions** using `withTransaction()` when consistency is critical.
- Use **Winston** for structured logging.

### Naming Conventions

- **Handlers** → `camelCase.ts` (e.g., `createTeam.ts`, `updateTeamMemberRole.ts`)
- **Schemas** → `camelCaseSchema.ts` (e.g., `createTeamSchema.ts`)
- **Guards** → `assert*` or `is*` pattern (e.g., `assertTeamPermission.ts`)
- **Utilities** → descriptive camelCase (e.g., `assertBody.ts`, `rateLimit.ts`)
- **Constants** → UPPER_SNAKE_CASE for values; `camelCaseConstants.ts` for files
- **Types** → PascalCase (e.g., `AuthenticatedRequest`, `EqupoError`)

### Error Handling

All errors must follow the `EqupoError` contract:

```typescript
// Good
throw new EqupoError(403, 'User is not an admin', { userUid, teamId });

// Response to client
{
  "error": "User is not an admin",
  "details": { "userUid": "...", "teamId": "..." }
}
```

### Authorization Pattern

1. Parse and validate params/body with **Zod**.
2. Verify user identity via **Firebase middleware** (`requireUser`).
3. Enforce permissions via **guards** (query the database for user's role).
4. Execute business logic in a **transaction**.
5. Sync changes to **Firestore** if needed.

Example:

```typescript
import { requireUser } from '#a/auth.js';
import { assertTeamPermission } from '#a/domains/team/guards/index.js';
import { endpoint } from '#a/utils/endpoint.js';

export const deleteTeam = endpoint(
  requireUser,
  async (req: AuthenticatedRequest, res: Response) => {
    const { teamId } = req.params;

    // Authorization: Check if user is admin
    await assertTeamPermission(teamId, req.user.uid, 'admin');

    // Business logic
    await withTransaction(async (client) => {
      await client.query('DELETE FROM teams WHERE id = $1', [teamId]);
    });

    res.status(204).send();
  }
);
```

### Project Organization

- **Handlers** performing I/O or mutations: `domains/<domain>/handlers/`.
- **Pure utility functions**: `lib/utils/`.
- **Domain-specific utilities**: `domains/<domain>/utils.ts`.
- **Shared types**: `types/`.
- **Firestore sync logic**: `domains/<domain>/firestore/`.
- **Authorization logic**: `domains/<domain>/guards/`.

### Adding a New Endpoint

1. **Define schema** in `src/domains/<domain>/schemas/`.
2. **Implement guard** (if needed) in `src/domains/<domain>/guards/`.
3. **Create handler** in `src/domains/<domain>/handlers/`.
4. **Register route** in `src/app.ts` with appropriate middleware (`requireUser`, `userRateLimit`).
5. **Add Firestore sync** if realtime subscriptions are needed.
6. **Write tests** in `test/`.
7. **Update this README** with endpoint documentation.

---

## 8. API Integration

### Authentication

**Client Endpoints** (require Firebase bearer token):
```
Authorization: Bearer <firebase-id-token>
```
## Tests

El suite usa el runner nativo de Node.js (`node:test` + `node:assert`) e importa desde `dist/` (TypeScript compilado).

```bash
npm test                # ejecuta los tests
npm run test:coverage   # ejecuta con reporte de cobertura (c8 → coverage/lcov.info)
```

La cobertura incluye schemas Zod, utilidades puras, guards y funciones de DB testeadas con un mock de `PoolClient`. Quedan excluidos del umbral solo los handlers, Firestore helpers y Socket.IO, que requieren mock a nivel de modulo.

### Estructura de tests

```
test/
├── constants/          # httpStatusCodes
├── domains/
│   ├── achievement/    # schemas, constantes, computeEnvironmentHealth, checkAchievementsOnTaskComplete
│   ├── reward/         # schemas
│   ├── room/           # schemas, generacion de tokens Zego
│   ├── task/           # schemas, Firestore mapper, utils puras + DB (mock PoolClient), guards, grantTaskCompletionRewards
│   ├── team/           # schemas, constantes de roles, guards (mock PoolClient)
│   └── user/           # xpUtils, validacion de URLs de avatar
├── helpers/
│   └── mockClient.js   # makeSequentialClient — mock de PoolClient compartido
├── integration/        # pruebas HTTP end-to-end
└── utils/              # assertBody, endpoint, EqupoError, rateLimit
```

El analisis de calidad estatica se envia automaticamente a SonarCloud tras cada push a `develop` o `main`.

## Estructura general de carpetas (objetivo)

**System Endpoints** (require system key):
```
x-system-key: <SYSTEM_API_KEY>
```

### Core Endpoints

#### Teams

- `POST /api/v1/teams` — Create a new team (owner becomes admin).
- `GET /api/v1/teams/me` — Get all teams the user is a member of.
- `PATCH /api/v1/teams/:teamId` — Update team details (admin only).
- `DELETE /api/v1/teams/:teamId` — Delete team (admin only).
- `POST /api/v1/teams/:teamId/members` — Invite a user by userUid (admin/leader).
- `GET /api/v1/teams/:teamId/members` — Get all team members.
- `PATCH /api/v1/teams/:teamId/members/:userUid/role` — Update member role (admin only).
- `DELETE /api/v1/teams/:teamId/members/:userUid` — Remove member from team (admin/leader).

#### Invitation Codes

- `POST /api/v1/teams/:teamId/invitation-codes` — Generate shareable invitation code.
- `GET /api/v1/teams/invite-preview` — Preview team info from invitation code (no join).
- `POST /api/v1/teams/join` — Join team using invitation code.

#### Tasks

- `POST /api/v1/teams/:teamId/tasks` — Create a task.
- `GET /api/v1/teams/:teamId/tasks` — List team tasks.
- `PATCH /api/v1/teams/:teamId/tasks/:taskId` — Update task.
- `DELETE /api/v1/teams/:teamId/tasks/:taskId` — Delete task.
- `POST /api/v1/teams/:teamId/tasks/:taskId/rollover` — Create recurring task rollover.
- `GET /api/v1/teams/:teamId/tasks/my-valid-ids` — Get tasks assigned to user.

#### Task Steps

- `GET /api/v1/teams/:teamId/tasks/:taskId/steps` — List task steps.
- `POST /api/v1/teams/:teamId/tasks/:taskId/steps` — Create step.
- `PATCH /api/v1/teams/:teamId/tasks/:taskId/steps/:stepId` — Update step.
- `PATCH /api/v1/teams/:teamId/tasks/:taskId/steps/:stepId/toggle` — Toggle step completion.
- `DELETE /api/v1/teams/:teamId/tasks/:taskId/steps/:stepId` — Delete step.

#### Task Commentaries

- `GET /api/v1/teams/:teamId/tasks/:taskId/commentaries` — List comments.
- `POST /api/v1/teams/:teamId/tasks/:taskId/commentaries` — Add comment.
- `PATCH /api/v1/teams/:teamId/tasks/:taskId/commentaries/:commentaryId` — Update comment.
- `DELETE /api/v1/teams/:teamId/tasks/:taskId/commentaries/:commentaryId` — Delete comment.

#### Groups (Rooms/Collaboration)

- `GET /api/v1/teams/:teamId/groups` — List team groups.
- `POST /api/v1/teams/:teamId/groups` — Create a group.
- `PATCH /api/v1/teams/:teamId/groups/:groupId` — Update group.
- `DELETE /api/v1/teams/:teamId/groups/:groupId` — Delete group.
- `POST /api/v1/teams/:teamId/groups/:groupId/members` — Add members to group.

#### Rewards & Achievements

- `POST /api/v1/teams/:teamId/rewards` — Grant reward to team member.
- `POST /api/v1/teams/:teamId/achievements` — Create achievement.
- `GET /api/v1/teams/:teamId/achievements` — List achievements.
- `POST /api/v1/teams/:teamId/achievements/unlocks` — Unlock achievement for user.
- `POST /api/v1/internal/users/:userUid/rewards` — System-only: grant reward to user.

#### Reports & Analytics

- `GET /api/v1/teams/:teamId/reports/kpi` — Get key performance indicators.
- `GET /api/v1/teams/:teamId/reports/overview` — Get team overview report.

#### User Features

- `POST /api/v1/users/me/avatar/mirror` — Mirror user avatar from external source.

#### AI Features

- `POST /api/v1/ai/generate-description` — Generate task/goal descriptions using AI.

#### Real-time Video

- `POST /api/v1/teams/:teamId/rooms/:roomId/zego-token` — Generate ZegoCloud token for video calls.

### Firestore Collections (Real-time Sync)

The backend denormalizes data to Firestore for frontend subscriptions:

- `teams/{teamId}` — Team metadata
- `teams/{teamId}/members/{userUid}` — Team membership
- `teams/{teamId}/tasks/{taskId}` — Task details
- `teams/{teamId}/tasks/{taskId}/steps/{stepId}` — Task steps
- `teams/{teamId}/tasks/{taskId}/commentaries/{commentaryId}` — Comments
- `teams/{teamId}/groups/{groupId}` — Group info
- `teams/{teamId}/groups/{groupId}/members/{userUid}` — Group membership

---

## 9. Testing Strategy

### Test Coverage

The project includes unit and integration tests in the `test/` directory.

### Running Tests

```bash
npm test
```

### Test Locations

- `test/*.test.js` — Integration and unit tests
- Examples:
   - `test/permissions.test.js` — RBAC authorization tests
   - `test/taskFirestoreMapper.test.js` — Firestore data mapping tests
   - `test/taskSchemas.test.js` — Zod schema validation tests
   - `test/tasks.http.integration.test.js` — HTTP integration tests

### Current State

The project includes unit and integration tests covering core domains and critical logic paths.
``
```bash
npm run check  # Runs lint, format check, and tests
```

---

## 10. Build and Deployment

### Build

To create a production build, run:

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

### Production Execution

```bash
npm start
```

Alternatively:

```bash
node dist/index.js
```

### Docker Deployment

A `Dockerfile` is included for containerization:

```bash
docker build -t equpo-backend:latest .
docker run -e DATABASE_URL=... -e FIREBASE_PROJECT_ID=... -p 8080:8080 equpo-backend:latest
```

### Deployment

The backend is currently deployed in a private environment and is not publicly accessible.

### Environment-Specific Configuration

Configuration is loaded from environment variables at runtime. Ensure all required variables are set in your deployment environment (see [Environment Variables](#environment-variables) section).

### Performance Considerations

- **Connection Pooling:** PostgreSQL connections are pooled to optimize resource usage.
- **Rate Limiting:** User-based rate limiting prevents abuse without blocking legitimate traffic.
- **Transaction Boundaries:** Transactions are kept short to minimize lock contention.
- **Firestore Sync:** Batched writes to Firestore to reduce API calls.
- **Compression:** Express compression middleware is enabled for responses.

### Logging

Structured logging via Winston captures:
- HTTP requests/responses
- Authorization decisions
- Database transactions
- Errors and exceptions

Logs can be configured to output to files, external services, or stdout.

---

## 11. Best Practices and Observations

### Implemented Practices

- **Domain-Driven Design:** Business logic organized by domain for clarity and scalability.
- **Type Safety:** Strict TypeScript throughout the codebase.
- **Runtime Validation:** Zod schemas validate all inputs at HTTP boundaries.
- **Authorization:** Database-backed RBAC ensures permissions are enforced at runtime.
- **Transaction Safety:** Critical operations use SQL transactions for consistency.
- **Error Standardization:** All errors follow the `EqupoError` contract.
- **Structured Logging:** Winston for auditable, searchable logs.
- **Rate Limiting:** Per-user rate limits prevent abuse.
- **Firestore Real-time Sync:** Frontend subscriptions receive updates via Firestore mirrors.

### Design Patterns

- **Guard Pattern:** Authorization logic is separated into reusable guard functions.
- **Handler Pattern:** Each HTTP endpoint has a dedicated handler function.
- **Schema Pattern:** Input validation is centralized in Zod schemas.
- **Transaction Pattern:** Database operations are wrapped in `withTransaction()`.
- **Firestore Sync Pattern:** Domain changes trigger denormalization to Firestore.

### Anti-Patterns Avoided

- **Mixing Authentication and Authorization:** Auth middleware (`requireUser`) only validates the bearer token; authorization is enforced in guards.
- **Implicit Permissions:** Permissions are always explicit, queried from the database at request time (not cached in JWT).
- **Firestore as Source of Truth:** PostgreSQL is the source of truth; Firestore is a denormalized read replica.
- **Unvalidated Input:** All user input is validated against Zod schemas before processing.
- **Unstructured Errors:** All errors follow the `EqupoError` contract for consistency.

### Performance Notes

- Database queries use parameterized statements to prevent SQL injection.
- Indexes on frequently queried columns (e.g., `team_id`, `user_uid`) improve query performance.
- Rate limiting is applied globally to prevent resource exhaustion.
- Firestore writes are batched to reduce API costs.

### Security Considerations

- **Firebase Admin SDK:** Used for server-side token verification; private key is kept in environment variables.
- **RBAC:** Permissions are checked at the database level, not trusted from client claims.
- **SQL Injection Prevention:** All queries use parameterized statements.
- **CORS:** Restricted to configured origins.
- **Rate Limiting:** Per-user limits prevent brute-force attacks.
- **System Endpoints:** Protected with `x-system-key` header for internal-only operations.

### Integration with Frontend

The frontend communicates with this backend via:

1. **Authenticated HTTP requests** with Firebase bearer tokens.
2. **Real-time Firestore subscriptions** for live data updates.
3. **Firebase Admin SDK** for server-to-server communication (rewards, system operations).

Frontend repository:

→ [Equpo Frontend](https://github.com/equpo-s-team/equpo-frontend)

---

## 12. Contributing & Code Review Checklist

Before submitting a pull request, ensure:

- [ ] `npm run check` passes (lint, format, tests).
- [ ] New endpoints have corresponding Zod schemas.
- [ ] Authorization is enforced via guards.
- [ ] Database changes use parameterized queries.
- [ ] Critical operations are wrapped in transactions.
- [ ] Firestore sync is added if realtime data is needed.
- [ ] Errors follow the `EqupoError` contract.
- [ ] Tests are added for new functionality.
- [ ] README is updated if adding new endpoints or changing architecture.

---

## 13. Troubleshooting

### Common Issues

**"column X does not exist"**
- Verify the database schema matches `src/domains/*/firestore/` expectations.
- Check `.env` `DATABASE_URL` points to the correct database.

**"User is not authorized"**
- Verify the user's role in the `team_membership` table matches the required permission.
- Check guards are correctly querying the database.

**"TypeError: Cannot read property 'X' of undefined"**
- All handlers should use Zod validation before accessing request properties.
- Ensure middleware is applied in the correct order in `app.ts`.

**Firestore sync not working**
- Verify `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, and `FIREBASE_CLIENT_EMAIL` are set.
- Check Firestore collection paths match expected format.

**Rate limit errors**
- Check `RATE_LIMIT_MAX_REQUESTS` and `RATE_LIMIT_WINDOW_MS` are appropriate for your use case.
- Verify rate limiting middleware is applied to routes.


---

**Last Updated:** May 2026

For questions or contributions, please open an issue or pull request on the repository.

