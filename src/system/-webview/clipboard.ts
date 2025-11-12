import { env } from 'vscode';

export async function callUsingClipboard(text: string, fnToCall: () => Promise<void>): Promise<void> {
	const previousClipboard = await env.clipboard.readText();
	const matchesClipboard = previousClipboard === text;
	if (!matchesClipboard) {
		await env.clipboard.writeText(text);
	}

	try {
		await fnToCall();
	} finally {
		if (!matchesClipboard) {
			await env.clipboard.writeText(previousClipboard);
		}
	}
}
