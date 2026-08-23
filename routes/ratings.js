import express from 'express';
import { body, validationResult } from 'express-validator';
import Rating from '../models/Rating.js';
import Job from '../models/Job.js';
import User from '../models/User.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Create or update rating (applicant or former_employee)
router.post('/', authenticate, [
  body('company').notEmpty().withMessage('Company ID is required'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('relation').isIn(['applicant', 'former_employee']).withMessage('Valid relation is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { job, company, rating, comment, responseReceived, isAnonymous, relation } = req.body;

    // Check if employer exists
    const employerUser = await User.findById(company);
    if (!employerUser || employerUser.userType !== 'employer') {
      return res.status(404).json({ message: 'Employer not found' });
    }

    // Check if job exists if provided
    if (job) {
      const jobExists = await Job.findById(job);
      if (!jobExists) {
        return res.status(404).json({ message: 'Job not found' });
      }
      if (relation === 'applicant' && !jobExists.applicants.includes(req.user._id)) {
        return res.status(403).json({ message: 'You must apply to this job first' });
      }
    }

    // Check if rating already exists by this applicant for this company (and job if provided)
    const query = {
      applicant: req.user._id,
      company
    };
    if (job) query.job = job;

    const getRatingScoreImpact = (ratingVal) => {
      switch (ratingVal) {
        case 1: return -15;
        case 2: return -10;
        case 3: return 0;
        case 4: return 2;
        case 5: return 5;
        default: return 0;
      }
    };

    let existingRating = await Rating.findOne(query);

    const prevResponseReceived = existingRating ? existingRating.responseReceived : null;
    const prevRatingVal = existingRating ? existingRating.rating : null;

    if (existingRating) {
      // Calculate rating impact difference
      const oldImpact = getRatingScoreImpact(prevRatingVal);
      const newImpact = getRatingScoreImpact(rating);
      employerUser.companyScore = Math.max(0, Math.min(100, employerUser.companyScore - oldImpact + newImpact));

      // Update existing rating
      existingRating.rating = rating;
      existingRating.comment = comment;
      existingRating.responseReceived = responseReceived !== undefined ? responseReceived : existingRating.responseReceived;
      existingRating.isAnonymous = isAnonymous !== undefined ? isAnonymous : existingRating.isAnonymous;
      existingRating.relation = relation || existingRating.relation;
      await existingRating.save();
    } else {
      // Calculate rating impact for new rating
      const impact = getRatingScoreImpact(rating);
      employerUser.companyScore = Math.max(0, Math.min(100, employerUser.companyScore + impact));

      // Create new rating
      existingRating = new Rating({
        job: job || null,
        company,
        employer: company, // keeping field for compatibility
        applicant: req.user._id,
        rating,
        comment,
        isAnonymous: isAnonymous !== undefined ? isAnonymous : true,
        relation: relation || 'applicant',
        responseReceived: responseReceived || false
      });
      await existingRating.save();
    }

    // Update companyScore based on responseReceived changes
    const currentResponseReceived = existingRating.responseReceived;
    if (prevResponseReceived === null || prevResponseReceived !== currentResponseReceived) {
      if (currentResponseReceived === false) {
        employerUser.companyScore = Math.max(0, employerUser.companyScore - 10);
      } else if (currentResponseReceived === true) {
        // If they corrected it and now responded
        if (prevResponseReceived === false) {
          employerUser.companyScore = Math.min(100, employerUser.companyScore + 10); // Refund penalty
        } else {
          employerUser.companyScore = Math.min(100, employerUser.companyScore + 2); // Tiny reward
        }
      }
    }

    // Recalculate average rating of company
    const allCompanyRatings = await Rating.find({ company });
    const totalRatings = allCompanyRatings.length;
    employerUser.companyRatingCount = totalRatings;
    await employerUser.save();

    // If job was provided, update job average rating too
    if (job) {
      const jobExists = await Job.findById(job);
      if (jobExists) {
        const allJobRatings = await Rating.find({ job });
        const avgRating = allJobRatings.reduce((sum, r) => sum + r.rating, 0) / allJobRatings.length;
        jobExists.averageRating = avgRating;
        jobExists.ratingCount = allJobRatings.length;
        await jobExists.save();
      }
    }

    res.json({ message: 'Rating saved successfully', rating: existingRating, companyScore: employerUser.companyScore });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get employer's ratings
router.get('/employer/:employerId', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const ratings = await Rating.find({ company: req.params.employerId })
      .populate('job', 'title company')
      .populate('applicant', 'username avatar')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Rating.countDocuments({ company: req.params.employerId });

    // Calculate statistics
    const allRatings = await Rating.find({ company: req.params.employerId });
    const avgRating = allRatings.length > 0 
      ? allRatings.reduce((sum, r) => sum + r.rating, 0) / allRatings.length 
      : 0;
    const responseRate = allRatings.length > 0
      ? (allRatings.filter(r => r.responseReceived).length / allRatings.length) * 100
      : 0;

    // Apply anonymity
    const sanitizedRatings = ratings.map(r => {
      const obj = r.toObject();
      if (obj.isAnonymous) {
        obj.applicant = {
          username: 'Gizli Kullan�c�',
          avatar: null
        };
      } else if (obj.applicant && obj.applicant.avatar && obj.applicant.avatar.startsWith('/uploads/')) {
        obj.applicant.avatar = `${req.protocol}://${req.get('host')}${obj.applicant.avatar}`;
      }
      return obj;
    });

    res.json({
      ratings: sanitizedRatings,
      statistics: {
        averageRating: avgRating.toFixed(2),
        totalRatings: allRatings.length,
        responseRate: responseRate.toFixed(2)
      },
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

// Get job's ratings
router.get('/job/:jobId', authenticate, async (req, res) => {
  try {
    const ratings = await Rating.find({ job: req.params.jobId })
      .populate('applicant', 'username avatar')
      .sort({ createdAt: -1 });

    const sanitizedRatings = ratings.map(r => {
      const obj = r.toObject();
      if (obj.isAnonymous) {
        obj.applicant = {
          username: 'Gizli Kullan�c�',
          avatar: null
        };
      } else if (obj.applicant && obj.applicant.avatar && obj.applicant.avatar.startsWith('/uploads/')) {
        obj.applicant.avatar = `${req.protocol}://${req.get('host')}${obj.applicant.avatar}`;
      }
      return obj;
    });

    res.json({ ratings: sanitizedRatings });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get user's ratings
router.get('/user/my-ratings', authenticate, async (req, res) => {
  try {
    const ratings = await Rating.find({ applicant: req.user._id })
      .populate('job', 'title company location')
      .populate('employer', 'username avatar')
      .sort({ createdAt: -1 });

    res.json({ ratings });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete rating
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const rating = await Rating.findById(req.params.id);

    if (!rating) {
      return res.status(404).json({ message: 'Rating not found' });
    }

    if (rating.applicant.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this rating' });
    }

    // Update job's average rating
    if (rating.job) {
      const job = await Job.findById(rating.job);
      if (job) {
        const remainingRatings = await Rating.find({ job: rating.job, _id: { $ne: req.params.id } });
        job.averageRating = remainingRatings.length > 0
          ? remainingRatings.reduce((sum, r) => sum + r.rating, 0) / remainingRatings.length
          : 0;
        job.ratingCount = remainingRatings.length;
        await job.save();
      }
    }

    const employerUser = await User.findById(rating.company);
    if (employerUser) {
      // Refund rating impact on deletion
      const getRatingScoreImpact = (ratingVal) => {
        switch (ratingVal) {
          case 1: return -15;
          case 2: return -10;
          case 3: return 0;
          case 4: return 2;
          case 5: return 5;
          default: return 0;
        }
      };
      const impact = getRatingScoreImpact(rating.rating);
      employerUser.companyScore = Math.max(0, Math.min(100, employerUser.companyScore - impact));

      await Rating.findByIdAndDelete(req.params.id);

      const allCompanyRatings = await Rating.find({ company: rating.company });
      employerUser.companyRatingCount = allCompanyRatings.length;
      await employerUser.save();
    } else {
      await Rating.findByIdAndDelete(req.params.id);
    }

    res.json({ message: 'Rating deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

export default router;
