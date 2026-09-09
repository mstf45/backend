import { sendNotification } from '../services/notificationService.js';
import { jsonrepair } from 'jsonrepair';
import express from 'express';
import dotenv from 'dotenv';
import { authenticate } from '../middleware/auth.js';
import User from '../models/User.js';
import CareerRoadmap from '../models/CareerRoadmap.js';

dotenv.config();

const router = express.Router();

/**
 * Google Gemini API üzerinden çok modlu (metin, PDF, görsel) içerik üretir.
 */
async function callGeminiWithParts(parts, systemInstruction = '', responseMimeType = null) {
  dotenv.config();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY sunucuda yapılandırılmamış.');
  }

  const allParts = [];
  if (systemInstruction) {
    allParts.push({ text: '[SİSTEM TALİMATI]: ' + systemInstruction + '\n\n' });
  }
  allParts.push(...parts);

  const payload = {
    contents: [
      {
        parts: allParts
      }
    ],
    generationConfig: {
      maxOutputTokens: 4096,
      temperature: 0.1,
      ...(responseMimeType ? { responseMimeType } : {})
    }
  };

  const models = [
    'gemini-3.5-flash-lite',
    'gemini-flash-lite-latest',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash',
    'gemini-2.5-flash',
    'gemini-flash-latest'
  ];
  let lastError = null;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
          const errMsg = data.error?.message || ('Gemini API Hatası: ' + response.status);
          const isDemandOrQuota = errMsg.includes('high demand') || response.status === 503 || response.status === 429;
          if (isDemandOrQuota && attempt === 0) {
            await new Promise(r => setTimeout(r, 600));
            continue;
          }
          throw new Error(errMsg);
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          return text.trim();
        }
      } catch (err) {
        lastError = err;
        console.warn(`[Gemini] ${model} (deneme ${attempt + 1}) başarısız oldu: ${err.message}`);
        if (!err.message?.includes('high demand') && !err.message?.includes('429') && !err.message?.includes('503')) {
          break;
        }
      }
    }
  }

  throw lastError || new Error('Gemini yanıt üretemedi.');
}

async function callGemini(prompt, systemInstruction = '') {
  return callGeminiWithParts([{ text: prompt }], systemInstruction);
}

// Get Active AI Key/Status from server
router.get('/key', authenticate, (req, res) => {
  dotenv.config();
  const geminiKey = process.env.GEMINI_API_KEY || '';
  const openaiKey = process.env.OPENAI_API_KEY || '';
  res.json({
    activeProvider: geminiKey ? 'gemini' : (openaiKey ? 'openai' : 'none'),
    apiKey: geminiKey || openaiKey,
    hasGemini: !!geminiKey,
    hasOpenAI: !!openaiKey
  });
});

// Generate post content (LinkedIn / Kariyer formatında)
router.post('/generate-post', authenticate, async (req, res) => {
  try {
    const { topic, tone = 'professional', length = 'medium' } = req.body;

    if (!topic || topic.trim().length === 0) {
      return res.status(400).json({ message: 'Lütfen bir konu veya taslak metin belirtin.' });
    }

    const lengthMap = {
      short: '100-150 kelime',
      medium: '200-300 kelime',
      long: '350-500 kelime'
    };

    const systemInstruction = 'Sen kariyer odaklı bir sosyal medya platformu için uzman bir yapay zeka içerik yazarısın. Verilen taslağı profesyonel, akıcı ve etkileyici bir paylaşıma dönüştürürsün.';
    const prompt = 'Kullanıcının kariyer platformunda paylaşmak istediği taslak metin / konu:\n"' + topic + '"\n\nGereksinimler:\n- Bu taslağı ' + tone + ' bir tonda, yaklaşık ' + (lengthMap[length] || '200 kelime') + ' uzunluğunda, etkileyici, profesyonel bir kariyer gönderisine dönüştür.\n- Gönderiye uygun ve popüler Türkçe hashtagler (#) ekle.\n- Kullanıcının dilinde (Türkçe) yanıt ver. Sadece paylaşılacak metni yaz, fazladan selam veya açıklama ekleme.';

    const generatedContent = await callGemini(prompt, systemInstruction);

    res.json({ content: generatedContent });
  } catch (error) {
    console.error('Gemini Post Generation Error:', error);
    res.status(500).json({
      message: 'İçerik üretilirken hata oluştu: ' + (error.message || 'Bilinmeyen hata'),
      error: error.message
    });
  }
});

// Generate job description
router.post('/generate-job-description', authenticate, async (req, res) => {
  try {
    const { profession, title, company, workType, location } = req.body;

    if (!profession || !title || !company) {
      return res.status(400).json({ message: 'Profession, title, and company are required' });
    }

    const workTypeMap = {
      full_time: 'Tam Zamanlı',
      part_time: 'Yarı Zamanlı',
      intern: 'Stajyer'
    };

    const prompt = title + ' pozisyonu için ' + company + ' şirketine ait detaylı ve profesyonel bir iş ilanı açıklaması yaz.\nMeslek: ' + profession + '\nÇalışma Şekli: ' + (workTypeMap[workType] || 'Tam Zamanlı') + '\nKonum: ' + (location || 'Uzaktan / Hibrit') + '\n\nİçermesi gerekenler:\n- Şirket ve rol hakkında ilgi çekici bir giriş\n- Temel sorumluluklar\n- Aranan nitelikler ve yetenekler\n- Tercih sebebi özellikler\n- Yan haklar ve olanaklar\n- Başvuru çağrısı\n\nTürkçe ve son derece profesyonel bir dille yaz.';

    const generatedDescription = await callGemini(prompt, 'Sen İK uzmanı ve profesyonel iş ilanı yazarısın.');

    res.json({ description: generatedDescription });
  } catch (error) {
    console.error('Gemini Job Description Error:', error);
    res.status(500).json({ message: 'İş ilanı oluşturulurken hata: ' + error.message, error: error.message });
  }
});

// Generate content suggestions
router.post('/suggestions', authenticate, async (req, res) => {
  try {
    const { context } = req.body;

    if (!context) {
      return res.status(400).json({ message: 'Context is required' });
    }

    const prompt = context + ' konusu için kariyer platformunda paylaşılabilecek 5 adet özgün içerik fikri üret. Her bir fikir numaralandırılmış olsun.';

    const text = await callGemini(prompt, 'Sen yaratıcı bir kariyer içerik stratejistisin.');

    const suggestions = text
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.replace(/^\d+[.)\s-]*/, '').trim())
      .filter(line => line.length > 0);

    res.json({ suggestions });
  } catch (error) {
    console.error('Gemini Suggestions Error:', error);
    res.status(500).json({ message: 'Öneri üretilirken hata: ' + error.message, error: error.message });
  }
});

function safeParseJson(raw) {
  if (!raw || typeof raw !== 'string') return {};

  // 1. Direct JSON parse
  try {
    return JSON.parse(raw);
  } catch (_) {}

  // 2. Try jsonrepair directly
  try {
    return JSON.parse(jsonrepair(raw));
  } catch (_) {}

  // 3. Clean markdown fences
  const cleaned = raw.replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (_) {}

  try {
    return JSON.parse(jsonrepair(cleaned));
  } catch (_) {}

  // 4. Extract outer JSON object {...}
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const extracted = raw.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(extracted);
    } catch (_) {}
    try {
      return JSON.parse(jsonrepair(extracted));
    } catch (_) {}
  }

  // 5. In-house regex fix for missing commas before next key ("key": ...)
  try {
    const fixedCommas = raw
      .replace(/([0-9]|"|true|false|null|\]|\})\s*\n\s*"/g, '$1,\n"')
      .replace(/,\s*([\]\}])/g, '$1');
    return JSON.parse(fixedCommas);
  } catch (_) {}

  // If all fails, attempt final repair
  return JSON.parse(jsonrepair(raw));
}

// AI CV Parsing (PDF, Görsel veya Metin tabanlı CV analizi)
router.post('/parse-cv', authenticate, async (req, res) => {
  try {
    const file = req.body.file || req.body.cvBase64;
    const text = req.body.text || req.body.cvText;
    const mimeType = req.body.mimeType || 'application/pdf';

    if (!file && !text) {
      return res.status(400).json({ message: 'Lütfen bir CV dosyası (PDF/Görsel) veya CV metni sağlayın.' });
    }

    const parts = [];

    if (file) {
      let cleanBase64 = file;
      let detectedMime = mimeType;
      if (file.startsWith('data:')) {
        const commaIndex = file.indexOf(',');
        if (commaIndex !== -1) {
          const meta = file.substring(5, commaIndex);
          const metaParts = meta.split(';');
          if (metaParts.length > 0 && metaParts[0].includes('/')) {
            detectedMime = metaParts[0];
          }
          cleanBase64 = file.substring(commaIndex + 1);
        }
      }

      // Clean base64 and inspect magic bytes for accurate MIME type
      cleanBase64 = cleanBase64.replace(/\s+/g, '');
      try {
        const prefix = Buffer.from(cleanBase64.substring(0, 32), 'base64');
        if (prefix.length >= 4) {
          if (prefix[0] === 0x25 && prefix[1] === 0x50 && prefix[2] === 0x44 && prefix[3] === 0x46) {
            detectedMime = 'application/pdf';
          } else if (prefix[0] === 0x89 && prefix[1] === 0x50 && prefix[2] === 0x4E && prefix[3] === 0x47) {
            detectedMime = 'image/png';
          } else if (prefix[0] === 0xFF && prefix[1] === 0xD8 && prefix[2] === 0xFF) {
            detectedMime = 'image/jpeg';
          } else if (prefix.length >= 12 && prefix[0] === 0x52 && prefix[1] === 0x49 && prefix[2] === 0x46 && prefix[3] === 0x46) {
            detectedMime = 'image/webp';
          }
        }
      } catch (_) {}

      parts.push({
        inlineData: {
          mimeType: detectedMime,
          data: cleanBase64
        }
      });
    }

    const promptText = 'Sen uzman bir İK ve Kariyer Veri Analiz asistanısın.\n' +
      'Ekteki CV dosyasından / metninden aday bilgilerini çıkar ve SADECE geçerli bir JSON formatında döndür.\n' +
      'Markdown bloğu veya fazladan açıklama yazma.\n\n' +
      'Çıkarılacak alanlar:\n' +
      '- profession: Adayın mesleği / unvanı (ör. "Kıdemli Mobil Geliştirici", "Flutter Developer"). Bulunamazsa null.\n' +
      '- bio: Adayın kariyer özeti / hakkında metni (1-3 cümle). Bulunamazsa adayın mesleğine ve yeteneklerine uygun profesyonel bir özet oluştur.\n' +
      '- phone: Adayın telefon numarası. Bulunamazsa null.\n' +
      '- email: Adayın e-posta adresi. Bulunamazsa null.\n' +
      '- socialLinks: Sosyal medya ve portfolyo linkleri ("linkedin", "github", "twitter", "instagram", "youtube", "medium", "facebook"). Link ya da kullanıcı adı. Bulunmayanlar null olsun.\n' +
      '- experience: Adayın iş ve staj deneyimleri listesi. Her deneyim için:\n' +
      '  - company: Şirket veya kurum adı\n' +
      '  - position: Pozisyon veya unvan\n' +
      '  - startDate: YYYY-MM-DD formatında (gün bilinmiyorsa ayın 1\'i, ör. 2022-01-01)\n' +
      '  - endDate: YYYY-MM-DD formatında veya devam ediyorsa null\n' +
      '  - description: Görev, sorumluluk ve kullanılan teknolojiler özeti (1-2 cümle)\n\n' +
      (text ? ('CV Metin İçeriği:\n' + text + '\n\n') : '') +
      'Lütfen yalnızca aşağıdaki JSON şemasında yanıt ver:\n' +
      '{\n' +
      '  "profession": string or null,\n' +
      '  "bio": string or null,\n' +
      '  "phone": string or null,\n' +
      '  "email": string or null,\n' +
      '  "socialLinks": {\n' +
      '    "linkedin": string or null,\n' +
      '    "github": string or null,\n' +
      '    "twitter": string or null,\n' +
      '    "instagram": string or null,\n' +
      '    "youtube": string or null,\n' +
      '    "medium": string or null,\n' +
      '    "facebook": string or null\n' +
      '  },\n' +
      '  "experience": [\n' +
      '    {\n' +
      '      "company": string,\n' +
      '      "position": string,\n' +
      '      "startDate": string or null,\n' +
      '      "endDate": string or null,\n' +
      '      "description": string\n' +
      '    }\n' +
      '  ]\n' +
      '}';

    parts.push({ text: promptText });

    const rawResult = await callGeminiWithParts(parts, 'Sen CV ayrıştıran bir JSON API servisisin.', 'application/json');

        console.log('Gemini Raw Response length:', rawResult?.length);
    let parsedData = {};
    try {
      parsedData = safeParseJson(rawResult);
    } catch (parseErr) {
      console.error('Failed to parse Gemini output. Raw snippet:', rawResult?.substring(0, 1000));
      throw new Error('Gemini çıktısı JSON formatına dönüştürülemedi: ' + parseErr.message);
    }

    res.json({
      success: true,
      cvData: parsedData
    });
  } catch (error) {
    console.error('CV Parse Error:', error);
    res.status(500).json({
      message: 'CV ayrıştırılırken hata oluştu: ' + (error.message || 'Bilinmeyen hata'),
      error: error.message
    });
  }
});

function parseSafeDate(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str) return null;

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  const ymMatch = str.match(/\b(19\d\d|20\d\d)[-/.](\d{1,2})\b/);
  if (ymMatch) {
    const y = ymMatch[1];
    const m = ymMatch[2].padStart(2, '0');
    const d = new Date(`${y}-${m}-01`);
    if (!isNaN(d.getTime())) return d;
  }

  const yearMatch = str.match(/\b(19\d\d|20\d\d)\b/);
  if (yearMatch) {
    const d = new Date(`${yearMatch[1]}-01-01`);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

// Apply CV data directly to User profile
router.post('/apply-cv-to-profile', authenticate, async (req, res) => {
  try {
    const { cvData } = req.body;
    if (!cvData) {
      return res.status(400).json({ message: 'cvData is required' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // 1. Profession
    if (cvData.profession && typeof cvData.profession === 'string' && cvData.profession.trim().length > 0) {
      user.profession = cvData.profession.trim();
    }

    // 2. Bio
    if (cvData.bio && typeof cvData.bio === 'string' && cvData.bio.trim().length > 0) {
      user.bio = cvData.bio.trim();
    }

    // 3. Phone (update if user provided and valid)
    if (cvData.phone && typeof cvData.phone === 'string' && cvData.phone.trim().length > 0) {
      user.phone = cvData.phone.trim();
    }

    // 4. Social Links (merge with existing)
    if (cvData.socialLinks && typeof cvData.socialLinks === 'object') {
      user.socialLinks = user.socialLinks || {};
      for (const [key, value] of Object.entries(cvData.socialLinks)) {
        if (value && typeof value === 'string' && value.trim().length > 0) {
          user.socialLinks[key] = value.trim();
        }
      }
    }

    // 5. Experience (add new experiences or merge)
    if (Array.isArray(cvData.experience) && cvData.experience.length > 0) {
      user.experience = user.experience || [];
      for (const exp of cvData.experience) {
        if (exp.company && exp.position) {
          const exists = user.experience.some(e => 
            e.company?.toLowerCase() === exp.company?.toLowerCase() &&
            e.position?.toLowerCase() === exp.position?.toLowerCase()
          );
          if (!exists) {
            user.experience.push({
              company: exp.company,
              position: exp.position,
              startDate: parseSafeDate(exp.startDate),
              endDate: parseSafeDate(exp.endDate),
              description: exp.description || ''
            });
          }
        }
      }
    }

    user.updatedAt = Date.now();
    await user.save();

    const userObj = user.toObject();
    delete userObj.password;

    res.json({
      success: true,
      message: 'CV bilgileri başarıyla profilinize aktarıldı!',
      user: userObj
    });
  } catch (error) {
    console.error('Apply CV Error:', error);
    res.status(500).json({
      message: 'Profil güncellenirken hata oluştu: ' + error.message,
      error: error.message
    });
  }
});


/**
 * Kullanıcının mevcut kariyer yol haritasını getirir
 */
router.get('/career-roadmap', authenticate, async (req, res) => {
  try {
    const roadmap = await CareerRoadmap.findOne({ user: req.user._id });
    if (roadmap && Array.isArray(roadmap.milestones)) {
      let prevPassed = true;
      let needsSave = false;
      for (let i = 0; i < roadmap.milestones.length; i++) {
        const m = roadmap.milestones[i];
        if (i === 0) {
          if (!m.isUnlocked) {
            m.isUnlocked = true;
            needsSave = true;
          }
        } else {
          const shouldBeUnlocked = prevPassed;
          if (m.isUnlocked !== shouldBeUnlocked) {
            m.isUnlocked = shouldBeUnlocked;
            needsSave = true;
          }
        }
        const isCurrentPassed = m.phaseExamPassed || (m.actionItems.length > 0 && m.actionItems.every(a => a.completed && a.isLockedCompleted));
        if (!isCurrentPassed) {
          prevPassed = false;
        }
      }
      if (needsSave) {
        await roadmap.save();
      }
    }
    res.json({
      success: true,
      roadmap: roadmap || null
    });
  } catch (error) {
    console.error('Get Career Roadmap Error:', error);
    res.status(500).json({
      success: false,
      message: 'Kariyer haritası yüklenirken hata oluştu: ' + error.message
    });
  }
});

/**
 * Gemini AI ile kullanıcıya özel kariyer yol haritası oluşturur
 */
router.post('/career-roadmap', authenticate, async (req, res) => {
  try {
    const { targetRole, targetTimeframe, weeklyCommitment, customFocus } = req.body;

    if (!targetRole || typeof targetRole !== 'string' || !targetRole.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Lütfen hedeflediğiniz kariyer rolünü belirtin.'
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Kullanıcı bulunamadı.'
      });
    }

    const experiencesSummary = (user.experience || []).map(exp => {
      const dates = [
        exp.startDate ? new Date(exp.startDate).toISOString().slice(0, 7) : '',
        exp.endDate ? new Date(exp.endDate).toISOString().slice(0, 7) : 'Halen'
      ].filter(Boolean).join(' - ');
      return `- ${exp.position} @ ${exp.company} (${dates}): ${exp.description || ''}`;
    }).join('\n');

    const systemInstruction = `Sen dünyanın en iyi kıdemli kariyer mentoru, teknoloji lideri ve kariyer koçusun.
Kullanıcının mevcut profesyonel profilini ve hedeflediği yeni pozisyonu inceleyerek ona özel, gerçekçi, adım adım ve motive edici bir Kariyer Yol Haritası (Career Roadmap) hazırlayacaksın.

Gereksinimler:
1. Türkçe dilinde, profesyonel, yapıcı ve samimi bir üslup kullan.
2. Yol haritasını 3 veya 4 net aşamaya (milestones) böl. Her aşama belirli bir zaman dilimini (örn. Ay 1-2) ve odaklanılacak 3-5 temel konuyu içermeli.
3. Her aşama için tamamlanabilir, somut 2-4 adet aksiyon maddesi (actionItems) yaz (örn: "Clean Architecture kullanarak bir Flutter örnek projesi geliştir").
4. Her aşamaya 1-2 adet kaliteli öğrenme kaynağı tavsiyesi (recommendedResources: Doküman, Kitap, Kurs, Video veya GitHub Reposu) ekle. "url" alanına bu kaynağın gerçek, doğrudan resmi web sitesi veya dokümantasyon bağlantısını (örn: "https://docs.flutter.dev", "https://roadmap.sh", "https://github.com/...", "https://developer.mozilla.org/..." vb.) MUTLAKA yaz. Asla boş bırakma.
5. Kullanıcının mevcut yetenekleri ile hedef unvan arasındaki boşluğu net bir şekilde tespit et (skillGapAnalysis: strengths ve toImprove).
6. Hedef rol için sektörde en çok saygı gören 2-3 sertifikayı (recommendedCertifications) ve stratejik kariyer tavsiyelerini (careerAdvice) ekle.
7. Çıktı SADECE geçerli bir JSON nesnesi olmalıdır. Ek açıklama veya markdown bloğu yazma.`;

    const promptText = `Kullanıcı Bilgileri:
- Kullanıcı Adı: ${user.username || 'Kullanıcı'}
- Mevcut Unvan/Meslek: ${user.profession || 'Belirtilmemiş'}
- Biyografi/Özet: ${user.bio || 'Yok'}
- Geçmiş İş Deneyimleri:
${experiencesSummary || 'Kayıtlı geçmiş deneyim bulunmuyor.'}

Kullanıcının Hedefi:
- Hedeflenen Rol / Pozisyon: ${targetRole}
- Hedeflenen Süre: ${targetTimeframe || '6-12 Ay'}
- Haftalık Ayırabileceği Süre: ${weeklyCommitment || '5-10 Saat'}
${customFocus ? `- Özel Odaklanmak İstediği Alanlar: ${customFocus}` : ''}

Lütfen yukarıdaki profil ve hedef doğrultusunda şu JSON şemasında yanıt ver:
{
  "targetRole": "${targetRole}",
  "currentLevel": "Junior / Mid / Senior vb. tespit edilen seviye",
  "targetTimeframe": "${targetTimeframe || '6-12 Ay'}",
  "weeklyCommitment": "${weeklyCommitment || '5-10 Saat'}",
  "summary": "Kullanıcının mevcut durumundan hedefine ulaşması için 2-3 cümlelik motive edici stratejik özet",
  "skillGapAnalysis": {
    "strengths": ["Zaten sahip olduğu 3-5 güçlü yetenek"],
    "toImprove": ["Kazanması gereken 3-5 kritik yetenek"]
  },
  "milestones": [
    {
      "id": "phase_1",
      "phase": "1. Aşama: Başlık",
      "timeframe": "Ay 1 - 2",
      "description": "Bu aşamada ne yapılacağı ve odak noktası",
      "topics": ["Konu 1", "Konu 2", "Konu 3"],
      "actionItems": [
        { "id": "m1_t1", "title": "Somut görev 1", "completed": false },
        { "id": "m1_t2", "title": "Somut görev 2", "completed": false }
      ],
      "recommendedResources": [
        { "title": "Kaynak Adı", "type": "Doküman / Kurs / Kitap", "url": "" }
      ]
    }
  ],
  "recommendedCertifications": ["Sertifika 1", "Sertifika 2"],
  "careerAdvice": ["Kariyer ve mülakat tavsiyesi 1", "Tavsiye 2"]
}`;

    const rawResult = await callGeminiWithParts(
      [{ text: promptText }],
      systemInstruction,
      'application/json'
    );

    const roadmapData = safeParseJson(rawResult);

    if (!roadmapData || !Array.isArray(roadmapData.milestones) || roadmapData.milestones.length === 0) {
      throw new Error('Yapay zeka yol haritası oluşturamadı. Lütfen tekrar deneyin.');
    }

    const cleanMilestones = roadmapData.milestones.map((m, idx) => ({
      id: m.id || `phase_${idx + 1}`,
      phase: m.phase || `${idx + 1}. Aşama`,
      timeframe: m.timeframe || '',
      description: m.description || '',
      topics: Array.isArray(m.topics) ? m.topics : [],
      isUnlocked: idx === 0,
      phaseExamPassed: false,
      phaseExamScore: 0,
      actionItems: (m.actionItems || []).map((item, itemIdx) => ({
        id: item.id || `m${idx + 1}_t${itemIdx + 1}`,
        title: item.title || 'Aksiyon maddesi',
        completed: false,
        isLockedCompleted: false,
        bestScore: 0
      })),
      recommendedResources: (m.recommendedResources || []).map(r => ({
        title: r.title || 'Öğrenme Kaynağı',
        type: r.type || 'Döküman',
        url: r.url || ''
      }))
    }));

    const cleanStrengths = Array.isArray(roadmapData.skillGapAnalysis?.strengths) 
      ? roadmapData.skillGapAnalysis.strengths 
      : [];
    const cleanToImprove = Array.isArray(roadmapData.skillGapAnalysis?.toImprove)
      ? roadmapData.skillGapAnalysis.toImprove
      : [];

    const savedRoadmap = await CareerRoadmap.findOneAndUpdate(
      { user: req.user._id },
      {
        user: req.user._id,
        targetRole: roadmapData.targetRole || targetRole,
        currentLevel: roadmapData.currentLevel || 'Gelişim Aşaması',
        targetTimeframe: roadmapData.targetTimeframe || targetTimeframe || '6-12 Ay',
        weeklyCommitment: roadmapData.weeklyCommitment || weeklyCommitment || '5-10 Saat',
        summary: roadmapData.summary || '',
        skillGapAnalysis: {
          strengths: cleanStrengths,
          toImprove: cleanToImprove
        },
        milestones: cleanMilestones,
        recommendedCertifications: Array.isArray(roadmapData.recommendedCertifications) ? roadmapData.recommendedCertifications : [],
        careerAdvice: Array.isArray(roadmapData.careerAdvice) ? roadmapData.careerAdvice : [],
        updatedAt: Date.now()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({
      success: true,
      message: 'Kariyer yol haritanız başarıyla oluşturuldu!',
      roadmap: savedRoadmap
    });

  } catch (error) {
    console.error('Generate Career Roadmap Error:', error);
    res.status(500).json({
      success: false,
      message: 'Kariyer yol haritası oluşturulurken hata oluştu: ' + error.message,
      error: error.message
    });
  }
});

/**
 * Yol haritasındaki bir görevin durumunu tamamlandı / tamamlanmadı olarak günceller
 */
router.patch('/career-roadmap/task', authenticate, async (req, res) => {
  try {
    const { milestoneId, taskId, completed } = req.body;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        message: 'Görev kimliği (taskId) belirtilmelidir.'
      });
    }

    const roadmap = await CareerRoadmap.findOne({ user: req.user._id });
    if (!roadmap) {
      return res.status(404).json({
        success: false,
        message: 'Kariyer haritası bulunamadı.'
      });
    }

    let found = false;
    for (const milestone of roadmap.milestones) {
      if (!milestoneId || milestone.id === milestoneId) {
        for (const item of milestone.actionItems) {
          if (item.id === taskId) {
            if (item.isLockedCompleted && completed === false) {
              return res.status(400).json({
                success: false,
                message: 'Bu görev 5/5 sınav başarısıyla onaylanmıştır ve geri kaldırılamaz.'
              });
            }
            item.completed = typeof completed === 'boolean' ? completed : !item.completed;
            found = true;
            break;
          }
        }
      }
      if (found) break;
    }

    if (!found) {
      return res.status(404).json({
        success: false,
        message: 'Belirtilen görev yol haritasında bulunamadı.'
      });
    }

    roadmap.updatedAt = Date.now();
    await roadmap.save();

    res.json({
      success: true,
      message: 'Görev durumu güncellendi.',
      roadmap
    });
  } catch (error) {
    console.error('Update Task Error:', error);
    res.status(500).json({
      success: false,
      message: 'Görev güncellenirken hata oluştu: ' + error.message,
      error: error.message
    });
  }
});


/**
 * Aksiyon maddesi (Görev) için kolaydan zora 5 adet soru üretir
 */
router.post('/career-roadmap/task-quiz', authenticate, async (req, res) => {
  try {
    const { milestoneId, taskId } = req.body;
    if (!taskId) {
      return res.status(400).json({ success: false, message: 'taskId gereklidir.' });
    }

    const roadmap = await CareerRoadmap.findOne({ user: req.user._id });
    if (!roadmap) {
      return res.status(404).json({ success: false, message: 'Kariyer haritası bulunamadı.' });
    }

    let targetMilestone = null;
    let targetTask = null;

    for (const m of roadmap.milestones) {
      if (!milestoneId || m.id === milestoneId) {
        const item = m.actionItems.find(a => a.id === taskId);
        if (item) {
          targetMilestone = m;
          targetTask = item;
          break;
        }
      }
    }

    if (!targetTask) {
      return res.status(404).json({ success: false, message: 'Görev bulunamadı.' });
    }

    // Faz kilit kontrolü: Eğer bu faz kilitliyse veya önceki fazlar tamamlanmadıysa AI soruları açılamaz!
    const milestoneIdx = roadmap.milestones.findIndex(m => m.id === targetMilestone.id);
    if (milestoneIdx > 0) {
      for (let i = 0; i < milestoneIdx; i++) {
        const prevM = roadmap.milestones[i];
        const prevPassed = prevM.phaseExamPassed || (prevM.actionItems.length > 0 && prevM.actionItems.every(a => a.completed && a.isLockedCompleted));
        if (!prevPassed) {
          return res.status(403).json({
            success: false,
            message: `Bu aşama kilitlidir! Diğer fazların aksiyon sorularına geçebilmek için lütfen önce "${prevM.phase || `${i + 1}. Aşama`}" görevlerini 5'te 5 yaparak tamamlayın veya seviye atlama sınavını geçin.`
          });
        }
      }
      if (!targetMilestone.isUnlocked) {
        return res.status(403).json({
          success: false,
          message: 'Bu aşama kilitlidir. Önceki aşamayı tamamlamadan bu aşamanın soruları açılamaz.'
        });
      }
    }

    const systemInstruction = `Sen dünyanın en iyi teknik mülakatçısı ve kıdemli eğitmenisin.
Kullanıcının verilen kariyer hedefi ve tamamlamak istediği görev için tam 5 adet çoktan seçmeli soru hazırlayacaksın.

Önemli Kurallar:
1. Sorular kesinlikle KOLAYDAN ZORA doğru sıralanmalıdır:
   - Soru 1 ve 2: Kolay (Temel kavramlar, anahtar kelimeler, basit kullanım).
   - Soru 3 ve 4: Orta Seviye (Gerçek hayat senaryoları, yaygın hatalar, best practice).
   - Soru 5: İleri Düzey (Mimari kararlar, performans, edge caseler, kurumsal yaklaşım).
2. Her soru için 4 seçenek (A, B, C, D) oluştur.
3. correctIndex 0, 1, 2 veya 3 olmalıdır.
4. "explanation" objesi çok detaylı ve öğretici olmalıdır:
   - "mistakeReason": Yanlış seçeneklerin neden yanıltıcı olduğu veya adayların neden yanıldığı.
   - "concept": Doğru cevabın arkasındaki ana prensip.
   - "codeExample": Kısa, aydınlatıcı bir kod veya mimari kural örneği.
   - "recommendedResource": Konuyu derinlemesine öğrenmek için resmi doküman veya kaynak önerisi.
5. Türkçe, profesyonel ve cesaretlendirici bir dil kullan.
6. Çıktı SADECE geçerli bir JSON nesnesi olmalıdır.`;

    const promptText = `Hedef Rol: ${roadmap.targetRole}
Aşama: ${targetMilestone?.phase || ''} - ${targetMilestone?.description || ''}
Görev (Aksiyon Maddesi): ${targetTask.title}

Lütfen yukarıdaki görev ve hedef doğrultusunda şu JSON şemasında 5 soru üret:
{
  "taskId": "${taskId}",
  "taskTitle": "${targetTask.title}",
  "questions": [
    {
      "id": "q1",
      "difficulty": "Kolay",
      "question": "Soru metni?",
      "options": ["Seçenek A", "Seçenek B", "Seçenek C", "Seçenek D"],
      "correctIndex": 0,
      "explanation": {
        "mistakeReason": "Bu soruda genellikle X ile Y karıştırılır...",
        "concept": "Doğru yaklaşım şudur...",
        "codeExample": "// Örnek kullanım",
        "recommendedResource": "Flutter docs veya resmi kaynak"
      }
    }
  ]
}`;

    const rawResult = await callGeminiWithParts(
      [{ text: promptText }],
      systemInstruction,
      'application/json'
    );

    const data = safeParseJson(rawResult);
    if (!data || !Array.isArray(data.questions) || data.questions.length === 0) {
      throw new Error('Sınav soruları oluşturulamadı.');
    }

    res.json({
      success: true,
      taskId,
      taskTitle: targetTask.title,
      isLockedCompleted: targetTask.isLockedCompleted || false,
      questions: data.questions
    });
  } catch (error) {
    console.error('Task Quiz Error:', error);
    res.status(500).json({
      success: false,
      message: 'Sınav soruları yüklenirken hata oluştu: ' + error.message
    });
  }
});

/**
 * Görev sınavı sonucunu değerlendirir; 5/5 yapıldıysa kalıcı olarak kilitler
 */
router.post('/career-roadmap/submit-task-quiz', authenticate, async (req, res) => {
  try {
    const { milestoneId, taskId, score } = req.body;
    const finalScore = Number(score) || 0;

    const roadmap = await CareerRoadmap.findOne({ user: req.user._id });
    if (!roadmap) {
      return res.status(404).json({ success: false, message: 'Kariyer haritası bulunamadı.' });
    }

    let targetMilestone = null;
    let targetTask = null;

    for (const m of roadmap.milestones) {
      if (!milestoneId || m.id === milestoneId) {
        const item = m.actionItems.find(a => a.id === taskId);
        if (item) {
          targetMilestone = m;
          targetTask = item;
          break;
        }
      }
    }

    if (!targetTask) {
      return res.status(404).json({ success: false, message: 'Görev bulunamadı.' });
    }

    targetTask.bestScore = Math.max(targetTask.bestScore || 0, finalScore);

    if (finalScore >= 5) {
      targetTask.completed = true;
      targetTask.isLockedCompleted = true; // Artık geri kaldırılamaz

      // Eğer bu fazdaki TÜM görevler tamamlandıysa bir sonraki fazın kilidini aç!
      const allPhaseTasksDone = targetMilestone.actionItems.every(a => a.completed && a.isLockedCompleted);
      if (allPhaseTasksDone) {
        const currentPhaseIdx = roadmap.milestones.findIndex(m => m.id === targetMilestone.id);
        if (currentPhaseIdx !== -1 && currentPhaseIdx + 1 < roadmap.milestones.length) {
          roadmap.milestones[currentPhaseIdx + 1].isUnlocked = true;
        }
      }
    }

    // Genel harita tamamlandı mı kontrol et
    const allCompleted = roadmap.milestones.every(m => 
      m.actionItems.every(a => a.completed)
    );

    if (allCompleted && !roadmap.isCompleted) {
      roadmap.isCompleted = true;
      const certId = 'PC-' + Math.random().toString(36).substring(2, 9).toUpperCase();
      sendNotification({
        recipientId: req.user._id,
        title: 'Tebrikler! Sertifikanız Hazır 🏆',
        message: `"${roadmap.targetRole}" kariyer hedefinizi tamamladınız ve Pro Career Doğrulanmış Sertifikası kazandınız!`,
        type: 'roadmap_completed',
        data: { role: roadmap.targetRole, certId }
      }).catch(err => console.warn('[RoadmapCert] Bildirim hatası:', err.message));
      const cert = {
        certificateId: certId,
        title: `Pro Career: ${roadmap.targetRole} Uzmanlık Sertifikası`,
        targetRole: roadmap.targetRole,
        issuedAt: new Date(),
        verificationCode: 'VERIFY-' + Date.now().toString(36).toUpperCase(),
        score: 100
      };
      roadmap.certificate = cert;

      const badge = {
        id: 'badge_hero_' + Date.now(),
        title: `${roadmap.targetRole} Mezunu`,
        icon: 'workspace_premium_rounded',
        description: 'Tüm aşamaları ve sınavları başarıyla tamamladı.',
        earnedAt: new Date()
      };
      roadmap.badges = roadmap.badges || [];
      roadmap.badges.push(badge);

      const user = await User.findById(req.user._id);
      if (user) {
        user.certificates = user.certificates || [];
        user.certificates.push(cert);
        user.badges = user.badges || [];
        user.badges.push(badge);
        await user.save();
      }
    }

    roadmap.updatedAt = Date.now();
    await roadmap.save();

    res.json({
      success: true,
      passed: finalScore >= 5,
      score: finalScore,
      isLockedCompleted: targetTask.isLockedCompleted,
      isRoadmapCompleted: roadmap.isCompleted,
      roadmap
    });
  } catch (error) {
    console.error('Submit Quiz Error:', error);
    res.status(500).json({
      success: false,
      message: 'Sınav sonucu kaydedilirken hata oluştu: ' + error.message
    });
  }
});

/**
 * Fazın tüm konularını kapsayan 10 soruluk karma telafi/seviye sınavı üretir
 */
router.post('/career-roadmap/phase-exam', authenticate, async (req, res) => {
  try {
    const { milestoneId } = req.body;
    if (!milestoneId) {
      return res.status(400).json({ success: false, message: 'milestoneId gereklidir.' });
    }

    const roadmap = await CareerRoadmap.findOne({ user: req.user._id });
    if (!roadmap) {
      return res.status(404).json({ success: false, message: 'Kariyer haritası bulunamadı.' });
    }

    const milestone = roadmap.milestones.find(m => m.id === milestoneId);
    if (!milestone) {
      return res.status(404).json({ success: false, message: 'Aşama bulunamadı.' });
    }

    const taskTitles = milestone.actionItems.map(a => a.title).join(', ');
    const topicsList = milestone.topics.join(', ');

    const systemInstruction = `Sen dünyanın en iyi teknik değerlendirme uzmanısın.
Bu aşamada öğrenilen tüm konuları kapsayan 10 adet kaliteli, karma ve öğretici çoktan seçmeli soru hazırlayacaksın.

Önemli Kurallar:
1. Toplam 10 soru olmalıdır.
2. Sorular aşamadaki konular ve görevler arasından dengeli dağıtılmalıdır (3 Kolay, 4 Orta, 3 İleri Düzey).
3. Her soru 4 seçenekli olmalı (correctIndex: 0..3).
4. Her soruda "explanation" nesnesi:
   - "mistakeReason": Yaygın hata nedeni.
   - "concept": Doğru prensip.
   - "codeExample": Örnek kod/mimari.
   - "recommendedResource": Kaynak linki veya adı.
5. Çıktı SADECE geçerli bir JSON olmalıdır.`;

    const promptText = `Hedef Rol: ${roadmap.targetRole}
Aşama: ${milestone.phase}
Açıklama: ${milestone.description}
Konular: ${topicsList || 'Genel Konular'}
Görevler: ${taskTitles}

Lütfen bu aşama için 10 soruluk karma sınavı şu JSON şemasında oluştur:
{
  "milestoneId": "${milestoneId}",
  "phaseTitle": "${milestone.phase}",
  "questions": [
    {
      "id": "q1",
      "difficulty": "Orta",
      "question": "Soru metni?",
      "options": ["A", "B", "C", "D"],
      "correctIndex": 0,
      "explanation": {
        "mistakeReason": "...",
        "concept": "...",
        "codeExample": "...",
        "recommendedResource": "..."
      }
    }
  ]
}`;

    const rawResult = await callGeminiWithParts(
      [{ text: promptText }],
      systemInstruction,
      'application/json'
    );

    const data = safeParseJson(rawResult);
    if (!data || !Array.isArray(data.questions) || data.questions.length === 0) {
      throw new Error('Faz sınavı soruları oluşturulamadı.');
    }

    res.json({
      success: true,
      milestoneId,
      phaseTitle: milestone.phase,
      questions: data.questions
    });
  } catch (error) {
    console.error('Phase Exam Error:', error);
    res.status(500).json({
      success: false,
      message: 'Faz sınavı yüklenirken hata oluştu: ' + error.message
    });
  }
});

/**
 * Faz sınavı sonucunu değerlendirir; başarılı ise bir sonraki fazın kilidini açar
 */
router.post('/career-roadmap/submit-phase-exam', authenticate, async (req, res) => {
  try {
    const { milestoneId, score, total } = req.body;
    const finalScore = Number(score) || 0;
    const totalQuestions = Number(total) || 10;
    const passed = finalScore >= Math.ceil(totalQuestions * 0.7); // %70 üzeri başarılı

    const roadmap = await CareerRoadmap.findOne({ user: req.user._id });
    if (!roadmap) {
      return res.status(404).json({ success: false, message: 'Kariyer haritası bulunamadı.' });
    }

    const milestoneIndex = roadmap.milestones.findIndex(m => m.id === milestoneId);
    if (milestoneIndex === -1) {
      return res.status(404).json({ success: false, message: 'Aşama bulunamadı.' });
    }

    const milestone = roadmap.milestones[milestoneIndex];
    milestone.phaseExamScore = Math.max(milestone.phaseExamScore || 0, finalScore);

    let nextUnlocked = false;
    if (passed) {
      milestone.phaseExamPassed = true;
      // Bir sonraki fazın kilidini aç
      if (milestoneIndex + 1 < roadmap.milestones.length) {
        roadmap.milestones[milestoneIndex + 1].isUnlocked = true;
        nextUnlocked = true;
      }
    }

    // Tüm fazlar tamamlandıysa veya tüm faz sınavları geçildiyse sertifika ver!
    const allPhasesPassed = roadmap.milestones.every(m => m.phaseExamPassed || m.actionItems.every(a => a.completed));
    if (allPhasesPassed && !roadmap.isCompleted) {
      roadmap.isCompleted = true;
      const certId = 'PC-' + Math.random().toString(36).substring(2, 9).toUpperCase();
      const cert = {
        certificateId: certId,
        title: `Pro Career: ${roadmap.targetRole} Başarı Sertifikası`,
        targetRole: roadmap.targetRole,
        issuedAt: new Date(),
        verificationCode: 'VERIFY-' + Date.now().toString(36).toUpperCase(),
        score: Math.round((finalScore / totalQuestions) * 100)
      };
      roadmap.certificate = cert;

      const badge = {
        id: 'badge_champ_' + Date.now(),
        title: `${roadmap.targetRole} Şampiyonu`,
        icon: 'workspace_premium_rounded',
        description: 'Tüm aşamaları ve faz sınavlarını başarıyla geçti.',
        earnedAt: new Date()
      };
      roadmap.badges = roadmap.badges || [];
      roadmap.badges.push(badge);

      const user = await User.findById(req.user._id);
      if (user) {
        user.certificates = user.certificates || [];
        user.certificates.push(cert);
        user.badges = user.badges || [];
        user.badges.push(badge);
        await user.save();
      }
    }

    roadmap.updatedAt = Date.now();
    await roadmap.save();

    res.json({
      success: true,
      passed,
      score: finalScore,
      total: totalQuestions,
      nextUnlocked,
      isRoadmapCompleted: roadmap.isCompleted,
      certificate: roadmap.certificate,
      roadmap
    });
  } catch (error) {
    console.error('Submit Phase Exam Error:', error);
    res.status(500).json({
      success: false,
      message: 'Faz sınavı sonucu kaydedilirken hata oluştu: ' + error.message
    });
  }
});

export default router;
