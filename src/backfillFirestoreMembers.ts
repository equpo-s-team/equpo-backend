/* eslint-disable no-console */
import { Pool } from 'pg';
import { getFirebaseAdmin, getFirestoreDb } from '#a/firebaseAdmin.js';
import { config } from '#a/config.js';

async function run() {
  const admin = getFirebaseAdmin();
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: 'equpo1' });
  }

  const pool = new Pool({ connectionString: config.databaseUrl });
  const client = await pool.connect();
  const db = getFirestoreDb();

  try {
    const res = await client.query(
      'SELECT team_id, user_uid, role FROM public.team_membership'
    );
    console.log(`Found ${res.rowCount} memberships.`);

    let count = 0;
    for (const row of res.rows) {
      await db
        .collection('teams')
        .doc(row.team_id)
        .collection('members')
        .doc(row.user_uid)
        .set(
          {
            role: row.role,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      console.log(`Upserted ${row.team_id} -> ${row.user_uid}`);
      count++;
    }
    console.log(`Successfully backfilled ${count} memberships!`);
  } catch (e) {
    console.error(e);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
