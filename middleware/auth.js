import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const authenticate = async (req, res, next) => {
  try {
    console.log('=== Auth middleware called ===');
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
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
      message: 'Hesabýnýzýn puaný %30 veya altýnda olduðu için bu iþlem engellenmiþtir (Sadece Okunabilir Mod).'
    });
  }
  next();
};
