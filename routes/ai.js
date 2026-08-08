import express from 'express';
import OpenAI from 'openai';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

console.log('OPENAI_API_KEY from env:', process.env.OPENAI_API_KEY ? 'SET' : 'NOT SET');

let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
  console.log('OpenAI client initialized successfully');
} else {
  console.log('OpenAI client not initialized - API key missing');
}

// Generate post content
router.post('/generate-post', authenticate, async (req, res) => {
  try {
    if (!openai) {
      return res.status(503).json({ message: 'AI features not available - OPENAI_API_KEY not configured' });
    }

    const { topic, tone = 'professional', length = 'medium' } = req.body;

    if (!topic) {
      return res.status(400).json({ message: 'Topic is required' });
    }

    const lengthMap = {
      short: '100-150 words',
      medium: '200-300 words',
      long: '400-500 words'
    };

    const prompt = `Write a ${tone} LinkedIn-style post about ${topic}. The post should be ${lengthMap[length]}. Make it engaging and include relevant hashtags.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a professional content writer for a career-focused social media platform.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 500
    });

    const generatedContent = completion.choices[0].message.content;

    res.json({ content: generatedContent });
  } catch (error) {
    console.error('OpenAI error:', error);
    if (error.status === 401) {
      return res.status(500).json({ message: 'OpenAI API key is not configured' });
    }
    res.status(500).json({ message: 'Failed to generate content', error: error.message });
  }
});

// Generate job description
router.post('/generate-job-description', authenticate, async (req, res) => {
  try {
    if (!openai) {
      return res.status(503).json({ message: 'AI features not available - OPENAI_API_KEY not configured' });
    }

    const { profession, title, company, workType, location } = req.body;

    if (!profession || !title || !company) {
      return res.status(400).json({ message: 'Profession, title, and company are required' });
    }

    const workTypeMap = {
      full_time: 'Full-time',
      part_time: 'Part-time',
      intern: 'Internship'
    };

    const prompt = `Write a detailed and professional job description for a ${title} position at ${company}. 
    Profession: ${profession}
    Work Type: ${workTypeMap[workType] || 'Full-time'}
    Location: ${location || 'Remote/Hybrid'}
    
    Include:
    - A compelling introduction about the company and role
    - Key responsibilities
    - Required qualifications and skills
    - Preferred qualifications
    - Benefits and perks
    - Call to action for applicants
    
    Make it professional, engaging, and suitable for a career platform.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are an HR professional and expert job description writer.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 800
    });

    const generatedDescription = completion.choices[0].message.content;

    res.json({ description: generatedDescription });
  } catch (error) {
    console.error('OpenAI error:', error);
    if (error.status === 401) {
      return res.status(500).json({ message: 'OpenAI API key is not configured' });
    }
    res.status(500).json({ message: 'Failed to generate job description', error: error.message });
  }
});

// Generate content suggestions
router.post('/suggestions', authenticate, async (req, res) => {
  try {
    if (!openai) {
      return res.status(503).json({ message: 'AI features not available - OPENAI_API_KEY not configured' });
    }

    const { context } = req.body;

    if (!context) {
      return res.status(400).json({ message: 'Context is required' });
    }

    const prompt = `Generate 5 content suggestions for ${context}. Each suggestion should be a brief topic or idea for a post on a professional career platform.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a creative content strategist.' },
        { role: 'user', content: prompt }
      ],
      max_tokens: 300
    });

    const suggestions = completion.choices[0].message.content
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.replace(/^\d+\.\s*/, '').trim());

    res.json({ suggestions });
  } catch (error) {
    console.error('OpenAI error:', error);
    if (error.status === 401) {
      return res.status(500).json({ message: 'OpenAI API key is not configured' });
    }
    res.status(500).json({ message: 'Failed to generate suggestions', error: error.message });
  }
});

export default router;
