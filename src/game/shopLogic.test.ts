import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SKIN_PRICES,
  getSkinPrice,
  isSkinUnlocked,
  makeSkinUnlockKey,
  purchaseSkin,
} from './shopLogic';
import {
  loadAccountStore,
  loginOrCreateAccount,
  unlockAccountSkin,
  type StorageLike,
} from './accountStore';

function makeMemoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem(k) {
      return data.get(k) ?? null;
    },
    setItem(k, v) {
      data.set(k, v);
    },
  };
}

test('Classic skins are always unlocked for free while Ascended costs 500 and Special costs 1000', () => {
  assert.equal(SKIN_PRICES.classic, 0);
  assert.equal(SKIN_PRICES.ascended, 500);
  assert.equal(SKIN_PRICES.special, 1000);
  assert.equal(getSkinPrice('classic'), 0);
  assert.equal(getSkinPrice('ascended'), 500);
  assert.equal(getSkinPrice('special'), 1000);

  for (const fid of ['marjohn', 'prime', 'damen', 'khen', 'jm'] as const) {
    assert.equal(isSkinUnlocked([], fid, 'classic'), true);
    assert.equal(isSkinUnlocked(undefined, fid, 'classic'), true);
    assert.equal(isSkinUnlocked([], fid, 'ascended'), false);
    assert.equal(isSkinUnlocked([], fid, 'special'), false);
  }
});

test('purchaseSkin enforces coin balance, deducts 500/1000 cleanly, and prevents duplicate purchase', () => {
  const deniedAsc = purchaseSkin({
    coins: 499,
    unlockedSkins: [],
    fighterId: 'jm',
    skinId: 'ascended',
  });
  assert.equal(deniedAsc.ok, false);
  assert.equal(deniedAsc.reason, 'insufficient_coins');
  assert.equal(deniedAsc.nextCoins, 499);
  assert.deepEqual(deniedAsc.nextUnlockedSkins, []);

  const boughtAsc = purchaseSkin({
    coins: 1550,
    unlockedSkins: [],
    fighterId: 'jm',
    skinId: 'ascended',
  });
  assert.equal(boughtAsc.ok, true);
  assert.equal(boughtAsc.cost, 500);
  assert.equal(boughtAsc.nextCoins, 1050);
  assert.deepEqual(boughtAsc.nextUnlockedSkins, ['jm:ascended']);
  assert.equal(isSkinUnlocked(boughtAsc.nextUnlockedSkins, 'jm', 'ascended'), true);
  assert.equal(isSkinUnlocked(boughtAsc.nextUnlockedSkins, 'prime', 'ascended'), false);

  const dupAsc = purchaseSkin({
    coins: boughtAsc.nextCoins,
    unlockedSkins: boughtAsc.nextUnlockedSkins,
    fighterId: 'jm',
    skinId: 'ascended',
  });
  assert.equal(dupAsc.ok, false);
  assert.equal(dupAsc.reason, 'already_unlocked');
  assert.equal(dupAsc.nextCoins, 1050);

  const boughtSpec = purchaseSkin({
    coins: boughtAsc.nextCoins,
    unlockedSkins: boughtAsc.nextUnlockedSkins,
    fighterId: 'jm',
    skinId: 'special',
  });
  assert.equal(boughtSpec.ok, true);
  assert.equal(boughtSpec.cost, 1000);
  assert.equal(boughtSpec.nextCoins, 50);
  assert.deepEqual(boughtSpec.nextUnlockedSkins, ['jm:ascended', 'jm:special']);
});

test('accountStore persists unlockedSkins across reload', () => {
  const storage = makeMemoryStorage();
  let store = loadAccountStore(storage);
  const created = loginOrCreateAccount(store, 'SkinCollector', 1000, storage);
  assert.ok(created);
  store = created.store;
  // Give player 600 coins via store update for test
  store.accounts.skincollector.coins = 600;

  const unlockKey = makeSkinUnlockKey('prime', 'ascended');
  const unlocked = unlockAccountSkin(store, 'SkinCollector', unlockKey, 500, storage);
  assert.equal(unlocked.ok, true);
  assert.equal(unlocked.account?.coins, 100);
  assert.deepEqual(unlocked.account?.unlockedSkins, ['prime:ascended']);

  const reloaded = loadAccountStore(storage);
  assert.equal(reloaded.accounts.skincollector.coins, 100);
  assert.deepEqual(reloaded.accounts.skincollector.unlockedSkins, ['prime:ascended']);
});
