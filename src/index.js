require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { analyzeMessage } = require('./threatDetector');
const { logThreat } = require('./firebaseLogger');
const { getAdminChannel, setAdminChannel } = require('./guildConfig');
const { startKeepAliveServer } = require('./keepAlive');

// UptimeRobot entegrasyonu için HTTP sunucusunu başlat
startKeepAliveServer();

// Zorunlu çevre değişkenleri listesi
const REQUIRED_ENV = [
  'DISCORD_TOKEN',
  'GEMINI_API_KEY',
  'FIREBASE_SERVICE_ACCOUNT_JSON',
  'FIREBASE_PROJECT_ID',
];

// Başlatma öncesi Environment durum kontrolü
console.log('[Sistem] Çevre değişkenleri doğrulanıyor...');
for (const key of REQUIRED_ENV) {
  if (!process.env[key] || process.env[key].trim().length === 0) {
    console.error(`[HATA] Render paneline eklediğin "${key}" değişkeni eksik veya boş!`);
    process.exit(1);
  }
}

// Token değerini garantiye almak için temizleme işlemi (.trim())
const CLEAN_TOKEN = process.env.DISCORD_TOKEN.trim();
console.log(`[Sistem] Token başarıyla yüklendi. Karakter uzunluğu: ${CLEAN_TOKEN.length}`);

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
  console.log(`[Hexages Games Guvenlik Sistemi] ${client.user.tag} olarak başarıyla bağlandı!`);
  console.log(`[Sistem] ${client.guilds.cache.size} sunucuda aktif koruma devrede.`);
});

// --- Slash komutları: Yönetici kanal ayarları ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'guvenlik-ayarla') return;

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: 'Bu komutu kullanmak için "Sunucuyu Yönet" yetkisine sahip olman gerekiyor.',
      ephemeral: true,
    });
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'kanal-ayarla') {
    const channel = interaction.options.getChannel('kanal');
    await setAdminChannel(interaction.guild.id, channel.id);
    return interaction.reply({
      content: `Admin/güvenlik kanalı <#${channel.id}> olarak ayarlandı. Tehlikeli mesajlar artık buraya bildirilecek.`,
      ephemeral: true,
    });
  }

  if (sub === 'kanal-goster') {
    const channelId = await getAdminChannel(interaction.guild.id);
    if (!channelId) {
      return interaction.reply({
        content: 'Bu sunucu için henüz admin kanalı ayarlanmamış. `/guvenlik-ayarla kanal-ayarla` ile ayarlayabilirsin.',
        ephemeral: true,
      });
    }
    return interaction.reply({
      content: `Şu anki admin/güvenlik kanalı: <#${channelId}>`,
      ephemeral: true,
    });
  }
});

// --- Mesaj Dinleme ve Filtreleme Motoru ---
client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
    if (!message.content || message.content.trim().length === 0) return;

    const analysis = await analyzeMessage(message.content);
    if (!analysis.isDangerous) return;

    const author = message.author;
    const member = message.member;
    const guild = message.guild;

    // 1) Firestore veritabanına kanıt kaydı gönderme
    let logId = null;
    try {
      logId = await logThreat({
        guildId: guild.id,
        guildName: guild.name,
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
      console.error('[Firestore Hatası] Kayıt işlenemedi:', logErr);
    }

    // 2) Zararlı içeriğe sahip mesajı imha etme
    let deleted = false;
    try {
      await message.delete();
      deleted = true;
    } catch (delErr) {
      console.error('[Yetki Hatası] Mesaj silinemedi:', delErr.message);
    }

    // 3) Sunucuya ait log kanalı sorgusu
    const adminChannelId = await getAdminChannel(guild.id);
    if (!adminChannelId) {
      console.error(`[${guild.name}] için admin kanalı ayarlanmamış! Yapılandırma gerekiyor.`);
      return;
    }

    const adminChannel = await client.channels.fetch(adminChannelId).catch(() => null);
    if (!adminChannel) {
      console.error(`[${guild.name}] belirtilen admin kanalı (${adminChannelId}) erişilemez durumda.`);
      return;
    }

    const ownerId = guild.ownerId;
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
      content: `<@${ownerId}> Hexages Games Güvenlik Sistemi bir tehdit tespit etti.`,
      embeds: [embed],
    });
  } catch (err) {
    console.error('[HATA] Mesaj işleme sürecinde kritik hata:', err);
  }
});

// Yeni sunucuya eklenme bildirimi
client.on('guildCreate', async (guild) => {
  console.log(`[Sunucu] Yeni katılım sağlandı: ${guild.name} (${guild.id})`);
  try {
    const owner = await guild.fetchOwner();
    await owner.send(
      `Hexages Games Güvenlik Sistemi **${guild.name}** sunucusuna eklendi.\n\n` +
      `Aktif olması için sunucuda bir yetkilinin şu komutu çalıştırması gerekiyor:\n` +
      `\`/guvenlik-ayarla kanal-ayarla\` — tehlikeli mesajların bildirileceği özel admin kanalını seçmek için.`
    ).catch(() => {
      console.log(`[Sistem] ${owner.user.tag} kullanıcısının DM kutusu kapalı, bilgilendirme iletilemedi.`);
    });
  } catch (err) {
    console.error('[HATA] Sunucu eklenme bildirimi gönderilemedi:', err);
  }
});

// Küresel çökme önleyiciler
process.on('unhandledRejection', (err) => {
  console.error('[Kritik Hata] Yakalanmamış Promise Reddi:', err);
});
process.on('uncaughtException', (err) => {
  console.error('[Kritik Hata] Yakalanmamış İstisna:', err);
});

// Temizlenmiş token ile bağlantı açılışı
client.login(CLEAN_TOKEN);
