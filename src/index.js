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

startKeepAliveServer();

// Zorunlu çevre değişkenleri - SADECE 3 TANE
const REQUIRED_ENV = ['DISCORD_TOKEN', 'GEMINI_API_KEY'];

console.log('[Sistem] Çevre değişkenleri doğrulanıyor...');
for (const key of REQUIRED_ENV) {
  if (!process.env[key] || process.env[key].trim().length === 0) {
    console.error(`[HATA] "${key}" eksik!`);
    process.exit(1);
  }
}

const CLEAN_TOKEN = process.env.DISCORD_TOKEN.trim();
console.log(`[Sistem] Token yüklendi. Uzunluk: ${CLEAN_TOKEN.length}`);

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
  console.log(`[Hexages Games] ${client.user.tag} bağlandı!`);
  console.log(`[Sistem] ${client.guilds.cache.size} sunucuda aktif.`);
});

// --- Slash komutları ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'guvenlik-ayarla') return;

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: 'Bu komut için "Sunucuyu Yönet" yetkisi gerekli.',
      ephemeral: true,
    });
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'kanal-ayarla') {
    const channel = interaction.options.getChannel('kanal');
    await setAdminChannel(interaction.guild.id, channel.id);
    return interaction.reply({
      content: `Güvenlik kanalı <#${channel.id}> olarak ayarlandı.`,
      ephemeral: true,
    });
  }

  if (sub === 'kanal-goster') {
    const channelId = await getAdminChannel(interaction.guild.id);
    if (!channelId) {
      return interaction.reply({
        content: 'Henüz admin kanalı ayarlanmamış.',
        ephemeral: true,
      });
    }
    return interaction.reply({
      content: `Admin kanalı: <#${channelId}>`,
      ephemeral: true,
    });
  }
});

// --- Mesaj Dinleme ---
client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
    if (!message.content || message.content.trim().length === 0) return;

    let analysis;
    try {
      analysis = await analyzeMessage(message.content);
    } catch (aiErr) {
      console.log('[AI] Gemini hatası, mesaj güvenli kabul edildi');
      return;
    }
    
    if (!analysis.isDangerous) return;

    const author = message.author;
    const member = message.member;
    const guild = message.guild;

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
      console.error('[Firestore] Kayıt hatası:', logErr);
    }

    let deleted = false;
    try {
      await message.delete();
      deleted = true;
    } catch (delErr) {
      console.error('[Silme] Yetki yok:', delErr.message);
    }

    const adminChannelId = await getAdminChannel(guild.id);
    if (!adminChannelId) {
      console.log(`[${guild.name}] Admin kanalı ayarlanmamış!`);
      return;
    }

    const adminChannel = await client.channels.fetch(adminChannelId).catch(() => null);
    if (!adminChannel) {
      console.error(`[${guild.name}] Admin kanalı bulunamadı!`);
      return;
    }

    const typeLabel =
      analysis.type === 'DEATH_THREAT'
        ? 'Ölüm / Şiddet Tehdidi'
        : analysis.type === 'PII_LEAK'
        ? 'Kişisel Bilgi İfşası'
        : 'Ölüm Tehdidi + Kişisel Bilgi İfşası';

    const embed = new EmbedBuilder()
      .setColor(0xE02424)
      .setTitle('🛡️ Hexages Games Güvenlik')
      .setDescription(`**${typeLabel}** tespit edildi ve kayıt altına alındı.`)
      .addFields(
        { name: 'Kullanıcı', value: `${author.tag} (<@${author.id}>)`, inline: true },
        { name: 'Tespit Türü', value: typeLabel, inline: true },
        { name: 'Mesaj Silindi', value: deleted ? '✅ Evet' : '❌ Hayır', inline: true },
        { name: 'Kanal', value: `<#${message.channel.id}>`, inline: true },
        { name: 'AI Değerlendirmesi', value: analysis.reasoning || '-', inline: false },
        { name: 'Kayıt ID', value: logId || 'Başarısız', inline: false }
      )
      .setTimestamp();

    await adminChannel.send({
      content: `<@${guild.ownerId}> Tehdit tespit edildi!`,
      embeds: [embed],
    });
  } catch (err) {
    console.error('[HATA]', err);
  }
});

client.on('guildCreate', async (guild) => {
  console.log(`[Sunucu] Eklendi: ${guild.name} (${guild.id})`);
});

process.on('unhandledRejection', (err) => console.error('[Kritik]', err));
process.on('uncaughtException', (err) => console.error('[Kritik]', err));

client.login(CLEAN_TOKEN);
