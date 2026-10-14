import 'dotenv/config';
import { createDatabase, migrate } from './db.js';
import { seed } from './seed.js';
import { createUser, registerSchema } from './auth.js';
const db = createDatabase();
try {
  await migrate(db);
  const command = process.argv[2] || 'migrate';
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
  console.error(error instanceof Error ? error.message : 'Command failed');
  process.exitCode = 1;
} finally {
  await db.destroy();
}
