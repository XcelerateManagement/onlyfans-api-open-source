export class HttpError extends Error {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = this.constructor.name;
  }
}

export class AuthError extends HttpError {
  /** Optional WWW-Authenticate challenge to attach on the 401 response.
   *  Populated by the OAuth verifier per RFC 6750 §3 so clients can
   *  discover the protected-resource metadata and re-run the flow. */
  public readonly challenge?: string;
  constructor(message: string, opts?: { challenge?: string }) {
    super(401, message);
    this.challenge = opts?.challenge;
  }
}

export class RateLimitError extends HttpError {
  constructor(message = "Rate limit exceeded for this tool") { super(429, message); }
}

export class BackendError extends HttpError {
  public readonly bodySnippet?: string;
  constructor(status: number, message: string, bodySnippet?: string) {
    super(status, message);
    this.bodySnippet = bodySnippet;
  }
}

export class ToolDeniedError extends HttpError {
  constructor(message: string) { super(403, message); }
}
