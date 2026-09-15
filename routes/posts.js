import { sendNotification } from '../services/notificationService.js';
import express from 'express';
import { body, validationResult } from 'express-validator';
import Post from '../models/Post.js';
import User from '../models/User.js';
import { authenticate, checkReadOnly } from '../middleware/auth.js';
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

    const rawType = base64String.substring(prefix.length, prefixEnd);
    const type = rawType.split(';')[0].trim().toLowerCase();
    const data = base64String.substring(prefixEnd + base64Prefix.length);

    console.log('Type:', type);
    console.log('Data length:', data.length);

    const buffer = Buffer.from(data, 'base64');
    console.log('Buffer length:', buffer.length);

    // Determine file extension
    let extension = '';
    if (type.startsWith('image/')) {
      extension = type.replace('image/', '').trim();
      if (extension === 'jpeg') extension = 'jpg';
      if (!extension || extension === '*') extension = 'jpg';
    } else if (type.startsWith('video/')) {
      extension = type.replace('video/', '').trim();
      if (extension === 'quicktime') extension = 'mov';
      if (!extension || extension === '*') extension = 'mp4';
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
router.post('/', authenticate, checkReadOnly, [
  body('content').custom((value, { req }) => {
    const hasContent = typeof value === 'string' && value.trim().length > 0;
    const hasMedia = req.body && req.body.media && typeof req.body.media === 'string' && req.body.media.length > 0;
    if (!hasContent && !hasMedia) {
      throw new Error('Gönderi içeriği veya medya eklemelisiniz.');
    }
    return true;
  }),
  body('media').optional(),
  body('ai').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { content, media, ai } = req.body;

    console.log('Media received:', media ? 'YES' : 'NO');
    if (media) {
      console.log('Media type:', media.substring(0, 50));
      console.log('Media length:', media.length);
    }

    let mediaType = 'text';
    let mediaUrl = null;

    // Handle base64 media - save to disk file
    if (media) {
      if (media.startsWith('data:')) {
        const savedMedia = saveBase64Media(media);
        if (savedMedia) {
          mediaUrl = savedMedia.path;
          if (savedMedia.type.startsWith('image/')) {
            mediaType = 'image';
          } else if (savedMedia.type.startsWith('video/')) {
            mediaType = 'video';
          }
        }
      } else {
        mediaUrl = media;
        if (media.startsWith('/uploads/')) {
          if (media.endsWith('.mp4') || media.endsWith('.mov') || media.endsWith('.avi')) {
            mediaType = 'video';
          } else {
            mediaType = 'image';
          }
        }
      }
    }

    let aiValue = null;
    if (ai !== undefined && ai !== null) {
      if (typeof ai === 'string') {
        const trimmed = ai.trim();
        if (trimmed === 'false' || trimmed === 'null' || trimmed === '') {
          aiValue = null;
        } else {
          aiValue = trimmed;
        }
      } else if (typeof ai === 'boolean') {
        aiValue = ai ? true : null;
      } else {
        aiValue = ai;
      }
    }

    const post = new Post({
      author: req.user._id,
      content: content || '',
      mediaType,
      mediaUrl,
      ai: aiValue
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
    console.log('=== GET /api/posts called ===');
    console.log('User ID:', req.user._id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    console.log('Page:', page, 'Limit:', limit, 'Skip:', skip);
    console.log('Fetching posts...');

    const user = await User.findById(req.user._id);
    const blockedIds = user.blockedUsers || [];

    const posts = await Post.find({
      hiddenBy: { $ne: req.user._id },
      author: { $nin: blockedIds }
    })
      .populate('author', 'username avatar profession')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    console.log('Posts found:', posts.length);

    const total = await Post.countDocuments({
      hiddenBy: { $ne: req.user._id },
      author: { $nin: blockedIds }
    });
    console.log('Total posts:', total);

    // Add isLiked and isSaved flags and default avatar
    console.log('Processing posts...');
    const postsWithFlags = posts.map(post => {
      try {
        const postObj = post.toObject();

        // Set default avatar for author if null
        if (!postObj.author) {
          console.log('Post has no author:', post._id);
          postObj.author = { username: 'Unknown', avatar: null, profession: null };
        }

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
          ai: postObj.ai !== undefined ? postObj.ai : null,
          isLiked: post.likes ? post.likes.includes(req.user._id) : false,
          isSaved: post.savedBy ? post.savedBy.includes(req.user._id) : false,
          isHidden: post.hiddenBy ? post.hiddenBy.includes(req.user._id) : false
        };
      } catch (mapError) {
        console.error('Error processing post:', post._id, mapError);
        return null;
      }
    }).filter(p => p !== null);

    console.log('Processed posts count:', postsWithFlags.length);
    console.log('Sending response...');

    const responseData = {
      posts: postsWithFlags,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };

    res.json(responseData);

    console.log('Response sent successfully');
  } catch (error) {
    console.error('Error in GET /api/posts:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Batch unlike posts
router.post('/batch-unlike', authenticate, async (req, res) => {
  try {
    const { postIds } = req.body;
    if (!Array.isArray(postIds)) {
      return res.status(400).json({ message: 'postIds must be an array' });
    }

    const posts = await Post.find({ _id: { $in: postIds } });
    for (const post of posts) {
      post.likes = post.likes.filter(id => id.toString() !== req.user._id.toString());
      post.likeCount = post.likes.length;
      await post.save();
    }

    res.json({ message: 'Posts unliked successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Batch unsave posts
router.post('/batch-unsave', authenticate, async (req, res) => {
  try {
    const { postIds } = req.body;
    if (!Array.isArray(postIds)) {
      return res.status(400).json({ message: 'postIds must be an array' });
    }

    const posts = await Post.find({ _id: { $in: postIds } });
    for (const post of posts) {
      post.savedBy = post.savedBy.filter(id => id.toString() !== req.user._id.toString());
      post.savedCount = post.savedBy.length;
      await post.save();
    }

    res.json({ message: 'Posts unsaved successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get user's own posts
router.get('/my-posts', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const posts = await Post.find({ author: req.user._id })
      .populate('author', 'username avatar profession')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Post.countDocuments({ author: req.user._id });

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

    const user = await User.findById(req.user._id);
    const blockedIds = user ? (user.blockedUsers || []) : [];

    const query = {
      mediaType: 'video',
      mediaUrl: { $ne: null, $exists: true },
      hiddenBy: { $ne: req.user._id },
      author: { $nin: blockedIds }
    };

    const posts = await Post.find(query)
      .populate('author', 'username avatar profession')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Post.countDocuments(query);

    const postsWithFlags = posts.map(post => {
      try {
        const postObj = post.toObject();

        if (!postObj.author) {
          postObj.author = { username: 'Unknown', avatar: null, profession: null };
        }

        if (!postObj.author.avatar) {
          postObj.author.avatar = getFullUrl(req, '/uploads/default_avatar.png');
        } else {
          postObj.author.avatar = getFullUrl(req, postObj.author.avatar);
        }

        if (postObj.mediaUrl && postObj.mediaUrl.startsWith('/uploads/')) {
          postObj.mediaUrl = getFullUrl(req, postObj.mediaUrl);
        }

        return {
          ...postObj,
          ai: postObj.ai !== undefined ? postObj.ai : null,
          isLiked: post.likes ? post.likes.includes(req.user._id) : false,
          isSaved: post.savedBy ? post.savedBy.includes(req.user._id) : false,
          isHidden: post.hiddenBy ? post.hiddenBy.includes(req.user._id) : false,
          likeCount: post.likes ? post.likes.length : 0,
          savedCount: post.savedBy ? post.savedBy.length : 0,
          commentCount: post.comments ? post.comments.length : 0
        };
      } catch (err) {
        console.error('Error processing video post:', err);
        return null;
      }
    }).filter(p => p !== null);

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

// Get single post
router.get('/:id', authenticate, async (req, res) => {
  try {
    console.log('=== GET /api/posts/:id called ===');
    console.log('Post ID:', req.params.id);

    const post = await Post.findById(req.params.id)
      .populate('author', 'username avatar profession socialLinks experience bio followerCount')
      .populate('likes', 'username avatar')
      .populate('comments.user', 'username avatar');

    if (!post) {
      console.log('Post not found');
      return res.status(404).json({ message: 'Post not found' });
    }

    console.log('Post found, comments count:', post.comments.length);

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
router.put('/:id', authenticate, checkReadOnly, async (req, res) => {
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

    const { content, media, ai } = req.body;

    console.log('Update post request - content:', content);
    console.log('Update post request - media exists:', !!media);
    console.log('Update post request - media length:', media ? media.length : 0);

    if (content) post.content = content;
    if (ai !== undefined) {
      if (ai === true || ai === 'true' || ai === 1 || ai === '1') post.ai = true;
      else if (ai === false || ai === 'false' || ai === 0 || ai === '0') post.ai = false;
      else post.ai = ai;
    }

    // Handle media update - save to disk file
    if (media) {
      console.log('Processing media update...');
      if (media.startsWith('data:')) {
        const savedMedia = saveBase64Media(media);
        if (savedMedia) {
          post.mediaUrl = savedMedia.path;
          if (savedMedia.type.startsWith('image/')) {
            post.mediaType = 'image';
          } else if (savedMedia.type.startsWith('video/')) {
            post.mediaType = 'video';
          }
        }
      } else {
        post.mediaUrl = media;
        if (media.startsWith('/uploads/')) {
          if (media.endsWith('.mp4') || media.endsWith('.mov') || media.endsWith('.avi')) {
            post.mediaType = 'video';
          } else {
            post.mediaType = 'image';
          }
        }
      }
      console.log('Post media updated - type:', post.mediaType, 'url:', post.mediaUrl);
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
router.delete('/:id', authenticate, checkReadOnly, async (req, res) => {
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
router.post('/:id/like', authenticate, checkReadOnly, async (req, res) => {
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

    // Gönderi sahibi farklı bir kullanıcı ise bildirim gönder
    if (!alreadyLiked && post.user && post.user.toString() !== req.user._id.toString()) {
      sendNotification({
        recipientId: post.user,
        senderId: req.user._id,
        title: 'Yeni Beğeni ❤️',
        message: `${req.user.username || 'Bir kullanıcı'} gönderinizi beğendi.`,
        type: 'post_like',
        data: { postId: post._id.toString() }
      }).catch(err => console.warn('[PostLike] Bildirim hatası:', err.message));
    }

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
router.post('/:id/save', authenticate, checkReadOnly, async (req, res) => {
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
router.post('/:id/comments', authenticate, checkReadOnly, async (req, res) => {
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

    // Gönderi sahibi farklı bir kullanıcı ise bildirim gönder
    if (post.user && post.user.toString() !== req.user._id.toString()) {
      const commentSnippet = (text || '').trim();
      const snippet = commentSnippet.length > 50 ? commentSnippet.slice(0, 50) + '...' : commentSnippet;
      sendNotification({
        recipientId: post.user,
        senderId: req.user._id,
        title: 'Yeni Yorum 💬',
        message: `${req.user.username || 'Bir kullanıcı'} gönderinize yorum yaptı: "${snippet}"`,
        type: 'post_comment',
        data: { postId: post._id.toString() }
      }).catch(err => console.warn('[PostComment] Bildirim hatası:', err.message));
    }

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

    // Check if target user profile is private
    const targetUser = await User.findById(req.params.userId);
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }
    const isMe = targetUser._id.toString() === req.user._id.toString();
    const isFollowing = targetUser.followers.map(f => f.toString()).includes(req.user._id.toString());

    if (targetUser.isPrivate && !isMe && !isFollowing) {
      return res.json({
        posts: [],
        pagination: { page, limit, total: 0, pages: 0 },
        message: 'This account is private'
      });
    }

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
