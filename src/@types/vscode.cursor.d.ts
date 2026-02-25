/**
 * Type definitions for the Cursor MCP Extension API.
 * See https://cursor.com/docs/context/mcp-extension-api for details.
 */

declare module 'vscode' {
	export namespace cursor {
		export namespace mcp {
			export interface StdioServerConfig {
				name: string;
				server: {
					command: string;
					args: string[];
					env: Record<string, string>;
				};
			}

			export interface RemoteServerConfig {
				name: string;
				server: {
					url: string;
					/**
					 * Optional HTTP headers to include with every request to this server (e.g. for authentication).
					 * The keys are header names and the values are header values.
					 */
					headers?: Record<string, string>;
				};
			}

			export type ExtMCPServerConfig = StdioServerConfig | RemoteServerConfig;

			/**
			 * Register an MCP server that the Cursor extension can communicate with.
			 *
			 * The server can be exposed either over HTTP(S) (SSE/streamable HTTP) or as a local stdio process.
			 */
			export const registerServer: (config: ExtMCPServerConfig) => void;

			/**
			 * Unregister a previously registered MCP server.
			 */
			export const unregisterServer: (serverName: string) => void;
		}
	}
}
