const { initFirebase } = require('./firebaseLogger');

const cache = new Map(); // guildId -> { adminChannelId } (Firestore okuma sayisini azaltmak icin basit cache)

/**
 * Bir sunucunun guvenlik admin kanalini Firestore'a kaydeder.
 * Koleksiyon: guild_configs/{guildId}
 */
async function setAdminChannel(guildId, channelId) {
  const db = initFirebase();
  await db.collection('guild_configs').doc(guildId).set(
    { adminChannelId: channelId, updatedAt: new Date().toISOString() },
    { merge: true }
  );
  cache.set(guildId, { adminChannelId: channelId });
}

/**
 * Bir sunucunun admin kanalini getirir. Once cache'e bakar, yoksa Firestore'dan okur.
 * Hic ayarlanmamissa null doner.
 */
async function getAdminChannel(guildId) {
  if (cache.has(guildId)) return cache.get(guildId).adminChannelId;

  const db = initFirebase();
  const doc = await db.collection('guild_configs').doc(guildId).get();

  if (!doc.exists) {
    cache.set(guildId, { adminChannelId: null });
    return null;
  }

  const data = doc.data();
  cache.set(guildId, { adminChannelId: data.adminChannelId || null });
  return data.adminChannelId || null;
}

module.exports = { setAdminChannel, getAdminChannel };
