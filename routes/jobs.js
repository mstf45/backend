import express from 'express';
import { body, validationResult } from 'express-validator';
import Job from '../models/Job.js';
import User from '../models/User.js';
import Blacklist from '../models/Blacklist.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

// Create job posting (employer only)
router.post('/', authenticate, authorize('employer'), [
  body('profession').trim().notEmpty().withMessage('Profession is required'),
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('company').trim().notEmpty().withMessage('Company is required'),
  body('location').trim().notEmpty().withMessage('Location is required'),
  body('workType').isIn(['full_time', 'part_time', 'intern']).withMessage('Valid work type is required'),
  body('description').trim().notEmpty().withMessage('Description is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { profession, title, company, location, coordinates, workType, description } = req.body;

    const job = new Job({
      employer: req.user._id,
      profession,
      title,
      company,
      location,
      coordinates,
      workType,
      description
    });

    await job.save();
    await job.populate('employer', 'username avatar company');

    res.status(201).json({ message: 'Job posted successfully', job });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all jobs (search page)
router.get('/', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Filter out blacklisted companies for the current user
    const blacklistedCompanies = await Blacklist.find({ user: req.user._id }).select('company');
    const blacklistedIds = blacklistedCompanies.map(b => b.company);

    const jobs = await Job.find({
      employer: { $nin: blacklistedIds },
      isActive: true
    })
      .populate('employer', 'username avatar company')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Job.countDocuments({
      employer: { $nin: blacklistedIds },
      isActive: true
    });

    // Add isApplied flag
    const jobsWithFlags = jobs.map(job => ({
      ...job.toObject(),
      isApplied: job.applicants.includes(req.user._id)
    }));

    res.json({
      jobs: jobsWithFlags,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get single job
router.get('/:id', authenticate, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate('employer', 'username avatar company')
      .populate('applicants', 'username avatar profession');

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    // Check if company is blacklisted by current user
    const isBlacklisted = await Blacklist.findOne({
      user: req.user._id,
      company: job.employer._id
    });

    // Get blacklist reason if blacklisted
    let blacklistInfo = null;
    if (isBlacklisted) {
      blacklistInfo = {
        isBlacklisted: true,
        reason: isBlacklisted.reason || 'CV\'ye Geri Dönüş Yapmıyorlar ve Cv Topluyorlar'
      };
    }

    // Add isApplied flag
    const jobWithFlag = {
      ...job.toObject(),
      isApplied: job.applicants.includes(req.user._id)
    };

    res.json({ job: jobWithFlag, blacklistInfo });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update job
router.put('/:id', authenticate, authorize('employer'), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    if (job.employer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to update this job' });
    }

    const { profession, title, company, location, coordinates, workType, description, isActive } = req.body;

    if (profession) job.profession = profession;
    if (title) job.title = title;
    if (company) job.company = company;
    if (location) job.location = location;
    if (coordinates) job.coordinates = coordinates;
    if (workType) job.workType = workType;
    if (description) job.description = description;
    if (isActive !== undefined) job.isActive = isActive;

    job.updatedAt = Date.now();
    await job.save();
    await job.populate('employer', 'username avatar company');

    res.json({ message: 'Job updated successfully', job });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete job
router.delete('/:id', authenticate, authorize('employer'), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    if (job.employer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this job' });
    }

    await Job.findByIdAndDelete(req.params.id);

    res.json({ message: 'Job deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Apply to job
router.post('/:id/apply', authenticate, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    // Check if user is employer
    const user = await User.findById(req.user._id);
    if (user.userType === 'employer') {
      return res.status(403).json({ message: 'Employers cannot apply to jobs' });
    }

    // Check if already applied
    if (job.applicants.includes(req.user._id)) {
      return res.status(400).json({ message: 'Already applied to this job' });
    }

    job.applicants.push(req.user._id);
    job.applicantCount = job.applicants.length;
    await job.save();

    res.json({ message: 'Applied successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get employer's jobs
router.get('/employer/:employerId', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const jobs = await Job.find({ employer: req.params.employerId })
      .populate('employer', 'username avatar company')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Job.countDocuments({ employer: req.params.employerId });

    res.json({
      jobs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get job applicants (employer only)
router.get('/:id/applicants', authenticate, authorize('employer'), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    if (job.employer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to view applicants' });
    }

    await job.populate('applicants', 'username avatar profession email phone bio experience');

    res.json({ applicants: job.applicants });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

export default router;
