import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pro_career')
  .then(() => console.log('MongoDB connected successfully'))
  .then(async () => {
    // Delete all jobs
    const jobsResult = await mongoose.connection.db.collection('jobs').deleteMany({});
    console.log(`Deleted ${jobsResult.deletedCount} jobs`);

    // Delete all applications
    const appsResult = await mongoose.connection.db.collection('applications').deleteMany({});
    console.log(`Deleted ${appsResult.deletedCount} applications`);

    // Delete all ratings
    const ratingsResult = await mongoose.connection.db.collection('ratings').deleteMany({});
    console.log(`Deleted ${ratingsResult.deletedCount} ratings`);

    mongoose.connection.close();
  })
  .catch((err) => console.error('MongoDB connection error:', err));
