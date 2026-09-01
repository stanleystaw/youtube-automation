const line = "═".repeat(56);

export function banner(title) {
  console.log(`\n${line}\n ${title}\n${line}`);
}

export function info(message) {
  console.log(`ℹ  ${message}`);
}

export function ok(message) {
  console.log(`✓  ${message}`);
}

export function warn(message) {
  console.warn(`⚠  ${message}`);
}

export function fail(message) {
  console.error(`✗  ${message}`);
}

export function step(message) {
  console.log(`\n→  ${message}`);
}
