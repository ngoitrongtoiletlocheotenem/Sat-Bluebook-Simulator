import 'dotenv/config';
import { createDatabase, migrate } from './db.js';
import { seed } from './seed.js';
import { createApp } from './app.js';
import { createUser, registerSchema } from './auth.js';

const db = createDatabase();
await migrate(db);
if (process.env.SEED_SAMPLE_DATA !== 'false') await seed(db);
if (
  process.env.ADMIN_EMAIL &&
  process.env.ADMIN_PASSWORD &&
  !(await db('users').where({ email: process.env.ADMIN_EMAIL.toLowerCase() }).first())
)
  await createUser(
    db,
    registerSchema.parse({
      email: process.env.ADMIN_EMAIL,
      name: process.env.ADMIN_NAME || 'Administrator',
      password: process.env.ADMIN_PASSWORD,
    }),
    'admin',
  );
const port = Number(process.env.PORT || 3001),
  server = createApp(db).listen(port, process.env.HOST || '127.0.0.1', () =>
    console.log(`Pathwise SAT server listening on port ${port}`),
  );
async function stop() {
  server.close(async () => {
    await db.destroy();
    process.exit(0);
  });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
