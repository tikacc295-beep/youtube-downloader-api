const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'YouTube Downloader API',
    version: '1.0.0'
  });
});

// Test yt-dlp installation
app.get('/test', async (req, res) => {
  try {
    const { spawn } = require('child_process');
    
    const result = await new Promise((resolve, reject) => {
      const childProcess = spawn('yt-dlp', ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      childProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      
      childProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
      
      childProcess.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`yt-dlp test failed: ${stderr}`));
        }
      });
      
      childProcess.on('error', (error) => {
        reject(error);
      });
    });
    
    res.json({
      status: 'OK',
      ytdlp_version: result.stdout.trim(),
      tmp_exists: require('fs').existsSync('/tmp'),
      node_version: process.version
    });
    
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      error: error.message,
      tmp_exists: require('fs').existsSync('/tmp'),
      node_version: process.version
    });
  }
});

// YouTube download endpoint
app.get('/api/download', async (req, res) => {
  try {
    const { url, quality = '720p' } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    console.log(`[API] Download request: ${url}, quality: ${quality}`);

    // Ensure /tmp directory exists
    const fs = require('fs');
    if (!fs.existsSync('/tmp')) {
      fs.mkdirSync('/tmp', { recursive: true });
      console.log(`[API] Created /tmp directory`);
    }

    // Try alternative methods first
    const methods = [
      { type: 'alternative', args: ['--extractor-args', 'youtube:player_client=web,android', '--extractor-args', 'youtube:skip=hls,dash'] },
      { type: 'ios', args: ['--extractor-args', 'youtube:player_client=ios'] },
      { type: 'tv', args: ['--extractor-args', 'youtube:player_client=tv_embedded'] }
    ];
    
    // Try each method
    for (const method of methods) {
      try {
        console.log(`[API] Trying method: ${method.type}`);
        
        const testArgs = [
          '--no-warnings',
          '--no-playlist',
          '--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
          ...method.args,
          '--get-url',
          '--format', '18',
          url
        ];
        
        const testResult = await runYtDlp(testArgs);
        const testLines = testResult.stdout.trim().split('\n').filter(l => l.trim());
        
        if (testLines.length > 0 && testLines[testLines.length - 1].startsWith('http')) {
          console.log(`[API] SUCCESS with method ${method.type}!`);
          const directUrl = testLines[testLines.length - 1];
          
          // Get title separately
          const titleArgs = [
            '--no-warnings',
            '--no-playlist',
            ...method.args,
            '--get-title',
            url
          ];
          
          let title = 'YouTube Video';
          try {
            const titleResult = await runYtDlp(titleArgs);
            title = titleResult.stdout.trim() || title;
          } catch (e) {
            console.log('[API] Could not get title, using default');
          }
          
          const filename = sanitizeFilename(title) + '.mp4';
          console.log(`[API] Redirecting to: ${directUrl.substring(0, 100)}...`);
          
          res.redirect(302, directUrl);
          return;
        }
      } catch (methodError) {
        console.log(`[API] Method ${method.type} failed:`, methodError.message);
        continue;
      }
    }
    
    // If alternatives failed, try original merge formats
    const mergeFormats = ['135+140', '22'];
    
    for (let i = 0; i < mergeFormats.length; i++) {
      const format = mergeFormats[i];
      
      try {
        console.log(`[API] Trying format ${i + 1}/${mergeFormats.length}: ${format}`);
        
        const tempFile = `/tmp/youtube_${Date.now()}.%(ext)s`;
        const args = [
          '--no-warnings',
          '--no-playlist',
          '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          '--add-header', 'Accept-Language:en-US,en;q=0.9',
          '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          '--extractor-args', 'youtube:player_client=android',
          '--extractor-args', 'youtube:player_skip=webpage',
          '--force-ipv4',
          '--sleep-interval', '1',
          '--max-sleep-interval', '3',
          '--merge-output-format', 'mp4',
          '-o', tempFile,
          '--print', 'title',
          '--print', 'format_id',
          '--print', 'resolution',
          '--print', 'filesize',
          '--print', 'after_move:filepath',
          '--format', format,
          url
        ];

        const result = await runYtDlp(args);
        const lines = result.stdout.trim().split('\n').filter(l => l.trim());

        if (lines.length >= 5) {
          const title = lines[0].trim();
          const formatId = lines[1].trim();
          const resolution = lines[2].trim();
          const filesize = lines[3].trim();
          const localFilePath = lines[4].trim();

          console.log(`[API] SUCCESS: ${formatId} - ${resolution}`);

          // Check if file exists
          if (fs.existsSync(localFilePath)) {
            const stat = fs.statSync(localFilePath);
            const cleanFilename = sanitizeFilename(title) + '.mp4';

            // Set headers for download
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Content-Disposition', `attachment; filename="${cleanFilename}"`);
            res.setHeader('Content-Length', stat.size);
            res.setHeader('Accept-Ranges', 'bytes');

            // Stream file and cleanup
            const fileStream = fs.createReadStream(localFilePath);
            fileStream.pipe(res);
            
            fileStream.on('end', () => {
              // Cleanup temp file
              try {
                fs.unlinkSync(localFilePath);
                console.log(`[API] Cleaned up: ${localFilePath}`);
              } catch (err) {
                console.log(`[API] Cleanup warning:`, err.message);
              }
            });

            return; // Success - exit function
          }
        }
      } catch (formatError) {
        console.log(`[API] Format ${format} failed:`, formatError.message);
        continue;
      }
    }

    // Fallback to direct 360p
    console.log(`[API] All merge formats failed, trying direct 360p`);
    
    const directArgs = [
      '--no-warnings',
      '--no-playlist',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      '--add-header', 'Accept-Language:en-US,en;q=0.9',
      '--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      '--extractor-args', 'youtube:player_client=android',
      '--extractor-args', 'youtube:player_skip=webpage',
      '--force-ipv4',
      '--sleep-interval', '1',
      '--max-sleep-interval', '3',
      '--print', 'title',
      '--print', 'ext',
      '--print', 'resolution',
      '--print', 'filesize',
      '--get-url',
      '--format', '18',
      url
    ];

    const directResult = await runYtDlp(directArgs);
    const directLines = directResult.stdout.trim().split('\n').filter(l => l.trim());

    if (directLines.length >= 5) {
      const title = directLines[0];
      const ext = directLines[1];
      const resolution = directLines[2];
      const filesize = directLines[3];
      const mediaUrl = directLines[4];

      console.log(`[API] Direct fallback: ${resolution}`);

      // Redirect to direct URL
      res.redirect(302, mediaUrl);
      return;
    }

    throw new Error('All download methods failed');

  } catch (error) {
    console.error('[API] Error:', error);
    console.error('[API] Stack:', error.stack);
    res.status(500).json({ 
      error: 'Download failed', 
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Helper function to run yt-dlp
function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const childProcess = spawn('yt-dlp', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    // Timeout after 20 seconds for Render compatibility
    const timeout = setTimeout(() => {
      childProcess.kill();
      reject(new Error('yt-dlp timeout'));
    }, 20000);

    childProcess.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    childProcess.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    childProcess.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`yt-dlp failed: ${stderr}`));
      }
    });

    childProcess.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

// Helper function to sanitize filename
function sanitizeFilename(title) {
  return title
    .replace(/[^\x00-\x7F]/g, '') // Remove non-ASCII characters
    .replace(/[^\w\s-]/g, '')     // Remove special characters
    .replace(/\s+/g, '_')         // Replace spaces with underscores
    .substring(0, 100)            // Limit length
    .trim();
}

app.listen(PORT, () => {
  console.log(`🚀 YouTube Downloader API running on port ${PORT}`);
});
