import express from 'express';
import User from '../models/User.js';
import Post from '../models/Post.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Block a user
router.post('/:id/block', authenticate, async (req, res) => {
  try {
    const userToBlockId = req.params.id;
    if (userToBlockId === req.user._id.toString()) {
      return res.status(400).json({ message: 'You cannot block yourself' });
    }

    const user = await User.findById(req.user._id);
    const targetUser = await User.findById(userToBlockId);

    if (!targetUser) {
      return res.status(404).json({ message: 'User to block not found' });
    }

    // Initialize blockedUsers if it doesn't exist
    if (!user.blockedUsers) {
      user.blockedUsers = [];
    }

    // Add to blockedUsers if not already there
    if (!user.blockedUsers.includes(userToBlockId)) {
      user.blockedUsers.push(userToBlockId);
    }

    // Remove from following/followers for both users
    user.following = user.following.filter(id => id.toString() !== userToBlockId);
    user.followers = user.followers.filter(id => id.toString() !== userToBlockId);
    user.followingCount = user.following.length;
    user.followerCount = user.followers.length;
    await user.save();

    targetUser.following = targetUser.following.filter(id => id.toString() !== req.user._id.toString());
    targetUser.followers = targetUser.followers.filter(id => id.toString() !== req.user._id.toString());
    targetUser.followingCount = targetUser.following.length;
    targetUser.followerCount = targetUser.followers.length;
    await targetUser.save();

    res.json({ message: 'User blocked successfully', blockedUsers: user.blockedUsers });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Unblock a user
router.delete('/:id/block', authenticate, async (req, res) => {
  try {
    const userToUnblockId = req.params.id;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.blockedUsers) {
      user.blockedUsers = user.blockedUsers.filter(id => id.toString() !== userToUnblockId);
      await user.save();
    }

    res.json({ message: 'User unblocked successfully', blockedUsers: user.blockedUsers });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get list of blocked users
router.get('/me/blocked', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('blockedUsers', 'username avatar profession company bio');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const blockedList = (user.blockedUsers || []).map(u => {
      const uObj = u.toObject();
      if (!uObj.avatar) {
        uObj.avatar = `${req.protocol}://${req.get('host')}/uploads/default_avatar.png`;
      } else if (uObj.avatar.startsWith('/uploads/')) {
        uObj.avatar = `${req.protocol}://${req.get('host')}${uObj.avatar}`;
      }
      return uObj;
    });

    res.json({ blockedUsers: blockedList });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get users the current user is following
router.get('/me/following', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('following', 'username avatar profession company bio');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const followingList = user.following.map(u => {
      const uObj = u.toObject();
      if (!uObj.avatar) {
        uObj.avatar = `${req.protocol}://${req.get('host')}/uploads/default_avatar.png`;
      } else if (uObj.avatar.startsWith('/uploads/')) {
        uObj.avatar = `${req.protocol}://${req.get('host')}${uObj.avatar}`;
      }
      return uObj;
    });

    res.json({ following: followingList });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get matching profiles for the current user
router.get('/me/matches', authenticate, async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);
    if (!currentUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    const excludeIds = [currentUser._id, ...currentUser.following];

    let query = {
      _id: { $nin: excludeIds }
    };

    // If current user has a profession, search for users with similar profession
    if (currentUser.profession) {
      const firstWord = currentUser.profession.split(' ')[0].replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ]/g, '');
      if (firstWord.length > 0) {
        const professionRegex = new RegExp(firstWord, 'i');
        query.$or = [
          { profession: { $regex: professionRegex } }
        ];
      }
    }

    let matches = await User.find(query)
      .select('username avatar profession company bio followers followerCount')
      .limit(20);

    // If we didn't find enough matches, backfill with popular users who are not followed
    if (matches.length < 5) {
      const additionalUsers = await User.find({
        _id: { $nin: [...excludeIds, ...matches.map(m => m._id)] }
      })
      .select('username avatar profession company bio followers followerCount')
      .sort({ followerCount: -1 })
      .limit(10);
      
      matches = [...matches, ...additionalUsers];
    }

    const formattedMatches = matches.map(u => {
      const uObj = u.toObject();
      if (!uObj.avatar) {
        uObj.avatar = `${req.protocol}://${req.get('host')}/uploads/default_avatar.png`;
      } else if (uObj.avatar.startsWith('/uploads/')) {
        uObj.avatar = `${req.protocol}://${req.get('host')}${uObj.avatar}`;
      }
      uObj.isFollowing = false;
      return uObj;
    });

    res.json({ matches: formattedMatches });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

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

    const isFollowing = user.followers.map(f => f.toString()).includes(req.user._id.toString());
    const isMe = user._id.toString() === req.user._id.toString();

    let responseUser = {
      ...userObj,
      postsCount,
      isFollowing
    };

    if (user.isPrivate && !isMe && !isFollowing) {
      responseUser = {
        _id: user._id,
        id: user._id,
        username: user.username,
        avatar: userObj.avatar,
        userType: user.userType,
        profession: user.profession,
        followerCount: user.followerCount,
        followingCount: user.followingCount,
        isPrivate: true,
        isFollowing: false,
        bio: 'Bu hesap gizli',
        experience: [],
        socialLinks: {},
        companyDescription: null,
        postsCount: 0
      };
    }

    res.json({ user: responseUser });
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

// Get user's liked posts
router.get('/:id/liked', authenticate, async (req, res) => {
  try {
    if (req.params.id !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to view liked posts' });
    }

    const posts = await Post.find({ likes: req.user._id })
      .populate('author', 'username avatar profession')
      .sort({ createdAt: -1 });

    // Format post author avatars
    const formattedPosts = posts.map(post => {
      const postObj = post.toObject();
      if (postObj.author) {
        if (!postObj.author.avatar) {
          postObj.author.avatar = `${req.protocol}://${req.get('host')}/uploads/default_avatar.png`;
        } else if (postObj.author.avatar.startsWith('/uploads/')) {
          postObj.author.avatar = `${req.protocol}://${req.get('host')}${postObj.author.avatar}`;
        }
      }
      return postObj;
    });

    res.json({ posts: formattedPosts });
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

    const formattedPosts = posts.map(post => {
      const postObj = post.toObject();
      if (postObj.author) {
        if (!postObj.author.avatar) {
          postObj.author.avatar = `${req.protocol}://${req.get('host')}/uploads/default_avatar.png`;
        } else if (postObj.author.avatar.startsWith('/uploads/')) {
          postObj.author.avatar = `${req.protocol}://${req.get('host')}${postObj.author.avatar}`;
        }
      }
      return postObj;
    });

    res.json({ posts: formattedPosts });
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
