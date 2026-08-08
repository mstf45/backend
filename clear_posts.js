import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pro_career')
  .then(() => console.log('MongoDB connected successfully'))
  .then(async () => {
    const result = await mongoose.connection.db.collection('posts').deleteMany({});
    console.log(`Deleted ${result.deletedCount} posts`);
    mongoose.connection.close();
  })
  .catch((err) => console.error('MongoDB connection error:', err));
