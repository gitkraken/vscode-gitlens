import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { window } from 'vscode';

interface ClaudeSettings {
	hooks?: Record<string, HookEntry[]>;
	[key: string]: unknown;
}

interface HookEntry {
	hooks: HookDefinition[];
}

interface HookDefinition {
	type: string;
	command: string;
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function installClaudeHook(): Promise<void> {
	const claudeDir = join(homedir(), '.claude');
	const hooksDir = join(claudeDir, 'hooks');
	const hookScriptPath = join(hooksDir, 'gitlens.ts');
	const settingsPath = join(claudeDir, 'settings.json');
	const hookCommand = `node --experimental-strip-types ${hookScriptPath}`;

	// Write the hook script (contents inlined at build time from gitlens-session-hook.ts)
	await mkdir(hooksDir, { recursive: true });
	await writeFile(hookScriptPath, __GITLENS_HOOK_SCRIPT__!, 'utf8');

	// Read or initialize settings
	let settings: ClaudeSettings = {};

	if (await fileExists(settingsPath)) {
		try {
			const raw = await readFile(settingsPath, 'utf8');
			settings = JSON.parse(raw) as ClaudeSettings;
		} catch {
			const proceed = await window.showWarningMessage(
				'Could not parse ~/.claude/settings.json. Overwrite with new settings?',
				{ modal: true },
				'Overwrite',
			);
			if (proceed !== 'Overwrite') return;
			settings = {};
		}
	}

	// Register the hook for all Claude Code lifecycle events
	const hooks = (settings.hooks ??= {});
	const hookEntry = { hooks: [{ type: 'command', command: hookCommand }] };
	const eventNames = [
		'SessionStart',
		'SessionEnd',
		'UserPromptSubmit',
		'PreToolUse',
		'PostToolUse',
		'PostToolUseFailure',
		'Stop',
		'SubagentStart',
		'SubagentStop',
		'PreCompact',
		'Notification',
		'PermissionRequest',
	] as const;

	let allInstalled = true;
	for (const eventName of eventNames) {
		const eventHooks = (hooks[eventName] ??= []);
		const alreadyInstalled = eventHooks.some(entry =>
			entry.hooks?.some(h => h.type === 'command' && h.command === hookCommand),
		);

		if (!alreadyInstalled) {
			allInstalled = false;
			eventHooks.push({ ...hookEntry });
		}
	}

	if (allInstalled) {
		void window.showInformationMessage('Claude hook is already installed.');
		return;
	}

	await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

	void window.showInformationMessage('Claude hook installed successfully.');
}
