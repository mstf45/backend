import mongoose from 'mongoose';

const ratingSchema = new mongoose.Schema({
  job: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Job',
    required: true
  },
  employer: {
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
ratingSchema.index({ employer: 1 });
ratingSchema.index({ applicant: 1 });
ratingSchema.index({ rating: 1 });

export default mongoose.model('Rating', ratingSchema);
