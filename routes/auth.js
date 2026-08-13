import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import User from '../models/User.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

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
      userType
    });

    await user.save();

    // Generate token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        userType: user.userType
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Login
router.post('/login', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        userType: user.userType,
        avatar: user.avatar,
        profession: user.profession
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get current user
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -phoneVerificationCode -phoneVerificationCodeExpires');
    
    // Set default avatar if null
    if (!user.avatar) {
      user.avatar = `${req.protocol}://${req.get('host')}/uploads/default_avatar.png`;
    } else if (user.avatar.startsWith('/uploads/')) {
      user.avatar = `${req.protocol}://${req.get('host')}${user.avatar}`;
    }
    
    // Ensure socialLinks has all fields with null values if not set
    const userObj = user.toObject();
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
      // Replace placeholder values with null
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
    const { avatar, profession, bio, socialLinks, experience, username, phone } = req.body;

    const user = await User.findById(req.user._id);
    
    if (avatar) user.avatar = avatar;
    if (profession) user.profession = profession;
    if (bio) user.bio = bio;
    if (socialLinks) user.socialLinks = { ...user.socialLinks, ...socialLinks };
    if (experience) user.experience = experience;
    
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
      // Only reset phone verification if phone number actually changes
      if (phone !== user.phone) {
        user.phone = phone;
        user.isPhoneVerified = false;
        user.phoneVerificationCode = null;
        user.phoneVerificationCodeExpires = null;
      }
    }

    user.updatedAt = Date.now();
    await user.save();

    // Convert avatar to full URL if needed
    const userObj = user.toObject();
    if (userObj.avatar) {
      if (userObj.avatar.startsWith('/uploads/')) {
        userObj.avatar = `${req.protocol}://${req.get('host')}${userObj.avatar}`;
      }
    }

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
      // Replace placeholder values with null
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

    // Generate 6-digit verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Set expiration to 10 minutes from now
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    
    user.phoneVerificationCode = verificationCode;
    user.phoneVerificationCodeExpires = expiresAt;
    await user.save();

    // In production, you would send this code via SMS
    // For now, we'll return it in the response for testing
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

    // Verify phone
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
