import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_here_change_in_production';

export const authenticate = async (req, res, next) => {
  try {
    console.log('=== Auth middleware called ===');
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const secret = process.env.JWT_SECRET || JWT_SECRET || 'your_jwt_secret_key_here_change_in_production';
    const decoded = jwt.verify(token, secret);
    const user = await User.findById(decoded.userId).select('-password');

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth error:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
};

export const authorize = (...userTypes) => {
  return (req, res, next) => {
    if (!userTypes.includes(req.user.userType)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    next();
  };
};

export const checkReadOnly = (req, res, next) => {
  if (req.user && req.user.userType === 'employer' && req.user.companyScore <= 30) {
    return res.status(403).json({
      message: 'Hesabınızın puanı %30 veya altında olduğu için bu işlem engellenmiştir (Sadece Okunabilir Mod).'
    });
  }
  next();
};