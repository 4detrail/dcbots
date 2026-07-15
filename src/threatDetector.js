const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

/**
 * Gecerli bir T.C. Kimlik No mu diye resmi algoritmayla dogrular.
 * Sadece 11 haneli sayi gormek yetmez, algoritma da tutmali -
 * boylece rastgele 11 haneli sayilar (telefon, discord id vs.) yanlislikla
 * TC kimlik olarak isaretlenmez.
 */
function isValidTCKimlik(numStr) {
  if (!/^[1-9][0-9]{10}$/.test(numStr)) return false;
  const digits = numStr.split('').map(Number);
  const oddSum = digits[0] + digits[2] + digits[4] + digits[6] + digits[8];
  const evenSum = digits[1] + digits[3] + digits[5] + digits[7];
  const d10 = ((oddSum * 7) - evenSum) % 10;
  if (d10 !== digits[9]) return false;
  const first10Sum = digits.slice(0, 10).reduce((a, b) => a + b, 0);
  const d11 = first10Sum % 10;
  return d11 === digits[10];
}

function findTCKimlikMatches(text) {
  const candidates = text.match(/\b\d{11}\b/g) || [];
  return candidates.filter(isValidTCKimlik);
}

/**
 * Hizli regex on-filtre: bariz TC kimlik no varsa direkt PII_LEAK olarak isaretle,
 * boylece her mesaj icin AI cagrisi yapmaya gerek kalmaz.
 */
function quickPiiScan(text) {
  const tcMatches = findTCKimlikMatches(text);
  return {
    hasTC: tcMatches.length > 0,
    tcMatches,
  };
}

/**
 * AI destekli siniflandirma: sadece GERCEKTEN tehlikeli icerigi isaretler.
 * Kufur, hakaret, sinirlanma gibi normal olumsuz konusma DISLANIR.
 * Sadece: olum tehditleri, siddet tehditleri, adres/konum ifsasi,
 * TC kimlik/kisisel kimlik bilgisi paylasimi, dogxing amacli bilgi paylasimi.
 */
async function classifyMessage(text, quickScan) {
  // Hicbir tehlike belirtisi tasimayan cok kisa/boş mesajlarda AI cagrisini atla
  if (!text || text.trim().length < 3) {
    return { isDangerous: false, type: 'NONE', reasoning: 'Mesaj cok kisa.' };
  }

  const systemPrompt = `Sen bir Discord sunucusu icin GUVENLIK siniflandirma sistemisin.
Gorevin SADECE su iki kategoriyi tespit etmek:
1. DEATH_THREAT: Birine yonelik olum tehdidi, ciddi siddet tehdidi, "seni oldurecegim", "evini basacagim" gibi ifadeler.
2. PII_LEAK: Bir kisinin TC kimlik numarasi, ev adresi, telefon numarasi, is yeri adresi gibi kisisel/hassas bilgisinin ifsa edilmesi (dogxing).

ASLA su durumlari isaretleme:
- Sıradan kufur, hakaret, argo ("amk", "salak", "aptal" vb.)
- Oyun ici sinirlanma, sohbet tartismasi
- Sakalasma, ironi, abartili ifadeler (baglamdan sakalaşma oldugu belliyse)
- Genel negatiflik, kizginlik ifade eden ama tehdit icermeyen mesajlar

SADECE gercekten tehlikeli, ciddi ve somut tehdit/ifsa iceren mesajlari isaretle.
Emin degilsen, isaretleme (false positive'den kacin).

Yanitini SADECE su JSON formatinda ver, baska hicbir metin ekleme:
{"isDangerous": true/false, "type": "DEATH_THREAT" | "PII_LEAK" | "BOTH" | "NONE", "reasoning": "kisa aciklama (turkce, max 20 kelime)"}`;

  const userContent = quickScan.hasTC
    ? `Mesaj: "${text}"\n\nNot: Bu mesajda gecerli bir T.C. Kimlik No formatinda sayi tespit edildi: ${quickScan.tcMatches.join(', ')}`
    : `Mesaj: "${text}"`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userContent }] }],
    systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0,
      maxOutputTokens: 200,
    },
  });

  const rawText = result.response.text();

  if (!rawText) {
    return { isDangerous: false, type: 'NONE', reasoning: 'AI yaniti alinamadi.' };
  }

  try {
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return parsed;
  } catch (err) {
    console.error('AI yaniti parse edilemedi:', rawText);
    return { isDangerous: false, type: 'NONE', reasoning: 'Parse hatasi.' };
  }
}

async function analyzeMessage(text) {
  const quickScan = quickPiiScan(text);
  const result = await classifyMessage(text, quickScan);

  // Regex ile kesin TC kimlik bulunduysa, AI "false" dese bile PII_LEAK olarak isaretle
  // (guvenlik tarafinda hata payini asagi cekmek icin)
  if (quickScan.hasTC && !result.isDangerous) {
    return {
      isDangerous: true,
      type: 'PII_LEAK',
      reasoning: 'Gecerli T.C. Kimlik No formati tespit edildi (regex dogrulama).',
    };
  }

  return result;
}

module.exports = { analyzeMessage, isValidTCKimlik, findTCKimlikMatches };
