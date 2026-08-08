import express from 'express';
import User from '../models/User.js';
import Post from '../models/Post.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Get user profile by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password')
      .populate('blacklistedCompanies', 'username avatar company');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Get user's posts count
    const postsCount = await Post.countDocuments({ author: req.params.id });

    // Set default avatar if null
    const userObj = user.toObject();
    if (!userObj.avatar) {
      userObj.avatar = `${req.protocol}://${req.get('host')}/uploads/default_avatar.png`;
    } else if (userObj.avatar.startsWith('/uploads/')) {
      userObj.avatar = `${req.protocol}://${req.get('host')}${userObj.avatar}`;
    }

    res.json({ 
      user: { 
        ...userObj, 
        postsCount 
      } 
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Follow user
router.post('/:id/follow', authenticate, async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.id);

    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (targetUser._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot follow yourself' });
    }

    const currentUser = await User.findById(req.user._id);

    // Check if already following
    if (currentUser.following.includes(targetUser._id)) {
      return res.status(400).json({ message: 'Already following this user' });
    }

    // Add to following array of current user
    currentUser.following.push(targetUser._id);
    currentUser.followingCount = currentUser.following.length;

    // Add to followers array of target user
    targetUser.followers.push(currentUser._id);
    targetUser.followerCount = targetUser.followers.length;

    await targetUser.save();
    await currentUser.save();

    res.json({ message: 'Followed successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Unfollow user
router.delete('/:id/follow', authenticate, async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.id);

    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (targetUser._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot unfollow yourself' });
    }

    const currentUser = await User.findById(req.user._id);

    // Check if not following
    if (!currentUser.following.includes(targetUser._id)) {
      return res.status(400).json({ message: 'Not following this user' });
    }

    // Remove from following array of current user
    currentUser.following = currentUser.following.filter(id => id.toString() !== targetUser._id.toString());
    currentUser.followingCount = currentUser.following.length;

    // Remove from followers array of target user
    targetUser.followers = targetUser.followers.filter(id => id.toString() !== currentUser._id.toString());
    targetUser.followerCount = targetUser.followers.length;

    await targetUser.save();
    await currentUser.save();

    res.json({ message: 'Unfollowed successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get user's saved posts
router.get('/:id/saved', authenticate, async (req, res) => {
  try {
    if (req.params.id !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to view saved posts' });
    }

    const posts = await Post.find({ savedBy: req.user._id })
      .populate('author', 'username avatar profession')
      .sort({ createdAt: -1 });

    res.json({ posts });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Update avatar
router.put('/avatar', authenticate, async (req, res) => {
  try {
    const { avatar } = req.body;

    if (!avatar) {
      return res.status(400).json({ message: 'Avatar URL is required' });
    }

    const user = await User.findById(req.user._id);
    user.avatar = avatar;
    user.updatedAt = Date.now();
    await user.save();

    res.json({ message: 'Avatar updated successfully', user });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Delete account
router.delete('/account', authenticate, async (req, res) => {
  try {
    // Delete user's posts
    await Post.deleteMany({ author: req.user._id });

    // Delete user
    await User.findByIdAndDelete(req.user._id);

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

export default router;
