/**
 * Seeds the initial admin (interactively) and, optionally, the guest list.
 *
 *   pnpm db:seed --admin ops@corp.com [data/attendees.json]
 *
 * Re-runnable: existing emails are left alone.
 */
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { auth } from '../src/lib/server/auth';
import { db } from '../src/lib/server/db';
import { user } from '../src/lib/server/db/schema';

const MIN_PASSWORD_LENGTH = 8;

type Attendee = { email: string; firstName: string; lastName: string };

function parseArgs(argv: string[]) {
	const flag = argv.indexOf('--admin');
	if (flag === -1 || !argv[flag + 1]) {
		throw new Error('--admin <email> is required, e.g. pnpm db:seed --admin ops@corp.com');
	}
	const adminEmail = argv[flag + 1];
	const attendeesFile = argv.filter((_, i) => i !== flag && i !== flag + 1)[0];
	return { adminEmail, attendeesFile };
}

/**
 * Asks for the password twice with the echo muted, so it never lands in
 * scrollback. One readline interface serves both prompts — closing and
 * reopening would end stdin when it is a pipe rather than a terminal.
 */
async function readAdminPassword() {
	let muted = false;
	const output = new Writable({
		write(chunk, _encoding, callback) {
			if (!muted) process.stdout.write(chunk);
			callback();
		}
	});
	const rl = createInterface({
		input: process.stdin,
		output,
		terminal: Boolean(process.stdin.isTTY)
	});

	// Reading through the line iterator rather than rl.question(): with piped
	// stdin the stream ends before a second question registers its listener, and
	// that await never settles.
	const lines = rl[Symbol.asyncIterator]();
	const ask = async (question: string) => {
		process.stdout.write(question);
		muted = true;
		try {
			const { value } = await lines.next();
			return (value ?? '').trim();
		} finally {
			muted = false;
			process.stdout.write('\n');
		}
	};

	try {
		for (;;) {
			const password = await ask('Admin password: ');
			if (password.length < MIN_PASSWORD_LENGTH) {
				console.error(`  Too short — at least ${MIN_PASSWORD_LENGTH} characters.`);
				continue;
			}
			if (password !== (await ask('Confirm password: '))) {
				console.error('  Passwords did not match.');
				continue;
			}
			return password;
		}
	} finally {
		rl.close();
	}
}

function splitName(email: string) {
	const [local] = email.split('@');
	const [first, ...rest] = local.split(/[._-]+/).filter(Boolean);
	return {
		firstName: capitalize(first ?? 'Admin'),
		lastName: rest.length ? rest.map(capitalize).join(' ') : 'Admin'
	};
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

async function seedAdmin(email: string) {
	const ctx = await auth.$context;

	if (await ctx.internalAdapter.findUserByEmail(email)) {
		console.log(`Admin ${email} already exists — leaving it alone.`);
		return;
	}

	const password = await readAdminPassword();
	const { firstName, lastName } = splitName(email);

	const created = await ctx.internalAdapter.createUser(
		{
			email,
			name: `${firstName} ${lastName}`,
			firstName,
			lastName,
			role: 'admin',
			// Verified out of band by whoever is running this, and claimed by
			// definition — an admin sets their own password right here.
			emailVerified: true,
			claimedAt: new Date()
		},
		{ method: 'admin' }
	);

	await ctx.internalAdapter.linkAccount({
		userId: created.id,
		accountId: created.id,
		providerId: 'credential',
		password: await ctx.password.hash(password)
	});

	console.log(`Created admin ${email}.`);
}

async function seedAttendees(file: string) {
	const attendees: Attendee[] = JSON.parse(await readFile(file, 'utf8'));

	const rows = attendees.map(({ email, firstName, lastName }) => {
		if (!email || !firstName || !lastName) {
			throw new Error(
				`every attendee needs email, firstName and lastName: ${JSON.stringify({ email, firstName, lastName })}`
			);
		}
		return {
			id: crypto.randomUUID(),
			email,
			name: `${firstName} ${lastName}`,
			firstName,
			lastName,
			role: 'attendee',
			emailVerified: false,
			claimedAt: null
		};
	});

	if (!rows.length) return console.log(`${file} is empty — nothing to seed.`);

	// The UNIQUE constraint on email is the dedupe; re-running is a no-op.
	await db.insert(user).values(rows).onConflictDoNothing({ target: user.email });

	const seeded = await db.$count(user, eq(user.role, 'attendee'));
	console.log(`Seeded ${rows.length} attendee(s) from ${file}; ${seeded} on the guest list now.`);
}

const { adminEmail, attendeesFile } = parseArgs(process.argv.slice(2));
await seedAdmin(adminEmail);
if (attendeesFile) await seedAttendees(attendeesFile);
