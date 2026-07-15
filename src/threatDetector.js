const { GoogleGenAI } = require('@google/genai');

const API_KEY = process.env.GEMINI_API_KEY?.trim();
if (!API_KEY || !API_KEY.startsWith('AIzaSy')) {
  console.error('[HATA] Geçersiz Gemini API Key!');
}

const ai = new GoogleGenAI({ apiKey: API_KEY });
// MODEL: gemini-flash-lite-latest — Google'ın otomatik güncellenen alias'i.
// gemini-1.5-pro ve tum 1.5 modelleri Google tarafindan kapatildi (404 hatasinin sebebi buydu).
const MODEL_NAME = 'gemini-flash-lite-latest';

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

// --- Yerel yedek tespit (AI tamamen cevapsiz kalirsa devreye girer) ---
// AI cagrisi basarisiz olursa mesajin "guvenli" sayilmasi guvenlik acigidir;
// bu yuzden en azindan acik olum/siddet tehdidi kaliplarini yerel olarak yakalariz.
const LOCAL_THREAT_PATTERNS = [
  /seni?\s+(gebert|öldür|oldur|katled)/i,
  /(canını|canini|hayatını|hayatini)\s+alacağım/i,
  /(seni|onu|sizi)\s+bulup\s+(öldür|oldur|geber)/i,
  /adresini\s+(bulacağım|bulup)/i,
  /kafanı\s+(kopar|patlat)/i,
  /gebereceksin/i,
];

function localHeuristicScan(text) {
  const hit = LOCAL_THREAT_PATTERNS.some((re) => re.test(text));
  return hit
    ? { isDangerous: true, type: 'DEATH_THREAT', reasoning: 'Yerel kalip eslesmesi (AI kullanilamadigi icin yedek kontrol).' }
    : { isDangerous: false, type: 'NONE', reasoning: 'AI kullanilamadi, yerel kontrol de eslesme bulamadi.' };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGeminiWithRetry(params, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      lastErr = err;
      const status = err?.status || err?.error?.code;
      // 400/401/403/404 gibi kalici hatalarda tekrar denemenin anlami yok.
      const retryable = !status || status === 429 || status >= 500;
      if (!retryable || attempt === retries) break;
      await sleep(300 * (attempt + 1));
    }
  }
  throw lastErr;
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

  let rawText;
  try {
    const result = await callGeminiWithRetry({
      model: MODEL_NAME,
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      config: {
        systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
        responseMimeType: 'application/json',
        temperature: 0,
        maxOutputTokens: 200,
      },
    });
    rawText = result.text;
  } catch (err) {
    console.error('[AI] Gemini hatasi (yeniden denemeler tukendi), yerel yedek kontrole geciliyor:', err.message || err);
    return localHeuristicScan(text);
  }

  if (!rawText) {
    console.error('[AI] Gemini bos yanit dondu, yerel yedek kontrole geciliyor.');
    return localHeuristicScan(text);
  }

  try {
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('Parse hatasi, yerel yedek kontrole geciliyor:', rawText);
    return localHeuristicScan(text);
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

module.exports = { analyzeMessage, isValidTCKimlik, findTCKimlikMatches, quickPiiScan, localHeuristicScan };
