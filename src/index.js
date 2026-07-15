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

// UptimeRobot'un ping atabilmesi icin basit bir HTTP sunucusu baslat.
// Bu, botu Render gibi ucretsiz platformlarda "uyanik" tutar.
startKeepAliveServer();

// Artik ADMIN_CHANNEL_ID / SERVER_OWNER_ID .env'de YOK - her sunucu kendi
// admin kanalini /guvenlik-ayarla komutuyla ayarliyor, sunucu sahibi de
// Discord API'den otomatik aliniyor (guild.ownerId).
const REQUIRED_ENV = [
  'DISCORD_TOKEN',
  'GEMINI_API_KEY',
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
  console.log(`${client.guilds.cache.size} sunucuda aktif. Cok-sunuculu mod (her sunucu kendi admin kanalini ayarlar).`);
});

// --- Slash komutlari: her sunucu kendi admin kanalini ayarlar ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'guvenlik-ayarla') return;

  // Ekstra guvenlik: sadece sunucuyu yonetme yetkisi olanlar kullanabilir
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: 'Bu komutu kullanmak icin "Sunucuyu Yonet" yetkisine sahip olman gerekiyor.',
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
    const guild = message.guild;

    // 1) Once Firestore admin paneline kaydet (mesaj silinmeden ONCE kanit olarak)
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

    // 3) Bu sunucunun admin kanalini bul (her sunucu kendi ayarini yapar)
    const adminChannelId = await getAdminChannel(guild.id);

    if (!adminChannelId) {
      console.error(
        `[${guild.name}] admin kanali ayarlanmamis. Yetkili birinin "/guvenlik-ayarla kanal-ayarla" calistirmasi gerekiyor.`
      );
      return;
    }

    const adminChannel = await client.channels.fetch(adminChannelId).catch(() => null);

    if (!adminChannel) {
      console.error(`[${guild.name}] admin kanali (${adminChannelId}) bulunamadi veya bot goremiyor.`);
      return;
    }

    // Sunucu sahibi otomatik olarak Discord API'den alinir - config gerekmez
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
    console.error('messageCreate isleme hatasi:', err);
  }
});

// Bot yeni bir sunucuya eklendiginde bilgilendirme mesaji
client.on('guildCreate', async (guild) => {
  console.log(`Yeni sunucu: ${guild.name} (${guild.id})`);
  try {
    const owner = await guild.fetchOwner();
    await owner.send(
      `Hexages Games Güvenlik Sistemi **${guild.name}** sunucusuna eklendi.\n\n` +
      `Aktif olması için sunucuda bir yetkilinin şu komutu çalıştırması gerekiyor:\n` +
      `\`/guvenlik-ayarla kanal-ayarla\` — tehlikeli mesajların bildirileceği özel admin kanalını seçmek için.`
    ).catch(() => {
      console.log(`${owner.user.tag} kullanicisina DM gonderilemedi (DM'ler kapali olabilir).`);
    });
  } catch (err) {
    console.error('guildCreate bilgilendirme hatasi:', err);
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
