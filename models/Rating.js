import mongoose from 'mongoose';

const ratingSchema = new mongoose.Schema({
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: false
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  applicant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  comment: {
    type: String,
    default: null
  },
  isAnonymous: {
    type: Boolean,
    default: true
  },
  relation: {
    type: String,
    enum: ['applicant', 'former_employee'],
    default: 'applicant'
  },
  responseReceived: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

ratingSchema.index({ job: 1 });
ratingSchema.index({ company: 1 });
ratingSchema.index({ applicant: 1 });
ratingSchema.index({ rating: 1 });

export default mongoose.model('Rating', ratingSchema);
