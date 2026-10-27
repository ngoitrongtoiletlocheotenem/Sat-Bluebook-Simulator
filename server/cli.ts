import 'dotenv/config';
import { createDatabase, migrate, requireCurrentSchema } from './db.js';
import { seed } from './seed.js';
import { createUser, registerSchema } from './auth.js';
let database: ReturnType<typeof createDatabase> | undefined;
try {
  const db = (database = createDatabase());
  const command = process.argv[2] || 'migrate';
  if (!['migrate', 'seed', 'admin'].includes(command))
    throw new Error('Unknown command; choose migrate, seed, or admin');
  if (command === 'migrate') await migrate(db);
  else await requireCurrentSchema(db);
  if (command === 'seed') {
    await seed(db);
    console.log('Original question bank and SAT blueprint seeded; no student history created.');
  } else if (command === 'admin') {
    const email = process.env.ADMIN_EMAIL,
      password = process.env.ADMIN_PASSWORD,
      name = process.env.ADMIN_NAME || 'Administrator';
    if (!email || !password)
      throw new Error(
        'Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 10 characters) in your environment or .env, then run npm run admin.',
      );
    if (await db('users').where({ email: email.toLowerCase() }).first())
      throw new Error('This email already has an account. Use administrator user-role management instead.');
    await createUser(db, registerSchema.parse({ email, password, name }), 'admin');
    console.log('Administrator account created.');
  } else if (command === 'migrate') console.log('Database migrations applied.');
  else throw new Error('Unknown command; choose migrate, seed, or admin');
} catch (error) {
  // Never print driver messages: they can contain SQL, parameters or connection details.
  const message = error instanceof Error ? error.message : '';
  console.error(
    /^(Set ADMIN_EMAIL|This email already|Unknown command|Database schema is out of date\.)/.test(message)
      ? message
      : 'Database command failed. Check configuration, input validation and database health.',
  );
  process.exitCode = 1;
} finally {
  await database?.destroy();
}
