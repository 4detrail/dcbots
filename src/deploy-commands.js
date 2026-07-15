require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('guvenlik-ayarla')
    .setDescription('Hexages Games Güvenlik Sistemi ayarları')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName('kanal-ayarla')
        .setDescription('Admin kanalını ayarla')
        .addChannelOption((opt) =>
          opt.setName('kanal').setDescription('Kanal seç').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('kanal-goster').setDescription('Mevcut admin kanalını göster')
    ),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    const clientId = process.env.CLIENT_ID;
    if (!clientId) {
      console.error('HATA: CLIENT_ID eksik!');
      process.exit(1);
    }
    console.log('Slash komutları kaydediliyor...');
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log('✅ Slash komutları kaydedildi!');
  } catch (err) {
    console.error('❌ Hata:', err);
  }
})();
