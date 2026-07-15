# Hexages Games Güvenlik Sistemi (Discord Bot)

Bu bot **çok-sunuculu** çalışır — botu ekleyen her sunucu kendi admin/güvenlik kanalını kendisi ayarlar. `.env` dosyasında hiçbir sunucuya özel bilgi yoktur, bot tek bir `DISCORD_TOKEN` ile tüm sunucularda çalışır.

Bu bot **küfür filtresi değildir.** Sadece şu iki durumu tespit eder:
- **Ölüm / ciddi şiddet tehditleri**
- **Kişisel/hassas bilgi ifşası** (geçerli TC Kimlik No, ev adresi vb.)

Tespit ettiğinde:
1. Mesajı ve kanıt bilgilerini (kullanıcı, saat, hesap yaşı, katılma tarihi, hangi sunucu) **önce** Firestore'daki `threat_logs` koleksiyonuna kaydeder.
2. Discord'daki mesajı siler.
3. O sunucu için ayarlanmış **admin/log kanalına** (herkese açık değil), sunucu sahibini (otomatik, Discord API'den alınır) etiketleyerek özel bir uyarı gönderir. **@everyone kullanılmaz, kimse herkese açık şekilde teşhir edilmez.**

## Kurulum

### 1. Bağımlılıkları yükle
```bash
npm install
```

### 2. Discord Bot oluştur
1. https://discord.com/developers/applications → New Application (ya da mevcut HEXAGES GAMES uygulamanı kullan)
2. Bot sekmesinden **Reset Token** ile token al → `.env` içine `DISCORD_TOKEN`
3. Genel Bilgi sayfasından **Uygulama ID'si**'ni kopyala → `.env` içine `CLIENT_ID`
4. **Privileged Gateway Intents** kısmında şunları aç:
   - MESSAGE CONTENT INTENT
   - SERVER MEMBERS INTENT
5. OAuth2 → URL Generator: `bot` ve `applications.commands` scope'larını seç, izinler: `Read Messages`, `Send Messages`, `Manage Messages` (silme için), `Embed Links` → oluşan linki herkesin kendi sunucusuna botu eklemesi için paylaşabilirsin.

### 3. Firebase Service Account al
1. Firebase Console → Project Settings → Service Accounts → **Generate new private key**
2. İndirilen JSON dosyasının tüm içeriğini tek satır olarak `.env` dosyasındaki `FIREBASE_SERVICE_ACCOUNT_JSON` değişkenine yapıştır.
3. `firestore-rules-eklentisi.txt` dosyasındaki kuralları mevcut `firestore.rules` dosyana ekle ve deploy et:
   ```bash
   firebase deploy --only firestore:rules
   ```

### 4. Anthropic API Key al
https://console.anthropic.com → API Keys → yeni key oluştur → `.env` içine `ANTHROPIC_API_KEY`

### 5. .env dosyasını doldur
```bash
cp .env.example .env
# sonra .env dosyasını kendi bilgilerinle doldur
```

### 6. Slash komutlarını Discord'a kaydet (tek seferlik)
```bash
npm run deploy-commands
```
Bu komut `/guvenlik-ayarla` komutunu tüm sunucularda kullanılabilir hale getirir (global kayıt, yayılması birkaç dakika sürebilir).

### 7. Botu çalıştır
```bash
npm start
```

## Botu bir sunucuya ekleyen herkes için kullanım

1. Bot sunucuya eklenince, sunucu sahibine otomatik olarak bir DM gönderir: kurulumu tamamlamak için `/guvenlik-ayarla` komutunu çalıştırması gerektiğini belirtir.
2. **Sunucuyu Yonet** yetkisine sahip biri, kendi özel admin kanalında şu komutu çalıştırır:
   ```
   /guvenlik-ayarla kanal-ayarla kanal:#admin-log
   ```
3. Bu ayar Firestore'a o sunucunun ID'siyle kaydedilir. O andan itibaren o sunucudaki tehlikeli mesajlar bu kanala düşer.
4. Mevcut ayarı görmek için: `/guvenlik-ayarla kanal-goster`

Hiçbir sunucu diğerinin admin kanalını göremez veya etkileyemez — her sunucunun kaydı Firestore'da ayrı tutulur (`guild_configs/{guildId}`).

## 7/24 Çalışır Durumda Tutma — Render.com + UptimeRobot

Kendi bilgisayarında çalıştırırsan, bilgisayar kapanınca bot da kapanır. Aşağıdaki yöntem **ücretsiz** ve UptimeRobot ile uyumlu:

### 1. Projeyi GitHub'a yükle
Render, GitHub reponu bağlayarak deploy ediyor. `.env` dosyasını **asla** GitHub'a yükleme (zaten `.gitignore` içinde hariç tutuldu).
```bash
git init
git add .
git commit -m "ilk kurulum"
# GitHub'da bos bir repo olustur, sonra:
git remote add origin <repo-url>
git push -u origin main
```

### 2. Render'da Web Service oluştur
1. https://render.com → GitHub hesabınla giriş yap
2. **New +** → **Web Service** → reponu seç
3. Ayarlar:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
4. **Environment** sekmesinden `.env` dosyandaki TÜM değişkenleri tek tek ekle (`DISCORD_TOKEN`, `ADMIN_CHANNEL_ID`, `SERVER_OWNER_ID`, `ANTHROPIC_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_PROJECT_ID`)
5. **Create Web Service** — birkaç dakika içinde deploy olur, sana `https://xxxx.onrender.com` gibi bir adres verir.

### 3. UptimeRobot ile ayakta tut
Render'ın ücretsiz planı, 15 dakika istek gelmezse projeyi uyutur. Bunu önlemek için:
1. https://uptimerobot.com → ücretsiz hesap aç
2. **Add New Monitor** → Monitor Type: **HTTP(s)**
3. URL: Render'ın sana verdiği adres (`https://xxxx.onrender.com`)
4. Monitoring Interval: **5 dakika**
5. Kaydet.

Bu sayede UptimeRobot her 5 dakikada bir botun HTTP sunucusuna (`src/keepAlive.js` ile eklediğimiz) ping atar, Render projeyi uyutmaz, bot 7/24 Discord'a bağlı kalır.

**Alternatif (daha sağlam, ücretli):** Bir VPS al, [pm2](https://pm2.keymetrics.io/) ile çalıştır — sunucu yeniden başlasa bile bot otomatik ayağa kalkar, uyku sorunu hiç olmaz:
```bash
npm install -g pm2
pm2 start src/index.js --name hexages-guard
pm2 save
pm2 startup
```

## Önemli Notlar

- Bu sistem **yasal yaptırım gücüne sahip değildir.** "Hexages Games güvenlik sistemine kayıt edildi" mesajı, sadece kanıtın toplandığını belirtir — resmi bir kurum kararı değildir. Gerçek ciddi tehditlerde kanıtları (admin panelindeki kayıtlar) alıp doğrudan **emniyet/KOM'a** başvurmanız gerekir.
- Sistem yanlış pozitif üretebilir (özellikle AI değerlendirmesi). Admin panelindeki her kaydı incelemeni öneririz.
- `Manage Messages` izni olmadan bot mesaj silemez — botun rolünü sunucu ayarlarından yeterince yukarıya taşımayı unutma.
