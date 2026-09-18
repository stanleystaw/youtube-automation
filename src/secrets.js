const KEY_RE = /stanleystawa_usr_[a-f0-9]+/gi;

export function stripSecrets(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    let out = value.replace(KEY_RE, "REDACTED");
    out = out.replace(/([?&]key=)[^&]+/gi, "$1REDACTED");
    return out;
  }
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (["magiclight", "raw", "data", "headers", "authorization"].includes(k)) continue;
      out[k] = stripSecrets(v);
    }
    return out;
  }
  return value;
}

export function stripKeyFromUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    u.searchParams.delete("key");
    return u.toString();
  } catch {
    return String(url).replace(/([?&]key=)[^&]+/gi, "$1");
  }
}
