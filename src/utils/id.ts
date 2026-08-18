let counter = 0;

/** Short, sortable-enough ids. Nothing here needs cryptographic uniqueness. */
export function uid(prefix = ''): string {
  counter = (counter + 1) % 100000;
  const stamp = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 1679616).toString(36);
  return `${prefix}${stamp}${counter.toString(36)}${rand}`;
}
