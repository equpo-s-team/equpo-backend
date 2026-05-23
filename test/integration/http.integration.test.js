import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

// Ensure required config vars exist before importing the app module.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/equpo_test';
process.env.SYSTEM_API_KEY = process.env.SYSTEM_API_KEY || 'test-system-key';
process.env.API_PREFIX = process.env.API_PREFIX || '/api/v1';
process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'equpo1';

const { app } = await import('../../dist/app.js');

let server;
let baseUrl;

before(() => {
  server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}${process.env.API_PREFIX}`;
});

after(async () => {
  if (server) {
    server.close();
  }
  const { redisClient, pubClient, subClient } = await import('../../dist/utils/redisClient.js');
  await Promise.all([
    redisClient.quit(),
    pubClient.quit(),
    subClient.quit(),
  ]);
});

// ─── Auth rejection (401) ────────────────────────────────────────────────────

test('HTTP integration: POST /teams/:teamId/tasks rejects missing Authorization header', async () => {
  const response = await fetch(
    `${baseUrl}/teams/550e8400-e29b-41d4-a716-446655440001/tasks`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dueDate: '2026-05-01T10:00:00.000Z', priority: 'high', status: 'todo' }),
    }
  );

  const payload = await response.json();
  assert.equal(response.status, 401);
  assert.equal(payload.error, 'Missing or invalid Authorization header');
});

test('HTTP integration: GET /teams/:teamId/tasks/my-valid-ids rejects missing Authorization header', async () => {
  const response = await fetch(
    `${baseUrl}/teams/550e8400-e29b-41d4-a716-446655440001/tasks/my-valid-ids`
  );

  const payload = await response.json();
  assert.equal(response.status, 401);
  assert.equal(payload.error, 'Missing or invalid Authorization header');
});

test('HTTP integration: GET /teams/:teamId/tasks/my-valid-ids rejects invalid bearer token', async () => {
  const response = await fetch(
    `${baseUrl}/teams/550e8400-e29b-41d4-a716-446655440001/tasks/my-valid-ids`,
    { headers: { Authorization: 'Bearer invalid-token-for-test' } }
  );

  const payload = await response.json();
  assert.equal(response.status, 401);
  assert.equal(payload.error, 'Invalid auth token');
});

// ─── Validation rejection (400/401) across multiple routes ───────────────────

test('HTTP integration: GET /teams/:teamId/tasks rejects missing Authorization header', async () => {
  const response = await fetch(
    `${baseUrl}/teams/550e8400-e29b-41d4-a716-446655440001/tasks`
  );
  const payload = await response.json();
  assert.equal(response.status, 401);
});

test('HTTP integration: GET /teams rejects missing Authorization header', async () => {
  const response = await fetch(`${baseUrl}/teams/me`);
  const payload = await response.json();
  assert.equal(response.status, 401);
});

test('HTTP integration: POST /teams rejects missing Authorization header', async () => {
  const response = await fetch(`${baseUrl}/teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test Team' }),
  });
  const payload = await response.json();
  assert.equal(response.status, 401);
});

test('HTTP integration: GET /health returns 200', async () => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
  assert.equal(response.status, 200);
});
