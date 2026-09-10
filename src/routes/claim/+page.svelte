<script lang="ts">
	import { enhance } from '$app/forms';
	import { authClient, canUsePasskey } from '$lib/auth-client';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	let passkeySupported = $state<boolean | null>(null);
	let usePasswordAnyway = $state(false);
	let passkeyError = $state('');
	let registering = $state(false);

	// The account exists from here on; only the credential is missing.
	let needsCredential = $derived(Boolean(form?.signedIn || data.user));

	$effect(() => {
		canUsePasskey().then((ok) => (passkeySupported = ok));
	});

	async function addPasskey() {
		registering = true;
		passkeyError = '';
		const result = await authClient.passkey.addPasskey();
		registering = false;

		if (result?.error) {
			passkeyError = 'That did not work. You can set a password instead.';
			usePasswordAnyway = true;
			return;
		}
		document.forms.namedItem('finishPasskey')?.requestSubmit();
	}
</script>

<svelte:head><title>Set up your account</title></svelte:head>

<main class="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 p-6">
	{#if !data.present && !needsCredential}
		<h1 class="text-2xl font-semibold">Scan the code at the desk</h1>
		<p class="text-gray-600">
			This page opens when you scan the QR code on the check-in screen. The code changes every 30
			seconds, so scan the one showing now.
		</p>
	{:else if !needsCredential}
		<h1 class="text-2xl font-semibold">What's your email?</h1>
		<p class="text-gray-600">Use the address you were invited with.</p>

		<form method="post" action="?/submitEmail" use:enhance class="flex flex-col gap-4">
			<label class="flex flex-col gap-1">
				Email
				<input
					type="email"
					name="email"
					autocomplete="email"
					required
					class="rounded-md border border-gray-300 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
				/>
			</label>
			<button class="rounded-md bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700">
				Continue
			</button>
		</form>
	{:else}
		<h1 class="text-2xl font-semibold">Secure your account</h1>

		{#if passkeySupported === null}
			<p class="text-gray-600">Checking what this device supports…</p>
		{:else if passkeySupported && !usePasswordAnyway}
			<p class="text-gray-600">
				Use your fingerprint, face or screen lock. Nothing to remember, nothing to type.
			</p>
			<button
				type="button"
				onclick={addPasskey}
				disabled={registering}
				class="rounded-md bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 disabled:opacity-50"
			>
				{registering ? 'Waiting for your device…' : 'Set up a passkey'}
			</button>
			<!-- The support check misreports on private-mode browsers and managed
			     devices, so never let it be the only way forward. -->
			<button
				type="button"
				onclick={() => (usePasswordAnyway = true)}
				class="text-sm text-gray-500 underline"
			>
				Use a password instead
			</button>
		{:else}
			<p class="text-gray-600">
				{passkeySupported
					? 'Set a password for your account.'
					: "This device can't use passkeys, so set a password instead."}
			</p>
			<form method="post" action="?/finishPassword" use:enhance class="flex flex-col gap-4">
				<label class="flex flex-col gap-1">
					Password
					<input
						type="password"
						name="password"
						autocomplete="new-password"
						minlength="8"
						required
						class="rounded-md border border-gray-300 bg-white px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
					/>
				</label>
				<button class="rounded-md bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700">
					Finish
				</button>
			</form>
			{#if passkeySupported}
				<button
					type="button"
					onclick={() => (usePasswordAnyway = false)}
					class="text-sm text-gray-500 underline"
				>
					Back to passkeys
				</button>
			{/if}
		{/if}

		<form method="post" action="?/finishPasskey" name="finishPasskey" hidden use:enhance></form>
	{/if}

	<p class="text-sm text-red-600" role="alert">{passkeyError || form?.message || ''}</p>
</main>
