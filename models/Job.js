import mongoose from 'mongoose';

const jobSchema = new mongoose.Schema({
  employer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  profession: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  company: {
    type: String,
    required: true
  },
  location: {
    type: String,
    required: true
  },
  coordinates: {
    latitude: { type: Number },
    longitude: { type: Number }
  },
  workType: {
    type: String,
    enum: ['full_time', 'part_time', 'intern'],
    required: true
  },
  description: {
    type: String,
    required: true
  },
  applicants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  applicantCount: {
    type: Number,
    default: 0
  },
  viewCount: {
    type: Number,
    default: 0
  },
  clickCount: {
    type: Number,
    default: 0
  },
  dailyStats: [{
    date: { type: String, required: true },
    views: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    applications: { type: Number, default: 0 }
  }],
  favorites: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  favoriteCount: {
    type: Number,
    default: 0
  },
  savedBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  savedCount: {
    type: Number,
    default: 0
  },
  hiddenBy: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  hiddenCount: {
    type: Number,
    default: 0
  },
  reports: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reason: {
      type: String,
      default: 'Diğer'
    },
    description: {
      type: String,
      default: ''
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  ratings: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rating'
  }],
  averageRating: {
    type: Number,
    default: 0
  },
  ratingCount: {
    type: Number,
    default: 0
  },
  durationDays: {
    type: Number,
    default: 30
  },
  maxApplicants: {
    type: Number,
    default: null
  },
  expiresAt: {
    type: Date
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

jobSchema.pre('save', function(next) {
  if (this.applicants) {
    this.applicantCount = this.applicants.length;
  }
  if (this.favorites) {
    this.favoriteCount = this.favorites.length;
  }
  if (this.savedBy) {
    this.savedCount = this.savedBy.length;
  }
  if (this.hiddenBy) {
    this.hiddenCount = this.hiddenBy.length;
  }
  next();
});

jobSchema.index({ employer: 1 });
jobSchema.index({ profession: 1 });
jobSchema.index({ workType: 1 });
jobSchema.index({ location: 1 });
jobSchema.index({ createdAt: -1 });
jobSchema.index({ favorites: 1 });
jobSchema.index({ savedBy: 1 });
jobSchema.index({ hiddenBy: 1 });

export default mongoose.model('Job', jobSchema);
