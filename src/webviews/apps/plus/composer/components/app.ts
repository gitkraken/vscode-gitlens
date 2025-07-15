import { css, html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import Sortable from 'sortablejs';
import '../../../shared/components/button';
import '../../../shared/components/code-icon';
import '../../../shared/components/overlays/tooltip';
import './commit-item';
import './hunk-item';

export interface MockCommit {
	id: string;
	message: string;
	hunks: MockHunk[];
}

export interface MockHunk {
	id: string;
	fileName: string;
	content: string;
	additions: number;
	deletions: number;
}

@customElement('gl-composer-app')
export class ComposerApp extends LitElement {
	static override styles = css`
		:host {
			display: flex;
			flex-direction: column;
			height: 100vh;
			padding: 1.6rem;
			gap: 1.6rem;
		}

		.header {
			display: flex;
			justify-content: space-between;
			align-items: center;
		}

		.header h1 {
			margin: 0;
			font-size: 2.4rem;
			font-weight: 600;
		}

		.main-content {
			display: flex;
			flex: 1;
			gap: 1.6rem;
			min-height: 0;
		}

		.commits-panel {
			flex: 0 0 300px;
			display: flex;
			flex-direction: column;
			gap: 1.2rem;
		}

		.commits-list {
			flex: 1;
			overflow-y: auto;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			padding: 0.8rem;
			background: var(--vscode-editor-background);
		}

		.details-panel {
			flex: 1;
			display: flex;
			flex-direction: column;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			background: var(--vscode-editor-background);
		}

		.details-header {
			padding: 1.2rem;
			border-bottom: 1px solid var(--vscode-panel-border);
			background: var(--vscode-editorGroupHeader-tabsBackground);
		}

		.details-content {
			flex: 1;
			overflow-y: auto;
			padding: 1.2rem;
		}

		.commit-message-input {
			width: 100%;
			padding: 0.8rem;
			border: 1px solid var(--vscode-input-border);
			border-radius: 4px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			font-family: inherit;
			font-size: inherit;
			resize: vertical;
			min-height: 60px;
		}

		.commit-message-input:focus {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: -1px;
		}

		.hunks-list {
			display: flex;
			flex-direction: column;
			gap: 0.8rem;
			margin-top: 1.2rem;
		}

		.empty-state {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			height: 100%;
			color: var(--vscode-descriptionForeground);
			text-align: center;
		}

		.empty-state code-icon {
			font-size: 4.8rem;
			margin-bottom: 1.2rem;
			opacity: 0.6;
		}

		.new-commit-drop-zone {
			min-height: 60px;
			border: 2px dashed var(--vscode-panel-border);
			border-radius: 4px;
			display: flex;
			align-items: center;
			justify-content: center;
			color: var(--vscode-descriptionForeground);
			margin-top: 0.8rem;
			transition: all 0.2s ease;
		}

		.new-commit-drop-zone.drag-over {
			border-color: var(--vscode-focusBorder);
			background: var(--vscode-list-hoverBackground);
		}

		.modal-overlay {
			position: fixed;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			background: rgba(0, 0, 0, 0.5);
			display: flex;
			align-items: center;
			justify-content: center;
			z-index: 1000;
		}

		.modal {
			background: var(--vscode-editor-background);
			border: 1px solid var(--vscode-panel-border);
			border-radius: 8px;
			padding: 2.4rem;
			min-width: 300px;
			text-align: center;
		}

		.modal h2 {
			margin: 0 0 1.6rem 0;
			color: var(--vscode-foreground);
		}

		.modal p {
			margin: 0 0 2.4rem 0;
			color: var(--vscode-descriptionForeground);
		}
	`;

	@state()
	private commits: MockCommit[] = [
		{
			id: 'commit-1',
			message: 'Add user authentication system',
			hunks: [
				{
					id: 'hunk-1',
					fileName: 'src/auth/login.ts',
					content:
						'+  const validateUser = (username: string, password: string) => {\n+    return authService.validate(username, password);\n+  };',
					additions: 3,
					deletions: 0,
				},
				{
					id: 'hunk-2',
					fileName: 'src/auth/types.ts',
					content:
						'+  export interface User {\n+    id: string;\n+    username: string;\n+    email: string;\n+    role: UserRole;\n+    createdAt: Date;\n+  };\n+\n+  export interface LoginCredentials {\n+    username: string;\n+    password: string;\n+  };\n+\n+  export enum UserRole {\n+    ADMIN = "admin",\n+    USER = "user",\n+    GUEST = "guest"\n+  }',
					additions: 17,
					deletions: 0,
				},
				{
					id: 'hunk-3',
					fileName: 'src/auth/session.ts',
					content:
						'-  // TODO: Implement session management\n-  const sessions = new Map();\n+  import { v4 as uuidv4 } from "uuid";\n+\n+  interface Session {\n+    id: string;\n+    userId: string;\n+    expiresAt: Date;\n+  }\n+\n+  const sessions = new Map<string, Session>();\n+\n+  export const createSession = async (userId: string): Promise<string> => {\n+    const sessionId = uuidv4();\n+    const session: Session = {\n+      id: sessionId,\n+      userId,\n+      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours\n+    };\n+    sessions.set(sessionId, session);\n+    return sessionId;\n+  };',
					additions: 17,
					deletions: 2,
				},
			],
		},
		{
			id: 'commit-2',
			message: 'Implement user dashboard',
			hunks: [
				{
					id: 'hunk-4',
					fileName: 'src/components/Dashboard.tsx',
					content:
						'+  import React from "react";\n+  import { User } from "../auth/types";\n+  import { UserProfile } from "./UserProfile";\n+  import { ActivityFeed } from "./ActivityFeed";\n+\n+  interface DashboardProps {\n+    user: User;\n+  }\n+\n+  const Dashboard: React.FC<DashboardProps> = ({ user }) => {\n+    return (\n+      <div className="dashboard">\n+        <h1>Welcome, {user.username}!</h1>\n+        <div className="dashboard-content">\n+          <UserProfile user={user} />\n+          <ActivityFeed userId={user.id} />\n+        </div>\n+      </div>\n+    );\n+  };\n+\n+  export default Dashboard;',
					additions: 21,
					deletions: 0,
				},
				{
					id: 'hunk-5',
					fileName: 'src/components/UserProfile.tsx',
					content:
						'+  import React from "react";\n+  import { User } from "../auth/types";\n+\n+  interface UserProfileProps {\n+    user: User;\n+  }\n+\n+  export const UserProfile: React.FC<UserProfileProps> = ({ user }) => {\n+    return (\n+      <div className="user-profile">\n+        <h2>Profile</h2>\n+        <p>Email: {user.email}</p>\n+        <p>Role: {user.role}</p>\n+        <p>Member since: {user.createdAt.toLocaleDateString()}</p>\n+      </div>\n+    );\n+  };',
					additions: 16,
					deletions: 0,
				},
				{
					id: 'hunk-6',
					fileName: 'src/components/ActivityFeed.tsx',
					content:
						'-  // Placeholder component\n-  export const ActivityFeed = () => <div>Coming soon...</div>;\n+  import React, { useEffect, useState } from "react";\n+\n+  interface Activity {\n+    id: string;\n+    type: string;\n+    message: string;\n+    timestamp: Date;\n+  }\n+\n+  interface ActivityFeedProps {\n+    userId: string;\n+  }\n+\n+  export const ActivityFeed: React.FC<ActivityFeedProps> = ({ userId }) => {\n+    const [activities, setActivities] = useState<Activity[]>([]);\n+\n+    useEffect(() => {\n+      // Fetch user activities\n+      fetchActivities(userId).then(setActivities);\n+    }, [userId]);\n+\n+    return (\n+      <div className="activity-feed">\n+        <h2>Recent Activity</h2>\n+        {activities.map(activity => (\n+          <div key={activity.id} className="activity-item">\n+            <span className="activity-type">{activity.type}</span>\n+            <span className="activity-message">{activity.message}</span>\n+            <span className="activity-time">{activity.timestamp.toLocaleString()}</span>\n+          </div>\n+        ))}\n+      </div>\n+    );\n+  };',
					additions: 26,
					deletions: 2,
				},
			],
		},
		{
			id: 'commit-3',
			message: 'Add error handling and logging',
			hunks: [
				{
					id: 'hunk-7',
					fileName: 'src/utils/errors.ts',
					content:
						'+  export class AuthError extends Error {\n+    constructor(message: string) {\n+      super(message);\n+      this.name = "AuthError";\n+    }\n+  }\n+\n+  export class ValidationError extends Error {\n+    constructor(message: string, public field: string) {\n+      super(message);\n+      this.name = "ValidationError";\n+    }\n+  }\n+\n+  export class NetworkError extends Error {\n+    constructor(message: string, public statusCode?: number) {\n+      super(message);\n+      this.name = "NetworkError";\n+    }\n+  }',
					additions: 19,
					deletions: 0,
				},
				{
					id: 'hunk-8',
					fileName: 'src/utils/logger.ts',
					content:
						'-  console.log("Debug mode enabled");\\n-  const debug = true;\\n+  enum LogLevel {\\n+    ERROR = 0,\\n+    WARN = 1,\\n+    INFO = 2,\\n+    DEBUG = 3\\n+  }\\n+\\n+  class Logger {\\n+    private level: LogLevel = LogLevel.INFO;\\n+\\n+    setLevel(level: LogLevel) {\\n+      this.level = level;\\n+    }\\n+\\n+    error(message: string, ...args: any[]) {\\n+      if (this.level >= LogLevel.ERROR) {\\n+        console.error("[ERROR] " + message, ...args);\\n+      }\\n+    }\\n+\\n+    warn(message: string, ...args: any[]) {\\n+      if (this.level >= LogLevel.WARN) {\\n+        console.warn("[WARN] " + message, ...args);\\n+      }\\n+    }\\n+\\n+    info(message: string, ...args: any[]) {\\n+      if (this.level >= LogLevel.INFO) {\\n+        console.info("[INFO] " + message, ...args);\\n+      }\\n+    }\\n+\\n+    debug(message: string, ...args: any[]) {\\n+      if (this.level >= LogLevel.DEBUG) {\\n+        console.debug("[DEBUG] " + message, ...args);\\n+      }\\n+    }\\n+  }\\n+\\n+  export const logger = new Logger();',
					additions: 35,
					deletions: 2,
				},
			],
		},
		{
			id: 'commit-4',
			message: 'Update documentation and cleanup',
			hunks: [
				{
					id: 'hunk-9',
					fileName: 'README.md',
					content:
						'+  # User Management System\\n+\\n+  ## Authentication\\n+  \\n+  This application includes a comprehensive user authentication system with:\\n+  - User login and session management\\n+  - Role-based access control\\n+  - Error handling and logging\\n+\\n+  ## Features\\n+  \\n+  - User dashboard with profile information\\n+  - Activity feed\\n+  - Secure session management\\n-  TODO: Add authentication\\n-  Basic user system needed',
					additions: 13,
					deletions: 2,
				},
				{
					id: 'hunk-10',
					fileName: 'src/legacy/oldAuth.js',
					content:
						'-  // Legacy authentication code - remove this file\\n-  function authenticate(user, pass) {\\n-    if (user === "admin" && pass === "password") {\\n-      return true;\\n-    }\\n-    return false;\\n-  }\\n-\\n-  module.exports = { authenticate };',
					additions: 0,
					deletions: 9,
				},
				{
					id: 'hunk-11',
					fileName: 'package.json',
					content:
						'   "dependencies": {\\n+    "uuid": "^9.0.0",\\n+    "@types/uuid": "^9.0.0",\\n     "react": "^18.2.0",\\n-    "lodash": "^4.17.21"\\n+    "react-dom": "^18.2.0"\\n   }',
					additions: 3,
					deletions: 1,
				},
			],
		},
	];

	@state()
	private selectedCommitId: string | null = null;

	@state()
	private showModal = false;

	@state()
	private nextCommitId = 5;

	@state()
	private nextHunkId = 12;

	private commitsSortable?: Sortable;
	private hunksSortable?: Sortable;

	override firstUpdated() {
		// Delay initialization to ensure DOM is ready
		setTimeout(() => this.initializeSortable(), 200);
	}

	override updated(changedProperties: Map<string | number | symbol, unknown>) {
		super.updated(changedProperties);

		// Reinitialize drop zones when commits change
		if (changedProperties.has('commits')) {
			setTimeout(() => this.initializeCommitDropZones(), 100);
		}
	}

	override disconnectedCallback() {
		super.disconnectedCallback?.();
		this.commitsSortable?.destroy();
		this.hunksSortable?.destroy();
	}

	private initializeSortable() {
		// Initialize commits sortable
		const commitsContainer = this.shadowRoot?.querySelector('.commits-list');
		if (commitsContainer) {
			this.commitsSortable = Sortable.create(commitsContainer as HTMLElement, {
				animation: 150,
				ghostClass: 'sortable-ghost',
				chosenClass: 'sortable-chosen',
				dragClass: 'sortable-drag',
				handle: '.drag-handle', // Only allow dragging by the handle
				filter: '.new-commit-drop-zone',
				onMove: evt => {
					// Only allow moving within the commits list, not into drop zones
					const target = evt.related;
					return (
						target.tagName.toLowerCase() === 'gl-commit-item' &&
						!target.closest('.drop-zone') &&
						!target.closest('.new-commit-drop-zone')
					);
				},
				onEnd: evt => {
					if (evt.oldIndex !== undefined && evt.newIndex !== undefined && evt.oldIndex !== evt.newIndex) {
						this.reorderCommits(evt.oldIndex, evt.newIndex);
					}
				},
			});
		}

		// Initialize hunks sortable (will be re-initialized when commit is selected)
		this.initializeHunksSortable();

		// Initialize drop zones
		this.initializeAllDropZones();
	}

	private initializeHunksSortable() {
		const hunksContainer = this.shadowRoot?.querySelector('.hunks-list');
		if (hunksContainer) {
			this.hunksSortable?.destroy();
			this.hunksSortable = Sortable.create(hunksContainer as HTMLElement, {
				group: {
					name: 'hunks',
					pull: 'clone',
					put: false,
				},
				animation: 150,
				ghostClass: 'sortable-ghost',
				chosenClass: 'sortable-chosen',
				dragClass: 'sortable-drag',
				sort: false,
			});
		}
	}

	private initializeAllDropZones() {
		// Initialize new commit drop zone
		const newCommitZone = this.shadowRoot?.querySelector('.new-commit-drop-zone');
		if (newCommitZone) {
			Sortable.create(newCommitZone as HTMLElement, {
				group: {
					name: 'hunks',
					pull: false,
					put: true,
				},
				animation: 150,
				onMove: evt => {
					// Only allow hunk items to be dropped here
					return evt.dragged.tagName.toLowerCase() === 'gl-hunk-item';
				},
				onAdd: evt => {
					const hunkId = evt.item.dataset.hunkId;
					if (hunkId) {
						this.createNewCommitWithHunk(hunkId);
					}
					evt.item.remove();
				},
			});
		}

		// Initialize commit drop zones
		this.initializeCommitDropZones();
	}

	private initializeCommitDropZones() {
		// Wait a bit for the DOM to be ready
		setTimeout(() => {
			const commitElements = this.shadowRoot?.querySelectorAll('gl-commit-item');
			commitElements?.forEach(commitElement => {
				// Find the drop zone within each commit element's shadow DOM
				const dropZone = commitElement.shadowRoot?.querySelector('.drop-zone');
				if (dropZone) {
					Sortable.create(dropZone as HTMLElement, {
						group: {
							name: 'hunks',
							pull: false,
							put: true,
						},
						animation: 150,
						onMove: evt => {
							// Only allow hunk items to be dropped here
							return evt.dragged.tagName.toLowerCase() === 'gl-hunk-item';
						},
						onAdd: evt => {
							const hunkId = evt.item.dataset.hunkId;
							const targetCommitId = commitElement.dataset.commitId;
							console.log('Drop detected:', { hunkId: hunkId, targetCommitId: targetCommitId });
							if (hunkId && targetCommitId) {
								this.moveHunkToCommit(hunkId, targetCommitId);
							}
							evt.item.remove();
						},
					});
				}
			});
		}, 50);
	}

	private reorderCommits(oldIndex: number, newIndex: number) {
		const newCommits = [...this.commits];
		const [movedCommit] = newCommits.splice(oldIndex, 1);
		newCommits.splice(newIndex, 0, movedCommit);
		this.commits = newCommits;
	}

	private moveHunkToCommit(hunkId: string, targetCommitId: string) {
		console.log('Moving hunk to commit:', hunkId, '->', targetCommitId);
		const sourceCommit = this.commits.find(c => c.hunks.some(h => h.id === hunkId));
		const targetCommit = this.commits.find(c => c.id === targetCommitId);
		const hunk = sourceCommit?.hunks.find(h => h.id === hunkId);

		if (sourceCommit && targetCommit && hunk && sourceCommit.id !== targetCommitId) {
			console.log('Moving hunk from', sourceCommit.message, 'to', targetCommit.message);

			// Create new commits array to trigger reactivity
			const newCommits = [...this.commits];
			const sourceIndex = newCommits.findIndex(c => c.id === sourceCommit.id);
			const targetIndex = newCommits.findIndex(c => c.id === targetCommitId);

			if (sourceIndex >= 0 && targetIndex >= 0) {
				// Remove hunk from source commit
				newCommits[sourceIndex] = {
					...sourceCommit,
					hunks: sourceCommit.hunks.filter(h => h.id !== hunkId),
				};

				// Add hunk to target commit
				newCommits[targetIndex] = {
					...targetCommit,
					hunks: [...targetCommit.hunks, hunk],
				};

				// Remove source commit if it has no hunks left
				if (newCommits[sourceIndex].hunks.length === 0) {
					newCommits.splice(sourceIndex, 1);
				}

				this.commits = newCommits;
				console.log('Updated commits:', this.commits);

				// Force a complete re-render
				this.requestUpdate();

				// Reinitialize sortables after the update
				void this.updateComplete.then(() => {
					setTimeout(() => {
						this.initializeHunksSortable();
						this.initializeCommitDropZones();
					}, 100);
				});
			}
		}
	}

	private createNewCommitWithHunk(hunkId: string) {
		console.log('Creating new commit with hunk:', hunkId);
		const sourceCommit = this.commits.find(c => c.hunks.some(h => h.id === hunkId));
		const hunk = sourceCommit?.hunks.find(h => h.id === hunkId);

		if (sourceCommit && hunk) {
			console.log('Found source commit and hunk, creating new commit');

			// Create new commit with the hunk
			const newCommit: MockCommit = {
				id: `commit-${this.nextCommitId}`,
				message: `New Commit ${this.nextCommitId}`,
				hunks: [hunk],
			};
			this.nextCommitId++;

			// Remove hunk from source commit
			sourceCommit.hunks = sourceCommit.hunks.filter(h => h.id !== hunkId);

			// Add new commit to the list
			const newCommits = [...this.commits];
			newCommits.push(newCommit);

			// Remove source commit if it has no hunks left
			if (sourceCommit.hunks.length === 0) {
				const sourceIndex = newCommits.findIndex(c => c.id === sourceCommit.id);
				if (sourceIndex >= 0) {
					newCommits.splice(sourceIndex, 1);
				}
			}

			this.commits = newCommits;
			console.log('New commits array:', this.commits);

			// Force a complete re-render
			this.requestUpdate();

			// Reinitialize sortables after the update
			void this.updateComplete.then(() => {
				setTimeout(() => {
					this.initializeHunksSortable();
					this.initializeCommitDropZones();
				}, 100);
			});
		}
	}

	private selectCommit(commitId: string) {
		this.selectedCommitId = commitId;
		// Reinitialize sortables after the DOM updates
		void this.updateComplete.then(() => {
			setTimeout(() => {
				this.initializeHunksSortable();
				this.initializeCommitDropZones();
			}, 50);
		});
	}

	private updateCommitMessage(commitId: string, message: string) {
		const commit = this.commits.find(c => c.id === commitId);
		if (commit) {
			commit.message = message;
			this.requestUpdate();
		}
	}

	private generateCommits() {
		this.showModal = true;
	}

	private closeModal() {
		this.showModal = false;
		// Close the webview
		window.close();
	}

	override render() {
		const selectedCommit = this.selectedCommitId ? this.commits.find(c => c.id === this.selectedCommitId) : null;

		return html`
			<div class="header">
				<h1>GitLens Composer</h1>
				<gl-button appearance="primary" @click=${this.generateCommits}>
					Generate ${this.commits.length} Commits
				</gl-button>
			</div>

			<div class="main-content">
				<div class="commits-panel">
					<h3>Commits (${this.commits.length})</h3>
					<div class="commits-list">
						${repeat(
							this.commits,
							commit => commit.id,
							commit => html`
								<gl-commit-item
									.commitId=${commit.id}
									.message=${commit.message}
									.hunkCount=${commit.hunks.length}
									.selected=${this.selectedCommitId === commit.id}
									@commit-selected=${() => this.selectCommit(commit.id)}
								></gl-commit-item>
							`,
						)}
					</div>
					<div class="new-commit-drop-zone">
						<code-icon icon="plus"></code-icon>
						Drop hunk here to create new commit
					</div>
				</div>

				<div class="details-panel">
					${when(
						selectedCommit,
						() => html`
							<div class="details-header">
								<label for="commit-message">Commit Message:</label>
								<textarea
									id="commit-message"
									class="commit-message-input"
									.value=${selectedCommit!.message}
									@input=${(e: Event) =>
										this.updateCommitMessage(
											selectedCommit!.id,
											(e.target as HTMLTextAreaElement).value,
										)}
									placeholder="Enter commit message..."
								></textarea>
							</div>
							<div class="details-content">
								<h4>Files Changed (${selectedCommit!.hunks.length})</h4>
								<div class="hunks-list">
									${repeat(
										selectedCommit!.hunks,
										hunk => hunk.id,
										hunk => html`
											<gl-hunk-item
												.hunkId=${hunk.id}
												.fileName=${hunk.fileName}
												.content=${hunk.content}
												.additions=${hunk.additions}
												.deletions=${hunk.deletions}
											></gl-hunk-item>
										`,
									)}
								</div>
							</div>
						`,
						() => html`
							<div class="empty-state">
								<code-icon icon="git-commit"></code-icon>
								<h3>Select a commit to view details</h3>
								<p>Click on a commit from the list to see its files and make changes.</p>
							</div>
						`,
					)}
				</div>
			</div>

			${when(
				this.showModal,
				() => html`
					<div class="modal-overlay" @click=${this.closeModal}>
						<div class="modal" @click=${(e: Event) => e.stopPropagation()}>
							<h2>Commits Generated</h2>
							<p>${this.commits.length} commits have been generated successfully!</p>
							<gl-button appearance="primary" @click=${this.closeModal}>OK</gl-button>
						</div>
					</div>
				`,
			)}
		`;
	}
}
