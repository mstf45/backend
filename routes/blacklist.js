import express from 'express';
import { body, validationResult } from 'express-validator';
import Blacklist from '../models/Blacklist.js';
import User from '../models/User.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Add company to blacklist
router.post('/', authenticate, [
  body('company').notEmpty().withMessage('Company ID is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { company, reason } = req.body;

    // Check if company exists and is an employer
    const companyUser = await User.findById(company);
    if (!companyUser) {
      return res.status(404).json({ message: 'Company not found' });
    }

    if (companyUser.userType !== 'employer') {
      return res.status(400).json({ message: 'Can only blacklist employers' });
    }

    // Check if already blacklisted
    const existingBlacklist = await Blacklist.findOne({
      user: req.user._id,
      company
    });

    if (existingBlacklist) {
      return res.status(400).json({ message: 'Company already blacklisted' });
    }

    // Create blacklist entry
    const blacklist = new Blacklist({
      user: req.user._id,
      company,
      reason: reason || 'CV\'ye Geri Dönüş Yapmıyorlar ve Cv Topluyorlar'
    });

    await blacklist.save();

    // Add to user's blacklisted companies array
    await User.findByIdAndUpdate(req.user._id, {
      $push: { blacklistedCompanies: company }
    });

    res.status(201).json({ message: 'Company blacklisted successfully', blacklist });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Remove company from blacklist
router.delete('/:companyId', authenticate, async (req, res) => {
  try {
    const blacklist = await Blacklist.findOne({
      user: req.user._id,
      company: req.params.companyId
    });

    if (!blacklist) {
      return res.status(404).json({ message: 'Blacklist entry not found' });
    }

    await Blacklist.findByIdAndDelete(blacklist._id);

    // Remove from user's blacklisted companies array
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { blacklistedCompanies: req.params.companyId }
    });

    res.json({ message: 'Company removed from blacklist' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get user's blacklist
router.get('/', authenticate, async (req, res) => {
  try {
    const blacklists = await Blacklist.find({ user: req.user._id })
      .populate('company', 'username avatar company')
      .sort({ createdAt: -1 });

    res.json({ blacklists });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Check if company is blacklisted by user
router.get('/check/:companyId', authenticate, async (req, res) => {
  try {
    const blacklist = await Blacklist.findOne({
      user: req.user._id,
      company: req.params.companyId
    });

    res.json({ isBlacklisted: !!blacklist, reason: blacklist?.reason });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

export default router;
