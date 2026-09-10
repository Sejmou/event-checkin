import { beforeAll, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), 'auth-spec-')), 'test.db');
process.env.BETTER_AUTH_SECRET = 'test-secret-for-auth-spec-only-32ch';

// imported lazily so DATABASE_URL is set before the db client is constructed
const load = async () => ({
	auth: (await import('./auth')).auth,
	db: (await import('./db')).db,
	user: (await import('./db/schema')).user
});

beforeAll(() => {
	execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { stdio: 'ignore' });
});

test('sign-up stores firstName/lastName', async () => {
	const { auth, db, user } = await load();

	// the sveltekitCookies plugin throws outside a request; the user row is
	// already committed by then, so the assertions below are the real check
	await auth.api
		.signUpEmail({
			body: {
				email: 'ada@example.com',
				password: 'correct-horse-battery',
				name: 'Ada Lovelace',
				firstName: 'Ada',
				lastName: 'Lovelace'
			}
		})
		.catch(() => {});

	const [row] = await db.select().from(user);
	expect(row.firstName).toBe('Ada');
	expect(row.lastName).toBe('Lovelace');
	// better-auth hardcodes `name`; callers derive it from the two real fields
	expect(row.name).toBe('Ada Lovelace');
});
