const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, serverTimestamp } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyAroBTexiXeaJGYqMiIIM5POdN2JUuigvo",
  authDomain: "hexagesgames-f8fe2.firebaseapp.com",
  projectId: "hexagesgames-f8fe2",
  storageBucket: "hexagesgames-f8fe2.firebasestorage.app",
  messagingSenderId: "469976981538",
  appId: "1:469976981538:web:c5b49c15b0206c7fb76a7b",
  measurementId: "G-6E33GJ0ZB0"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

console.log('[Firebase] Bağlantı kuruldu.');

async function logThreat(data) {
  try {
    const docRef = await addDoc(collection(db, 'threat_logs'), {
      guildId: data.guildId,
      guildName: data.guildName,
      channelId: data.channelId,
      channelName: data.channelName,
      authorId: data.authorId,
      authorUsername: data.authorUsername,
      authorTag: data.authorTag,
      messageContent: data.messageContent,
      detectionType: data.detectionType,
      detectionReasoning: data.detectionReasoning,
      accountCreatedAt: data.accountCreatedAt,
      joinedServerAt: data.joinedServerAt,
      messageTimestamp: data.messageTimestamp,
      loggedAt: serverTimestamp(),
      status: 'new',
    });
    console.log(`[Firestore] Kayıt: ${docRef.id}`);
    return docRef.id;
  } catch (err) {
    console.error('[Firestore] Hata:', err);
    throw err;
  }
}

module.exports = { logThreat, db };
