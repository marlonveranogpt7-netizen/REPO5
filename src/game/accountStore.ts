export interface UserAccount {
  username: string;
  coins: number;
  wins: number;
  kills: number;
  matchesPlayed: number;
  unlockedSkins?: string[];
  createdAt: number;
  lastLoginAt: number;
}

export interface AccountStoreState {
  activeUsername: string | null;
  accounts: Record<string, UserAccount>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CoinRewardBreakdown {
  base: number;
  winBonus: number;
  koBonus: number;
  damageBonus: number;
  total: number;
}

export const ACCOUNT_STORAGE_KEY = 'koopal_clash_accounts_v1';
export const STARTING_COINS = 100;

function getDefaultStorage(): StorageLike | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, 14);
}

export function normalizeAccountKey(raw: string): string {
  return normalizeUsername(raw).toLowerCase();
}

export function loadAccountStore(storage: StorageLike | null = getDefaultStorage()): AccountStoreState {
  if (!storage) {
    return { activeUsername: null, accounts: {} };
  }
  try {
    const raw = storage.getItem(ACCOUNT_STORAGE_KEY);
    if (!raw) return { activeUsername: null, accounts: {} };
    const parsed = JSON.parse(raw) as Partial<AccountStoreState>;
    const accounts: Record<string, UserAccount> = {};
    if (parsed.accounts && typeof parsed.accounts === 'object') {
      for (const [k, acc] of Object.entries(parsed.accounts)) {
        if (!acc || typeof acc.username !== 'string') continue;
        const cleanName = normalizeUsername(acc.username);
        if (!cleanName) continue;
        const cleanUnlocked = Array.isArray(acc.unlockedSkins)
          ? acc.unlockedSkins.filter((s): s is string => typeof s === 'string' && s.includes(':')).slice(0, 30)
          : [];
        accounts[k.toLowerCase()] = {
          username: cleanName,
          coins: Number.isFinite(acc.coins) ? Math.max(0, Math.round(acc.coins)) : STARTING_COINS,
          wins: Number.isFinite(acc.wins) ? Math.max(0, Math.round(acc.wins)) : 0,
          kills: Number.isFinite(acc.kills) ? Math.max(0, Math.round(acc.kills)) : 0,
          matchesPlayed: Number.isFinite(acc.matchesPlayed) ? Math.max(0, Math.round(acc.matchesPlayed)) : 0,
          unlockedSkins: cleanUnlocked,
          createdAt: Number.isFinite(acc.createdAt) ? acc.createdAt : Date.now(),
          lastLoginAt: Number.isFinite(acc.lastLoginAt) ? acc.lastLoginAt : Date.now(),
        };
      }
    }
    const activeKey =
      typeof parsed.activeUsername === 'string' ? parsed.activeUsername.trim().toLowerCase() : null;
    const activeAccount = activeKey && accounts[activeKey] ? accounts[activeKey].username : null;
    return {
      activeUsername: activeAccount,
      accounts,
    };
  } catch {
    return { activeUsername: null, accounts: {} };
  }
}

export function saveAccountStore(
  store: AccountStoreState,
  storage: StorageLike | null = getDefaultStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage quota errors
  }
}

export function getActiveAccount(store: AccountStoreState): UserAccount | null {
  if (!store.activeUsername) return null;
  const key = normalizeAccountKey(store.activeUsername);
  return store.accounts[key] ?? null;
}

export function loginOrCreateAccount(
  store: AccountStoreState,
  rawUsername: string,
  now = Date.now(),
  storage: StorageLike | null = getDefaultStorage()
): { store: AccountStoreState; account: UserAccount; created: boolean } | null {
  const cleanName = normalizeUsername(rawUsername);
  if (!cleanName) return null;
  const key = cleanName.toLowerCase();
  const existing = store.accounts[key];
  const account: UserAccount = existing
    ? {
        ...existing,
        username: cleanName,
        unlockedSkins: Array.isArray(existing.unlockedSkins) ? existing.unlockedSkins : [],
        lastLoginAt: now,
      }
    : {
        username: cleanName,
        coins: STARTING_COINS,
        wins: 0,
        kills: 0,
        matchesPlayed: 0,
        unlockedSkins: [],
        createdAt: now,
        lastLoginAt: now,
      };
  const nextStore: AccountStoreState = {
    activeUsername: account.username,
    accounts: {
      ...store.accounts,
      [key]: account,
    },
  };
  saveAccountStore(nextStore, storage);
  return { store: nextStore, account, created: !existing };
}

export function logoutAccount(
  store: AccountStoreState,
  storage: StorageLike | null = getDefaultStorage()
): AccountStoreState {
  const nextStore: AccountStoreState = {
    ...store,
    activeUsername: null,
  };
  saveAccountStore(nextStore, storage);
  return nextStore;
}

export function calculateMatchCoinReward(input: {
  won: boolean;
  kills: number;
  damageDealt: number;
  isTrainingMode: boolean;
}): CoinRewardBreakdown {
  if (input.isTrainingMode) {
    return { base: 0, winBonus: 0, koBonus: 0, damageBonus: 0, total: 0 };
  }
  const base = 15;
  const winBonus = input.won ? 45 : 0;
  const koBonus = Math.max(0, Math.round(input.kills)) * 12;
  const damageBonus = Math.min(20, Math.floor(Math.max(0, input.damageDealt) / 45));
  return {
    base,
    winBonus,
    koBonus,
    damageBonus,
    total: base + winBonus + koBonus + damageBonus,
  };
}

export function recordMatchReward(
  store: AccountStoreState,
  username: string | null | undefined,
  reward: CoinRewardBreakdown,
  won: boolean,
  kills: number,
  storage: StorageLike | null = getDefaultStorage()
): { store: AccountStoreState; account: UserAccount | null } {
  if (!username) return { store, account: null };
  const cleanName = normalizeUsername(username);
  if (!cleanName) return { store, account: null };
  const key = cleanName.toLowerCase();
  const baseAcc: UserAccount = store.accounts[key] ?? {
    username: cleanName,
    coins: STARTING_COINS,
    wins: 0,
    kills: 0,
    matchesPlayed: 0,
    createdAt: Date.now(),
    lastLoginAt: Date.now(),
  };
  const updated: UserAccount = {
    ...baseAcc,
    coins: baseAcc.coins + Math.max(0, Math.round(reward.total)),
    wins: baseAcc.wins + (won ? 1 : 0),
    kills: baseAcc.kills + Math.max(0, Math.round(kills)),
    matchesPlayed: baseAcc.matchesPlayed + 1,
    lastLoginAt: Date.now(),
  };
  const nextStore: AccountStoreState = {
    activeUsername: store.activeUsername ?? updated.username,
    accounts: {
      ...store.accounts,
      [key]: updated,
    },
  };
  saveAccountStore(nextStore, storage);
  return { store: nextStore, account: updated };
}

export function unlockAccountSkin(
  store: AccountStoreState,
  username: string | null | undefined,
  unlockKey: string,
  price: number,
  storage: StorageLike | null = getDefaultStorage()
): { store: AccountStoreState; account: UserAccount | null; ok: boolean } {
  if (!username) return { store, account: null, ok: false };
  const key = normalizeAccountKey(username);
  const existing = store.accounts[key];
  if (!existing) return { store, account: null, ok: false };
  const owned = Array.isArray(existing.unlockedSkins) ? existing.unlockedSkins : [];
  if (owned.includes(unlockKey)) {
    return { store, account: existing, ok: false };
  }
  const safePrice = Math.max(0, Math.round(price));
  if (existing.coins < safePrice) {
    return { store, account: existing, ok: false };
  }
  const updated: UserAccount = {
    ...existing,
    coins: existing.coins - safePrice,
    unlockedSkins: [...owned, unlockKey],
    lastLoginAt: Date.now(),
  };
  const nextStore: AccountStoreState = {
    ...store,
    accounts: {
      ...store.accounts,
      [key]: updated,
    },
  };
  saveAccountStore(nextStore, storage);
  return { store: nextStore, account: updated, ok: true };
}

export interface GuestSession {
  displayName: string;
  coins: number;
  wins: number;
  kills: number;
  matchesPlayed: number;
  unlockedSkins: string[];
  createdAt: number;
}

export const GUEST_SESSION_KEY = 'koopal_guest_session_v1';

function getDefaultSessionStorage(): StorageLike | null {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    return window.sessionStorage;
  }
  return null;
}

export function loadGuestSession(
  storage: StorageLike | null = getDefaultSessionStorage()
): GuestSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(GUEST_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GuestSession>;
    return {
      displayName: typeof parsed.displayName === 'string' && parsed.displayName.trim() ? parsed.displayName.slice(0, 14) : 'Guest',
      coins: Number.isFinite(parsed.coins) ? Math.max(0, Math.round(Number(parsed.coins))) : 0,
      wins: Number.isFinite(parsed.wins) ? Math.max(0, Math.round(Number(parsed.wins))) : 0,
      kills: Number.isFinite(parsed.kills) ? Math.max(0, Math.round(Number(parsed.kills))) : 0,
      matchesPlayed: Number.isFinite(parsed.matchesPlayed) ? Math.max(0, Math.round(Number(parsed.matchesPlayed))) : 0,
      unlockedSkins: Array.isArray(parsed.unlockedSkins)
        ? parsed.unlockedSkins.filter((s): s is string => typeof s === 'string' && s.includes(':')).slice(0, 30)
        : [],
      createdAt: Number.isFinite(parsed.createdAt) ? Number(parsed.createdAt) : Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveGuestSession(
  guest: GuestSession | null,
  storage: StorageLike | null = getDefaultSessionStorage()
): void {
  if (!storage) return;
  try {
    if (!guest) {
      if (typeof (storage as unknown as { removeItem?: (k: string) => void }).removeItem === 'function') {
        (storage as unknown as { removeItem: (k: string) => void }).removeItem(GUEST_SESSION_KEY);
      } else {
        storage.setItem(GUEST_SESSION_KEY, '');
      }
      return;
    }
    storage.setItem(GUEST_SESSION_KEY, JSON.stringify(guest));
  } catch {
    // ignore storage errors
  }
}

export function createGuestSession(
  displayName = 'Guest',
  storage: StorageLike | null = getDefaultSessionStorage()
): GuestSession {
  const cleanName = normalizeUsername(displayName) || 'Guest';
  const guest: GuestSession = {
    displayName: cleanName,
    coins: 0,
    wins: 0,
    kills: 0,
    matchesPlayed: 0,
    unlockedSkins: [],
    createdAt: Date.now(),
  };
  saveGuestSession(guest, storage);
  return guest;
}

export function recordGuestMatchReward(
  guest: GuestSession,
  reward: CoinRewardBreakdown,
  won: boolean,
  kills: number,
  storage: StorageLike | null = getDefaultSessionStorage()
): GuestSession {
  const next: GuestSession = {
    ...guest,
    coins: guest.coins + Math.max(0, Math.round(reward.total)),
    wins: guest.wins + (won ? 1 : 0),
    kills: guest.kills + Math.max(0, Math.round(kills)),
    matchesPlayed: guest.matchesPlayed + 1,
  };
  saveGuestSession(next, storage);
  return next;
}

export function unlockGuestSkin(
  guest: GuestSession,
  unlockKey: string,
  price: number,
  storage: StorageLike | null = getDefaultSessionStorage()
): { guest: GuestSession; ok: boolean } {
  if (guest.unlockedSkins.includes(unlockKey)) {
    return { guest, ok: false };
  }
  const safePrice = Math.max(0, Math.round(price));
  if (guest.coins < safePrice) {
    return { guest, ok: false };
  }
  const next: GuestSession = {
    ...guest,
    coins: guest.coins - safePrice,
    unlockedSkins: [...guest.unlockedSkins, unlockKey],
  };
  saveGuestSession(next, storage);
  return { guest: next, ok: true };
}

