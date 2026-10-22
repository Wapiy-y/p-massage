/** Record ids: time-prefixed so they sort naturally, with random entropy. */
export function newId(prefix = 'r'): string {
  const time = Date.now().toString(36);
  const random = [...crypto.getRandomValues(new Uint8Array(4))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${prefix}_${time}${random}`;
}
