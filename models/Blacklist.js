import mongoose from 'mongoose';

const blacklistSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reason: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

blacklistSchema.index({ user: 1 });
blacklistSchema.index({ company: 1 });
blacklistSchema.index({ user: 1, company: 1 }, { unique: true });

export default mongoose.model('Blacklist', blacklistSchema);
