import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  isPhoneVerified: {
    type: Boolean,
    default: false
  },
  phoneVerificationCode: {
    type: String,
    default: null
  },
  phoneVerificationCodeExpires: {
    type: Date,
    default: null
  },
  password: {
    type: String,
    required: true
  },
  userType: {
    type: String,
    enum: ['job_seeker', 'employer'],
    required: true
  },
  avatar: {
    type: String,
    default: null
  },
  profession: {
    type: String,
    default: null
  },
  bio: {
    type: String,
    default: null
  },
  company: {
    type: String,
    default: null
  },
  companyLogo: {
    type: String,
    default: null
  },
  companyEmployeeCount: {
    type: Number,
    default: null
  },
  companyDescription: {
    type: String,
    default: null
  },
  companyScore: {
    type: Number,
    default: 100
  },
  companyRatingCount: {
    type: Number,
    default: 0
  },
  socialLinks: {
    instagram: { type: String, default: null },
    twitter: { type: String, default: null },
    facebook: { type: String, default: null },
    linkedin: { type: String, default: null },
    youtube: { type: String, default: null },
    github: { type: String, default: null },
    medium: { type: String, default: null }
  },
  experience: [{
    company: String,
    position: String,
    startDate: Date,
    endDate: Date,
    description: String
  }],
  followers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  following: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  followerCount: {
    type: Number,
    default: 0
  },
  followingCount: {
    type: Number,
    default: 0
  },
  blacklistedCompanies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  isPrivate: {
    type: Boolean,
    default: false
  },
  blockedUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  showBlockDialogAfterHide: {
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

userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ userType: 1 });
userSchema.index({ companyScore: -1 });

export default mongoose.model('User', userSchema);
