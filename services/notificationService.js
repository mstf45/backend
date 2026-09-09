import Notification from '../models/Notification.js';
import dotenv from 'dotenv';
dotenv.config();

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID || '5ec1dd1a-03c8-42dd-a545-96d99ce1f9c0';
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY || '';

/**
 * Merkezi Bildirim Servisi.
 * Hem veritabanına (MongoDB Notification) kaydeder hem de OneSignal üzerinden push bildirim gönderir.
 * 
 * @param {Object} options
 * @param {string|mongoose.Types.ObjectId} options.recipientId - Bildirimi alacak kullanıcının ID'si
 * @param {string|mongoose.Types.ObjectId} [options.senderId] - Bildirimi tetikleyen kullanıcının ID'si
 * @param {string} options.title - Bildirim başlığı
 * @param {string} options.message - Bildirim içeriği
 * @param {string} [options.type='info'] - Bildirim tipi (like, comment, message, application, cv_review, job_limit, job_expired, roadmap)
 * @param {Object} [options.data={}] - İlgili meta veriler (postId, jobId, chatId vb.)
 */
export async function sendNotification({
  recipientId,
  senderId = null,
  title,
  message,
  type = 'info',
  data = {}
}) {
  if (!recipientId || !title || !message) {
    console.warn('[NotificationService] Eksik parametreler: recipientId, title veya message bulunamadı.');
    return null;
  }

  const targetIdStr = recipientId.toString();

  // 1. Veritabanına (MongoDB) Kaydet
  let savedNotification = null;
  try {
    const notif = new Notification({
      user: recipientId,
      sender: senderId || null,
      title: title.trim(),
      message: message.trim(),
      type: type || 'info',
      data: data || {},
      isRead: false
    });
    savedNotification = await notif.save();
  } catch (dbErr) {
    console.error('[NotificationService] DB bildirim kaydetme hatası:', dbErr.message);
  }

  // 2. OneSignal Push Bildirimi Gönder
  if (!ONESIGNAL_REST_API_KEY) {
    console.warn('-------------------------------------------------------------------------');
    console.warn('[NotificationService] ⚠️ UYARI: ONESIGNAL_REST_API_KEY tanımlanmamış!');
    console.warn('Bildirim veritabanına kaydedildi ancak telefonun üst bildirim çubuğuna (Push)');
    console.warn('düşebilmesi için C:/backend/.env dosyasında ONESIGNAL_REST_API_KEY olmalıdır.');
    console.warn('OneSignal Dashboard -> Settings -> Keys & IDs -> REST API Key');
    console.warn('-------------------------------------------------------------------------');
    return savedNotification;
  }

  try {
    const authHeader = ONESIGNAL_REST_API_KEY.startsWith('os_v2_app_')
      ? `Key ${ONESIGNAL_REST_API_KEY}`
      : `Basic ${ONESIGNAL_REST_API_KEY}`;

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': authHeader
    };

    // OneSignal REST API v1 & v2 uyumlu zengin payload
    const payload = {
      app_id: ONESIGNAL_APP_ID,
      include_aliases: {
        external_id: [targetIdStr]
      },
      include_external_user_ids: [targetIdStr],
      channel_for_external_user_ids: 'push',
      target_channel: 'push',
      headings: {
        en: title,
        tr: title
      },
      contents: {
        en: message,
        tr: message
      },
      // Android durum çubuğu ve öncelik ayarları (Heads-up banner)
      priority: 10,
      android_visibility: 1,
      android_accent_color: 'FF0D9488',
      data: {
        type,
        recipientId: targetIdStr,
        senderId: senderId ? senderId.toString() : null,
        ...data
      }
    };

    const response = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok) {
      console.warn('[NotificationService] OneSignal API Uyarısı:', response.status, JSON.stringify(result));
      // Geriye dönük uyumluluk: Legacy endpoint denemesi
      const fallbackRes = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
        },
        body: JSON.stringify({
          app_id: ONESIGNAL_APP_ID,
          include_external_user_ids: [targetIdStr],
          headings: { en: title, tr: title },
          contents: { en: message, tr: message },
          priority: 10,
          data: { type, ...data }
        })
      });
      const fallbackData = await fallbackRes.json();
      console.log('[NotificationService] OneSignal Legacy fallback yanıtı:', JSON.stringify(fallbackData));
    } else {
      console.log(`[NotificationService] ✅ Push bildirim OneSignal üzerinden cihaza iletildi -> Hedef: ${targetIdStr} (Alıcı: ${result.recipients || 1})`);
    }
  } catch (pushErr) {
    console.error('[NotificationService] OneSignal Push Gönderme Hatası:', pushErr.message);
  }

  return savedNotification;
}

export default {
  sendNotification
};
