import { Platform, type App } from "obsidian";

interface AppWithWebviewPartition extends App {
	getWebviewPartition?: () => string;
}

interface ElectronIpc {
	ipcRenderer?: {
		send: (channel: string, ...args: unknown[]) => void;
	};
}

let preparedPartition: string | null = null;

/**
 * Resolve the per-vault browser session partition that Obsidian's core
 * Web Viewer uses, and ask the main process to prepare it.
 *
 * Sessions created through the "create-browser-session" channel get a
 * cleaned user agent (no obsidian/electron tokens) and have the
 * sec-ch-ua / sec-fetch-dest headers stripped, which is required for
 * Google sign-in to work inside a webview. Sharing the partition also
 * means one sign-in is shared with the core Web Viewer and persists
 * across restarts.
 */
export function getBrowserPartition(app: App): string | null {
	if (Platform.isMobile) {
		return null;
	}

	const partition = (app as AppWithWebviewPartition).getWebviewPartition?.();
	if (!partition) {
		return null;
	}

	if (preparedPartition !== partition) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const electron = require("electron") as ElectronIpc;
			electron.ipcRenderer?.send("create-browser-session", partition, false);
			preparedPartition = partition;
		} catch {
			// Not fatal: the webview still works with the default session,
			// only Google sign-in may be rejected there.
		}
	}

	return partition;
}
