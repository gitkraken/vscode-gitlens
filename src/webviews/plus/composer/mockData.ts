// Mock data for the composer following the proper data model
// This represents the structure that would come from AI rebase results

import type { ComposerCommit, ComposerHunk, ComposerHunkMap } from './protocol';

// Mock hunks following the AI rebase result structure
export const mockHunks: ComposerHunk[] = [
	// Authentication system hunks
	{
		index: 1,
		fileName: 'src/auth/validateUser.ts',
		diffHeader:
			'diff --git a/src/auth/validateUser.ts b/src/auth/validateUser.ts\nnew file mode 100644\nindex 0000000..a1b2c3d\n--- /dev/null\n+++ b/src/auth/validateUser.ts',
		hunkHeader: '@@ -0,0 +1,15 @@',
		content: `+export function validateUser(credentials: LoginCredentials): boolean {
+	if (!credentials.username || !credentials.password) {
+		return false;
+	}
+
+	// Check against user database
+	const user = getUserByUsername(credentials.username);
+	if (!user) {
+		return false;
+	}
+
+	// Verify password hash
+	return verifyPassword(credentials.password, user.passwordHash);
+}`,
		additions: 15,
		deletions: 0,
		source: 'commits',
	},
	{
		index: 2,
		fileName: 'src/types/user.ts',
		diffHeader:
			'diff --git a/src/types/user.ts b/src/types/user.ts\nnew file mode 100644\nindex 0000000..b2c3d4e\n--- /dev/null\n+++ b/src/types/user.ts',
		hunkHeader: '@@ -0,0 +1,12 @@',
		content: `+export interface User {
+	id: string;
+	username: string;
+	email: string;
+	passwordHash: string;
+	role: 'admin' | 'user' | 'guest';
+}
+
+export interface LoginCredentials {
+	username: string;
+	password: string;
+}`,
		additions: 12,
		deletions: 0,
		source: 'commits',
	},
	{
		index: 3,
		fileName: 'src/auth/session.ts',
		diffHeader:
			'diff --git a/src/auth/session.ts b/src/auth/session.ts\nnew file mode 100644\nindex 0000000..c3d4e5f\n--- /dev/null\n+++ b/src/auth/session.ts',
		hunkHeader: '@@ -0,0 +1,18 @@',
		content: `+import { v4 as uuidv4 } from 'uuid';
+
+export interface Session {
+	id: string;
+	userId: string;
+	expiresAt: Date;
+}
+
+export function createSession(userId: string): Session {
+	return {
+		id: uuidv4(),
+		userId,
+		expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
+	};
+}
+
+export function isSessionValid(session: Session): boolean {
+	return session.expiresAt > new Date();
+}`,
		additions: 18,
		deletions: 0,
		source: 'commits',
	},

	// Hunks from commit-2 (Database integration)
	{
		index: 4,
		fileName: 'src/database/connection.ts',
		diffHeader:
			'diff --git a/src/database/connection.ts b/src/database/connection.ts\nnew file mode 100644\nindex 0000000..d4e5f6g\n--- /dev/null\n+++ b/src/database/connection.ts',
		hunkHeader: '@@ -0,0 +1,20 @@',
		content: `+import { Pool } from 'pg';
+
+const pool = new Pool({
+	host: process.env.DB_HOST || 'localhost',
+	port: parseInt(process.env.DB_PORT || '5432'),
+	database: process.env.DB_NAME || 'myapp',
+	user: process.env.DB_USER || 'postgres',
+	password: process.env.DB_PASSWORD || 'password',
+});
+
+export async function query(text: string, params?: any[]) {
+	const client = await pool.connect();
+	try {
+		const result = await client.query(text, params);
+		return result;
+	} finally {
+		client.release();
+	}
+}
+
+export { pool };`,
		additions: 20,
		deletions: 0,
		source: 'commits',
	},
	{
		index: 5,
		fileName: 'src/database/migrations/001_create_users.sql',
		diffHeader:
			'diff --git a/src/database/migrations/001_create_users.sql b/src/database/migrations/001_create_users.sql\nindex 1234567..e5f6g7h 100644\n--- a/src/database/migrations/001_create_users.sql\n+++ b/src/database/migrations/001_create_users.sql',
		hunkHeader: '@@ -1,5 +1,12 @@',
		content: `+CREATE TABLE users (
+	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
+	username VARCHAR(255) UNIQUE NOT NULL,
+	email VARCHAR(255) UNIQUE NOT NULL,
+	password_hash VARCHAR(255) NOT NULL,
+	role VARCHAR(50) NOT NULL DEFAULT 'user',
+	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
+	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
+);
+
-CREATE TABLE user (
-	id SERIAL PRIMARY KEY,
-	name TEXT
-);
+CREATE INDEX idx_users_username ON users(username);`,
		additions: 10,
		deletions: 4,
		source: 'commits',
	},

	// Hunks from commit-3 (Error handling and logging)
	{
		index: 6,
		fileName: 'src/utils/errors.ts',
		diffHeader:
			'diff --git a/src/utils/errors.ts b/src/utils/errors.ts\nnew file mode 100644\nindex 0000000..f6g7h8i\n--- /dev/null\n+++ b/src/utils/errors.ts',
		hunkHeader: '@@ -0,0 +1,25 @@',
		content: `+export class AuthError extends Error {
+	constructor(message: string) {
+		super(message);
+		this.name = 'AuthError';
+	}
+}
+
+export class ValidationError extends Error {
+	constructor(message: string) {
+		super(message);
+		this.name = 'ValidationError';
+	}
+}
+
+export class NetworkError extends Error {
+	constructor(message: string) {
+		super(message);
+		this.name = 'NetworkError';
+	}
+}
+
+export function handleError(error: Error): void {
+	console.error(\`[\${error.name}] \${error.message}\`);
+	// Additional error handling logic here
+}`,
		additions: 25,
		deletions: 0,
		source: 'commits',
	},
	{
		index: 7,
		fileName: 'src/utils/logger.ts',
		diffHeader:
			'diff --git a/src/utils/logger.ts b/src/utils/logger.ts\nindex 1234567..g7h8i9j 100644\n--- a/src/utils/logger.ts\n+++ b/src/utils/logger.ts',
		hunkHeader: '@@ -1,5 +1,32 @@',
		content: `+export enum LogLevel {
+	ERROR = 0,
+	WARN = 1,
+	INFO = 2,
+	DEBUG = 3,
+}
+
-// Simple console logging
-const log = console.log;
+export class Logger {
+	private static level: LogLevel = LogLevel.INFO;
+
+	static setLevel(level: LogLevel): void {
+		this.level = level;
+	}
+
+	static error(message: string, ...args: any[]): void {
+		if (this.level >= LogLevel.ERROR) {
+			console.error(\`[ERROR] \${message}\`, ...args);
+		}
+	}
+
+	static warn(message: string, ...args: any[]): void {
+		if (this.level >= LogLevel.WARN) {
+			console.warn(\`[WARN] \${message}\`, ...args);
+		}
+	}
+
+	static info(message: string, ...args: any[]): void {
+		if (this.level >= LogLevel.INFO) {
+			console.info(\`[INFO] \${message}\`, ...args);
+		}
+	}
+
+	static debug(message: string, ...args: any[]): void {
+		if (this.level >= LogLevel.DEBUG) {
+			console.debug(\`[DEBUG] \${message}\`, ...args);
+		}
+	}
+}`,
		additions: 30,
		deletions: 2,
		source: 'commits',
	},

	// Unassigned hunks (staged/unstaged)
	{
		index: 8,
		fileName: 'src/config/database.ts',
		diffHeader:
			'diff --git a/src/config/database.ts b/src/config/database.ts\nnew file mode 100644\nindex 0000000..h8i9j0k\n--- /dev/null\n+++ b/src/config/database.ts',
		hunkHeader: '@@ -0,0 +1,8 @@',
		content: `+export const databaseConfig = {
+	maxConnections: 20,
+	connectionTimeout: 5000,
+	idleTimeout: 30000,
+	retryAttempts: 3,
+	ssl: process.env.NODE_ENV === 'production',
+};`,
		additions: 8,
		deletions: 0,
		source: 'staged',
	},
	{
		index: 9,
		fileName: 'src/middleware/auth.ts',
		diffHeader:
			'diff --git a/src/middleware/auth.ts b/src/middleware/auth.ts\nnew file mode 100644\nindex 0000000..i9j0k1l\n--- /dev/null\n+++ b/src/middleware/auth.ts',
		hunkHeader: '@@ -0,0 +1,15 @@',
		content: `+import { Request, Response, NextFunction } from 'express';
+import { verifyToken } from '../auth/jwt';
+
+export function requireAuth(req: Request, res: Response, next: NextFunction) {
+	const token = req.headers.authorization?.replace('Bearer ', '');
+
+	if (!token) {
+		return res.status(401).json({ error: 'No token provided' });
+	}
+
+	try {
+		const decoded = verifyToken(token);
+		req.user = decoded;
+		next();
+	} catch (error) {
+		return res.status(401).json({ error: 'Invalid token' });
+	}
+}`,
		additions: 15,
		deletions: 0,
		source: 'unstaged',
	},
	{
		index: 10,
		fileName: 'src/auth/validateUser.ts',
		diffHeader:
			'diff --git a/src/auth/validateUser.ts b/src/auth/validateUser.ts\nindex abcdefg..xyz9876 100644\n--- a/src/auth/validateUser.ts\n+++ b/src/auth/validateUser.ts',
		hunkHeader:
			'@@ -25,6 +25,18 @@ export async function validateUser(credentials: LoginCredentials): Promise<User',
		content: `	if (!user || !await bcrypt.compare(credentials.password, user.passwordHash)) {
	throw new Error('Invalid credentials');
}

+	// Check if user account is locked
+	if (user.isLocked) {
+		throw new Error('Account is locked');
+	}
+
+	// Update last login timestamp
+	await updateUserLastLogin(user.id);
+
+	// Log successful login
+	Logger.info('User logged in successfully', { userId: user.id, username: user.username });
+
return user;`,
		additions: 8,
		deletions: 0,
		source: 'commits',
	},
	{
		index: 11,
		fileName: 'src/utils/logger.ts',
		diffHeader:
			'diff --git a/src/utils/logger.ts b/src/utils/logger.ts\nindex g7h8i9j..m4n5o6p 100644\n--- a/src/utils/logger.ts\n+++ b/src/utils/logger.ts',
		hunkHeader: '@@ -35,4 +35,12 @@ export class Logger {',
		content: `		if (this.level >= LogLevel.DEBUG) {
		console.debug(\`[DEBUG] \${message}\`, ...args);
	}
}
+
+	static trace(message: string, ...args: any[]): void {
+		if (this.level >= LogLevel.DEBUG) {
+			console.trace(\`[TRACE] \${message}\`, ...args);
+		}
+	}
}`,
		additions: 6,
		deletions: 0,
		source: 'commits',
	},
];

// Mock commits with hunk indices
export const mockCommits: ComposerCommit[] = [
	{
		id: 'commit-1',
		message: 'Add user authentication system',
		aiExplanation:
			'This commit introduces a comprehensive user authentication system with login validation, user types, and session management. The changes include creating a validateUser function for credential checking, defining User and LoginCredentials interfaces with role-based access control, and implementing secure session management with UUID-based session IDs and expiration handling.',
		hunkIndices: [1, 10, 2, 3],
	},
	{
		id: 'commit-2',
		message: 'Implement database integration with PostgreSQL',
		aiExplanation:
			'This commit establishes database connectivity using PostgreSQL with connection pooling for optimal performance. It includes database connection configuration with environment variable support, a reusable query function with proper connection management, and initial database schema migration for the users table with appropriate indexes for efficient querying.',
		hunkIndices: [4, 5],
	},
	{
		id: 'commit-3',
		message: 'Add error handling and logging',
		aiExplanation:
			'This commit establishes a robust error handling and logging infrastructure. It introduces custom error classes (AuthError, ValidationError, NetworkError) for better error categorization and a comprehensive Logger class with different log levels (ERROR, WARN, INFO, DEBUG) to replace basic console logging with structured, configurable logging throughout the application.',
		hunkIndices: [6, 7, 11],
	},
];

// Callbacks are no longer used - replaced with IPC commands

// Mock hunk map (maps hunk indices to hunk headers for combined diff)
export const mockHunkMap: ComposerHunkMap[] = [
	{ index: 1, hunkHeader: '@@ -0,0 +1,15 @@' },
	{ index: 2, hunkHeader: '@@ -0,0 +1,12 @@' },
	{ index: 3, hunkHeader: '@@ -0,0 +1,18 @@' },
	{ index: 4, hunkHeader: '@@ -0,0 +1,20 @@' },
	{ index: 5, hunkHeader: '@@ -0,0 +1,10 @@' },
	{ index: 6, hunkHeader: '@@ -0,0 +1,25 @@' },
	{ index: 7, hunkHeader: '@@ -0,0 +1,30 @@' },
	{ index: 8, hunkHeader: '@@ -0,0 +1,8 @@' },
	{ index: 9, hunkHeader: '@@ -0,0 +1,15 @@' },
	{ index: 10, hunkHeader: '@@ -0,0 +1,12 @@' },
];

// Mock base commit
export const mockBaseCommit = {
	sha: 'abc123def456789',
	message: 'Initial commit with project setup',
	repoName: 'my-awesome-project',
	branchName: 'main',
};

// Update assigned property on mock hunks based on mock commits
function updateMockHunkAssignments() {
	// Get all assigned hunk indices from mock commits
	const assignedIndices = new Set<number>();
	mockCommits.forEach(commit => {
		commit.hunkIndices.forEach(index => assignedIndices.add(index));
	});

	// Update assigned property on hunks
	mockHunks.forEach(hunk => {
		hunk.assigned = assignedIndices.has(hunk.index);
	});
}

// Initialize the assigned property
updateMockHunkAssignments();
