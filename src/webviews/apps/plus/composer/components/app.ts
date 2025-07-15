import { css, html, LitElement, nothing } from 'lit';
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
	aiExplanation?: string;
	hunks: MockHunk[];
}

export interface MockUnassignedChanges {
	mode: 'staged-unstaged' | 'unassigned';
	staged?: MockHunk[];
	unstaged?: MockHunk[];
	unassigned?: MockHunk[];
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
			min-width: 300px;
			max-width: 300px;
			display: flex;
			flex-direction: column;
			gap: 1.2rem;
			overflow: hidden;
		}

		.commits-header {
			display: flex;
			flex-direction: column;
			gap: 0.4rem;
		}

		.commits-header h3 {
			margin: 0;
		}

		.commits-header small {
			color: var(--vscode-descriptionForeground);
			font-size: 0.9em;
		}

		.commits-actions {
			min-height: 40px;
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 0.8rem;
			padding: 0.8rem;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			background: var(--vscode-editorGroupHeader-tabsBackground);
		}

		.commits-actions:empty {
			display: none;
		}

		.commits-actions gl-button {
			min-width: 160px;
			padding-left: 1.6rem;
			padding-right: 1.6rem;
		}

		.commits-list {
			flex: 1;
			overflow-y: auto;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			padding: 0.8rem;
			background: var(--vscode-editor-background);
			min-width: 0;
			box-sizing: border-box;
		}

		.details-panel {
			flex: 1;
			display: flex;
			flex-direction: column;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			background: var(--vscode-editor-background);
			overflow: hidden;
			min-width: 0;
		}

		.details-panel.split-view {
			flex-direction: row;
			overflow-x: auto;
			scroll-behavior: smooth;
		}

		.commit-details {
			flex: 1;
			display: flex;
			flex-direction: column;
			min-width: 0;
			border-right: 1px solid var(--vscode-panel-border);
		}

		/* When there are exactly 2 commits, they should fit perfectly */
		.details-panel.split-view.two-commits .commit-details {
			flex: 1;
			min-width: 0;
			max-width: 50%;
		}

		/* When there are 3 or more commits, each should be at least 50% width */
		.details-panel.split-view.many-commits .commit-details {
			flex: 0 0 50%;
			min-width: 50%;
		}

		.commit-details:last-child {
			border-right: none;
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
			max-width: 100%;
			box-sizing: border-box;
			padding: 0.6rem;
			border: 1px solid var(--vscode-input-border);
			border-radius: 4px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			font-family: inherit;
			font-size: inherit;
			resize: vertical;
			min-height: 50px;
		}

		.commit-message-input:focus {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: -1px;
		}

		.hunks-list {
			display: flex;
			flex-direction: column;
			gap: 0.6rem;
			overflow-y: auto;
			flex: 1;
			min-height: 0;
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
			box-sizing: border-box;
			width: 100%;
		}

		.new-commit-drop-zone.drag-over {
			border-color: var(--vscode-focusBorder);
			background: var(--vscode-list-hoverBackground);
		}

		/* Hide drop zone content when dragging over it */
		.new-commit-drop-zone.sortable-chosen,
		.new-commit-drop-zone:has(.sortable-ghost) {
			color: transparent;
		}

		.new-commit-drop-zone.sortable-chosen code-icon,
		.new-commit-drop-zone:has(.sortable-ghost) code-icon {
			opacity: 0;
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

		.section-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 1.2rem;
			background: var(--vscode-editorGroupHeader-tabsBackground);
			border-bottom: 1px solid var(--vscode-panel-border);
			cursor: pointer;
			user-select: none;
		}

		.section-header:hover {
			background: var(--vscode-list-hoverBackground);
		}

		.section-header h4 {
			margin: 0;
			font-size: 1.1em;
			font-weight: 600;
		}

		.section-toggle {
			color: var(--vscode-descriptionForeground);
			transition: transform 0.2s ease;
		}

		.section-toggle.expanded {
			transform: rotate(90deg);
		}

		.section-content {
			padding: 0.8rem;
			overflow: hidden;
			box-sizing: border-box;
			max-height: 300px;
			display: flex;
			flex-direction: column;
		}

		.section-content.collapsed {
			display: none;
		}

		.ai-explanation {
			color: var(--vscode-foreground);
			line-height: 1.5;
			margin: 0;
		}

		.ai-explanation.placeholder {
			color: var(--vscode-descriptionForeground);
			font-style: italic;
		}

		.unassigned-changes-item {
			padding: 1.2rem;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			background: var(--vscode-list-inactiveSelectionBackground);
			cursor: pointer;
			transition: all 0.2s ease;
			margin-bottom: 1.2rem;
			display: flex;
			align-items: center;
			gap: 0.8rem;
			user-select: none;
		}

		.unassigned-changes-item:hover {
			background: var(--vscode-list-hoverBackground);
		}

		.unassigned-changes-item.selected {
			background: var(--vscode-list-activeSelectionBackground);
			border-color: var(--vscode-focusBorder);
		}

		.unassigned-changes-item code-icon {
			color: var(--vscode-descriptionForeground);
		}

		.unassigned-changes-item .title {
			font-weight: 500;
			color: var(--vscode-foreground);
		}

		.unassigned-changes-item .count {
			color: var(--vscode-descriptionForeground);
			font-size: 0.9em;
		}

		.unassigned-changes-section {
			margin-bottom: 1.5rem;
		}

		.unassigned-changes-section:last-child {
			margin-bottom: 0;
		}
	`;

	@state()
	private unassignedChanges: MockUnassignedChanges = {
		mode: 'staged-unstaged',
		staged: [
			{
				id: 'staged-1',
				fileName: 'src/components/Header.tsx',
				content:
					'@@ -15,7 +15,7 @@ export function Header() {\n   return (\n     <header className="app-header">\n-      <h1>My App</h1>\n+      <h1>GitLens Composer</h1>\n       <nav>\n         <a href="/home">Home</a>\n         <a href="/about">About</a>',
				additions: 1,
				deletions: 1,
			},
			{
				id: 'staged-2',
				fileName: 'src/styles/theme.css',
				content:
					'@@ -8,4 +8,8 @@\n   --primary-color: #007acc;\n   --secondary-color: #f0f0f0;\n   --text-color: #333;\n+  --accent-color: #ff6b35;\n+  --border-radius: 8px;\n+  --shadow: 0 2px 4px rgba(0,0,0,0.1);\n }',
				additions: 3,
				deletions: 0,
			},
		],
		unstaged: [
			{
				id: 'unstaged-1',
				fileName: 'src/utils/helpers.ts',
				content:
					'@@ -12,6 +12,10 @@ export function formatDate(date: Date): string {\n   return date.toLocaleDateString();\n }\n \n+export function formatTime(date: Date): string {\n+  return date.toLocaleTimeString();\n+}\n+\n export function capitalize(str: string): string {\n   return str.charAt(0).toUpperCase() + str.slice(1);\n }',
				additions: 4,
				deletions: 0,
			},
			{
				id: 'unstaged-2',
				fileName: 'README.md',
				content:
					'@@ -1,4 +1,6 @@\n # My Project\n \n-This is a sample project.\n+This is a sample project built with GitLens Composer.\n+\n+## Features',
				additions: 3,
				deletions: 1,
			},
		],
		// Mock data for unassigned mode (not currently used)
		unassigned: [
			{
				id: 'unassigned-1',
				fileName: 'src/components/Button.tsx',
				content:
					'@@ -5,7 +5,7 @@ interface ButtonProps {\n }\n \n export function Button({ children, onClick }: ButtonProps) {\n-  return <button onClick={onClick}>{children}</button>;\n+  return <button className="btn" onClick={onClick}>{children}</button>;\n }',
				additions: 1,
				deletions: 1,
			},
		],
	};

	@state()
	private commits: MockCommit[] = [
		{
			id: 'commit-1',
			message: 'Add user authentication system',
			aiExplanation:
				'This commit introduces a comprehensive user authentication system with login validation, user types, and session management. The changes include creating a validateUser function for credential checking, defining User and LoginCredentials interfaces with role-based access control, and implementing secure session management with UUID-based session IDs and expiration handling.',
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
			aiExplanation:
				'This commit creates a user dashboard interface with React components for displaying user information and activity. The implementation includes a main Dashboard component that welcomes users, a UserProfile component showing user details like email and role, and an ActivityFeed component that fetches and displays recent user activities with proper state management.',
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
			aiExplanation:
				'This commit establishes a robust error handling and logging infrastructure. It introduces custom error classes (AuthError, ValidationError, NetworkError) for better error categorization and a comprehensive Logger class with different log levels (ERROR, WARN, INFO, DEBUG) to replace basic console logging with structured, configurable logging throughout the application.',
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
	private unassignedChangesSelected = false;

	@state()
	private selectedCommitIds: Set<string> = new Set();

	@state()
	private selectedHunkId: string | null = null;

	@state()
	private selectedHunkIds: Set<string> = new Set();

	@state()
	private commitMessageExpanded = true;

	@state()
	private aiExplanationExpanded = true;

	@state()
	private filesChangedExpanded = true;

	@state()
	private showModal = false;

	@state()
	private nextCommitId = 5;

	@state()
	private nextHunkId = 12;

	private commitsSortable?: Sortable;
	private hunksSortable?: Sortable;
	private autoScrollInterval?: number;
	private detailsPanel?: HTMLElement;
	private isDragging = false;
	private lastMouseEvent?: MouseEvent;

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
		// Destroy existing sortables
		this.hunksSortable?.destroy();

		// Find all hunks lists (could be multiple in split view)
		const hunksContainers = this.shadowRoot?.querySelectorAll('.hunks-list');
		if (hunksContainers && hunksContainers.length > 0) {
			hunksContainers.forEach(hunksContainer => {
				Sortable.create(hunksContainer as HTMLElement, {
					group: {
						name: 'hunks',
						pull: 'clone',
						put: true, // Allow dropping between split views
					},
					animation: 150,
					ghostClass: 'sortable-ghost',
					chosenClass: 'sortable-chosen',
					dragClass: 'sortable-drag',
					sort: false,
					onStart: evt => {
						this.isDragging = true;
						console.log('Drag started - setting up independent auto-scroll');
						const draggedHunkId = evt.item.dataset.hunkId;
						// If dragging a selected hunk and there are multiple selected, prepare multi-drag
						if (draggedHunkId && this.selectedHunkIds.has(draggedHunkId) && this.selectedHunkIds.size > 1) {
							// Store the selected hunk IDs for the drop handler
							evt.item.dataset.multiDragHunkIds = Array.from(this.selectedHunkIds).join(',');
						}

						// Start independent auto-scroll monitoring that ignores SortableJS events
						this.startIndependentAutoScroll();
					},
					onEnd: () => {
						this.isDragging = false;
						console.log('Drag ended - stopping auto-scroll');
						// Stop auto-scrolling
						this.stopIndependentAutoScroll();
					},
					onAdd: evt => {
						const hunkId = evt.item.dataset.hunkId;
						const multiDragHunkIds = evt.item.dataset.multiDragHunkIds;
						const targetCommitId = evt.to.dataset.commitId;

						if (targetCommitId) {
							if (multiDragHunkIds) {
								// Multi-drag: move all selected hunks
								const hunkIds = multiDragHunkIds.split(',');
								console.log('Multi-drop between split views:', {
									hunkIds: hunkIds,
									targetCommitId: targetCommitId,
								});
								this.moveHunksToCommit(hunkIds, targetCommitId);
							} else if (hunkId) {
								// Single drag
								console.log('Drop between split views:', {
									hunkId: hunkId,
									targetCommitId: targetCommitId,
								});
								this.moveHunkToCommit(hunkId, targetCommitId);
							}
						}
						evt.item.remove();
					},
				});
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
					const multiDragHunkIds = evt.item.dataset.multiDragHunkIds;

					if (multiDragHunkIds) {
						// Multi-drag: create new commit with all selected hunks
						const hunkIds = multiDragHunkIds.split(',');
						console.log('Multi-drop to new commit:', hunkIds);
						this.createNewCommitWithHunks(hunkIds);
					} else if (hunkId) {
						// Single drag
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
							const multiDragHunkIds = evt.item.dataset.multiDragHunkIds;
							const targetCommitId = commitElement.dataset.commitId;

							if (targetCommitId) {
								if (multiDragHunkIds) {
									// Multi-drag: move all selected hunks
									const hunkIds = multiDragHunkIds.split(',');
									console.log('Multi-drop detected:', {
										hunkIds: hunkIds,
										targetCommitId: targetCommitId,
									});
									this.moveHunksToCommit(hunkIds, targetCommitId);
								} else if (hunkId) {
									// Single drag
									console.log('Drop detected:', { hunkId: hunkId, targetCommitId: targetCommitId });
									this.moveHunkToCommit(hunkId, targetCommitId);
								}
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

	private moveHunksToCommit(hunkIds: string[], targetCommitId: string) {
		console.log('Moving hunks to commit:', hunkIds, '->', targetCommitId);

		const newCommits = [...this.commits];
		const targetCommitIndex = newCommits.findIndex(c => c.id === targetCommitId);

		if (targetCommitIndex < 0) return;

		const hunksToMove: MockHunk[] = [];
		const commitsToUpdate = new Map<string, MockCommit>();

		// Collect all hunks to move from commits and unassigned changes
		for (const hunkId of hunkIds) {
			// Check commits first
			const sourceCommit = newCommits.find(c => c.hunks.some(h => h.id === hunkId));
			let hunk = sourceCommit?.hunks.find(h => h.id === hunkId);

			if (sourceCommit && hunk && sourceCommit.id !== targetCommitId) {
				hunksToMove.push(hunk);

				if (!commitsToUpdate.has(sourceCommit.id)) {
					commitsToUpdate.set(sourceCommit.id, {
						...sourceCommit,
						hunks: sourceCommit.hunks.filter(h => !hunkIds.includes(h.id)),
					});
				}
			} else {
				// Check unassigned changes
				if (this.unassignedChanges.mode === 'staged-unstaged') {
					hunk =
						this.unassignedChanges.staged?.find(h => h.id === hunkId) ||
						this.unassignedChanges.unstaged?.find(h => h.id === hunkId);
				} else {
					hunk = this.unassignedChanges.unassigned?.find(h => h.id === hunkId);
				}

				if (hunk) {
					hunksToMove.push(hunk);
				}
			}
		}

		if (hunksToMove.length === 0) return;

		// Update source commits (remove hunks)
		for (const [commitId, updatedCommit] of commitsToUpdate) {
			const commitIndex = newCommits.findIndex(c => c.id === commitId);
			if (commitIndex >= 0) {
				newCommits[commitIndex] = updatedCommit;
			}
		}

		// Remove hunks from unassigned changes
		this.removeHunksFromUnassigned(hunkIds);

		// Add hunks to target commit
		newCommits[targetCommitIndex] = {
			...newCommits[targetCommitIndex],
			hunks: [...newCommits[targetCommitIndex].hunks, ...hunksToMove],
		};

		// Remove empty commits
		const finalCommits = newCommits.filter(c => c.hunks.length > 0);

		this.commits = finalCommits;
		this.selectedHunkIds = new Set(); // Clear selection after move
		this.selectedHunkId = null;

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

	private moveHunkToCommit(hunkId: string, targetCommitId: string) {
		this.moveHunksToCommit([hunkId], targetCommitId);
	}

	private createNewCommitWithHunks(hunkIds: string[]) {
		console.log('Creating new commit with hunks:', hunkIds);

		const newCommits = [...this.commits];
		const hunksToMove: MockHunk[] = [];
		const commitsToUpdate = new Map<string, MockCommit>();

		// Collect all hunks to move from commits and unassigned changes
		for (const hunkId of hunkIds) {
			// Check commits first
			const sourceCommit = newCommits.find(c => c.hunks.some(h => h.id === hunkId));
			let hunk = sourceCommit?.hunks.find(h => h.id === hunkId);

			if (sourceCommit && hunk) {
				hunksToMove.push(hunk);

				if (!commitsToUpdate.has(sourceCommit.id)) {
					commitsToUpdate.set(sourceCommit.id, {
						...sourceCommit,
						hunks: sourceCommit.hunks.filter(h => !hunkIds.includes(h.id)),
					});
				}
			} else {
				// Check unassigned changes
				if (this.unassignedChanges.mode === 'staged-unstaged') {
					hunk =
						this.unassignedChanges.staged?.find(h => h.id === hunkId) ||
						this.unassignedChanges.unstaged?.find(h => h.id === hunkId);
				} else {
					hunk = this.unassignedChanges.unassigned?.find(h => h.id === hunkId);
				}

				if (hunk) {
					hunksToMove.push(hunk);
				}
			}
		}

		if (hunksToMove.length === 0) return;

		// Create new commit with the hunks
		const newCommit: MockCommit = {
			id: `commit-${this.nextCommitId}`,
			message: `New Commit ${this.nextCommitId}`,
			hunks: hunksToMove,
		};
		this.nextCommitId++;

		// Update source commits (remove hunks)
		for (const [commitId, updatedCommit] of commitsToUpdate) {
			const commitIndex = newCommits.findIndex(c => c.id === commitId);
			if (commitIndex >= 0) {
				newCommits[commitIndex] = updatedCommit;
			}
		}

		// Remove hunks from unassigned changes
		this.removeHunksFromUnassigned(hunkIds);

		// Add new commit to the list
		newCommits.push(newCommit);

		// Remove empty commits
		const finalCommits = newCommits.filter(c => c.hunks.length > 0);

		this.commits = finalCommits;
		this.selectedHunkIds = new Set(); // Clear selection after move
		this.selectedHunkId = null;

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

	private createNewCommitWithHunk(hunkId: string) {
		this.createNewCommitWithHunks([hunkId]);
	}

	private selectHunk(hunkId: string, shiftKey = false) {
		if (shiftKey) {
			// Multi-select with shift key
			const newSelection = new Set(this.selectedHunkIds);

			// If we have a single selection and no multi-selection yet, add the current single selection to multi-selection
			if (this.selectedHunkId && this.selectedHunkIds.size === 0) {
				newSelection.add(this.selectedHunkId);
			}

			// Toggle the clicked hunk in multi-selection
			if (newSelection.has(hunkId)) {
				newSelection.delete(hunkId);
			} else {
				newSelection.add(hunkId);
			}

			this.selectedHunkIds = newSelection;

			// If we have multi-selection, clear single selection
			if (this.selectedHunkIds.size > 1) {
				this.selectedHunkId = null;
			} else if (this.selectedHunkIds.size === 1) {
				this.selectedHunkId = Array.from(this.selectedHunkIds)[0];
				this.selectedHunkIds = new Set(); // Clear multi-selection when back to single
			} else {
				this.selectedHunkId = null;
			}
		} else {
			// Single select (clear multi-selection)
			this.selectedHunkIds = new Set();
			this.selectedHunkId = hunkId;
		}
	}

	private selectCommit(commitId: string, shiftKey = false) {
		if (shiftKey) {
			// Multi-select with shift key
			const newSelection = new Set(this.selectedCommitIds);

			// If we have a single selection and no multi-selection yet, add the current single selection to multi-selection
			if (this.selectedCommitId && this.selectedCommitIds.size === 0) {
				newSelection.add(this.selectedCommitId);
			}

			// Toggle the clicked commit in multi-selection
			if (newSelection.has(commitId)) {
				newSelection.delete(commitId);
			} else {
				newSelection.add(commitId);
			}

			this.selectedCommitIds = newSelection;

			// If we have multi-selection, clear single selection
			if (this.selectedCommitIds.size > 1) {
				this.selectedCommitId = null;
			} else if (this.selectedCommitIds.size === 1) {
				this.selectedCommitId = Array.from(this.selectedCommitIds)[0];
				this.selectedCommitIds = new Set(); // Clear multi-selection when back to single
			} else {
				this.selectedCommitId = null;
			}
		} else {
			// Single select (clear multi-selection)
			this.selectedCommitIds = new Set();
			this.selectedCommitId = commitId;
		}

		// Clear unassigned changes selection
		this.unassignedChangesSelected = false;

		// Reinitialize sortables after the DOM updates
		void this.updateComplete.then(() => {
			setTimeout(() => {
				this.initializeHunksSortable();
				this.initializeCommitDropZones();
			}, 50);
		});
	}

	private selectUnassignedChanges() {
		// Clear commit selection
		this.selectedCommitId = null;
		this.selectedCommitIds = new Set();

		// Select unassigned changes
		this.unassignedChangesSelected = true;

		// Clear hunk selection
		this.selectedHunkId = null;
		this.selectedHunkIds = new Set();

		console.log('Selected unassigned changes');

		// Reinitialize sortables after the DOM updates to include unassigned hunks
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

	private combineSelectedCommits() {
		if (this.selectedCommitIds.size < 2) return;

		const selectedCommits = this.commits.filter(c => this.selectedCommitIds.has(c.id));
		const firstCommitIndex = this.commits.findIndex(c => c.id === selectedCommits[0].id);

		// Combine all hunks from selected commits
		const combinedHunks: MockHunk[] = [];
		selectedCommits.forEach(commit => {
			combinedHunks.push(...commit.hunks);
		});

		// Create new combined commit
		const combinedCommit: MockCommit = {
			id: `commit-${this.nextCommitId}`,
			message: `New Commit ${this.nextCommitId}`,
			hunks: combinedHunks,
		};
		this.nextCommitId++;

		// Remove selected commits and insert combined commit at the position of the first selected commit
		const newCommits = this.commits.filter(c => !this.selectedCommitIds.has(c.id));
		newCommits.splice(firstCommitIndex, 0, combinedCommit);

		this.commits = newCommits;
		this.selectedCommitIds = new Set();
		this.selectedCommitId = combinedCommit.id;

		console.log('Combined commits into:', combinedCommit);
	}

	private toggleCommitMessageExpanded() {
		this.commitMessageExpanded = !this.commitMessageExpanded;
	}

	private toggleAiExplanationExpanded() {
		this.aiExplanationExpanded = !this.aiExplanationExpanded;
	}

	private toggleFilesChangedExpanded() {
		this.filesChangedExpanded = !this.filesChangedExpanded;
	}

	private renderUnassignedChangesItem() {
		if (!this.hasUnassignedChanges) {
			return nothing;
		}

		const totalHunks =
			this.unassignedChanges.mode === 'staged-unstaged'
				? (this.unassignedChanges.staged?.length ?? 0) + (this.unassignedChanges.unstaged?.length ?? 0)
				: (this.unassignedChanges.unassigned?.length ?? 0);

		return html`
			<div
				class="unassigned-changes-item ${this.unassignedChangesSelected ? 'selected' : ''}"
				@click=${this.selectUnassignedChanges}
			>
				<code-icon icon="git-branch"></code-icon>
				<div class="title">Unassigned Changes</div>
				<div class="count">(${totalHunks} hunks)</div>
			</div>
		`;
	}

	private renderUnassignedChangesDetails() {
		if (!this.unassignedChangesSelected || !this.hasUnassignedChanges) {
			return nothing;
		}

		return html`
			${this.unassignedChanges.mode === 'staged-unstaged'
				? html`
						${this.unassignedChanges.staged && this.unassignedChanges.staged.length > 0
							? html`
									<!-- Staged Changes Section -->
									<div class="unassigned-changes-section">
										<div class="section-header" @click=${this.toggleCommitMessageExpanded}>
											<h4>Staged Changes (${this.unassignedChanges.staged.length})</h4>
											<code-icon
												class="section-toggle ${this.commitMessageExpanded ? 'expanded' : ''}"
												icon="chevron-right"
											></code-icon>
										</div>
										<div class="section-content ${this.commitMessageExpanded ? '' : 'collapsed'}">
											<div class="hunks-list" data-source="staged">
												${repeat(
													this.unassignedChanges.staged,
													hunk => hunk.id,
													hunk => html`
														<gl-hunk-item
															.hunkId=${hunk.id}
															.fileName=${hunk.fileName}
															.content=${hunk.content}
															.additions=${hunk.additions}
															.deletions=${hunk.deletions}
															.selected=${this.selectedHunkId === hunk.id ||
															this.selectedHunkIds.has(hunk.id)}
															.multiSelected=${this.selectedHunkIds.has(hunk.id)}
															@hunk-selected=${(e: CustomEvent) =>
																this.selectHunk(hunk.id, e.detail.shiftKey)}
														></gl-hunk-item>
													`,
												)}
											</div>
										</div>
									</div>
								`
							: nothing}
						${this.unassignedChanges.unstaged && this.unassignedChanges.unstaged.length > 0
							? html`
									<!-- Unstaged Changes Section -->
									<div class="unassigned-changes-section">
										<div class="section-header" @click=${this.toggleAiExplanationExpanded}>
											<h4>Unstaged Changes (${this.unassignedChanges.unstaged.length})</h4>
											<code-icon
												class="section-toggle ${this.aiExplanationExpanded ? 'expanded' : ''}"
												icon="chevron-right"
											></code-icon>
										</div>
										<div class="section-content ${this.aiExplanationExpanded ? '' : 'collapsed'}">
											<div class="hunks-list" data-source="unstaged">
												${repeat(
													this.unassignedChanges.unstaged,
													hunk => hunk.id,
													hunk => html`
														<gl-hunk-item
															.hunkId=${hunk.id}
															.fileName=${hunk.fileName}
															.content=${hunk.content}
															.additions=${hunk.additions}
															.deletions=${hunk.deletions}
															.selected=${this.selectedHunkId === hunk.id ||
															this.selectedHunkIds.has(hunk.id)}
															.multiSelected=${this.selectedHunkIds.has(hunk.id)}
															@hunk-selected=${(e: CustomEvent) =>
																this.selectHunk(hunk.id, e.detail.shiftKey)}
														></gl-hunk-item>
													`,
												)}
											</div>
										</div>
									</div>
								`
							: nothing}
					`
				: html`
						<!-- Unassigned Changes Section -->
						<div class="unassigned-changes-section">
							<div class="section-header" @click=${this.toggleFilesChangedExpanded}>
								<h4>Unassigned Changes (${this.unassignedChanges.unassigned?.length ?? 0})</h4>
								<code-icon
									class="section-toggle ${this.filesChangedExpanded ? 'expanded' : ''}"
									icon="chevron-right"
								></code-icon>
							</div>
							<div class="section-content ${this.filesChangedExpanded ? '' : 'collapsed'}">
								<div class="hunks-list" data-source="unassigned">
									${repeat(
										this.unassignedChanges.unassigned ?? [],
										hunk => hunk.id,
										hunk => html`
											<gl-hunk-item
												.hunkId=${hunk.id}
												.fileName=${hunk.fileName}
												.content=${hunk.content}
												.additions=${hunk.additions}
												.deletions=${hunk.deletions}
												.selected=${this.selectedHunkId === hunk.id ||
												this.selectedHunkIds.has(hunk.id)}
												.multiSelected=${this.selectedHunkIds.has(hunk.id)}
												@hunk-selected=${(e: CustomEvent) =>
													this.selectHunk(hunk.id, e.detail.shiftKey)}
											></gl-hunk-item>
										`,
									)}
								</div>
							</div>
						</div>
					`}
		`;
	}

	private renderCommitDetails(commit: MockCommit) {
		return html`
			<div class="commit-details" data-commit-id=${commit.id}>
				<!-- Commit Message Section -->
				<div class="section-header" @click=${this.toggleCommitMessageExpanded}>
					<h4>Commit Message</h4>
					<code-icon
						class="section-toggle ${this.commitMessageExpanded ? 'expanded' : ''}"
						icon="chevron-right"
					></code-icon>
				</div>
				<div class="section-content ${this.commitMessageExpanded ? '' : 'collapsed'}">
					<textarea
						class="commit-message-input"
						.value=${commit.message}
						@input=${(e: Event) =>
							this.updateCommitMessage(commit.id, (e.target as HTMLTextAreaElement).value)}
						placeholder="Enter commit message..."
					></textarea>
				</div>

				<!-- AI Explanation Section -->
				<div class="section-header" @click=${this.toggleAiExplanationExpanded}>
					<h4>AI Explanation</h4>
					<code-icon
						class="section-toggle ${this.aiExplanationExpanded ? 'expanded' : ''}"
						icon="chevron-right"
					></code-icon>
				</div>
				<div class="section-content ${this.aiExplanationExpanded ? '' : 'collapsed'}">
					<p class="ai-explanation ${commit.aiExplanation ? '' : 'placeholder'}">
						${commit.aiExplanation || 'No AI explanation available for this commit.'}
					</p>
				</div>

				<!-- Files Changed Section -->
				<div class="section-header" @click=${this.toggleFilesChangedExpanded}>
					<h4>Files Changed (${commit.hunks.length})</h4>
					<code-icon
						class="section-toggle ${this.filesChangedExpanded ? 'expanded' : ''}"
						icon="chevron-right"
					></code-icon>
				</div>
				<div class="section-content ${this.filesChangedExpanded ? '' : 'collapsed'}">
					<div class="hunks-list" data-commit-id=${commit.id}>
						${repeat(
							commit.hunks,
							hunk => hunk.id,
							hunk => html`
								<gl-hunk-item
									.hunkId=${hunk.id}
									.fileName=${hunk.fileName}
									.content=${hunk.content}
									.additions=${hunk.additions}
									.deletions=${hunk.deletions}
									.selected=${this.selectedHunkId === hunk.id || this.selectedHunkIds.has(hunk.id)}
									.multiSelected=${this.selectedHunkIds.has(hunk.id)}
									@hunk-selected=${(e: CustomEvent) => this.selectHunk(hunk.id, e.detail.shiftKey)}
								></gl-hunk-item>
							`,
						)}
					</div>
				</div>
			</div>
		`;
	}

	private stopAutoScroll() {
		// Legacy method - now handled by stopIndependentAutoScroll
		if (this.autoScrollInterval) {
			clearInterval(this.autoScrollInterval);
			this.autoScrollInterval = undefined;
		}
	}

	private independentScrollActive = false;
	private mouseTracker = (e: MouseEvent) => {
		this.lastMouseEvent = e;
		console.log(
			'Mouse tracker called:',
			e.clientX,
			e.clientY,
			'isDragging:',
			this.isDragging,
			'scrollActive:',
			this.independentScrollActive,
		);
		// Immediately check for auto-scroll on every mouse move
		if (this.independentScrollActive && this.isDragging) {
			console.log('Calling performIndependentAutoScroll');
			this.performIndependentAutoScroll(e.clientX, e.clientY);
		}
	};

	private startIndependentAutoScroll() {
		console.log('🚀 Starting AGGRESSIVE independent auto-scroll system');
		console.log('Setting independentScrollActive to true, isDragging:', this.isDragging);
		this.independentScrollActive = true;

		// Track mouse position with maximum priority
		console.log('Adding mousemove event listener');
		document.addEventListener('mousemove', this.mouseTracker, {
			passive: false, // Not passive so we can preventDefault if needed
			capture: true,
		});

		console.log('Starting requestAnimationFrame loop');
		// Also use requestAnimationFrame for maximum responsiveness
		const animationLoop = () => {
			if (!this.independentScrollActive || !this.isDragging) {
				console.log(
					'Animation loop stopping - scrollActive:',
					this.independentScrollActive,
					'isDragging:',
					this.isDragging,
				);
				return;
			}

			if (this.lastMouseEvent) {
				this.performIndependentAutoScroll(this.lastMouseEvent.clientX, this.lastMouseEvent.clientY);
			}

			requestAnimationFrame(animationLoop);
		};

		requestAnimationFrame(animationLoop);
	}

	private stopIndependentAutoScroll() {
		console.log('Stopping independent auto-scroll system');

		this.independentScrollActive = false;

		document.removeEventListener('mousemove', this.mouseTracker, true);
		this.stopAutoScroll();
	}

	private performIndependentAutoScroll(mouseX: number, mouseY: number) {
		console.log('🔍 performIndependentAutoScroll called with:', mouseX, mouseY);
		// SIMPLE approach - just check distance from container edges
		const scrollThreshold = 200; // Large trigger area - 200px from edges

		// Horizontal scrolling - check distance from split view container edges
		const detailsPanel = this.shadowRoot?.querySelector('.details-panel.split-view') as HTMLElement;
		if (detailsPanel && this.selectedCommitIds.size >= 2) {
			const rect = detailsPanel.getBoundingClientRect();

			// Simple distance calculation from container edges
			const leftDistance = mouseX - rect.left;
			const rightDistance = rect.right - mouseX;

			console.log(
				'Mouse position:',
				mouseX,
				'Container:',
				rect.left,
				'to',
				rect.right,
				'Distances:',
				leftDistance,
				rightDistance,
			);

			// Left edge scrolling
			if (leftDistance >= 0 && leftDistance < scrollThreshold && detailsPanel.scrollLeft > 0) {
				detailsPanel.scrollLeft = Math.max(0, detailsPanel.scrollLeft - 25);
				console.log(
					'SCROLLING LEFT - distance from left edge:',
					leftDistance,
					'new scrollLeft:',
					detailsPanel.scrollLeft,
				);
				return;
			}

			// Right edge scrolling
			if (rightDistance >= 0 && rightDistance < scrollThreshold) {
				const maxScroll = detailsPanel.scrollWidth - detailsPanel.clientWidth;
				if (detailsPanel.scrollLeft < maxScroll) {
					detailsPanel.scrollLeft = Math.min(maxScroll, detailsPanel.scrollLeft + 25);
					console.log(
						'SCROLLING RIGHT - distance from right edge:',
						rightDistance,
						'new scrollLeft:',
						detailsPanel.scrollLeft,
						'max:',
						maxScroll,
					);
					return;
				}
			}
		}

		// Vertical scrolling - simple approach for commits panel
		const commitsPanel = this.shadowRoot?.querySelector('.commits-panel') as HTMLElement;
		if (commitsPanel) {
			const rect = commitsPanel.getBoundingClientRect();
			const topDistance = mouseY - rect.top;
			const bottomDistance = rect.bottom - mouseY;

			// Top edge scrolling
			if (topDistance >= 0 && topDistance < scrollThreshold && commitsPanel.scrollTop > 0) {
				commitsPanel.scrollTop = Math.max(0, commitsPanel.scrollTop - 15);
			}
			// Bottom edge scrolling
			else if (bottomDistance >= 0 && bottomDistance < scrollThreshold) {
				const maxScroll = commitsPanel.scrollHeight - commitsPanel.clientHeight;
				if (commitsPanel.scrollTop < maxScroll) {
					commitsPanel.scrollTop = Math.min(maxScroll, commitsPanel.scrollTop + 15);
				}
			}
		}
	}

	private get hasUnassignedChanges(): boolean {
		if (this.unassignedChanges.mode === 'staged-unstaged') {
			return (
				(this.unassignedChanges.staged?.length ?? 0) > 0 || (this.unassignedChanges.unstaged?.length ?? 0) > 0
			);
		}
		return (this.unassignedChanges.unassigned?.length ?? 0) > 0;
	}

	private get canFinishAndCommit(): boolean {
		// In unassigned mode, all changes must be assigned before finishing
		if (this.unassignedChanges.mode === 'unassigned') {
			return !this.hasUnassignedChanges;
		}
		// In staged-unstaged mode, user can finish even with unassigned changes
		return true;
	}

	private removeHunksFromUnassigned(hunkIds: string[]) {
		if (this.unassignedChanges.mode === 'staged-unstaged') {
			if (this.unassignedChanges.staged) {
				this.unassignedChanges.staged = this.unassignedChanges.staged.filter(h => !hunkIds.includes(h.id));
			}
			if (this.unassignedChanges.unstaged) {
				this.unassignedChanges.unstaged = this.unassignedChanges.unstaged.filter(h => !hunkIds.includes(h.id));
			}
		} else if (this.unassignedChanges.unassigned) {
			this.unassignedChanges.unassigned = this.unassignedChanges.unassigned.filter(h => !hunkIds.includes(h.id));
		}
	}

	private closeModal() {
		this.showModal = false;
		// Close the webview
		window.close();
	}

	override render() {
		const selectedCommit = this.selectedCommitId ? this.commits.find(c => c.id === this.selectedCommitId) : null;
		const selectedCommits = Array.from(this.selectedCommitIds)
			.map(id => this.commits.find(c => c.id === id))
			.filter(Boolean) as MockCommit[];
		const isMultiSelect = this.selectedCommitIds.size > 1;

		return html`
			<div class="header">
				<h1>GitLens Composer</h1>
			</div>

			<div class="main-content">
				<div class="commits-panel">
					<div class="commits-header">
						<h3>Commits (${this.commits.length})</h3>
						<small>Shift+click to multi-select</small>
					</div>
					<div class="commits-actions">
						${when(
							this.selectedCommitIds.size > 1,
							() => html`
								<gl-button appearance="secondary" @click=${this.combineSelectedCommits}>
									Combine ${this.selectedCommitIds.size} Commits
								</gl-button>
							`,
							() => html`
								<gl-button
									appearance="primary"
									?disabled=${!this.canFinishAndCommit}
									@click=${this.generateCommits}
								>
									Finish and Commit
								</gl-button>
							`,
						)}
					</div>
					${this.renderUnassignedChangesItem()}
					<div class="commits-list">
						${repeat(
							this.commits,
							commit => commit.id,
							commit => html`
								<gl-commit-item
									.commitId=${commit.id}
									.message=${commit.message}
									.hunkCount=${commit.hunks.length}
									.selected=${this.selectedCommitId === commit.id ||
									this.selectedCommitIds.has(commit.id)}
									.multiSelected=${this.selectedCommitIds.has(commit.id)}
									@commit-selected=${(e: CustomEvent) =>
										this.selectCommit(commit.id, e.detail.shiftKey)}
								></gl-commit-item>
							`,
						)}
					</div>
					<div class="new-commit-drop-zone">Drop hunk here to create new commit</div>
				</div>

				<div
					class="details-panel ${isMultiSelect ? 'split-view' : ''} ${selectedCommits.length === 2
						? 'two-commits'
						: selectedCommits.length > 2
							? 'many-commits'
							: ''}"
				>
					${when(
						this.unassignedChangesSelected,
						() => this.renderUnassignedChangesDetails(),
						() =>
							when(
								isMultiSelect,
								() => html`
									${repeat(
										selectedCommits,
										commit => commit.id,
										commit => this.renderCommitDetails(commit),
									)}
								`,
								() =>
									when(
										selectedCommit,
										() => this.renderCommitDetails(selectedCommit!),
										() => html`
											<div class="empty-state">
												<code-icon icon="git-commit"></code-icon>
												<h3>Select a commit to view details</h3>
												<p>
													Click on a commit from the list to see its files and make changes.
												</p>
											</div>
										`,
									),
							),
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
