require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
} = require('discord.js');
const { analyzeMessage } = require('./threatDetector');
const { logThreat } = require('./firebaseLogger');
const { startKeepAliveServer } = require('./keepAlive');

// UptimeRobot'un ping atabilmesi icin basit bir HTTP sunucusu baslat.
// Bu, botu Render gibi ucretsiz platformlarda "uyanik" tutar.
startKeepAliveServer();

const REQUIRED_ENV = [
  'DISCORD_TOKEN',
  'ADMIN_CHANNEL_ID',
  'SERVER_OWNER_ID',
  'ANTHROPIC_API_KEY',
  'FIREBASE_SERVICE_ACCOUNT_JSON',
  'FIREBASE_PROJECT_ID',
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`HATA: .env dosyanda ${key} eksik. Bot baslatilamiyor.`);
    process.exit(1);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel],
});

client.once('ready', () => {
  console.log(`[Hexages Games Guvenlik Sistemi] ${client.user.tag} olarak baglandi.`);
  console.log('Bot 7/24 dinlemede. Sadece ciddi tehdit / kisisel bilgi ifsasi tespit edilir, kufur filtrelenmez.');
});

client.on('messageCreate', async (message) => {
  try {
    // Botlarin kendi mesajlarini ve DM'leri atla
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.content || message.content.trim().length === 0) return;

    const analysis = await analyzeMessage(message.content);

    if (!analysis.isDangerous) return;

    // --- Tehlikeli mesaj tespit edildi ---
    const author = message.author;
    const member = message.member;

    // 1) Once Firestore admin paneline kaydet (mesaj silinmeden ONCE kanit olarak)
    let logId = null;
    try {
      logId = await logThreat({
        guildId: message.guild.id,
        guildName: message.guild.name,
        channelId: message.channel.id,
        channelName: message.channel.name,
        authorId: author.id,
        authorUsername: author.username,
        authorTag: author.tag,
        messageContent: message.content,
        detectionType: analysis.type,
        detectionReasoning: analysis.reasoning,
        accountCreatedAt: author.createdAt.toISOString(),
        joinedServerAt: member?.joinedAt ? member.joinedAt.toISOString() : null,
        messageTimestamp: message.createdAt.toISOString(),
      });
    } catch (logErr) {
      console.error('Firestore loglama hatasi:', logErr);
      // Loglama basarisiz olsa bile guvenlik icin mesaji silmeye devam et
    }

    // 2) Discord'da mesaji sil
    let deleted = false;
    try {
      await message.delete();
      deleted = true;
    } catch (delErr) {
      console.error('Mesaj silinemedi (yetki eksik olabilir):', delErr.message);
    }

    // 3) Admin/log kanalina ozel uyari gonder - @everyone YOK, sadece sunucu sahibi etiketlenir
    const adminChannel = await client.channels
      .fetch(process.env.ADMIN_CHANNEL_ID)
      .catch(() => null);

    if (adminChannel) {
      const typeLabel =
        analysis.type === 'DEATH_THREAT'
          ? 'Ölüm / Şiddet Tehdidi'
          : analysis.type === 'PII_LEAK'
          ? 'Kişisel Bilgi İfşası (TC Kimlik / Adres vb.)'
          : 'Ölüm Tehdidi + Kişisel Bilgi İfşası';

      const embed = new EmbedBuilder()
        .setColor(0xE02424)
        .setTitle('🛡️ Hexages Games Güvenlik Sistemi')
        .setDescription(
          `Bu kişi, sunucuda **${typeLabel.toLowerCase()}** içeren bir mesaj paylaştığı için ` +
          `Hexages Games güvenlik sistemi tarafından tespit edilmiş ve kayıt altına alınmıştır.`
        )
        .addFields(
          { name: 'Kullanıcı', value: `${author.tag} (<@${author.id}>)`, inline: true },
          { name: 'Kullanıcı ID', value: author.id, inline: true },
          { name: 'Tespit Türü', value: typeLabel, inline: true },
          { name: 'Mesaj Silindi mi?', value: deleted ? 'Evet' : 'Hayır (yetki kontrol edilmeli)', inline: true },
          { name: 'Kanal', value: `<#${message.channel.id}>`, inline: true },
          { name: 'Hesap Oluşturma', value: `<t:${Math.floor(author.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'AI Değerlendirmesi', value: analysis.reasoning || '-', inline: false },
          { name: 'Admin Panel Kayıt ID', value: logId || 'Kayıt başarısız', inline: false }
        )
        .setFooter({ text: 'Bu bilgiler admin panelinde ve Firestore\'da kanıt olarak saklanmaktadır.' })
        .setTimestamp();

      await adminChannel.send({
        content: `<@${process.env.SERVER_OWNER_ID}> Hexages Games Güvenlik Sistemi bir tehdit tespit etti.`,
        embeds: [embed],
      });
    } else {
      console.error('ADMIN_CHANNEL_ID gecersiz veya bot bu kanali goremiyor.');
    }
  } catch (err) {
    console.error('messageCreate isleme hatasi:', err);
  }
});

// Beklenmedik hatalarin botu tamamen dusurmesini engelle (7/24 calisma icin)
process.on('unhandledRejection', (err) => {
  console.error('Yakalanmamis Promise hatasi:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Yakalanmamis istisna:', err);
});

client.login(process.env.DISCORD_TOKEN);
