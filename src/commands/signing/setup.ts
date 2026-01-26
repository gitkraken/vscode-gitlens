import type { TextEditor, Uri } from 'vscode';
import { window, workspace } from 'vscode';
import type { Container } from '../../container.js';
import { command } from '../../system/-webview/command.js';
import { GlCommandBase } from '../commandBase.js';
import { getCommandUri } from '../commandBase.utils.js';

export interface SetupSigningWizardCommandArgs {
	readonly repoPath?: string;
}

@command()
export class SetupSigningWizardCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.git.setupCommitSigning');
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: SetupSigningWizardCommandArgs): Promise<void> {
		// Get the repository
		let repository;
		if (args?.repoPath) {
			repository = this.container.git.getRepository(args.repoPath);
		} else {
			uri = getCommandUri(uri, editor);
			repository = this.container.git.getBestRepository(uri, editor);

			// If no repository found and there's a single workspace folder, use it
			if (repository == null && workspace.workspaceFolders?.length === 1) {
				repository = this.container.git.getRepository(workspace.workspaceFolders[0].uri);
			}

			// Final fallback to first available repository
			repository ??= this.container.git.getBestRepositoryOrFirst(uri, editor);
		}

		if (repository == null) {
			void window.showErrorMessage('Unable to find a repository to configure signing for');
			return;
		}

		// Check if the git provider supports getSigningConfig
		if (repository.git.config.getSigningConfig == null) {
			void window.showErrorMessage('Commit signing is not supported by the current git provider.');
			return;
		}

		// Check if signing is already configured
		const signingConfig = await repository.git.config.getSigningConfig();
		const alreadyConfigured = Boolean(signingConfig?.enabled && signingConfig?.signingKey);

		// Send telemetry event
		this.container.telemetry.sendEvent('commit/signing/setupWizard/opened', {
			alreadyConfigured: alreadyConfigured,
		});

		if (alreadyConfigured) {
			const result = await window.showInformationMessage(
				`Commit signing is already configured using ${signingConfig?.format?.toUpperCase() ?? 'GPG'}.`,
				{ modal: false },
				'Reconfigure',
				'Test Signing',
			);

			if (result === 'Test Signing') {
				await this.testSigning(repository);
				return;
			} else if (result !== 'Reconfigure') {
				return;
			}
		}

		// Show setup wizard
		await this.showSetupWizard(repository);
	}

	private async showSetupWizard(repository: ReturnType<typeof this.container.git.getRepository>): Promise<void> {
		if (repository == null) return;

		// Check if the git provider supports setSigningConfig
		if (repository.git.config.setSigningConfig == null) {
			void window.showErrorMessage('Commit signing is not supported by the current git provider.');
			return;
		}

		// TODO: Implement full setup wizard UI
		// For now, show a simple quick pick to choose signing format

		// Check Git version support for different signing formats
		const supportsSSH = await repository.git.supports('git:signing:ssh');
		const supportsX509 = await repository.git.supports('git:signing:x509');

		const options: Array<{
			label: string;
			description: string;
			detail: string;
			value: 'gpg' | 'ssh' | 'x509';
		}> = [
			{
				label: '$(key) GPG',
				description: 'Sign commits with GPG',
				detail: 'Uses GPG (GNU Privacy Guard) for signing commits',
				value: 'gpg',
			},
		];

		if (supportsSSH) {
			options.push({
				label: '$(key) SSH',
				description: 'Sign commits with SSH',
				detail: 'Uses SSH keys for signing commits (requires Git 2.34+)',
				value: 'ssh',
			});
		}

		if (supportsX509) {
			options.push({
				label: '$(key) X.509',
				description: 'Sign commits with X.509',
				detail: 'Uses X.509 certificates for signing commits (requires Git 2.19+)',
				value: 'x509',
			});
		}

		const format = await window.showQuickPick(options, {
			title: 'Commit Signing Setup',
			placeHolder: 'Choose a signing format',
			ignoreFocusOut: true,
		});

		if (format == null) return;

		// Get signing key
		const placeholder = format.value === 'ssh' ? '~/.ssh/id_ed25519.pub' : 'Your key ID';
		let signingKey = await window.showInputBox({
			title: 'Commit Signing Setup',
			prompt: `Enter your ${format.value.toUpperCase()} signing key ${format.value === 'ssh' ? '(file path)' : '(key ID)'}`,
			placeHolder: placeholder,
			ignoreFocusOut: true,
		});

		// For SSH keys, use placeholder value if user pressed Enter without input
		signingKey = !signingKey && format.value === 'ssh' ? placeholder : signingKey;

		if (!signingKey) return;

		// Configure Git globally
		try {
			await repository.git.config.setSigningConfig?.(
				{
					enabled: true,
					format: format.value,
					signingKey: signingKey,
				},
				{ global: true },
			);

			const result = await window.showInformationMessage(
				`Commit signing has been configured globally using ${format.value.toUpperCase()}.`,
				{ modal: false },
				'Test Signing',
			);

			if (result === 'Test Signing') {
				await this.testSigning(repository);
			}

			// Send telemetry event for successful setup
			this.container.telemetry.sendEvent('commit/signing/setup', {
				format: format.value,
				keyGenerated: false, // We don't support key generation yet
			});
		} catch (ex) {
			void window.showErrorMessage(
				`Failed to configure commit signing: ${ex instanceof Error ? ex.message : String(ex)}`,
			);
		}
	}

	private async testSigning(repository: ReturnType<typeof this.container.git.getRepository>): Promise<void> {
		if (repository == null) return;

		// Check if the git provider supports validateSigningSetup
		if (repository.git.config.validateSigningSetup == null) {
			void window.showErrorMessage('Commit signing is not supported by the current git provider.');
			return;
		}

		// Validate signing setup
		const validation = await repository.git.config.validateSigningSetup();

		if (validation?.valid) {
			void window.showInformationMessage('✓ Commit signing is configured correctly and ready to use.');
		} else {
			void window.showWarningMessage(`Commit signing validation failed: ${validation?.error ?? 'Unknown error'}`);
		}
	}
}
