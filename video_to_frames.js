const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
    .option('input', {
        alias: 'i',
        description: 'Input video file path',
        type: 'string',
        demandOption: true
    })
    .option('output', {
        alias: 'o',
        description: 'Output directory for frames',
        type: 'string',
        default: './frames'
    })
    .option('percentage', {
        alias: 'p',
        description: 'Percentage of frames to extract (1-100)',
        type: 'number',
        default: 100
    })
    .option('maxFrames', {
        alias: 'm',
        description: 'Maximum number of frames to extract',
        type: 'number'
    })
    .help()
    .argv;

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

async function extractFrames(inputPath, outputDir, frameInterval, maxFrames) {
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Build ffmpeg command
    const ffmpegArgs = [
        '-i', inputPath,
        '-vf', `select='not(mod(n,${frameInterval}))'`,
        '-vsync', '0',
        '-frame_pts', '1',
        '-f', 'image2',
        path.join(outputDir, 'frame_%d.jpg')
    ];

    if (maxFrames) {
        ffmpegArgs.splice(2, 0, '-vframes', maxFrames.toString());
    }

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

async function main() {
    try {
        // Get video information
        const { totalFrames } = await getVideoInfo(argv.input);

        // Calculate frame interval based on percentage
        const frameInterval = Math.max(1, Math.round(100 / argv.percentage));
        
        // Calculate effective max frames
        const effectiveMaxFrames = argv.maxFrames 
            ? Math.min(argv.maxFrames, Math.ceil(totalFrames / frameInterval))
            : Math.ceil(totalFrames / frameInterval);

        console.log(`Input file: ${argv.input}`);
        console.log(`Output directory: ${argv.output}`);
        console.log(`Total frames in video: ${totalFrames}`);
        console.log(`Extracting every ${frameInterval}th frame (${argv.percentage}%)`);
        console.log(`Maximum frames to extract: ${effectiveMaxFrames}`);

        // Extract frames
        await extractFrames(argv.input, argv.output, frameInterval, effectiveMaxFrames);
        
        console.log('Frame extraction completed successfully!');
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

main();