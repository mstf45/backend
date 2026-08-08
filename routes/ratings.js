import express from 'express';
import { body, validationResult } from 'express-validator';
import Rating from '../models/Rating.js';
import Job from '../models/Job.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Create or update rating
router.post('/', authenticate, [
  body('job').notEmpty().withMessage('Job ID is required'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { job, rating, comment, responseReceived } = req.body;

    // Check if job exists
    const jobExists = await Job.findById(job);
    if (!jobExists) {
      return res.status(404).json({ message: 'Job not found' });
    }

    // Check if user has applied to this job
    if (!jobExists.applicants.includes(req.user._id)) {
      return res.status(403).json({ message: 'You must apply to this job first' });
    }

    // Check if rating already exists
    let existingRating = await Rating.findOne({
      job,
      applicant: req.user._id
    });

    if (existingRating) {
      // Update existing rating
      existingRating.rating = rating;
      existingRating.comment = comment;
      existingRating.responseReceived = responseReceived !== undefined ? responseReceived : existingRating.responseReceived;
      await existingRating.save();
    } else {
      // Create new rating
      existingRating = new Rating({
        job,
        employer: jobExists.employer,
        applicant: req.user._id,
        rating,
        comment,
        responseReceived: responseReceived || false
      });
      await existingRating.save();
    }

    // Update job's average rating
    const allRatings = await Rating.find({ job });
    const avgRating = allRatings.reduce((sum, r) => sum + r.rating, 0) / allRatings.length;
    
    jobExists.averageRating = avgRating;
    jobExists.ratingCount = allRatings.length;
    await jobExists.save();

    res.json({ message: 'Rating saved successfully', rating: existingRating });
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

    const ratings = await Rating.find({ employer: req.params.employerId })
      .populate('job', 'title company')
      .populate('applicant', 'username avatar')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Rating.countDocuments({ employer: req.params.employerId });

    // Calculate statistics
    const allRatings = await Rating.find({ employer: req.params.employerId });
    const avgRating = allRatings.length > 0 
      ? allRatings.reduce((sum, r) => sum + r.rating, 0) / allRatings.length 
      : 0;
    const responseRate = allRatings.length > 0
      ? (allRatings.filter(r => r.responseReceived).length / allRatings.length) * 100
      : 0;

    res.json({
      ratings,
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

    res.json({ ratings });
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
    const job = await Job.findById(rating.job);
    if (job) {
      const remainingRatings = await Rating.find({ job: rating.job, _id: { $ne: req.params.id } });
      job.averageRating = remainingRatings.length > 0
        ? remainingRatings.reduce((sum, r) => sum + r.rating, 0) / remainingRatings.length
        : 0;
      job.ratingCount = remainingRatings.length;
      await job.save();
    }

    await Rating.findByIdAndDelete(req.params.id);

    res.json({ message: 'Rating deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

export default router;
