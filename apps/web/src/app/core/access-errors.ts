/** Intentional cancellation of work whose access context has been superseded. */
export class AccessChangedError extends Error { constructor() { super('Access changed; this response was discarded.'); } }
export class AccessUnavailableError extends Error { constructor() { super('Access cannot currently be verified. Please wait for the connection to recover.'); } }
