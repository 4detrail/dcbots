const admin = require('firebase-admin');

let db = null;

function initFirebase() {
  if (db) return db;

  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON tanimli degil. .env dosyani kontrol et.'
    );
  }

  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });

  db = admin.firestore();
  return db;
}

/**
 * Tehlikeli olarak isaretlenen bir mesaji Firestore'daki
 * 'threat_logs' koleksiyonuna kaydeder. Bu koleksiyon SADECE
 * admin panelinde, yetkili emailler tarafindan okunmalidir.
 *
 * Onerilen firestore.rules eklentisi (mevcut kurallarina ekle):
 *
 * match /threat_logs/{logId} {
 *   allow read: if request.auth != null &&
 *     request.auth.token.email in ['yigittr1922@gmail.com', 'firecrostnetwork@gmail.com'];
 *   allow write: if false; // sadece backend (service account) yazabilir
 * }
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
  const firestore = initFirebase();

  const docRef = await firestore.collection('threat_logs').add({
    guildId,
    guildName,
    channelId,
    channelName,
    authorId,
    authorUsername,
    authorTag,
    messageContent,
    detectionType, // 'DEATH_THREAT' | 'PII_LEAK' | 'BOTH'
    detectionReasoning,
    accountCreatedAt,
    joinedServerAt,
    messageTimestamp,
    loggedAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'new', // admin panelinde 'reviewed' / 'reported_to_authorities' olarak guncellenebilir
  });

  return docRef.id;
}

module.exports = { initFirebase, logThreat };
