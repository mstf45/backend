import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pro_career')
  .then(() => console.log('MongoDB connected successfully\n'))
  .then(async () => {
    const users = await mongoose.connection.db.collection('users').find({}).toArray();
    console.log(`--- Total Registered Users: ${users.length} ---`);
    users.forEach((user, index) => {
      console.log(`${index + 1}. Username: ${user.username} | Email: ${user.email} | Type: ${user.userType || 'N/A'}`);
    });
    mongoose.connection.close();
  })
  .catch((err) => console.error('MongoDB connection error:', err));
