import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import Application from './models/Application.js';
import User from './models/User.js';
import Notification from './models/Notification.js';
import path from 'path';
import { fileURLToPath } from 'url';

// Import routes
import authRoutes from './routes/auth.js';
import postRoutes from './routes/posts.js';
import jobRoutes from './routes/jobs.js';
import userRoutes from './routes/users.js';
import ratingRoutes from './routes/ratings.js';
import blacklistRoutes from './routes/blacklist.js';
import searchRoutes from './routes/search.js';
import aiRoutes from './routes/ai.js';
import messageRoutes from './routes/messages.js';
import notificationRoutes from './routes/notifications.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });



// Daily Application Penalty Check
const runDailyPenaltyCheck = async () => {
  try {
    console.log('=== Running Application Response Penalty Check ===');
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const pendingApps = await Application.find({
      status: 'applied',
      appliedAt: { $lte: oneWeekAgo },
      penaltyApplied: false
    }).populate('job', 'title');

    console.log(`Found ${pendingApps.length} unresponded applications eligible for penalty.`);

    for (const app of pendingApps) {
      app.penaltyApplied = true;
      await app.save();

      // Penalize employer by subtracting 10 points
      const employer = await User.findById(app.employer);
      if (employer) {
        employer.companyScore = Math.max(0, employer.companyScore - 10);
        await employer.save();
        console.log(`Employer ${employer.username} penalized. New companyScore: ${employer.companyScore}`);
      }

      // Notify applicant
      const jobTitle = app.job ? app.job.title : 'İş ilanı';
      const notification = new Notification({
        user: app.applicant,
        title: 'Değerlendirme Hatırlatması',
        message: `"${jobTitle}" ilanına yaptığınız başvuruya 1 haftadır geri dönüş yapılmadı. Şirketi değerlendirebilirsiniz.`,
        type: 'warning'
      });
      await notification.save();
    }
    console.log('=== Penalty check completed ===');
  } catch (error) {
    console.error('Error in daily penalty check:', error);
  }
};

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pro_career')
  .then(async () => {
    console.log('MongoDB connected successfully');
    try {
      const Job = mongoose.model('Job');
      const jobs = await Job.find({});
      for (const job of jobs) {
        if (job.applicants) {
          const actualCount = job.applicants.length;
          if (job.applicantCount !== actualCount) {
            job.applicantCount = actualCount;
            await job.save();
          }
        }
      }
      console.log('Jobs applicant count synchronization completed.');
      // Run application response penalty check
      runDailyPenaltyCheck();
      setInterval(runDailyPenaltyCheck, 12 * 60 * 60 * 1000); // Check every 12 hours
    } catch (err) {
      console.error('Error synchronizing jobs applicant count:', err);
    }
  })
  .catch((err) => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/users', userRoutes);
app.use('/api/ratings', ratingRoutes);
app.use('/api/blacklist', blacklistRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Pro Career API is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

export default app;
