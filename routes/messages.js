import express from 'express';
import Message from '../models/Message.js';
import User from '../models/User.js';
import Application from '../models/Application.js';
import { authenticate, checkReadOnly } from '../middleware/auth.js';

const router = express.Router();

// Send message
router.post('/', authenticate, checkReadOnly, async (req, res) => {
  try {
    const { receiverId, content } = req.body;

    if (!receiverId || !content || !content.trim()) {
      return res.status(400).json({ message: 'Receiver and content are required' });
    }

    const receiver = await User.findById(receiverId);
    if (!receiver) {
      return res.status(404).json({ message: 'Receiver not found' });
    }

    const message = new Message({
      sender: req.user._id,
      receiver: receiverId,
      content: content.trim()
    });

    await message.save();

    // Automatically resolve pending application response if applicable
    if (req.user.userType === 'employer') {
      const pendingApp = await Application.findOne({
        employer: req.user._id,
        applicant: receiverId,
        status: 'applied'
      });
      if (pendingApp) {
        pendingApp.status = 'contacted';
        pendingApp.respondedAt = Date.now();
        await pendingApp.save();
        
        // Reward employer for responding (+2 points)
        const employerUser = await User.findById(req.user._id);
        if (employerUser) {
          employerUser.companyScore = Math.min(100, employerUser.companyScore + 2);
          await employerUser.save();
        }
      }
    }
    
    const populated = await Message.findById(message._id)
      .populate('sender', 'username avatar')
      .populate('receiver', 'username avatar');

    // Format URLs
    if (populated.sender.avatar && populated.sender.avatar.startsWith('/uploads/')) {
      populated.sender.avatar = `${req.protocol}://${req.get('host')}${populated.sender.avatar}`;
    }
    if (populated.receiver.avatar && populated.receiver.avatar.startsWith('/uploads/')) {
      populated.receiver.avatar = `${req.protocol}://${req.get('host')}${populated.receiver.avatar}`;
    }

    res.status(201).json({ message: 'Message sent successfully', chatMessage: populated });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get conversations list
router.get('/conversations', authenticate, async (req, res) => {
  try {
    const messages = await Message.find({
      $or: [{ sender: req.user._id }, { receiver: req.user._id }]
    })
      .sort({ createdAt: -1 })
      .populate('sender', 'username avatar userType')
      .populate('receiver', 'username avatar userType');

    const conversationsMap = {};
    for (const msg of messages) {
      const otherUser = msg.sender._id.toString() === req.user._id.toString() ? msg.receiver : msg.sender;
      const otherId = otherUser._id.toString();
      if (!conversationsMap[otherId]) {
        if (otherUser.avatar && otherUser.avatar.startsWith('/uploads/')) {
          otherUser.avatar = `${req.protocol}://${req.get('host')}${otherUser.avatar}`;
        }
        conversationsMap[otherId] = {
          otherUser,
          lastMessage: msg
        };
      }
    }

    res.json({ conversations: Object.values(conversationsMap) });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Get chat history with a user
router.get('/history/:userId', authenticate, async (req, res) => {
  try {
    const history = await Message.find({
      $or: [
        { sender: req.user._id, receiver: req.params.userId },
        { sender: req.params.userId, receiver: req.user._id }
      ]
    })
      .sort({ createdAt: 1 })
      .populate('sender', 'username avatar')
      .populate('receiver', 'username avatar');

    const formattedHistory = history.map(msg => {
      const obj = msg.toObject();
      if (obj.sender.avatar && obj.sender.avatar.startsWith('/uploads/')) {
        obj.sender.avatar = `${req.protocol}://${req.get('host')}${obj.sender.avatar}`;
      }
      if (obj.receiver.avatar && obj.receiver.avatar.startsWith('/uploads/')) {
        obj.receiver.avatar = `${req.protocol}://${req.get('host')}${obj.receiver.avatar}`;
      }
      return obj;
    });

    res.json({ history: formattedHistory });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

export default router;
