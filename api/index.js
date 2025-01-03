const express = require('express');
const cors = require('cors');
const mongoose = require("mongoose");
const User = require('./models/User');
const Post = require('./models/Post');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config(); // Load environment variables

const app = express();
const uploadMiddleware = multer({ dest: 'uploads/' }); // Middleware to handle file uploads
const SALT_ROUNDS = 10;
const secret = process.env.JWT_SECRET || 'fallback_secret';

// Middleware setup
app.use(cors({ credentials: true, origin: 'http://localhost:3000' }));
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(__dirname + '/uploads'));

// MongoDB connection
mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://blog:T0aLiHhnSfBjf0KO@cluster0.xk7rh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('MongoDB connected successfully'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Root route
app.get('/', (req, res) => {
  res.send('API is up and running. Access specific endpoints for functionality.');
});

// User registration
app.post('/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const userDoc = await User.create({ username, password: hashedPassword });
    res.status(201).json({ message: 'User registered successfully', user: userDoc });
  } catch (e) {
    console.error('Error during registration:', e);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// User login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required.' });
  }

  try {
    const userDoc = await User.findOne({ username });
    if (!userDoc) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const passOk = await bcrypt.compare(password, userDoc.password);
    if (!passOk) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    jwt.sign({ username, id: userDoc._id }, secret, {}, (err, token) => {
      if (err) {
        console.error('Error signing token:', err);
        return res.status(500).json({ message: 'Internal server error.' });
      }
      res.cookie('token', token, { httpOnly: true }).json({ id: userDoc._id, username });
    });
  } catch (e) {
    console.error('Error during login:', e);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// User profile
app.get('/profile', (req, res) => {
  const { token } = req.cookies;
  if (!token) {
    return res.status(401).json({ message: 'Not authenticated.' });
  }

  jwt.verify(token, secret, {}, (err, info) => {
    if (err) {
      console.error('JWT verification error:', err);
      return res.status(401).json({ message: 'Invalid token.' });
    }
    res.json(info);
  });
});

// Create a post
app.post('/post', uploadMiddleware.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  const { originalname, path } = req.file;
  const parts = originalname.split('.');
  const ext = parts[parts.length - 1];
  const newPath = path + '.' + ext;
  fs.renameSync(path, newPath);

  const { token } = req.cookies;
  jwt.verify(token, secret, {}, async (err, info) => {
    if (err) {
      console.error('JWT verification error:', err);
      return res.status(401).json({ message: 'Invalid token.' });
    }

    const { title, summary, content } = req.body;
    try {
      const postDoc = await Post.create({
        title,
        summary,
        content,
        cover: newPath,
        author: info.id,
      });
      res.status(201).json(postDoc);
    } catch (e) {
      console.error('Error creating post:', e);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });
});

// Update a post
app.put('/post', uploadMiddleware.single('file'), async (req, res) => {
  let newPath = null;

  if (req.file) {
    const { originalname, path } = req.file;
    const parts = originalname.split('.');
    const ext = parts[parts.length - 1];
    newPath = path + '.' + ext;
    fs.renameSync(path, newPath);
  }

  const { token } = req.cookies;

  jwt.verify(token, secret, {}, async (err, info) => {
    if (err) return res.status(401).json({ message: 'Invalid or expired token.' });

    const { id, title, summary, content } = req.body;
    if (!id || !title || !summary || !content) {
      return res.status(400).json({ message: 'Missing required fields.' });
    }

    try {
      const postDoc = await Post.findById(id);
      if (!postDoc) {
        return res.status(404).json({ message: 'Post not found.' });
      }

      const isAuthor = JSON.stringify(postDoc.author) === JSON.stringify(info.id);
      if (!isAuthor) {
        return res.status(403).json({ message: 'You are not the author of this post.' });
      }

      // Update the document fields
      postDoc.set({
        title,
        summary,
        content,
        cover: newPath ? newPath : postDoc.cover,
      });

      const updatedPost = await postDoc.save();
      res.json(updatedPost);
    } catch (error) {
      console.error('Error updating post:', error);
      res.status(500).json({ message: 'Internal server error.' });
    }
  });
});

// Get all posts
app.get('/post', async (req, res) => {
  try {
    const posts = await Post.find()
      .populate('author', ['username'])
      .sort({ createdAt: -1 })
      .limit(20);
    res.json(posts);
  } catch (e) {
    console.error('Error fetching posts:', e);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Get post by ID
app.get('/post/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const postDoc = await Post.findById(id).populate('author', ['username']);
    if (!postDoc) {
      return res.status(404).json({ message: 'Post not found.' });
    }
    res.json(postDoc);
  } catch (e) {
    console.error('Error fetching post:', e);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error.' });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
