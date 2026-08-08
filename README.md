# Pro Career Backend

LinkedIn-style social media platform for job seekers and employers with employer rating and blacklisting system.

## Features

- **User Authentication**: Register and login for both job seekers and employers
- **Post Management**: Create, edit, delete posts with text, images, and videos
- **Job Posting**: Employers can post job listings with detailed information
- **Job Application**: Job seekers can apply to job postings
- **Rating System**: Applicants can rate employers based on their response behavior
- **Blacklisting**: Users can blacklist companies that don't respond to applications
- **Search & Filter**: Advanced search for jobs by profession, location, work type, and geolocation
- **AI Integration**: AI-powered content generation for posts and job descriptions
- **Social Features**: Like, save, comment on posts; follow users

## Tech Stack

- **Node.js** - Runtime environment
- **Express** - Web framework
- **MongoDB** - Database
- **Mongoose** - ODM for MongoDB
- **JWT** - Authentication
- **Multer** - File uploads
- **OpenAI API** - AI content generation

## Installation

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

3. Configure environment variables in `.env`:
```
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/pro_career
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRE=7d
OPENAI_API_KEY=your_openai_api_key_here
UPLOAD_DIR=uploads
MAX_FILE_SIZE=10485760
```

4. Start MongoDB server (make sure MongoDB is running)

5. Create uploads directory:
```bash
mkdir uploads
```

6. Start the server:
```bash
# Development mode
npm run dev

# Production mode
npm start
```

## API Endpoints

### Authentication (`/api/auth`)
- `POST /register` - Register new user (job_seeker or employer)
- `POST /login` - Login user
- `GET /me` - Get current user
- `PUT /profile` - Update user profile

### Posts (`/api/posts`)
- `POST /` - Create post (with file upload)
- `GET /` - Get all posts (feed)
- `GET /videos` - Get video posts only
- `GET /:id` - Get single post
- `PUT /:id` - Update post
- `DELETE /:id` - Delete post
- `POST /:id/like` - Like/unlike post
- `POST /:id/save` - Save/unsave post
- `POST /:id/comments` - Add comment
- `GET /user/:userId` - Get user's posts

### Jobs (`/api/jobs`)
- `POST /` - Create job posting (employer only)
- `GET /` - Get all jobs (filters out blacklisted companies)
- `GET /:id` - Get single job with blacklist info
- `PUT /:id` - Update job (employer only)
- `DELETE /:id` - Delete job (employer only)
- `POST /:id/apply` - Apply to job
- `GET /employer/:employerId` - Get employer's jobs
- `GET /:id/applicants` - Get job applicants (employer only)

### Ratings (`/api/ratings`)
- `POST /` - Create/update rating
- `GET /employer/:employerId` - Get employer's ratings with statistics
- `GET /job/:jobId` - Get job's ratings
- `GET /user/my-ratings` - Get user's ratings
- `DELETE /:id` - Delete rating

### Blacklist (`/api/blacklist`)
- `POST /` - Add company to blacklist
- `DELETE /:companyId` - Remove company from blacklist
- `GET /` - Get user's blacklist
- `GET /check/:companyId` - Check if company is blacklisted

### Search (`/api/search`)
- `GET /jobs` - Search jobs with filters (profession, location, workType, geolocation)
- `GET /posts` - Search posts
- `GET /users` - Search users
- `GET /professions` - Get list of professions
- `GET /locations` - Get list of locations

### AI (`/api/ai`)
- `POST /generate-post` - Generate post content with AI
- `POST /generate-job-description` - Generate job description with AI
- `POST /suggestions` - Get content suggestions

### Users (`/api/users`)
- `GET /:id` - Get user profile
- `POST /:id/follow` - Follow user
- `DELETE /:id/follow` - Unfollow user
- `GET /:id/saved` - Get user's saved posts
- `PUT /avatar` - Update avatar
- `DELETE /account` - Delete account

## Database Models

### User
- username, email, phone, password
- userType: job_seeker or employer
- avatar, profession, bio
- socialLinks (linkedin, twitter, github, website)
- experience array
- followerCount, followingCount
- blacklistedCompanies array

### Post
- author (User reference)
- content, mediaType (text/image/video), mediaUrl
- likes array, likeCount
- savedBy array, savedCount
- comments array

### Job
- employer (User reference)
- profession, title, company, location
- coordinates (latitude, longitude)
- workType (full_time, part_time, intern)
- description
- applicants array, applicantCount
- ratings array, averageRating, ratingCount
- isActive

### Rating
- job (Job reference)
- employer (User reference)
- applicant (User reference)
- rating (1-5), comment
- responseReceived (boolean)

### Blacklist
- user (User reference)
- company (User reference)
- reason

## Key Features Explained

### Employer Rating System
- After applying to a job, applicants can rate the employer (1-5 stars)
- They can indicate whether they received a response
- Low ratings and poor response rates indicate unreliable employers

### Blacklisting System
- Users can blacklist companies that don't respond to applications
- Blacklisted companies' jobs are filtered out from search results
- When viewing a blacklisted company's job, a warning is shown with the reason
- Default reason: "CV'ye Geri Dönüş Yapmıyorlar ve Cv Topluyorlar"

### AI Content Generation
- Generate professional post content based on topic and tone
- Generate detailed job descriptions based on job details
- Get content suggestions for various contexts

## Project Structure

```
backend/
├── server.js              # Main server file
├── package.json           # Dependencies
├── .env.example           # Environment variables template
├── models/                # Database models
│   ├── User.js
│   ├── Post.js
│   ├── Job.js
│   ├── Rating.js
│   └── Blacklist.js
├── routes/                # API routes
│   ├── auth.js
│   ├── posts.js
│   ├── jobs.js
│   ├── ratings.js
│   ├── blacklist.js
│   ├── search.js
│   ├── ai.js
│   └── users.js
├── middleware/            # Custom middleware
│   ├── auth.js
│   ├── upload.js
│   └── error.js
└── uploads/               # Uploaded files directory
```

## License

MIT
