import express from 'express';
import dotenv from 'dotenv';
import { authenticate } from '../middleware/auth.js';
import User from '../models/User.js';

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
      maxOutputTokens: 2500,
      temperature: 0.2,
      ...(responseMimeType ? { responseMimeType } : {})
    }
  };

  const models = ['gemini-2.5-flash', 'gemini-flash-latest'];
  let lastError = null;

  for (const model of models) {
    try {
      const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || ('Gemini API Hatası: ' + response.status));
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        return text.trim();
      }
    } catch (err) {
      lastError = err;
      console.warn('Gemini model ' + model + ' başarısız oldu, diğer model deneniyor: ' + err.message);
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

      parts.push({
        inline_data: {
          mime_type: detectedMime,
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

    let parsedData = {};
    try {
      parsedData = JSON.parse(rawResult);
    } catch (parseErr) {
      const cleaned = rawResult.replace(/^```jsons*/i, '').replace(/```s*$/i, '').trim();
      parsedData = JSON.parse(cleaned);
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
              startDate: exp.startDate ? new Date(exp.startDate) : null,
              endDate: exp.endDate ? new Date(exp.endDate) : null,
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

export default router;
