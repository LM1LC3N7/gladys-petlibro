// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container):
//   - the PETLIBRO token, with the account it belongs to (a hash of the
//     e-mail), so a restart does not sign in again — each sign-in signs the
//     PETLIBRO app out of the same account;
//   - when the last sign-in happened, so a container restarting in a loop
//     still never signs in more than once per TIMINGS.loginGap.
// -----------------------------------------------------------------------------

import { readFile, rename, writeFile } from 'node:fs/promises';

export const STATE_FILE = '/data/petlibro-state.json';

export function fileStore(path = STATE_FILE) {
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, 'utf8'));
      } catch {
        return null;
      }
    },
    async save(data) {
      const temporary = `${path}.tmp`;
      await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
      await rename(temporary, path);
    },
  };
}

const finite = (value) => (Number.isFinite(value) ? value : undefined);

/** The persisted state, repaired: `{ account, session, lastLoginAt }`. */
export function normalizeMemory(raw) {
  const account = typeof raw?.account === 'string' && raw.account !== '' ? raw.account : null;
  const s = raw?.session;
  const session =
    s && typeof s.token === 'string' && s.token !== ''
      ? {
          token: s.token,
          loggedInAt: finite(s.loggedInAt) ?? 0,
          expiresAt: finite(s.expiresAt),
        }
      : null;
  return { account, session: account ? session : null, lastLoginAt: finite(raw?.lastLoginAt) };
}
