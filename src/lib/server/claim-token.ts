import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

/** How long one QR code stays on screen before it rotates. */
export const BUCKET_MS = 30_000;

/**
 * How long a guest has to finish claiming after scanning. Decoupled from
 * BUCKET_MS on purpose: the code may rotate while they're still typing.
 */
const PRESENCE_MS = 10 * 60_000;

export const PRESENCE_COOKIE = 'claim_presence';

function hmac(message: string) {
	return createHmac('sha256', env.BETTER_AUTH_SECRET).update(message).digest('base64url');
}

function equals(a: string, b: string) {
	const bufA = Buffer.from(a);
	const bufB = Buffer.from(b);
	return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * The QR payload. Derived from the clock rather than stored, so it rotates by
 * itself, needs no cleanup, and — the point of a kiosk code — is usable by
 * everyone who scans it during its window.
 */
export function bucketToken(at = Date.now()) {
	return hmac(`claim:${Math.floor(at / BUCKET_MS)}`);
}

/** Milliseconds until the on-screen code changes. */
export function msUntilNextBucket(at = Date.now()) {
	return BUCKET_MS - (at % BUCKET_MS);
}

/** Accepts the current bucket and the previous one, so a scan mid-rotation survives. */
export function verifyBucketToken(token: string, at = Date.now()) {
	return equals(token, bucketToken(at)) || equals(token, bucketToken(at - BUCKET_MS));
}

/** Proof the holder scanned a live code, in a form that outlives one rotation. */
export function issuePresence(at = Date.now()) {
	const expiresAt = at + PRESENCE_MS;
	return `${expiresAt}.${hmac(`presence:${expiresAt}`)}`;
}

export function verifyPresence(value: string | undefined, at = Date.now()) {
	if (!value) return false;
	const [expiresAt, signature] = value.split('.');
	if (!expiresAt || !signature) return false;
	if (!/^\d+$/.test(expiresAt) || Number(expiresAt) < at) return false;
	return equals(signature, hmac(`presence:${expiresAt}`));
}

export const presenceCookieOptions = {
	path: '/claim',
	httpOnly: true,
	sameSite: 'lax',
	maxAge: PRESENCE_MS / 1000
} as const;
