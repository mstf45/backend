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

// Helper to update daily statistics for views, clicks, applications
const updateJobDailyStats = async (jobId, type) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const incField = {};
    incField[type === 'views' ? 'viewCount' : (type === 'clicks' ? 'clickCount' : 'applicantCount')] = 1;

    const pullResult = await Job.updateOne(
      { _id: jobId, 'dailyStats.date': today },
      { 
        $inc: { 
          ...incField,
          ['dailyStats.$.' + type]: 1 
        } 
      }
    );

    if (pullResult.matchedCount === 0) {
      const newStat = { date: today, views: 0, clicks: 0, applications: 0 };
      newStat[type] = 1;
      await Job.updateOne(
        { _id: jobId },
        {
          $inc: incField,
          $push: { dailyStats: newStat }
        }
      );
    }
  } catch (err) {
    console.error('updateJobDailyStats error:', err.message);
  }
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

    const finalCompany = req.user.company || company || 'Şirket Belirtilmemiş';

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
      hiddenBy: { $ne: req.user._id },
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
        isApplied: job.applicants ? job.applicants.some(id => id.toString() === req.user._id.toString()) : false,
        isFavorite: job.favorites ? job.favorites.some(id => id.toString() === req.user._id.toString()) : false,
        isSaved: job.savedBy ? job.savedBy.some(id => id.toString() === req.user._id.toString()) : false,
        isHidden: job.hiddenBy ? job.hiddenBy.some(id => id.toString() === req.user._id.toString()) : false
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
        jobObj.isFavorite = app.job.favorites ? app.job.favorites.some(id => id.toString() === req.user._id.toString()) : false;
        jobObj.isSaved = app.job.savedBy ? app.job.savedBy.some(id => id.toString() === req.user._id.toString()) : false;
        
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
      jobObj.isFavorite = job.favorites ? job.favorites.some(id => id.toString() === req.user._id.toString()) : false;
      jobObj.isSaved = job.savedBy ? job.savedBy.some(id => id.toString() === req.user._id.toString()) : false;
      jobObj.isApplied = job.applicants ? job.applicants.some(id => id.toString() === req.user._id.toString()) : false;
      
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

// Favorite / Unfavorite job
router.post('/:id/favorite', authenticate, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    if (!job.favorites) {
      job.favorites = [];
    }

    const alreadyFavorited = job.favorites.some(id => id.toString() === req.user._id.toString());

    if (alreadyFavorited) {
      job.favorites = job.favorites.filter(id => id.toString() !== req.user._id.toString());
      job.favoriteCount = job.favorites.length;
    } else {
      job.favorites.push(req.user._id);
      job.favoriteCount = job.favorites.length;
    }

    await job.save();

    res.json({
      message: alreadyFavorited ? 'İlan favorilerden çıkarıldı' : 'İlan favorilere eklendi',
      isFavorite: !alreadyFavorited,
      favoriteCount: job.favoriteCount
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Save / Unsave job
router.post('/:id/save', authenticate, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    if (!job.savedBy) {
      job.savedBy = [];
    }

    const alreadySaved = job.savedBy.some(id => id.toString() === req.user._id.toString());

    if (alreadySaved) {
      job.savedBy = job.savedBy.filter(id => id.toString() !== req.user._id.toString());
      job.savedCount = job.savedBy.length;
    } else {
      job.savedBy.push(req.user._id);
      job.savedCount = job.savedBy.length;
    }

    await job.save();

    res.json({
      message: alreadySaved ? 'İlan kaydedilenlerden çıkarıldı' : 'İlan kaydedildi',
      isSaved: !alreadySaved,
      savedCount: job.savedCount
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Hide job (Önerme / Gizle)
router.post('/:id/hide', authenticate, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    if (!job.hiddenBy) {
      job.hiddenBy = [];
    }

    const alreadyHidden = job.hiddenBy.some(id => id.toString() === req.user._id.toString());

    if (!alreadyHidden) {
      job.hiddenBy.push(req.user._id);
      job.hiddenCount = job.hiddenBy.length;
      await job.save();
    }

    res.json({
      message: 'İlan gizlendi',
      isHidden: true,
      hiddenCount: job.hiddenCount
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Report job (İlanı Bildir)
router.post('/:id/report', authenticate, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    const { reason, description } = req.body;

    if (!job.reports) {
      job.reports = [];
    }

    job.reports.push({
      user: req.user._id,
      reason: reason || 'Diğer',
      description: description || '',
      createdAt: new Date()
    });

    // Also hide the job for the reporting user
    if (!job.hiddenBy) {
      job.hiddenBy = [];
    }
    if (!job.hiddenBy.some(id => id.toString() === req.user._id.toString())) {
      job.hiddenBy.push(req.user._id);
      job.hiddenCount = job.hiddenBy.length;
    }

    await job.save();

    res.json({
      message: 'İlan bildirildi ve incelemeye alındı',
      reported: true
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
        reason: isBlacklisted.reason || "CV'ye Geri Dönüş Yapmıyorlar ve Cv Topluyorlar"
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
          applicantName: r.isAnonymous ? 'Gizli Kullanıcı' : (r.applicant?.username || 'Kullanıcı'),
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
      isApplied: job.applicants ? job.applicants.some(id => id.toString() === req.user._id.toString()) : false,
      isFavorite: job.favorites ? job.favorites.some(id => id.toString() === req.user._id.toString()) : false,
      isSaved: job.savedBy ? job.savedBy.some(id => id.toString() === req.user._id.toString()) : false,
      isHidden: job.hiddenBy ? job.hiddenBy.some(id => id.toString() === req.user._id.toString()) : false
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
      return res.status(400).json({ message: 'Bu iş ilanının süresi dolmuştur.' });
    }

    // Check if limit reached
    if (job.maxApplicants && job.applicantCount >= job.maxApplicants) {
      return res.status(400).json({ message: 'Bu iş ilanı için başvuru sınırına ulaşılmıştır.' });
    }

    // Check if already applied
    if (job.applicants && job.applicants.includes(req.user._id)) {
      return res.status(400).json({ message: 'Already applied to this job' });
    }

    if (!job.applicants) {
      job.applicants = [];
    }

    job.applicants.push(req.user._id);
    job.applicantCount = job.applicants.length;

    // Check if it reached max after this application
    if (job.maxApplicants && job.applicantCount >= job.maxApplicants) {
      job.isActive = false;

      const notification = new Notification({
        user: job.employer,
        title: 'Başvuru Sınırına Ulaşıldı',
        message: `"${job.title}" adlı iş ilanınız maksimum başvuru sınırına (${job.maxApplicants} kişi) ulaştığı için kapatılmıştır.`,
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
    await updateJobDailyStats(job._id, 'applications');

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


// ==================== JOB ANALYTICS & STATS ====================

// Record job view (impression)
router.post('/:id/view', authenticate, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    if (job.employer.toString() !== req.user._id.toString()) {
      await updateJobDailyStats(job._id, 'views');
    }
    res.json({ message: 'View recorded' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Record job click / read
router.post('/:id/click', authenticate, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ message: 'Job not found' });

    if (job.employer.toString() !== req.user._id.toString()) {
      await updateJobDailyStats(job._id, 'clicks');
    }
    res.json({ message: 'Click recorded' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get job analytics (employer only)
router.get('/:id/analytics', authenticate, authorize('employer'), async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);

    if (!job) {
      return res.status(404).json({ message: 'Job not found' });
    }

    if (job.employer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to view analytics for this job' });
    }

    const viewCount = job.viewCount || 0;
    const clickCount = job.clickCount || 0;
    const applicantCount = job.applicantCount || (job.applicants ? job.applicants.length : 0);
    const favoriteCount = job.favoriteCount || (job.favorites ? job.favorites.length : 0);
    const savedCount = job.savedCount || (job.savedBy ? job.savedBy.length : 0);

    // Rates
    const clickThroughRate = viewCount > 0 ? ((clickCount / viewCount) * 100).toFixed(1) : (clickCount > 0 ? '100.0' : '0.0');
    const applicationRate = clickCount > 0 ? ((applicantCount / clickCount) * 100).toFixed(1) : (applicantCount > 0 ? '100.0' : '0.0');

    // Funnel data
    const funnel = [
      { key: 'views', label: 'Görüntülenme', count: viewCount, color: '#3B82F6', description: 'İlanı listede veya aramada görenler' },
      { key: 'clicks', label: 'Tıklanma & Okunma', count: clickCount, color: '#8B5CF6', description: 'İlan detayını açıp okuyanlar' },
      { key: 'applications', label: 'Başvuru', count: applicantCount, color: '#10B981', description: 'İş başvurusunda bulunan adaylar' },
      { key: 'interactions', label: 'Favori & Kayıt', count: favoriteCount + savedCount, color: '#F59E0B', description: 'İlanı kaydeden veya favorileyenler' }
    ];

    // Last 7 days breakdown
    const now = new Date();
    const dayNames = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
    const dailyActivity = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().slice(0, 10);
      const dayName = dayNames[d.getDay()];

      const found = (job.dailyStats || []).find(s => s.date === dateStr);
      dailyActivity.push({
        date: dateStr,
        dayName,
        views: found ? found.views : 0,
        clicks: found ? found.clicks : 0,
        applications: found ? found.applications : 0
      });
    }

    // Status breakdown from Application collection
    const applications = await Application.find({ job: job._id });
    const statusCounts = {
      applied: 0,
      contacted: 0,
      accepted: 0,
      rejected: 0
    };

    applications.forEach(app => {
      if (statusCounts[app.status] !== undefined) {
        statusCounts[app.status]++;
      } else {
        statusCounts.applied++;
      }
    });

    res.json({
      success: true,
      analytics: {
        jobId: job._id.toString(),
        title: job.title,
        company: job.company,
        createdAt: job.createdAt,
        isActive: job.isActive,
        viewCount,
        clickCount,
        applicantCount,
        favoriteCount,
        savedCount,
        clickThroughRate: parseFloat(clickThroughRate),
        applicationRate: parseFloat(applicationRate),
        funnel,
        dailyActivity,
        applicantStatusBreakdown: statusCounts
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

export default router;
