import { fail, redirect } from '@sveltejs/kit';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { auth, mintSession } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { passkey, user } from '$lib/server/db/schema';
import {
	PRESENCE_COOKIE,
	issuePresence,
	presenceCookieOptions,
	verifyBucketToken,
	verifyPresence
} from '$lib/server/claim-token';
import type { Actions, PageServerLoad } from './$types';

/**
 * Deliberately identical for "no such email", "already claimed" and "not on the
 * list". Anyone who scans the code could otherwise use this form to find out who
 * is on the guest list.
 */
const NO_MATCH = 'We could not set that account up. Check the address, or ask at the desk.';
const NO_PRESENCE = 'This code has expired. Scan the current one at the desk.';

/** Cheap in-memory throttle per presence cookie, for the same reason. */
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 60_000;

// ponytail: per-process counter, so it resets on redeploy and doesn't add up
// across instances. Fine for one box at one event; move to the DB if this ever
// runs more than once.
function tooManyAttempts(key: string) {
	const now = Date.now();
	const entry = attempts.get(key);

	if (!entry || entry.resetAt < now) {
		attempts.set(key, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
		return false;
	}
	entry.count += 1;
	return entry.count > MAX_ATTEMPTS;
}

export const load: PageServerLoad = (event) => {
	// Already signed in and set up? Nothing to claim.
	if (event.locals.user?.claimedAt) redirect(302, '/');

	const token = event.url.searchParams.get('t');
	if (token && verifyBucketToken(token)) {
		// Outlives the 30s rotation, so the code changing mid-typing costs nothing.
		event.cookies.set(PRESENCE_COOKIE, issuePresence(), presenceCookieOptions);
		redirect(302, '/claim');
	}

	const present = verifyPresence(event.cookies.get(PRESENCE_COOKIE));
	return { present, user: event.locals.user ?? null };
};

export const actions: Actions = {
	submitEmail: async (event) => {
		const presence = event.cookies.get(PRESENCE_COOKIE);
		if (!verifyPresence(presence)) return fail(403, { message: NO_PRESENCE });
		if (tooManyAttempts(presence!)) return fail(429, { message: NO_MATCH });

		const email = (await event.request.formData()).get('email')?.toString().trim() ?? '';

		const [match] = await db
			.select({ id: user.id })
			.from(user)
			.where(and(eq(user.email, email), isNull(user.claimedAt), eq(user.role, 'attendee')))
			.limit(1);

		if (!match) return fail(400, { message: NO_MATCH });

		await mintSession(email, event.request.headers);
		return { signedIn: true };
	},

	finishPasskey: async (event) => {
		const current = event.locals.user;
		if (!current) return fail(403, { message: NO_PRESENCE });

		// The passkey was registered in the browser against the session minted
		// above. Confirm it actually landed before closing the account off —
		// marking it claimed with no credential would lock the guest out.
		if ((await db.$count(passkey, eq(passkey.userId, current.id))) === 0) {
			return fail(400, { message: 'That passkey did not save. Try again, or set a password.' });
		}

		return markClaimed(event);
	},

	finishPassword: async (event) => {
		const password = (await event.request.formData()).get('password')?.toString() ?? '';
		if (password.length < 8) {
			return fail(400, { message: 'Use at least 8 characters.' });
		}

		// Links a `credential` account when the user has none, which is our case.
		await auth.api.setPassword({
			body: { newPassword: password },
			headers: event.request.headers
		});

		return markClaimed(event);
	}
};

async function markClaimed(event: Parameters<Actions[string]>[0]) {
	const current = event.locals.user;
	if (!current) return fail(403, { message: NO_PRESENCE });

	// Guarded on claimed_at so a double submit can't re-claim.
	await db
		.update(user)
		.set({ claimedAt: sql`(cast(unixepoch('subsecond') * 1000 as integer))` })
		.where(and(eq(user.id, current.id), isNull(user.claimedAt)));

	event.cookies.delete(PRESENCE_COOKIE, presenceCookieOptions);
	redirect(302, '/');
}
