<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';

	let error = $state('');
	let registering = $state(false);

	async function addPasskey() {
		registering = true;
		error = '';
		const result = await authClient.passkey.addPasskey();
		registering = false;

		if (result?.error) {
			error = 'That did not work. You can skip for now and try again later.';
			return;
		}
		await goto(resolve('/admin'), { invalidateAll: true });
	}
</script>

<svelte:head><title>Add a passkey</title></svelte:head>

<main class="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6">
	<h1 class="text-2xl font-semibold">Add a passkey</h1>
	<p class="text-gray-600">
		Faster than your password, and it can't be phished. Your password keeps working either way.
	</p>

	<button
		type="button"
		onclick={addPasskey}
		disabled={registering}
		class="rounded-md bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 disabled:opacity-50"
	>
		{registering ? 'Waiting for your device…' : 'Add a passkey'}
	</button>

	<form method="post" action="?/skip">
		<button class="text-sm text-gray-500 underline">Skip for now</button>
	</form>

	<p class="text-sm text-red-600" role="alert">{error}</p>
</main>
