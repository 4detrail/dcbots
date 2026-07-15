const { doc, setDoc, getDoc } = require('firebase/firestore');
const { db } = require('./firebaseLogger');

const cache = new Map();

async function setAdminChannel(guildId, channelId) {
  try {
    await setDoc(doc(db, 'guild_configs', guildId), {
      adminChannelId: channelId,
      updatedAt: new Date().toISOString(),
      guildId: guildId
    }, { merge: true });
    cache.set(guildId, { adminChannelId: channelId });
    console.log(`[Config] Kaydedildi: ${guildId} -> ${channelId}`);
  } catch (err) {
    console.error('[Config] Hata:', err);
    throw err;
  }
}

async function getAdminChannel(guildId) {
  if (cache.has(guildId)) return cache.get(guildId).adminChannelId;

  try {
    const docSnap = await getDoc(doc(db, 'guild_configs', guildId));
    if (!docSnap.exists()) {
      cache.set(guildId, { adminChannelId: null });
      return null;
    }
    const data = docSnap.data();
    cache.set(guildId, { adminChannelId: data.adminChannelId || null });
    return data.adminChannelId || null;
  } catch (err) {
    console.error('[Config] Okuma hatası:', err);
    return null;
  }
}

module.exports = { setAdminChannel, getAdminChannel };
