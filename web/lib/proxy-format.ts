// Client-side proxy format check, mirroring the backend's validate_proxy
// (onlyfans-api/crm_api.py): it accepts the same shapes the server accepts,
// repairs the copy-paste mistakes that have exactly one sensible reading, and
// explains everything else in plain words while the operator is still typing.
//
// The server still validates. This exists so a malformed proxy is caught in
// the form, not after a 20-second login attempt (or, worse, silently dropped).

export type ProxyCheck =
  | {
      ok: true;
      /** What to send to the API. */
      value: string;
      /** `value` with the password hidden, for display. */
      masked: string;
      /** Human-readable repairs applied to the input, if any. */
      fixes: string[];
      /** No username/password — only works with an IP-whitelisted proxy. */
      noAuth: boolean;
    }
  | { ok: false; error: string };

export const PROXY_EXAMPLE = "http://user:pass@host:port";

const SCHEMES = ["http", "https", "socks5", "socks5h"];
const HOST_RE = /^[A-Za-z0-9._-]+$/;

const fail = (error: string): ProxyCheck => ({ ok: false, error });

function validPort(p: string): boolean {
  return /^\d{1,5}$/.test(p) && Number(p) >= 1 && Number(p) <= 65535;
}

/** A hostname or IP — used only to tell the parts of a scrambled proxy apart. */
function looksLikeHost(h: string): boolean {
  return HOST_RE.test(h) && h.includes(".");
}

function isHostPort(s: string): boolean {
  const parts = s.split(":");
  return parts.length === 2 && looksLikeHost(parts[0]) && validPort(parts[1]);
}

export function checkProxy(raw: string): ProxyCheck {
  const fixes: string[] = [];
  let s = raw.trim();

  const unquoted = s.replace(/^["'`<]+|["'`>]+$/g, "").trim();
  if (unquoted !== s) {
    s = unquoted;
    fixes.push("removed the surrounding quotes");
  }
  if (!s) return fail("Enter a proxy.");
  if (/\s/.test(s)) {
    return fail(
      /\n/.test(raw.trim())
        ? "That looks like more than one line — paste a single proxy."
        : "A proxy can't contain spaces — remove them.",
    );
  }

  // Scheme. `http//host` and `http:/host` are typos of `http://host`.
  const typo = /^(https?|socks5h?)(?::\/(?!\/)|\/\/)/i.exec(s);
  if (typo) {
    s = `${typo[1]}://${s.slice(typo[0].length)}`;
    fixes.push(`fixed "${typo[0]}" to "${typo[1].toLowerCase()}://"`);
  }
  let scheme = "http";
  let hadScheme = false;
  let rest = s;
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/.exec(s);
  if (m) {
    hadScheme = true;
    scheme = m[1].toLowerCase();
    rest = m[2];
    if (/^socks4a?$|^socks$/.test(scheme)) {
      return fail(`${m[1]}:// isn't supported — use socks5:// or http://.`);
    }
    if (!SCHEMES.includes(scheme)) {
      return fail(`"${m[1]}://" isn't a proxy type we support — use http:// or socks5://.`);
    }
    if (m[1] !== scheme) fixes.push(`lower-cased ${scheme}://`);
  }
  if (/\/+$/.test(rest)) {
    rest = rest.replace(/\/+$/, "");
    fixes.push("removed the trailing /");
  }

  let host: string;
  let port: string;
  let user: string | null = null;
  let pass = "";
  // Set when the input used one of the colon-separated four-part layouts.
  let colonLayout = false;

  // host:port:user:pass is recognised first: its password may contain "@",
  // which must not be read as a URL userinfo separator.
  const colonParts = rest.split(":");
  const n = colonParts.length;
  const endsWithHostPort = n >= 4 && looksLikeHost(colonParts[n - 2]) && validPort(colonParts[n - 1]);
  const compact =
    n >= 4 &&
    HOST_RE.test(colonParts[0]) &&
    validPort(colonParts[1]) &&
    // "user:12345:1.2.3.4:8080" is user:pass:host:port with a numeric password.
    (looksLikeHost(colonParts[0]) || !endsWithHostPort);
  const at = compact ? -1 : rest.lastIndexOf("@");
  if (at >= 0) {
    let left = rest.slice(0, at);
    let right = rest.slice(at + 1);
    if (isHostPort(left) && !isHostPort(right)) {
      [left, right] = [right, left];
      fixes.push("put user:pass before host:port");
    }
    const hp = right.split(":");
    if (hp.length !== 2 || !hp[0] || !hp[1]) {
      return fail(`After the "@" the proxy needs host:port — e.g. ${PROXY_EXAMPLE}.`);
    }
    [host, port] = hp;
    const colon = left.indexOf(":");
    if (colon <= 0) return fail(`The username or password is missing — use ${PROXY_EXAMPLE}.`);
    user = left.slice(0, colon);
    pass = left.slice(colon + 1);
    if (!pass) return fail(`The password is missing — use ${PROXY_EXAMPLE}.`);
  } else {
    const parts = colonParts;
    if (parts.length === 2) {
      [host, port] = parts;
    } else if (compact) {
      // host:port:user:pass — the password may itself contain ":".
      [host, port, user] = parts;
      pass = parts.slice(3).join(":");
      colonLayout = true;
      if (hadScheme) fixes.push("rewrote host:port:user:pass as a URL");
    } else if (
      parts.length >= 4 &&
      validPort(parts[parts.length - 1]) &&
      looksLikeHost(parts[parts.length - 2])
    ) {
      // user:pass:host:port — a common provider export order.
      host = parts[parts.length - 2];
      port = parts[parts.length - 1];
      user = parts[0];
      pass = parts.slice(1, -2).join(":");
      colonLayout = true;
      fixes.push("reordered user:pass:host:port to host:port:user:pass");
    } else if (parts.length === 3) {
      return fail("One part is missing — use host:port:user:pass or " + PROXY_EXAMPLE + ".");
    } else if (parts.length === 1) {
      return fail("The port is missing — use host:port:user:pass or " + PROXY_EXAMPLE + ".");
    } else {
      return fail(
        "Couldn't tell which part is the host and which is the port — use host:port:user:pass or " +
          PROXY_EXAMPLE +
          ".",
      );
    }
    if (user !== null && (!user || !pass)) {
      return fail("The username or password is empty — use host:port:user:pass.");
    }
  }

  if (host.includes("/") || port.includes("/")) {
    return fail("Remove everything after host:port — a proxy address has no path.");
  }
  if (!host || !HOST_RE.test(host)) {
    return fail(`"${host}" isn't a valid proxy host.`);
  }
  if (!validPort(port)) {
    return fail(`The port "${port}" must be a number from 1 to 65535.`);
  }
  if (!hadScheme && !colonLayout) fixes.push("added http://");

  const auth = user !== null ? `${user}:${pass}@` : "";
  const maskedAuth = user !== null ? `${user}:${"•".repeat(Math.min(pass.length, 8))}@` : "";
  return {
    ok: true,
    value: `${scheme}://${auth}${host}:${port}`,
    masked: `${scheme}://${maskedAuth}${host}:${port}`,
    fixes,
    noAuth: user === null,
  };
}
