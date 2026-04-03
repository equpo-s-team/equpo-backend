import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

// Ensure required config vars exist before importing the app module.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/equpo_test';
process.env.SYSTEM_API_KEY = process.env.SYSTEM_API_KEY || 'test-system-key';
process.env.API_PREFIX = process.env.API_PREFIX || '/api/v1';

const { app } = await import('../dist/app.js');

let server;
let baseUrl;

before(() => {
  server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}${process.env.API_PREFIX}`;
});

after(() => {
  if (server) {
    server.close();
  }
});

test('HTTP integration: POST /teams/:teamId/tasks rejects missing Authorization header', async () => {
  const response = await fetch(
    `${baseUrl}/teams/550e8400-e29b-41d4-a716-446655440001/tasks`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dueDate: '2026-05-01T10:00:00.000Z',
        priority: 'high',
        status: 'todo',
      }),
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
    {
      headers: {
        Authorization: 'Bearer invalid-token-for-test',
      },
    }
  );

  const payload = await response.json();
  assert.equal(response.status, 401);
  assert.equal(payload.error, 'Invalid auth token');
});

