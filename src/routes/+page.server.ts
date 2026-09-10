import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	const user = event.locals.user;
	if (!user) redirect(302, '/login');
	// Signed in but no credential yet — finish claiming first.
	if (!user.claimedAt) redirect(302, '/claim');
	return { user };
};

export const actions: Actions = {
	signOut: async (event) => {
		await auth.api.signOut({ headers: event.request.headers });
		redirect(302, '/login');
	}
};
