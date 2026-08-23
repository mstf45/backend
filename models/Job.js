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
  next();
});

jobSchema.index({ employer: 1 });
jobSchema.index({ profession: 1 });
jobSchema.index({ workType: 1 });
jobSchema.index({ location: 1 });
jobSchema.index({ createdAt: -1 });

export default mongoose.model('Job', jobSchema);
