const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const path = require('path');
const fs = require('fs');
const os = require('os');

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;

// Explicit CORS — allow all origins including Android WebView (file://)
app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') { res.sendStatus(200); return; }
  next();
});

// Use system temp directory for uploads
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB max
});

// Health check — tells the app the server is online
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Compress server is running' });
});

// Video compression endpoint
app.post('/compress-video', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded' });
  }

  const inputPath = req.file.path;
  const outputPath = path.join(os.tmpdir(), 'out_' + Date.now() + '.mp4');

  // Read settings from request (sent by the app)
  const crf = Math.min(51, Math.max(18, parseInt(req.body.crf) || 28));
  const resolution = req.body.resolution || 'original'; // e.g. '720', '1080', 'original'
  const speed = req.body.speed || 'balanced'; // quality | balanced | fast

  // Map speed mode to FFmpeg preset
  const presetMap = {
    quality: 'slow',
    balanced: 'medium',
    fast: 'fast'
  };
  const preset = presetMap[speed] || 'medium';

  let cmd = ffmpeg(inputPath)
    .outputOptions([
      '-c:v libx264',        // H.264 video codec
      '-crf ' + crf,         // Quality (18=best, 51=worst)
      '-preset ' + preset,   // Speed vs compression tradeoff
      '-c:a aac',            // AAC audio codec
      '-b:a 128k',           // Audio bitrate
      '-movflags +faststart', // Makes MP4 stream-friendly
      '-pix_fmt yuv420p'     // Maximum compatibility
    ]);

  // Apply resolution scaling if requested
  if (resolution !== 'original') {
    // Scale down height to target, keep aspect ratio, force even numbers
    cmd = cmd.outputOptions('-vf scale=-2:' + resolution);
  }

  cmd
    .output(outputPath)
    .on('end', () => {
      // Send compressed MP4 back to the app
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', 'attachment; filename="compressed.mp4"');

      const stream = fs.createReadStream(outputPath);
      stream.pipe(res);

      stream.on('end', () => {
        // Clean up temp files
        fs.unlink(inputPath, () => {});
        fs.unlink(outputPath, () => {});
      });
      stream.on('error', () => {
        fs.unlink(inputPath, () => {});
        fs.unlink(outputPath, () => {});
      });
    })
    .on('error', (err) => {
      console.error('FFmpeg error:', err.message);
      fs.unlink(inputPath, () => {});
      fs.unlink(outputPath, () => {});
      res.status(500).json({ error: 'Compression failed: ' + err.message });
    })
    .run();
});

app.listen(PORT, () => {
  console.log('Compress server running on port ' + PORT);
});
