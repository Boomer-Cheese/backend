const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');

// Frame processing imports
const { spawn } = require('child_process');
const fs = require('fs');

const OUTPUT = './frames';

// Configure multer for video file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/') // Uploads will be stored in an 'uploads' directory
    },
    filename: function (req, file, cb) {
        // Generate unique filename with original extension
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// Create multer instance with configuration
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 1024 * 1024 * 1024, // 1GB max file size
    },
    fileFilter: function (req, file, cb) {
        // Accept video files only
        const allowedMimes = [
            'video/mp4',
            'video/webm',
            'video/ogg',
            'video/quicktime',
            'video/x-msvideo',
            'video/x-matroska'
        ];
        
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only video files are allowed.'));
        }
    }
});

const app = express();

// Enable CORS
app.use(cors());

// Parse JSON bodies
app.use(express.json());

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Upload endpoint
app.post('/upload', upload.single('video'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        res.json({
            message: 'File uploaded successfully',
            file: {
                filename: req.file.filename,
                originalName: req.file.originalname,
                size: req.file.size,
                mimetype: req.file.mimetype,
                path: req.file.path
            }
        });

        // Get video information
        const { totalFrames } = await getVideoInfo(req.file.path);

        console.log(`Input file: ${req.file.path}`);
        console.log(`Output directory: ${OUTPUT}`);
        console.log(`Total frames in video: ${totalFrames}`);
        console.log(`Frames to extract: ${totalFrames}`);

        // Extract frames
        await extractFrames(req.file.path, OUTPUT, totalFrames);
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'File upload failed' });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                error: 'File size too large. Maximum size is 1GB'
            });
        }
    }
    console.error('Server error:', error);
    res.status(500).json({
        error: error.message || 'Internal server error'
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// ----------------------------

async function getVideoInfo(inputPath) {
    return new Promise((resolve, reject) => {
        const ffprobe = spawn('ffprobe', [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=nb_frames,r_frame_rate',
            '-of', 'json',
            inputPath
        ]);

        let output = '';
        ffprobe.stdout.on('data', (data) => {
            output += data;
        });

        ffprobe.on('close', (code) => {
            if (code !== 0) {
                reject(new Error('Failed to get video information'));
                return;
            }

            const info = JSON.parse(output);
            const stream = info.streams[0];
            const [num, den] = stream.r_frame_rate.split('/');
            const frameRate = num / den;
            const totalFrames = parseInt(stream.nb_frames);

            resolve({ frameRate, totalFrames });
        });

        ffprobe.stderr.on('data', (data) => {
            console.error(`ffprobe error: ${data}`);
        });
    });
}

async function extractFrames(inputPath, outputDir, maxFrames) {
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Build ffmpeg command
    const ffmpegArgs = [
        '-i', inputPath,
        '-vframes', '200',
        '-vsync', '0',
        '-frame_pts', '1',
        '-f', 'image2',
        path.join(outputDir, 'frame_%d.jpg')
    ];

    return new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', ffmpegArgs);

        ffmpeg.stderr.on('data', (data) => {
            console.error(`ffmpeg error: ${data}`);
        });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`ffmpeg process exited with code ${code}`));
            }
        });
    });
}