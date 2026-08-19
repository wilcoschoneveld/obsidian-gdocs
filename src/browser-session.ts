import { Platform } from "obsidian";

/**
 * Google's sign-in endpoints reject requests whose fetch metadata looks
 * wrong: a missing `sec-fetch-dest` header (or `sec-fetch-dest: iframe`)
 * yields a static 401 "request is malformed" page, and a user agent
 * containing obsidian/electron tokens triggers the "This browser or app
 * may not be secure" block.
 *
 * Obsidian's own core Web Viewer session deletes `sec-fetch-dest` and
 * `sec-ch-ua`, which Google nowadays rejects as malformed, so instead of
 * sharing that session this plugin configures its own persistent
 * partition: the user agent keeps its genuine Chrome version (so it
 * stays consistent with the untouched `sec-ch-ua` client hints) minus
 * the obsidian/electron tokens, and `sec-fetch-dest: iframe` is
 * rewritten to `document` rather than removed.
 */
const PARTITION = "persist:gdocs-browser";

interface RequestHeadersDetails {
	requestHeaders: Record<string, string>;
}

type BeforeSendHeadersListener = (
	details: RequestHeadersDetails,
	callback: (response: { requestHeaders?: Record<string, string> }) => void,
) => void;

interface BrowserSession {
	setUserAgent(userAgent: string): void;
	webRequest: {
		onBeforeSendHeaders(listener: BeforeSendHeadersListener | null): void;
	};
}

interface ElectronRemote {
	session: {
		fromPartition(partition: string): BrowserSession;
	};
}

let configured = false;

function getRemoteSession(): BrowserSession | null {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const remote = require("@electron/remote") as ElectronRemote;
	return remote.session?.fromPartition(PARTITION) ?? null;
}

function cleanedUserAgent(): string {
	return navigator.userAgent
		.split(" ")
		.filter((token) => !/^(obsidian|electron)\//i.test(token))
		.join(" ");
}

export function getBrowserPartition(): string | null {
	if (Platform.isMobile) {
		return null;
	}

	if (!configured) {
		try {
			const session = getRemoteSession();
			if (!session) {
				console.warn("gdocs: remote session unavailable, using default session");
				return null;
			}
			session.setUserAgent(cleanedUserAgent());
			session.webRequest.onBeforeSendHeaders((details, callback) => {
				const headers = details.requestHeaders;
				for (const name of Object.keys(headers)) {
					if (name.toLowerCase() === "sec-fetch-dest" && headers[name] === "iframe") {
						headers[name] = "document";
					}
				}
				callback({ requestHeaders: headers });
			});
			configured = true;
			console.log(`gdocs: configured browser session "${PARTITION}"`);
		} catch (error) {
			// Not fatal: the webview still works with the default session,
			// only Google sign-in may be rejected there.
			console.warn("gdocs: could not configure browser session", error);
			return null;
		}
	}

	return PARTITION;
}

/**
 * Detach the header listener so a disabled/updated plugin does not leave
 * a dangling remote callback behind (requests through the session would
 * hang waiting for it).
 */
export function teardownBrowserSession(): void {
	if (!configured) {
		return;
	}
	configured = false;
	try {
		getRemoteSession()?.webRequest.onBeforeSendHeaders(null);
	} catch {
		// Session already gone; nothing to clean up.
	}
}
