require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('guvenlik-ayarla')
    .setDescription('Hexages Games Güvenlik Sistemi ayarları')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild) // sadece sunucuyu yonetme yetkisi olanlar
    .addSubcommand((sub) =>
      sub
        .setName('kanal-ayarla')
        .setDescription('Tehlikeli mesajların bildirileceği özel admin kanalını ayarla')
        .addChannelOption((opt) =>
          opt
            .setName('kanal')
            .setDescription('Sadece adminlerin gördüğü bir kanal seç')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('kanal-goster').setDescription('Şu anki admin kanal ayarını göster')
    ),
]
  .map((cmd) => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    if (!process.env.CLIENT_ID) {
      console.error('HATA: .env dosyasinda CLIENT_ID eksik (Developer Portal > Genel Bilgi > Uygulama ID\'si).');
      process.exit(1);
    }

    console.log('Slash komutlari kaydediliyor (global - tum sunucularda birkaç dakika icinde gorunur)...');

    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: commands,
    });

    console.log('Slash komutlari basariyla kaydedildi.');
  } catch (err) {
    console.error('Komut kaydi hatasi:', err);
  }
})();
