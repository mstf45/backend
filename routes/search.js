import express from 'express';
import Job from '../models/Job.js';
import Post from '../models/Post.js';
import User from '../models/User.js';
import Blacklist from '../models/Blacklist.js';
import { authenticate } from '../middleware/auth.js';
import { professions } from '../config/professions.js';

const router = express.Router();

// Helper to format avatar and companyLogo for populate
const formatEmployerUrls = (req, employer) => {
  if (employer) {
    if (employer.avatar) {
      if (employer.avatar.startsWith('/uploads/')) {
        employer.avatar = `${req.protocol}://${req.get('host')}${employer.avatar}`;
      }
    } else {
      employer.avatar = `${req.protocol}://${req.get('host')}/uploads/default_avatar.png`;
    }

    if (employer.companyLogo) {
      if (employer.companyLogo.startsWith('/uploads/')) {
        employer.companyLogo = `${req.protocol}://${req.get('host')}${employer.companyLogo}`;
      }
    } else {
      employer.companyLogo = `${req.protocol}://${req.get('host')}/uploads/default_avatar.png`;
    }
  }
  return employer;
};

// Search jobs with filters
router.get('/jobs', authenticate, async (req, res) => {
  try {
    const {
      profession,
      location,
      workType,
      latitude,
      longitude,
      radius,
      page = 1,
      limit = 20
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = { isActive: true };

    // Filter out blacklisted companies
    const blacklistedCompanies = await Blacklist.find({ user: req.user._id }).select('company');
    const blacklistedIds = blacklistedCompanies.map(b => b.company);
    query.employer = { $nin: blacklistedIds };
    query.hiddenBy = { $ne: req.user._id };

    if (profession) {
      query.profession = { $regex: profession, $options: 'i' };
    }

    if (location) {
      query.location = { $regex: location, $options: 'i' };
    }

    if (workType) {
      query.workType = workType;
    }

    // Geospatial search if coordinates provided
    if (latitude && longitude && radius) {
      query.coordinates = {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(longitude), parseFloat(latitude)]
          },
          $maxDistance: parseFloat(radius) * 1000 // Convert km to meters
        }
      };
    }

    const jobs = await Job.find(query)
      .populate('employer', 'username avatar company companyLogo companyScore')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Job.countDocuments(query);

    const jobsWithFlags = jobs.map(job => {
      formatEmployerUrls(req, job.employer);
      const jobObj = job.toObject();
      jobObj.id = jobObj._id.toString();
      jobObj.isApplied = job.applicants ? job.applicants.some(id => id.toString() === req.user._id.toString()) : false;
      jobObj.isFavorite = job.favorites ? job.favorites.some(id => id.toString() === req.user._id.toString()) : false;
      jobObj.isSaved = job.savedBy ? job.savedBy.some(id => id.toString() === req.user._id.toString()) : false;
      jobObj.isHidden = job.hiddenBy ? job.hiddenBy.some(id => id.toString() === req.user._id.toString()) : false;
      return jobObj;
    });

    res.json({
      jobs: jobsWithFlags,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Search posts
router.get('/posts', authenticate, async (req, res) => {
  try {
    const { query, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const searchQuery = query
      ? { content: { $regex: query, $options: 'i' } }
      : {};

    const posts = await Post.find(searchQuery)
      .populate('author', 'username avatar profession')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Post.countDocuments(searchQuery);

    res.json({
      posts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Search users
router.get('/users', authenticate, async (req, res) => {
  try {
    const { query, userType, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const searchQuery = {};

    if (query) {
      searchQuery.$or = [
        { username: { $regex: query, $options: 'i' } },
        { profession: { $regex: query, $options: 'i' } }
      ];
    }

    if (userType) {
      searchQuery.userType = userType;
    }

    const users = await User.find(searchQuery)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(searchQuery);

    res.json({
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get professions list (for dropdown)
router.get('/professions', authenticate, async (req, res) => {
  try {
    res.json({ professions });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get locations list (for dropdown)
router.get('/locations', authenticate, async (req, res) => {
  try {
    const locations = await Job.distinct('location');
    res.json({ locations });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

export default router;
