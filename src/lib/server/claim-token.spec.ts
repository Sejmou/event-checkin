import { expect, test } from 'vitest';
import {
	BUCKET_MS,
	bucketToken,
	issuePresence,
	verifyBucketToken,
	verifyPresence
} from './claim-token';

test('a code is accepted for its own window and the one before it', () => {
	const now = Date.now();
	const token = bucketToken(now);

	expect(verifyBucketToken(token, now)).toBe(true);
	// Scanned just before a rotation, submitted just after.
	expect(verifyBucketToken(token, now + BUCKET_MS)).toBe(true);
});

test('a code is rejected two windows later', () => {
	const now = Date.now();
	expect(verifyBucketToken(bucketToken(now), now + 2 * BUCKET_MS)).toBe(false);
});

test('a made-up code is rejected', () => {
	expect(verifyBucketToken('not-a-real-token')).toBe(false);
	expect(verifyBucketToken('')).toBe(false);
});

test('the code changes when the window rolls over', () => {
	const now = Date.now();
	expect(bucketToken(now)).not.toBe(bucketToken(now + BUCKET_MS));
});

test('presence outlives several rotations but not its own expiry', () => {
	const now = Date.now();
	const presence = issuePresence(now);

	expect(verifyPresence(presence, now + 5 * BUCKET_MS)).toBe(true);
	expect(verifyPresence(presence, now + 11 * 60_000)).toBe(false);
});

test('presence cannot be forged or tampered with', () => {
	const presence = issuePresence();
	const [expiresAt, signature] = presence.split('.');

	// Push the expiry out, keep the signature.
	expect(verifyPresence(`${Number(expiresAt) + 60_000}.${signature}`)).toBe(false);
	expect(verifyPresence(`${expiresAt}.deadbeef`)).toBe(false);
	expect(verifyPresence(undefined)).toBe(false);
	expect(verifyPresence('garbage')).toBe(false);
});
