import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import User from '../models/User.js';
import { authenticate } from '../middleware/auth.js';
import { saveBase64Media } from '../utils/base64Upload.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_here_change_in_production';

const router = express.Router();

// Helper to format avatar and companyLogo URLs
const formatUserUrls = (req, userObj) => {
  if (userObj.avatar) {
    if (userObj.avatar.startsWith('/uploads/')) {
      userObj.avatar = `${req.protocol}://${req.get('host')}${userObj.avatar}`;
    }
  } else {
    userObj.avatar = `${req.protocol}://${req.get('host')}/uploads/default_avatar.png`;
  }

  if (userObj.companyLogo) {
    if (userObj.companyLogo.startsWith('/uploads/')) {
      userObj.companyLogo = `${req.protocol}://${req.get('host')}${userObj.companyLogo}`;
    }
  } else {
    userObj.companyLogo = `${req.protocol}://${req.get('host')}/uploads/default_avatar.png`;
  }
  return userObj;
};

// Register
router.post('/register', [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').trim().notEmpty().withMessage('Phone is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('userType').isIn(['job_seeker', 'employer']).withMessage('Valid user type is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, phone, password, userType } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      username,
      email,
      phone,
      password: hashedPassword,
      userType,
      companyScore: 100
    });

    await user.save();

    // Generate token
    const token = jwt.sign(
      { userId: user._id },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    const userObj = formatUserUrls(req, user.toObject());
    delete userObj.password;

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: userObj
    });
  } catch (error) {
    console.error('Error in POST /api/auth/register:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const rawIdentifier = req.body.email || req.body.username || req.body.identifier;
    const password = req.body.password;

    if (!rawIdentifier || !password) {
      return res.status(400).json({ message: 'E-posta/kullanıcı adı ve şifre gereklidir' });
    }

    const identifier = rawIdentifier.toString().trim();
    console.log(`=== POST /api/auth/login attempt for: "${identifier}" ===`);

    // Find user by case-insensitive email or username
    const user = await User.findOne({
      $or: [
        { email: identifier.toLowerCase() },
        { username: { $regex: new RegExp(`^${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }
      ]
    });

    if (!user) {
      console.log(`[LOGIN FAILED] User not found for identifier: "${identifier}"`);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log(`[LOGIN FAILED] Incorrect password for user: "${user.email}" (${user.username})`);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate token
    const token = jwt.sign(
      { userId: user._id },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    const userObj = formatUserUrls(req, user.toObject());
    delete userObj.password;

    console.log(`[LOGIN SUCCESS] User: "${user.email}" (${user.username}, ID: ${user._id}) logged in successfully.`);

    res.json({
      message: 'Login successful',
      token,
      user: userObj
    });
  } catch (error) {
    console.error('Error in POST /api/auth/login:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get current user
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -phoneVerificationCode -phoneVerificationCodeExpires');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userObj = formatUserUrls(req, user.toObject());
    
    // Ensure socialLinks has all fields with null values if not set
    if (!userObj.socialLinks) {
      userObj.socialLinks = {
        instagram: null,
        twitter: null,
        facebook: null,
        linkedin: null,
        youtube: null,
        github: null,
        medium: null
      };
    } else {
      const defaultSocialLinks = {
        instagram: null,
        twitter: null,
        facebook: null,
        linkedin: null,
        youtube: null,
        github: null,
        medium: null
      };
      const placeholderValues = ['instagram_url', 'twitter_url', 'facebook_url', 'linkedin_url', 'youtube_url', 'github_url', 'medium_url'];
      Object.keys(userObj.socialLinks).forEach(key => {
        if (placeholderValues.includes(userObj.socialLinks[key])) {
          userObj.socialLinks[key] = null;
        }
      });
      userObj.socialLinks = { ...defaultSocialLinks, ...userObj.socialLinks };
    }
    
    res.json({ user: userObj });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update user profile
router.put('/profile', authenticate, async (req, res) => {
  try {
    const { 
      avatar, 
      profession, 
      bio, 
      socialLinks, 
      experience, 
      username, 
      phone,
      company,
      companyLogo,
      companyEmployeeCount,
      companyDescription,
      companyLocation
    } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    if (profession !== undefined) user.profession = profession;
    if (bio !== undefined) user.bio = bio;
    if (socialLinks) user.socialLinks = { ...user.socialLinks, ...socialLinks };
    if (experience) user.experience = experience;
    
    if (company !== undefined) user.company = company;
    if (companyEmployeeCount !== undefined) user.companyEmployeeCount = companyEmployeeCount;
    if (companyDescription !== undefined) user.companyDescription = companyDescription;
    if (companyLocation !== undefined) user.companyLocation = companyLocation;
    if (req.body.isPrivate !== undefined) {
      user.isPrivate = req.body.isPrivate === true || req.body.isPrivate === 'true';
    }
    if (req.body.showBlockDialogAfterHide !== undefined) {
      user.showBlockDialogAfterHide = req.body.showBlockDialogAfterHide === true || req.body.showBlockDialogAfterHide === 'true';
    }

    if (avatar) {
      if (avatar.startsWith('data:')) {
        const saved = saveBase64Media(avatar);
        if (saved) user.avatar = saved.path;
      } else {
        user.avatar = avatar;
      }
    }

    if (companyLogo) {
      if (companyLogo.startsWith('data:')) {
        const saved = saveBase64Media(companyLogo);
        if (saved) user.companyLogo = saved.path;
      } else {
        user.companyLogo = companyLogo;
      }
    }
    
    // Update username if provided and not taken
    if (username && username !== user.username) {
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        return res.status(400).json({ message: 'Username already taken' });
      }
      user.username = username;
    }
    
    // Update phone if provided
    if (phone) {
      if (phone !== user.phone) {
        user.phone = phone;
        user.isPhoneVerified = false;
        user.phoneVerificationCode = null;
        user.phoneVerificationCodeExpires = null;
      }
    }

    user.updatedAt = Date.now();
    await user.save();

    const userObj = formatUserUrls(req, user.toObject());
    delete userObj.password;

    // Ensure socialLinks has all fields
    if (!userObj.socialLinks) {
      userObj.socialLinks = {
        instagram: null,
        twitter: null,
        facebook: null,
        linkedin: null,
        youtube: null,
        github: null,
        medium: null
      };
    } else {
      const defaultSocialLinks = {
        instagram: null,
        twitter: null,
        facebook: null,
        linkedin: null,
        youtube: null,
        github: null,
        medium: null
      };
      const placeholderValues = ['instagram_url', 'twitter_url', 'facebook_url', 'linkedin_url', 'youtube_url', 'github_url', 'medium_url'];
      Object.keys(userObj.socialLinks).forEach(key => {
        if (placeholderValues.includes(userObj.socialLinks[key])) {
          userObj.socialLinks[key] = null;
        }
      });
      userObj.socialLinks = { ...defaultSocialLinks, ...userObj.socialLinks };
    }

    res.json({ message: 'Profile updated successfully', user: userObj });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Send phone verification code
router.post('/verify-phone/send', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (user.isPhoneVerified) {
      return res.status(400).json({ message: 'Phone already verified' });
    }

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    
    user.phoneVerificationCode = verificationCode;
    user.phoneVerificationCodeExpires = expiresAt;
    await user.save();

    res.json({ 
      message: 'Verification code sent successfully',
      verificationCode: verificationCode,
      expiresAt: expiresAt
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Verify phone code
router.post('/verify-phone', authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({ message: 'Verification code is required' });
    }

    const user = await User.findById(req.user._id);
    
    if (user.isPhoneVerified) {
      return res.status(400).json({ message: 'Phone already verified' });
    }

    if (!user.phoneVerificationCode) {
      return res.status(400).json({ message: 'No verification code sent' });
    }

    if (user.phoneVerificationCodeExpires < new Date()) {
      return res.status(400).json({ message: 'Verification code expired' });
    }

    if (user.phoneVerificationCode !== code) {
      return res.status(400).json({ message: 'Invalid verification code' });
    }

    user.isPhoneVerified = true;
    user.phoneVerificationCode = null;
    user.phoneVerificationCodeExpires = null;
    await user.save();

    res.json({ message: 'Phone verified successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

export default router;

