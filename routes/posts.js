import express from 'express';
import { body, validationResult } from 'express-validator';
import Post from '../models/Post.js';
import { authenticate } from '../middleware/auth.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to convert relative paths to full URLs
const getFullUrl = (req, path) => {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith('/uploads/')) {
    return `${req.protocol}://${req.get('host')}${path}`;
  }
  return path;
};

const router = express.Router();

// Helper function to save base64 media to file
const saveBase64Media = (base64String) => {
  try {
    console.log('Starting saveBase64Media...');
    console.log('Base64 string length:', base64String.length);
    console.log('First 100 chars:', base64String.substring(0, 100));
    
    // Simple string parsing
    const prefix = 'data:';
    const base64Prefix = ';base64,';
    
    if (!base64String.startsWith(prefix)) {
      console.log('Does not start with data:');
      return null;
    }
    
    const prefixEnd = base64String.indexOf(base64Prefix);
    if (prefixEnd === -1) {
      console.log('Does not contain ;base64,');
      return null;
    }
    
    const type = base64String.substring(prefix.length, prefixEnd);
    const data = base64String.substring(prefixEnd + base64Prefix.length);
    
    console.log('Type:', type);
    console.log('Data length:', data.length);
    
    const buffer = Buffer.from(data, 'base64');
    console.log('Buffer length:', buffer.length);

    // Determine file extension
    let extension = '';
    if (type.startsWith('image/')) {
      extension = type.replace('image/', '');
    } else if (type.startsWith('video/')) {
      extension = type.replace('video/', '');
    } else {
      console.log('Unknown type:', type);
      return null;
    }
    
    console.log('Extension:', extension);

    const filename = `media-${Date.now()}-${Math.round(Math.random() * 1E9)}.${extension}`;
    const filepath = path.join(__dirname, '../uploads', filename);
    console.log('Filepath:', filepath);

    // Ensure uploads directory exists
    const uploadsDir = path.join(__dirname, '../uploads');
    console.log('Uploads dir:', uploadsDir);
    console.log('Uploads dir exists:', fs.existsSync(uploadsDir));
    
    if (!fs.existsSync(uploadsDir)) {
      console.log('Creating uploads directory...');
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    console.log('Writing file...');
    fs.writeFileSync(filepath, buffer);
    console.log('File written successfully');

    return {
      type: type,
      path: `/uploads/${filename}`
    };
  } catch (error) {
    console.error('Error saving base64 media:', error);
    console.error('Error stack:', error.stack);
    return null;
  }
};

// Create post
router.post('/', authenticate, [
  body('content').trim().notEmpty().withMessage('Content is required'),
  body('media').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { content, media } = req.body;

    console.log('Media received:', media ? 'YES' : 'NO');
    if (media) {
      console.log('Media type:', media.substring(0, 50));
      console.log('Media length:', media.length);
    }

    let mediaType = 'text';
    let mediaUrl = null;

    // Handle base64 media - store directly in database
    if (media) {
      mediaUrl = media;
      // Determine media type from base64 string
      if (media.startsWith('data:image/')) {
        mediaType = 'image';
      } else if (media.startsWith('data:video/')) {
        mediaType = 'video';
      }
    }

    const post = new Post({
      author: req.user._id,
      content: content || '',
      mediaType,
      mediaUrl
    });

    await post.save();
    await post.populate('author', 'username avatar profession');

    res.status(201).json({ message: 'Post created successfully', post });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get all posts (feed)
router.get('/', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const posts = await Post.find({ hiddenBy: { $ne: req.user._id } })
      .populate('author', 'username avatar profession')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Post.countDocuments({ hiddenBy: { $ne: req.user._id } });

    // Add isLiked and isSaved flags and default avatar
    const postsWithFlags = posts.map(post => {
      const postObj = post.toObject();
      
      // Set default avatar for author if null
      if (!postObj.author.avatar) {
        postObj.author.avatar = getFullUrl(req, '/uploads/default_avatar.png');
      } else {
        postObj.author.avatar = getFullUrl(req, postObj.author.avatar);
      }
      
      // Set full URL for mediaUrl if it's a file path
      if (postObj.mediaUrl && postObj.mediaUrl.startsWith('/uploads/')) {
        postObj.mediaUrl = getFullUrl(req, postObj.mediaUrl);
      }
      
      return {
        ...postObj,
        isLiked: post.likes.includes(req.user._id),
        isSaved: post.savedBy.includes(req.user._id),
        isHidden: post.hiddenBy.includes(req.user._id)
      };
    });

    res.json({
      posts: postsWithFlags,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get video posts only
router.get('/videos', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const posts = await Post.find({ mediaType: 'video' })
      .populate('author', 'username avatar profession')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Post.countDocuments({ mediaType: 'video' });

    res.json({
      posts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get single post
router.get('/:id', authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate('author', 'username avatar profession socialLinks experience bio followerCount')
      .populate('likes', 'username avatar')
      .populate('comments.user', 'username avatar');

    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    // Set default avatar for author if null
    if (!post.author.avatar) {
      post.author.avatar = `${req.protocol}://${req.get('host')}/uploads/default_avatar.png`;
    } else if (post.author.avatar.startsWith('/uploads/')) {
      post.author.avatar = `${req.protocol}://${req.get('host')}${post.author.avatar}`;
    }

    // Set default avatar for likes if null
    post.likes.forEach(like => {
      if (!like.avatar) {
        like.avatar = `${req.protocol}://${req.get('host')}/uploads/default_avatar.png`;
      } else if (like.avatar.startsWith('/uploads/')) {
        like.avatar = `${req.protocol}://${req.get('host')}${like.avatar}`;
      }
    });

    // Set default avatar for comment users if null
    post.comments.forEach(comment => {
      if (comment.user && !comment.user.avatar) {
        comment.user.avatar = `${req.protocol}://${req.get('host')}/uploads/default_avatar.png`;
      } else if (comment.user && comment.user.avatar.startsWith('/uploads/')) {
        comment.user.avatar = `${req.protocol}://${req.get('host')}${comment.user.avatar}`;
      }
    });

    // Set full URL for mediaUrl if exists
    if (post.mediaUrl && post.mediaUrl.startsWith('/uploads/')) {
      post.mediaUrl = `${req.protocol}://${req.get('host')}${post.mediaUrl}`;
    }

    res.json({ post });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update post
router.put('/:id', authenticate, async (req, res) => {
  try {
    console.log('=== PUT /posts/:id called ===');
    console.log('Post ID:', req.params.id);
    console.log('User ID:', req.user._id);
    
    const post = await Post.findById(req.params.id);

    if (!post) {
      console.log('Post not found');
      return res.status(404).json({ message: 'Post not found' });
    }

    console.log('Post found, author:', post.author);
    console.log('Post author type:', typeof post.author);
    console.log('User ID type:', typeof req.user._id);
    
    if (post.author.toString() !== req.user._id.toString()) {
      console.log('Authorization failed');
      return res.status(403).json({ message: 'Not authorized to update this post' });
    }

    const { content, media } = req.body;
    
    console.log('Update post request - content:', content);
    console.log('Update post request - media exists:', !!media);
    console.log('Update post request - media length:', media ? media.length : 0);
    
    if (content) post.content = content;
    
    // Handle media update - store directly in database
    if (media) {
      console.log('Processing media update...');
      mediaUrl = media;
      // Determine media type from base64 string
      if (media.startsWith('data:image/')) {
        mediaType = 'image';
      } else if (media.startsWith('data:video/')) {
        mediaType = 'video';
      }
      post.mediaType = mediaType;
      post.mediaUrl = mediaUrl;
      console.log('Post media updated - type:', post.mediaType, 'url length:', post.mediaUrl.length);
    }

    post.updatedAt = Date.now();
    await post.save();
    await post.populate('author', 'username avatar profession');

    console.log('Post saved successfully');
    res.json({ message: 'Post updated successfully', post });
  } catch (error) {
    console.error('Error in PUT /posts/:id:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete post
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    if (post.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this post' });
    }

    await Post.findByIdAndDelete(req.params.id);

    res.json({ message: 'Post deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Like post
router.post('/:id/like', authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const alreadyLiked = post.likes.includes(req.user._id);

    if (alreadyLiked) {
      post.likes = post.likes.filter(id => id.toString() !== req.user._id.toString());
      post.likeCount = post.likes.length;
    } else {
      post.likes.push(req.user._id);
      post.likeCount = post.likes.length;
    }

    await post.save();

   res.json({ 
      message: alreadyLiked ? 'Post unliked' : 'Post liked',
      liked: !alreadyLiked,
      likeCount: post.likeCount
   });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Hide post
router.post('/:id/hide', authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const alreadyHidden = post.hiddenBy.includes(req.user._id);

    if (alreadyHidden) {
      return res.status(400).json({ message: 'Post already hidden' });
    }

    post.hiddenBy.push(req.user._id);
    post.hiddenCount = post.hiddenBy.length;

    await post.save();

    res.json({ 
      message: 'Post hidden successfully',
      hidden: true,
      hiddenCount: post.hiddenCount
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Unhide post
router.post('/:id/unhide', authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const alreadyHidden = post.hiddenBy.includes(req.user._id);

    if (!alreadyHidden) {
      return res.status(400).json({ message: 'Post not hidden' });
    }

    post.hiddenBy = post.hiddenBy.filter(id => id.toString() !== req.user._id.toString());
    post.hiddenCount = post.hiddenBy.length;

    await post.save();

    res.json({ 
      message: 'Post unhidden successfully',
      hidden: false,
      hiddenCount: post.hiddenCount
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Save post
router.post('/:id/save', authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const alreadySaved = post.savedBy.includes(req.user._id);

    if (alreadySaved) {
      post.savedBy = post.savedBy.filter(id => id.toString() !== req.user._id.toString());
      post.savedCount = post.savedBy.length;
    } else {
      post.savedBy.push(req.user._id);
      post.savedCount = post.savedBy.length;
    }

    await post.save();

    res.json({ 
      message: alreadySaved ? 'Post unsaved' : 'Post saved',
      saved: !alreadySaved,
      savedCount: post.savedCount
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Add comment
router.post('/:id/comments', authenticate, async (req, res) => {
  try {
    const { text } = req.body;
    const post = await Post.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    post.comments.push({
      user: req.user._id,
      text,
      createdAt: Date.now()
    });

    await post.save();
    await post.populate('comments.user', 'username avatar');

    res.json({ message: 'Comment added successfully', comments: post.comments });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get user's posts
router.get('/user/:userId', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const posts = await Post.find({ author: req.params.userId })
      .populate('author', 'username avatar profession')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Post.countDocuments({ author: req.params.userId });

    res.json({
      posts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

export default router;
