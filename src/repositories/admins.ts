/** Data access for admin accounts. */
export interface AdminRow {
  id: string;
  username: string;
  password_hash: string;
}

export async function findByUsername(db: D1Database, username: string): Promise<AdminRow | null> {
  return await db
    .prepare('SELECT id, username, password_hash FROM admins WHERE username = ?')
    .bind(username)
    .first<AdminRow>();
}
