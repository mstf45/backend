import express from 'express';
import { body, validationResult } from 'express-validator';
import Job from '../models/Job.js';
import User from '../models/User.js';
import Blacklist from '../models/Blacklist.js';
import Notification from '../models/Notification.js';
import Application from '../models/Application.js';
import Rating from '../models/Rating.js';
import { authenticate, authorize, checkReadOnly } from '../middleware/auth.js';

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

// Create job posting (employer only)
router.post('/', authenticate, authorize('employer'), checkReadOnly, [
  body('profession').trim().notEmpty().withMessage('Profession is required'),
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('location').trim().notEmpty().withMessage('Location is required'),
  body('workType').isIn(['full_time', 'part_time', 'intern']).withMessage('Valid work type is required'),
  body('description').trim().notEmpty().withMessage('Description is required'),
  body('durationDays').isInt({ min: 1 }).withMessage('Valid duration in days is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { profession, title, company, location, coordinates, workType, description, durationDays, maxApplicants } = req.body;

    const expiresAt = new Date(Date.now() + parseInt(durationDays) * 24 * 60 * 60 * 1000);

    const finalCompany = req.user.company || company || '�irket Belirtilmemi�';

    const job = new Job({
      employer: req.user._id,
      profession,
      title,
      company: finalCompany,
      location,
      coordinates,
      workType,
      description,
      durationDays: parseInt(durationDays),
      maxApplicants: maxApplicants ? parseInt(maxApplicants) : null,
      expiresAt
    });

    await job.save();
    await job.populate('employer', 'username avatar company companyLogo companyEmployeeCount companyDescription companyScore');
    formatEmployerUrls(req, job.employer);

    res.status(201).json({ message: 'Job posted successfully', job });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all jobs (search page with sorting by companyScore visibility)
router.get('/', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Filter out blacklisted companies for the current user
    const blacklistedCompanies = await Blacklist.find({ user: req.user._id }).select('company');
    const blacklistedIds = blacklistedCompanies.map(b => b.company);

    const now = new Date();
    const queryFilter = {
      employer: { $nin: blacklistedIds },
      isActive: true,
      $and: [
        {
          $or: [
            { expiresAt: { $exists: false } },
            { expiresAt: null },
            { expiresAt: { $gt: now } }
          ]
        },
        {
          $or: [
            { maxApplicants: { $exists: false } },
            { maxApplicants: null },
            { maxApplicants: 0 },
            { $expr: { $lt: ["$applicantCount", "$maxApplicants"] } }
          ]
        }
      ]
    };

    // Use MongoDB Aggregation to sort by company score visibility
    const aggregatePipeline = [
      { $match: queryFilter },
      {
        $lookup: {
          from: 'users',
          localField: 'employer',
          foreignField: '_id',
          as: 'employer'
        }
      },
      { $unwind: '$employer' },
      {
        $addFields: {
          sortWeight: {
            $cond: {
              if: { $gte: ['$employer.companyScore', 50] },
              then: 1,
              else: 0
            }
          }
        }
      },
      { $sort: { sortWeight: -1, createdAt: -1 } },
      { $skip: skip },
      { $limit: limit }
    ];

    const jobs = await Job.aggregate(aggregatePipeline);
    const total = await Job.countDocuments(queryFilter);

    const jobsWithFlags = jobs.map(job => {
      formatEmployerUrls(req, job.employer);
      delete job.employer.password;
      return {
        ...job,
        id: job._id.toString(),
        isApplied: job.applicants.some(id => id.toString() === req.user._id.toString())
      };
    });

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

// Get jobs that the user has applied to
router.get('/applied', authenticate, async (req, res) => {
  try {
    const applications = await Application.find({ applicant: req.user._id })
      .populate({
        path: 'job',
        populate: {
          path: 'employer',
          select: 'username avatar company companyLogo companyEmployeeCount companyDescription companyScore'
        }
      })
      .sort({ appliedAt: -1 });

    const jobs = [];
    applications.forEach(app => {
      if (app.job) {
        const jobObj = app.job.toObject();
        jobObj.id = jobObj._id.toString();
        jobObj.isApplied = true;
        
        // Calculate isActive dynamically
        const now = new Date();
        const isExpired = jobObj.expiresAt && new Date(jobObj.expiresAt) < now;
        const isLimitReached = jobObj.maxApplicants && jobObj.applicantCount >= jobObj.maxApplicants;
        jobObj.isActive = jobObj.isActive && !isExpired && !isLimitReached;

        if (jobObj.employer) {
          formatEmployerUrls(req, jobObj.employer);
        }
        jobs.push(jobObj);
      }
    });

    res.json({ jobs });
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
      .populate('employer', 'username avatar company companyLogo companyEmployeeCount companyDescription companyScore')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Job.countDocuments({ employer: req.params.employerId });

    const jobsWithFlags = jobs.map(job => {
      formatEmployerUrls(req, job.employer);
      const jobObj = job.toObject();
      jobObj.id = jobObj._id.toString();
      
      const now = new Date();
      const isExpired = jobObj.expiresAt && new Date(jobObj.expiresAt) < now;
      const isLimitReached = jobObj.maxApplicants && jobObj.applicantCount >= jobObj.maxApplicants;
      jobObj.isActive = jobObj.isActive && !isExpired && !isLimitReached;
      
      return jobObj;
    });

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

// Get single job details (with scoreWarning if companyScore < 50)
router.get('/:id', authenticate, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id)
      .populate('employer', 'username avatar company companyLogo companyEmployeeCount companyDescription companyScore')
      .populate('applicants', 'username avatar profession');

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    formatEmployerUrls(req, job.employer);

    // Check if company is blacklisted by current user
    const isBlacklisted = await Blacklist.findOne({
      user: req.user._id,
      company: job.employer._id
    });

    let blacklistInfo = null;
    if (isBlacklisted) {
      blacklistInfo = {
        isBlacklisted: true,
        reason: isBlacklisted.reason || "CV'ye Geri D�n�� Yapm�yorlar ve Cv Topluyorlar"
      };
    }

    // Load warnings & reviews if company score < 50
    let scoreWarning = null;
    if (job.employer && job.employer.companyScore < 50) {
      const reviews = await Rating.find({ company: job.employer._id })
        .populate('applicant', 'username avatar')
        .sort({ createdAt: -1 })
        .limit(10);

      scoreWarning = {
        showWarning: true,
        companyScore: job.employer.companyScore,
        reviews: reviews.map(r => ({
          id: r._id,
          rating: r.rating,
          comment: r.comment,
          relation: r.relation,
          isAnonymous: r.isAnonymous,
          createdAt: r.createdAt,
          applicantName: r.isAnonymous ? 'Gizli Kullan�c�' : (r.applicant?.username || 'Kullan�c�'),
          applicantAvatar: r.isAnonymous ? null : (r.applicant?.avatar ? (r.applicant.avatar.startsWith('/uploads/') ? `${req.protocol}://${req.get('host')}${r.applicant.avatar}` : r.applicant.avatar) : null)
        }))
      };
    }

    const now = new Date();
    const isExpired = job.expiresAt && new Date(job.expiresAt) < now;
    const isLimitReached = job.maxApplicants && job.applicantCount >= job.maxApplicants;
    
    const jobObj = job.toObject();
    jobObj.id = jobObj._id.toString();
    jobObj.isActive = jobObj.isActive && !isExpired && !isLimitReached;

    const jobWithFlag = {
      ...jobObj,
      isApplied: job.applicants.some(id => id.toString() === req.user._id.toString())
    };

    const application = await Application.findOne({
      job: job._id,
      applicant: req.user._id
    });

    res.json({ job: jobWithFlag, blacklistInfo, scoreWarning, application });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update job
router.put('/:id', authenticate, authorize('employer'), checkReadOnly, async (req, res) => {
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
    
    const finalCompany = req.user.company || company || job.company;
    job.company = finalCompany;
    
    if (location) job.location = location;
    if (coordinates) job.coordinates = coordinates;
    if (workType) job.workType = workType;
    if (description) job.description = description;
    if (isActive !== undefined) job.isActive = isActive;

    job.updatedAt = Date.now();
    await job.save();
    await job.populate('employer', 'username avatar company companyLogo companyEmployeeCount companyDescription companyScore');
    formatEmployerUrls(req, job.employer);

    res.json({ message: 'Job updated successfully', job });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete job
router.delete('/:id', authenticate, authorize('employer'), checkReadOnly, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    if (job.employer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this job' });
    }

    await Job.findByIdAndDelete(req.params.id);
    await Application.deleteMany({ job: req.params.id });

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

    // Check if expired
    const now = new Date();
    if (job.expiresAt && now > job.expiresAt) {
      return res.status(400).json({ message: 'Bu i� ilan�n�n s�resi dolmu�tur.' });
    }

    // Check if limit reached
    if (job.maxApplicants && job.applicantCount >= job.maxApplicants) {
      return res.status(400).json({ message: 'Bu i� ilan� i�in ba�vuru s�n�r�na ula��lm��t�r.' });
    }

    // Check if already applied
    if (job.applicants.includes(req.user._id)) {
      return res.status(400).json({ message: 'Already applied to this job' });
    }

    job.applicants.push(req.user._id);
    job.applicantCount = job.applicants.length;

    // Check if it reached max after this application
    if (job.maxApplicants && job.applicantCount >= job.maxApplicants) {
      job.isActive = false;

      const notification = new Notification({
        user: job.employer,
        title: 'Ba�vuru S�n�r�na Ula��ld�',
        message: `"${job.title}" adl� i� ilan�n�z maksimum ba�vuru s�n�r�na (${job.maxApplicants} ki�i) ula�t��� i�in kapat�lm��t�r.`,
        type: 'warning'
      });
      await notification.save();
    }

    await job.save();

    // Create Application entry
    const application = new Application({
      job: job._id,
      applicant: req.user._id,
      employer: job.employer,
      status: 'applied',
      appliedAt: new Date()
    });
    await application.save();

    res.json({ message: 'Applied successfully' });
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

    await job.populate('applicants', 'username avatar profession email phone bio experience socialLinks');

    res.json({ applicants: job.applicants });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Republish job (employer only)
router.post('/:id/republish', authenticate, authorize('employer'), checkReadOnly, [
  body('durationDays').isInt({ min: 1 }).withMessage('Valid duration in days is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    if (job.employer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to republish this job' });
    }

    const { durationDays, maxApplicants } = req.body;
    const now = new Date();
    
    job.durationDays = parseInt(durationDays);
    job.expiresAt = new Date(now.getTime() + parseInt(durationDays) * 24 * 60 * 60 * 1000);
    
    if (maxApplicants !== undefined) {
      job.maxApplicants = maxApplicants ? parseInt(maxApplicants) : null;
    }
    
    job.isActive = true;
    job.updatedAt = now;
    
    await job.save();
    await job.populate('employer', 'username avatar company companyLogo companyEmployeeCount companyDescription companyScore');
    formatEmployerUrls(req, job.employer);

    res.json({ message: 'Job republished successfully', job });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

export default router;
