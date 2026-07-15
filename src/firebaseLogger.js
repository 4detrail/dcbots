// firebaseLogger.js - TAMAMEN YENİ
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, serverTimestamp } = require('firebase/firestore');

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyAroBTexiXeaJGYqMiIIM5POdN2JUuigvo",
  authDomain: "hexagesgames-f8fe2.firebaseapp.com",
  projectId: "hexagesgames-f8fe2",
  storageBucket: "hexagesgames-f8fe2.firebasestorage.app",
  messagingSenderId: "469976981538",
  appId: "1:469976981538:web:c5b49c15b0206c7fb76a7b",
  measurementId: "G-6E33GJ0ZB0"
};

// Firebase'i başlat
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

console.log('[Firebase] Client SDK ile bağlantı kuruldu.');

// db'yi export et (guildConfig.js için)
module.exports.db = db;

/**
 * Tehlikeli mesajı Firestore'a kaydet
 */
async function logThreat({
  guildId,
  guildName,
  channelId,
  channelName,
  authorId,
  authorUsername,
  authorTag,
  messageContent,
  detectionType,
  detectionReasoning,
  accountCreatedAt,
  joinedServerAt,
  messageTimestamp,
}) {
  try {
    console.log(`[Firestore] Tehdit kaydediliyor: ${guildName} (${guildId})`);
    
    // collection'ı doğru kullan
    const docRef = await addDoc(collection(db, 'threat_logs'), {
      guildId,
      guildName,
      channelId,
      channelName,
      authorId,
      authorUsername,
      authorTag,
      messageContent,
      detectionType,
      detectionReasoning,
      accountCreatedAt,
      joinedServerAt,
      messageTimestamp,
      loggedAt: serverTimestamp(),
      status: 'new',
    });

    console.log(`[Firestore] Kayıt oluşturuldu: ${docRef.id}`);
    return docRef.id;
  } catch (err) {
    console.error('[Firestore] Kayıt hatası:', err);
    throw err;
  }
}

module.exports = { logThreat, db };
