# GitLens Commit Signing - Implementation Plan

## Status: Phase 1 Complete ✅

**Phase 1 (Core Infrastructure)** has been fully implemented. All core signing functionality is in place.

### Phase 1 Implementation Summary

| Component                                      | Location                                        |
| ---------------------------------------------- | ----------------------------------------------- |
| `gitConfigsLogWithSignatures` constant         | `src/env/node/git/git.ts`                       |
| `ConfigGitSubProvider.getSigningConfig()`      | `src/env/node/git/sub-providers/config.ts`      |
| `ConfigGitSubProvider.validateSigningSetup()`  | `src/env/node/git/sub-providers/config.ts`      |
| `ConfigGitSubProvider.setSigningConfig()`      | `src/env/node/git/sub-providers/config.ts`      |
| `ConfigGitSubProvider.getSigningConfigFlags()` | `src/env/node/git/sub-providers/config.ts`      |
| `CommitsGitSubProvider.getCommitSignature()`   | `src/env/node/git/sub-providers/commits.ts`     |
| `CommitsGitSubProvider.parseSignature()`       | `src/env/node/git/sub-providers/commits.ts`     |
| `GitCommit._signature` + `getSignature()`      | `src/git/models/commit.ts`                      |
| `SigningConfig`, `CommitSignature` types       | `src/git/models/signature.ts`                   |
| `SigningError` + `SigningErrorReason`          | `src/git/errors.ts`                             |
| Patch sub-provider signing support             | `src/env/node/git/sub-providers/patch.ts`       |
| Composer integration                           | `src/webviews/plus/composer/composerWebview.ts` |
| Telemetry events                               | `src/constants.telemetry.ts`                    |
| `GitProvider` interface updates                | `src/git/gitProvider.ts`                        |

### Remaining Work

- **Phase 2**: Setup Wizard & Configuration UI
- **Phase 3**: Signature Verification & Display (badges in Commit Graph, etc.)

## Philosophy: Leverage Git Config, Extend Existing Sub-Providers

This plan takes a **Git-first approach** - we read directly from Git configuration and extend existing sub-providers rather than creating new ones.

### Key Principles

1. **Read from Git Config** - All signing configuration comes from Git's native config system
2. **No Duplication** - Don't create GitLens settings that mirror Git config values
3. **Extend Existing Sub-Providers** - Add signing to `config` and `commits` sub-providers
4. **Minimal Settings** - Only add GitLens settings for UI/UX features Git doesn't support

---

## Architecture Decision: Extend Existing Sub-Providers

**Rather than creating a new `signing` sub-provider, we extend existing ones:**

### A. Config Sub-Provider (`src/env/node/git/sub-providers/config.ts`)

- Handles signing **configuration** (similar to how it handles `user.name`, `user.email`)
- Read/write signing settings from Git config
- Validate signing setup
- Platform-specific GPG/SSH detection

### B. Commits Sub-Provider (`src/env/node/git/sub-providers/commits.ts`)

- Handles signature **parsing and display** (commit metadata)
- Parse `git log --show-signature` output
- Extend `GitCommit` model with signature property

### C. Patch Sub-Provider (`src/env/node/git/sub-providers/patch.ts`)

- Add signing support to unreachable commit creation
- Respect auto-sign configuration

### Rationale

✅ **No new sub-provider needed** - Simpler architecture
✅ **Natural fit** - Config goes with config, commit data goes with commits
✅ **Smaller surface area** - Fewer files to modify
✅ **Consistent with existing patterns** - `config` already handles `user.name`, `user.email`
✅ **Easier to maintain** - Related functionality stays together

---

## Configuration Strategy

### What We Read from Git Config (No GitLens Settings Needed)

- `commit.gpgsign` - Whether to auto-sign commits (boolean)
- `gpg.format` - Signing format: `gpg`, `ssh`, `x509`, `openpgp`
- `gpg.program` - Path to GPG program
- `gpg.ssh.program` - Path to SSH program (for SSH signing)
- `user.signingkey` - The signing key ID or path
- `gpg.ssh.allowedSignersFile` - SSH allowed signers file path

### Minimal GitLens Settings (Only What Git Can't Provide)

```typescript
interface CommitSigningConfig {
	readonly showSetupWizard: boolean; // default: true
	readonly showStatusBar: boolean; // default: true
	readonly showSignatureBadges: boolean; // default: true
	readonly enableKeyGeneration: boolean; // default: true
}
```

---

## Implementation Phases

### Phase 1: Core Infrastructure ✅ COMPLETE

#### 1.1 Extend ConfigGitSubProvider

```typescript
// In src/env/node/git/sub-providers/config.ts

export class ConfigGitSubProvider implements GitConfigSubProvider {
	// NEW: Read signing configuration from Git config
	async getSigningConfig(repoPath: string): Promise<SigningConfig> {
		const autoSign = await this.git.config__get('commit.gpgsign', repoPath);
		const format = (await this.git.config__get('gpg.format', repoPath)) ?? 'gpg';
		const signingKey = await this.git.config__get('user.signingkey', repoPath);
		const gpgProgram = await this.git.config__get('gpg.program', repoPath);
		const sshProgram = await this.git.config__get('gpg.ssh.program', repoPath);
		const allowedSignersFile = await this.git.config__get('gpg.ssh.allowedSignersFile', repoPath);

		return {
			enabled: autoSign === 'true',
			format: format as 'gpg' | 'ssh' | 'x509' | 'openpgp',
			signingKey,
			gpgProgram,
			sshProgram,
			allowedSignersFile,
		};
	}

	// NEW: Validate signing setup
	async validateSigningSetup(repoPath: string): Promise<ValidationResult> {
		const config = await this.getSigningConfig(repoPath);

		if (!config.signingKey) {
			return { valid: false, error: 'No signing key configured' };
		}

		if (config.format === 'gpg') {
			const gpgPath = config.gpgProgram ?? (await this.findGPG());
			if (!gpgPath) {
				return { valid: false, error: 'GPG not found' };
			}
		} else if (config.format === 'ssh') {
			const sshPath = config.sshProgram ?? (await this.findSSH());
			if (!sshPath) {
				return { valid: false, error: 'SSH not found' };
			}
		}

		return { valid: true };
	}

	// NEW: Set signing configuration (for setup wizard)
	async setSigningConfig(repoPath: string, config: Partial<SigningConfig>): Promise<void> {
		if (config.enabled !== undefined) {
			await this.setConfig(repoPath, 'commit.gpgsign', config.enabled ? 'true' : 'false');
		}
		if (config.format !== undefined) {
			await this.setConfig(repoPath, 'gpg.format', config.format);
		}
		if (config.signingKey !== undefined) {
			await this.setConfig(repoPath, 'user.signingkey', config.signingKey);
		}
		if (config.gpgProgram !== undefined) {
			await this.setConfig(repoPath, 'gpg.program', config.gpgProgram);
		}
		if (config.sshProgram !== undefined) {
			await this.setConfig(repoPath, 'gpg.ssh.program', config.sshProgram);
		}
		if (config.allowedSignersFile !== undefined) {
			await this.setConfig(repoPath, 'gpg.ssh.allowedSignersFile', config.allowedSignersFile);
		}
	}

	// NEW: Generate -c flags for git commands when signing config needs to be passed
	getSigningConfigFlags(config: SigningConfig): string[] {
		const flags: string[] = [];

		if (config.gpgProgram) {
			flags.push('-c', `gpg.program=${config.gpgProgram}`);
		}
		if (config.format && config.format !== 'gpg') {
			flags.push('-c', `gpg.format=${config.format}`);
		}
		if (config.sshProgram) {
			flags.push('-c', `gpg.ssh.program=${config.sshProgram}`);
		}
		if (config.allowedSignersFile) {
			flags.push('-c', `gpg.ssh.allowedSignersFile=${config.allowedSignersFile}`);
		}

		return flags;
	}
}
```

#### 1.2 Add Git Config for Signature Display

**CRITICAL**: GitLens currently disables signature display with `-c log.showSignature=false` in `gitConfigsLog`. We need a new config constant for when we want signatures.

```typescript
// In src/env/node/git/git.ts

// EXISTING (line 64-65):
export const gitConfigsLog = ['-c', 'log.showSignature=false'] as const;

// NEW: Config for when we WANT signatures
export const gitConfigsLogWithSignatures = ['-c', 'log.showSignature=true'] as const;
```

#### 1.3 Extend CommitsGitSubProvider

```typescript
// In src/env/node/git/sub-providers/commits.ts

export class CommitsGitSubProvider implements GitCommitsSubProvider {
	// NEW: Get commit signature information
	async getCommitSignature(repoPath: string, sha: string): Promise<CommitSignature | undefined> {
		// Use gitConfigsLogWithSignatures to enable signature display
		const result = await this.git.exec(
			{ cwd: repoPath, configs: gitConfigsLogWithSignatures },
			'log',
			'--show-signature',
			'--format=%H',
			'-1',
			sha,
		);

		return this.parseSignature(result.stdout);
	}

	// NEW: Parse signature from git log --show-signature output
	private parseSignature(output: string): CommitSignature | undefined {
		// Parse GPG/SSH signature output
		// Example GPG output:
		//   gpg: Signature made ...
		//   gpg: Good signature from "Name <email>"
		// Example SSH output:
		//   Good "git" signature for user@example.com with ED25519 key SHA256:...

		const lines = output.split('\n');
		let status: 'good' | 'bad' | 'unknown' | 'expired' | 'revoked' = 'unknown';
		let signer: string | undefined;
		let key: string | undefined;

		for (const line of lines) {
			if (line.includes('Good signature') || line.includes('Good "git" signature')) {
				status = 'good';
				// Extract signer info
			} else if (line.includes('BAD signature')) {
				status = 'bad';
			} else if (line.includes('expired')) {
				status = 'expired';
			} else if (line.includes('revoked')) {
				status = 'revoked';
			}
		}

		if (status === 'unknown') return undefined;

		return { status, signer, key };
	}
}
```

#### 1.4 Update GitCommit Model

```typescript
// In src/git/models/commit.ts

export class GitCommit {
	private _signature: CommitSignature | undefined | null;

	constructor(
		// ... existing parameters ...
		signature?: CommitSignature, // NEW: Optional signature passed during construction
	) {
		this._signature = signature;
	}

	// NEW: Lazy-load signature on demand
	async getSignature(): Promise<CommitSignature | undefined> {
		if (this._signature === null) return undefined;
		if (this._signature !== undefined) return this._signature;

		// Fetch signature from git
		this._signature =
			(await this.container.git.getRepositoryService(this.repoPath).commits.getCommitSignature?.(this.sha)) ?? null;

		return this._signature ?? undefined;
	}
}
```

**Note**: Signatures are loaded lazily to avoid performance impact on normal commit operations. Only fetch when explicitly needed (e.g., when displaying commit details).

#### 1.5 Update Patch Sub-Provider

```typescript
// In src/env/node/git/sub-providers/patch.ts

private async createUnreachableCommitForPatchCore(
	env: Record<string, string>,
	repoPath: string,
	base: string | undefined,
	message: string,
	patch: string,
	options?: { sign?: boolean }  // NEW
): Promise<string> {
	const scope = getLogScope();

	if (!patch.endsWith('\n')) {
		patch += '\n';
	}

	try {
		// Apply the patch to our temp index, without touching the working directory
		await this.git.exec(
			{ cwd: repoPath, configs: gitConfigsLog, env: env, stdin: patch },
			'apply',
			'--cached',
			'-',
		);

		// Create a new tree from our patched index
		let result = await this.git.exec({ cwd: repoPath, env: env }, 'write-tree');
		const tree = result.stdout.trim();

		// NEW: Check if we should sign
		const signingConfig = await this.provider.config.getSigningConfig(repoPath);
		const shouldSign = options?.sign ?? signingConfig.enabled;

		// Create new commit from the tree
		const args = ['commit-tree', tree];

		if (base) {
			args.push('-p', base);
		}

		// NEW: Add signing flag if enabled
		if (shouldSign) {
			args.push('-S');
		}

		args.push('-m', message);

		result = await this.git.exec({ cwd: repoPath, env: env }, ...args);
		const sha = result.stdout.trim();

		return sha;
	} catch (ex) {
		Logger.error(ex, scope);
		debugger;

		throw ex;
	}
}

// Update both public methods to accept sign option
async createUnreachableCommitForPatch(
	repoPath: string,
	base: string,
	message: string,
	patch: string,
	options?: { sign?: boolean }  // NEW
): Promise<GitCommit | undefined> {
	// ... existing implementation, pass options to createUnreachableCommitForPatchCore
}

async createUnreachableCommitsFromPatches(
	repoPath: string,
	base: string | undefined,
	patches: { message: string; patch: string }[],
	options?: { sign?: boolean }  // NEW
): Promise<string[]> {
	// ... existing implementation, pass options to createUnreachableCommitForPatchCore
}
```

#### 1.5 Composer Integration

```typescript
// In src/webviews/plus/composer/composerWebview.ts

private async onFinishAndCommit(params: FinishAndCommitParams) {
	const signingConfig = await repo.git.config.getSigningConfig();
	const shouldSign = signingConfig.enabled;

	const shas = await repo.git.patch?.createUnreachableCommitsFromPatches(
		params.baseCommit?.sha,
		diffInfo,
		{ sign: shouldSign }
	);
}
```

#### 1.6 Type Definitions

```typescript
// NEW: src/git/models/signature.ts

export interface SigningConfig {
	enabled: boolean;
	format: 'gpg' | 'ssh' | 'x509' | 'openpgp';
	signingKey?: string;
	gpgProgram?: string;
	sshProgram?: string;
	allowedSignersFile?: string;
}

export interface CommitSignature {
	status: 'good' | 'bad' | 'expired' | 'revoked' | 'unknown' | 'error'; // Note: 'good'/'bad' match GPG/SSH terminology
	signer?: string;
	keyId?: string;
	fingerprint?: string;
	timestamp?: Date;
	errorMessage?: string;
	trustLevel?: 'ultimate' | 'full' | 'marginal' | 'never' | 'unknown';
}

export interface ValidationResult {
	valid: boolean;
	error?: string;
}
```

#### 1.7 Update GitProvider Interfaces

```typescript
// In src/git/gitProvider.ts

export interface GitConfigSubProvider {
	// ... existing methods ...

	// NEW: Signing configuration methods
	getSigningConfig?(repoPath: string): Promise<SigningConfig>;
	validateSigningSetup?(repoPath: string): Promise<ValidationResult>;
	setSigningConfig?(repoPath: string, config: Partial<SigningConfig>): Promise<void>;
}

export interface GitCommitsSubProvider {
	// ... existing methods ...

	// NEW: Signature parsing
	getCommitSignature?(repoPath: string, sha: string): Promise<CommitSignature | undefined>;
}
```

#### 1.6 Error Handling

```typescript
// In src/git/models/errors.ts (or create new file)

export class SigningError extends Error {
	constructor(
		public readonly reason: 'no-key' | 'gpg-not-found' | 'ssh-not-found' | 'passphrase-failed' | 'unknown',
		message: string,
		public readonly details?: string,
	) {
		super(message);
		this.name = 'SigningError';
	}
}

// Usage in patch sub-provider:
try {
	result = await this.git.exec({ cwd: repoPath, env: env }, ...args);
} catch (ex) {
	if (ex instanceof Error && ex.message.includes('gpg failed to sign')) {
		throw new SigningError('passphrase-failed', 'GPG failed to sign the commit', ex.message);
	} else if (ex instanceof Error && ex.message.includes('no signing key')) {
		throw new SigningError('no-key', 'No signing key configured', ex.message);
	}
	throw ex;
}
```

#### 1.7 Telemetry Events

Uses the standard `Source` type for tracking where actions originate:

```typescript
// Track signing usage and failures

// In patch sub-provider after successful signing:
this.container.telemetry.sendEvent('commit/signed', { format: signingConfig.format }, options?.source);

// On signing failure:
this.container.telemetry.sendEvent(
	'commit/signing/failed',
	{ reason: error.reason, format: signingConfig.format },
	options?.source,
);

// Caller passes Source object:
await repo.git.patch?.createUnreachableCommitsFromPatches(base, patches, {
	sign: shouldSign,
	source: { source: 'composer' }, // Uses standard Source type
});

// In setup wizard after completion:
this.container.telemetry.sendEvent('commit/signing/setup', {
	format: config.format,
	keyGenerated: wasKeyGenerated,
});
```

---

### Phase 2: Setup & Configuration UI (2-3 weeks)

#### 2.1 Setup Wizard

Guide users through configuring Git's signing settings:

1. **Detect Existing Setup** - Check if `user.signingkey` is configured
2. **Choose Format** - GPG, SSH, or X.509
3. **Select/Generate Key** - Use existing or generate new
4. **Configure Git** - Write to Git config using `repo.git.config.setSigningConfig()`
5. **Test** - Create a test signed commit

#### 2.2 Settings UI

- Read-only display of current Git config values
- "Edit in Git Config" button
- "Run Setup Wizard" button
- "Test Signing" button
- GitLens-specific toggles (status bar, badges, etc.)

---

### Phase 3: Signature Verification & Display (2-3 weeks)

Show signature status in:

- Commit Graph (badge on commits)
- Commit Details panel
- File History
- Search results

**Badge Types:**

- ✅ Valid (green)
- ⚠️ Expired/untrusted (yellow)
- ❌ Invalid (red)
- ⚪ Unsigned (gray)

---

## File Structure

```
src/
├── env/node/git/
│   ├── git.ts                         # MODIFY: Add gitConfigsLogWithSignatures constant
│   └── sub-providers/
│       ├── config.ts                  # MODIFY: Add signing config methods + getSigningConfigFlags()
│       ├── commits.ts                 # MODIFY: Add signature parsing + getCommitSignature()
│       └── patch.ts                   # MODIFY: Add sign option to both createUnreachable* methods
├── git/
│   ├── gitProvider.ts                 # MODIFY: Extend GitConfigSubProvider & GitCommitsSubProvider interfaces
│   └── models/
│       ├── commit.ts                  # MODIFY: Add signature property + getSignature() method
│       ├── signature.ts               # NEW: SigningConfig, CommitSignature, ValidationResult types
│       └── errors.ts                  # MODIFY: Add SigningError class
├── webviews/plus/composer/
│   └── composerWebview.ts             # MODIFY: Pass sign option to createUnreachableCommitsFromPatches
├── plus/signing/                      # NEW: UI/UX features (Phase 2+)
│   ├── setupWizard.ts                 # NEW: Setup wizard logic
│   └── keyGenerator.ts                # NEW: Generate keys (optional)
└── config.ts                          # MODIFY: Add minimal GitLens settings (showSetupWizard, etc.)
```

### Files Modified (Phase 1)

1. **src/env/node/git/git.ts** - Add `gitConfigsLogWithSignatures` constant
2. **src/env/node/git/sub-providers/config.ts** - Add 4 new methods (getSigningConfig, validateSigningSetup, setSigningConfig, getSigningConfigFlags)
3. **src/env/node/git/sub-providers/commits.ts** - Add 2 new methods (getCommitSignature, parseSignature)
4. **src/env/node/git/sub-providers/patch.ts** - Modify 3 methods (createUnreachableCommitForPatchCore, createUnreachableCommitForPatch, createUnreachableCommitsFromPatches)
5. **src/git/gitProvider.ts** - Extend 2 interfaces (GitConfigSubProvider, GitCommitsSubProvider)
6. **src/git/models/commit.ts** - Add signature property + getSignature() method
7. **src/git/models/signature.ts** - NEW file with 3 type definitions
8. **src/git/models/errors.ts** - Add SigningError class
9. **src/webviews/plus/composer/composerWebview.ts** - Pass sign option when creating commits

**Total: 8 files modified, 1 file created**

---

## Backward Compatibility

All existing code continues to work without changes. The `options` parameter is optional on all modified methods:

```typescript
createUnreachableCommitForPatch(..., options?: { sign?: boolean; source?: Source })
createUnreachableCommitsFromPatches(..., options?: { sign?: boolean; source?: Source })
```

Existing calls without the `options` parameter will:

1. Check Git config for `commit.gpgsign`
2. Sign if enabled, skip if disabled
3. Maintain existing behavior for repos without signing configured

**Verified call sites** (all compatible):

- `src/commands/patches.ts` - Paste patch command
- `src/webviews/plus/patchDetails/patchDetailsWebview.ts` - Patch details
- `src/commands/generateRebase.ts` - AI-generated rebase
- `src/commands/git/worktree.ts` - Copy changes to worktree

---

## Implementation Patterns

### Lazy Signature Loading

Uses `undefined | null` caching pattern (matches existing GitLens patterns like `_message`):

- `undefined` = not yet fetched
- `null` = fetched but no signature found
- `CommitSignature` = signature found and cached

### Why `log.showSignature=false` Stays in `gitConfigsLog`

GitLens explicitly disables signatures in normal log operations for performance. The `gitConfigsLogWithSignatures` constant is used only when signatures are explicitly requested. This ensures:

1. Fast log operations by default
2. Signatures only fetched when explicitly requested (lazy loading)
3. Consistent behavior regardless of user's global Git config

---

## Benefits

✅ **No Configuration Duplication** - Single source of truth (Git config)
✅ **Works with VS Code** - Both extensions read same Git config
✅ **Works with CLI** - Git CLI and GitLens stay in sync
✅ **Simpler Implementation** - Extends existing code, no new sub-provider
✅ **Better UX** - Users configure Git once, works everywhere
✅ **Smaller Surface Area** - Fewer files to create/modify

---

## API Reference

### Type Definitions

```typescript
type SigningFormat = 'gpg' | 'ssh' | 'x509' | 'openpgp';
type SignatureStatus = 'good' | 'bad' | 'unknown' | 'expired' | 'revoked' | 'error';
type TrustLevel = 'ultimate' | 'full' | 'marginal' | 'never' | 'unknown';

interface SigningConfig {
	enabled: boolean; // commit.gpgsign
	format: SigningFormat; // gpg.format
	signingKey?: string; // user.signingkey
	gpgProgram?: string; // gpg.program
	sshProgram?: string; // gpg.ssh.program
	allowedSignersFile?: string; // gpg.ssh.allowedSignersFile
}

interface CommitSignature {
	status: SignatureStatus;
	signer?: string;
	keyId?: string;
	fingerprint?: string;
	timestamp?: Date;
	errorMessage?: string;
	trustLevel?: TrustLevel;
}

interface ValidationResult {
	valid: boolean;
	error?: string;
}
```

### ConfigGitSubProvider Methods

| Method                               | Description                           |
| ------------------------------------ | ------------------------------------- |
| `getSigningConfig(repoPath)`         | Reads all signing config from Git     |
| `validateSigningSetup(repoPath)`     | Validates GPG/SSH is available        |
| `setSigningConfig(repoPath, config)` | Writes signing config to Git          |
| `getSigningConfigFlags(config)`      | Generates `-c` flags for Git commands |

### CommitsGitSubProvider Methods

| Method                              | Description                               |
| ----------------------------------- | ----------------------------------------- |
| `getCommitSignature(repoPath, sha)` | Fetches and parses signature for a commit |

### GitCommit Methods

| Method           | Description                                    |
| ---------------- | ---------------------------------------------- |
| `getSignature()` | Lazy-loads signature (cached after first call) |

### PatchGitSubProvider Options

```typescript
// Both methods accept options:
createUnreachableCommitForPatch(..., options?: { sign?: boolean; source?: Source })
createUnreachableCommitsFromPatches(..., options?: { sign?: boolean; source?: Source })
```

- `sign: true` → Always sign
- `sign: false` → Never sign
- `sign: undefined` → Respect `commit.gpgsign` config

### Usage Patterns

```typescript
// Check if signing is enabled
const config = await repo.git.config.getSigningConfig();
if (config.enabled) {
	console.log(`Using ${config.format} signing`);
}

// Validate before signing
const validation = await repo.git.config.validateSigningSetup();
if (!validation.valid) {
	throw new Error(`Signing not configured: ${validation.error}`);
}

// Display signature status
const signature = await commit.getSignature();
if (signature?.status === 'good') {
	console.log(`✓ Verified signature from ${signature.signer}`);
}

// Error handling
if (SigningError.is(ex, SigningErrorReason.NoKey)) {
	console.error('No signing key configured');
}
```

---

## Testing Guide

### Quick Setup

**GPG Signing:**

```bash
gpg --full-generate-key                    # Generate key
gpg --list-secret-keys --keyid-format=long # List keys
git config --global user.signingkey KEYID
git config --global commit.gpgsign true
git config --global gpg.format gpg
```

**SSH Signing (Git 2.34+):**

```bash
ssh-keygen -t ed25519 -C "your@email.com"
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
git config --global gpg.format ssh
echo "$(git config user.email) $(cat ~/.ssh/id_ed25519.pub)" > ~/.ssh/allowed_signers
git config --global gpg.ssh.allowedSignersFile ~/.ssh/allowed_signers
```

### Manual Test Cases

| Test             | Steps                                      | Expected                              |
| ---------------- | ------------------------------------------ | ------------------------------------- |
| Read Config      | `repo.git.config.getSigningConfig()`       | Returns correct SigningConfig         |
| Validate Setup   | `repo.git.config.validateSigningSetup()`   | Returns `{valid: true}` if configured |
| Parse Signature  | `repo.git.commits.getCommitSignature(sha)` | Returns CommitSignature with status   |
| Lazy Loading     | Call `commit.getSignature()` twice         | Second call returns cached value      |
| Composer Signing | Create commit with `commit.gpgsign=true`   | Commit is signed                      |
| Disable Signing  | Set `commit.gpgsign=false`, create commit  | Commit is unsigned                    |
| Force Signing    | Pass `{sign: true}` to patch methods       | Commit is signed regardless of config |
| Missing Key      | Unset `user.signingkey`, validate          | Returns error                         |

### Troubleshooting

**GPG Agent Issues:**

```bash
export GPG_TTY=$(tty)
```

**SSH Signing Issues:**

- Verify Git version ≥ 2.34: `git --version`
- Check allowed signers file exists and is readable
