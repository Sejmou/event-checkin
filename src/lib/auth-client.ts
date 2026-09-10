import { createAuthClient } from 'better-auth/client';
import { passkeyClient } from '@better-auth/passkey/client';

// Vanilla client: every call here is imperative (register a passkey, sign in
// with one). Nothing needs the reactive session store.
export const authClient = createAuthClient({ plugins: [passkeyClient()] });

/**
 * Whether this device can actually make a passkey.
 *
 * Best-effort by nature — private-mode Safari/Firefox, corporate policy and
 * virtual authenticators all misreport this, in both directions — so the UI
 * always keeps a manual way over to the password form.
 */
export async function canUsePasskey() {
	if (typeof PublicKeyCredential === 'undefined') return false;
	try {
		return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
	} catch {
		return false;
	}
}
