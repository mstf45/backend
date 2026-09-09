import mongoose from 'mongoose';

const actionItemSchema = new mongoose.Schema({
  id: { type: String, required: true },
  title: { type: String, required: true },
  completed: { type: Boolean, default: false },
  isLockedCompleted: { type: Boolean, default: false },
  bestScore: { type: Number, default: 0 }
}, { _id: false });

const resourceSchema = new mongoose.Schema({
  title: { type: String, required: true },
  type: { type: String, default: 'Döküman' },
  url: { type: String, default: null }
}, { _id: false });

const milestoneSchema = new mongoose.Schema({
  id: { type: String, required: true },
  phase: { type: String, required: true },
  timeframe: { type: String, required: true },
  description: { type: String, default: '' },
  topics: [{ type: String }],
  isUnlocked: { type: Boolean, default: false },
  phaseExamPassed: { type: Boolean, default: false },
  phaseExamScore: { type: Number, default: 0 },
  actionItems: [actionItemSchema],
  recommendedResources: [resourceSchema]
}, { _id: false });

const careerRoadmapSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  targetRole: { type: String, required: true },
  currentLevel: { type: String, default: 'Giriş / Orta Seviye' },
  targetTimeframe: { type: String, default: '6-12 Ay' },
  weeklyCommitment: { type: String, default: '5-10 Saat' },
  summary: { type: String, default: '' },
  skillGapAnalysis: {
    strengths: [{ type: String }],
    toImprove: [{ type: String }]
  },
  milestones: [milestoneSchema],
  recommendedCertifications: [{ type: String }],
  careerAdvice: [{ type: String }],
  isCompleted: { type: Boolean, default: false },
  certificate: { type: Object, default: null },
  badges: [{ type: Object, default: () => [] }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});


export default mongoose.model('CareerRoadmap', careerRoadmapSchema);
