import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const saveBase64Media = (base64String) => {
  try {
    if (!base64String || typeof base64String !== 'string' || !base64String.startsWith('data:')) {
      return null;
    }

    const base64Prefix = ';base64,';
    const prefixEnd = base64String.indexOf(base64Prefix);
    if (prefixEnd === -1) {
      return null;
    }

    const type = base64String.substring('data:'.length, prefixEnd);
    const data = base64String.substring(prefixEnd + base64Prefix.length);

    const buffer = Buffer.from(data, 'base64');

    let extension = '';
    if (type.startsWith('image/')) {
      extension = type.replace('image/', '');
    } else if (type.startsWith('video/')) {
      extension = type.replace('video/', '');
    } else {
      return null;
    }

    const filename = `media-${Date.now()}-${Math.round(Math.random() * 1E9)}.${extension}`;
    const filepath = path.join(__dirname, '../uploads', filename);

    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    fs.writeFileSync(filepath, buffer);

    return {
      type: type,
      path: `/uploads/${filename}`
    };
  } catch (error) {
    console.error('Error saving base64 media:', error);
    return null;
  }
};
