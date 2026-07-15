const { GoogleGenerativeAI } = require('@google/generative-ai');

const API_KEY = process.env.GEMINI_API_KEY?.trim();
if (!API_KEY || !API_KEY.startsWith('AIzaSy')) {
  console.error('[HATA] Geçersiz Gemini API Key!');
}

const genAI = new GoogleGenerativeAI(API_KEY);
// MODEL: gemini-1.5-pro (daha kararlı)
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });

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

function quickPiiScan(text) {
  const tcMatches = findTCKimlikMatches(text);
  return { hasTC: tcMatches.length > 0, tcMatches };
}

async function classifyMessage(text, quickScan) {
  if (!text || text.trim().length < 3) {
    return { isDangerous: false, type: 'NONE', reasoning: 'Mesaj cok kisa.' };
  }

  const systemPrompt = `Sen bir Discord sunucusu icin GUVENLIK siniflandirma sistemisin.
Gorevin SADECE su iki kategoriyi tespit etmek:
1. DEATH_THREAT: Birine yonelik olum tehdidi, ciddi siddet tehdidi.
2. PII_LEAK: TC kimlik, ev adresi, telefon gibi kisisel bilgi ifsasi.

ASLA su durumlari isaretleme:
- Kufur, hakaret, argo
- Oyun ici sinirlanma
- Sakalasma, ironi

Yanitini SADECE JSON formatinda ver:
{"isDangerous": true/false, "type": "DEATH_THREAT" | "PII_LEAK" | "BOTH" | "NONE", "reasoning": "kisa aciklama"}`;

  const userContent = quickScan.hasTC
    ? `Mesaj: "${text}"\nTC Kimlik bulundu: ${quickScan.tcMatches.join(', ')}`
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
  if (!rawText) return { isDangerous: false, type: 'NONE', reasoning: 'AI yaniti yok.' };

  try {
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('Parse hatasi:', rawText);
    return { isDangerous: false, type: 'NONE', reasoning: 'Parse hatasi.' };
  }
}

async function analyzeMessage(text) {
  const quickScan = quickPiiScan(text);
  const result = await classifyMessage(text, quickScan);

  if (quickScan.hasTC && !result.isDangerous) {
    return {
      isDangerous: true,
      type: 'PII_LEAK',
      reasoning: 'Gecerli T.C. Kimlik No tespit edildi.',
    };
  }
  return result;
}

module.exports = { analyzeMessage, isValidTCKimlik, findTCKimlikMatches };
