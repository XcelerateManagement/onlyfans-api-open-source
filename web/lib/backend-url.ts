/**
 * The address of your own API container.
 *
 * There is deliberately no default. An unconfigured install must fail loudly at
 * startup rather than quietly falling back to somebody else's production API —
 * which is what a hardcoded hostname here would do, silently, with your
 * creators' credentials.
 *
 * Set BACKEND_URL in .env. Under the shipped docker-compose that is
 * `http://api:5000`, which is the compose network alias for the API service.
 */
export function backendUrl(): string {
  const url = process.env.BACKEND_URL;

  if (!url) {
    throw new Error(
      "BACKEND_URL is not set. Point it at your API container " +
        "(http://api:5000 under the shipped docker-compose) and restart. " +
        "There is no default on purpose — see .env.example.",
    );
  }

  return url.replace(/\/+$/, "");
}
