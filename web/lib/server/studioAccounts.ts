import fs from 'node:fs/promises';
import path from 'node:path';

const platforms = [
  ['upwork', 'Upwork', 'www.upwork.com', '/nx/create-profile/', '/nx/payments/disbursement-methods'],
  ['fiverr', 'Fiverr', 'www.fiverr.com', '/login', '/users/me/seller_dashboard'],
  ['contra', 'Contra', 'contra.com', '/', '/wallet'],
  ['peopleperhour', 'PeoplePerHour', 'www.peopleperhour.com', '/member-application', '/settings/payments'],
  ['freelancer', 'Freelancer', 'www.freelancer.com', '/signup', '/payments/withdraw'],
] as const;

export type StudioAccount = {
  id: string; name: string; accountStatus: string; profileStatus: string;
  payoutStatus: string; setupUrl: string; payoutUrl: string; nextStep: string; checkedAt: string;
};

function unavailableAccounts(): StudioAccount[] {
  return platforms.map(([id, name, host, setup, payout]) => ({
    id, name, accountStatus: 'Evidence unavailable · readiness unknown',
    profileStatus: 'Not verified', payoutStatus: 'Not verified',
    setupUrl: `https://${host}${setup}`, payoutUrl: `https://${host}${payout}`,
    nextStep: 'Account evidence is missing or invalid. Restore data/studio/accounts.json or verify the existing account directly; do not create a duplicate account.',
    checkedAt: '',
  }));
}

export function parseStudioAccounts(value: unknown): StudioAccount[] {
  if (!Array.isArray(value) || value.length !== platforms.length) throw new Error('Invalid account evidence');
  return platforms.map(([id, name, host]) => {
    const matches = value.filter(row => row && typeof row === 'object' && row.id === id);
    if (matches.length !== 1) throw new Error('Missing or duplicate account evidence');
    const row = matches[0];
    const fields = ['id', 'name', 'accountStatus', 'profileStatus', 'payoutStatus', 'setupUrl', 'payoutUrl', 'nextStep', 'checkedAt'] as const;
    for (const field of fields) {
      if (typeof row[field] !== 'string' || !row[field].trim() || row[field].length > 3000) throw new Error('Invalid account field');
    }
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(row.checkedAt);
    const canonicalDate = dateOnly ? `${row.checkedAt}T00:00:00.000Z` : row.checkedAt;
    if (row.name !== name || (!dateOnly && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.checkedAt))
      || !Number.isFinite(Date.parse(canonicalDate)) || new Date(canonicalDate).toISOString() !== canonicalDate) throw new Error('Invalid account observation');
    for (const field of ['setupUrl', 'payoutUrl']) {
      const url = new URL(row[field]);
      if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password) throw new Error('Invalid account destination');
    }
    // Project only the public schema; never echo arbitrary runtime fields/secrets.
    return Object.fromEntries(fields.map(field => [field, row[field]])) as StudioAccount;
  });
}

/** Read on every request: account evidence must not be bundled into a build. */
export async function readStudioAccounts(root = process.cwd()): Promise<StudioAccount[]> {
  try {
    const raw = await fs.readFile(path.join(root, 'data/studio/accounts.json'), 'utf8');
    if (raw.length > 64_000) throw new Error('Account evidence too large');
    return parseStudioAccounts(JSON.parse(raw));
  } catch {
    return unavailableAccounts();
  }
}
