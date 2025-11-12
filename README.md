# YouTube Downloader API

Fast and reliable YouTube video downloader API using yt-dlp.

## Features

- 🎥 Download YouTube videos in multiple qualities
- 🔄 Automatic format fallback (480p merge → 720p → 360p direct)
- ⚡ Fast processing with timeouts
- 🧹 Automatic cleanup of temporary files
- 🐳 Docker support for easy deployment

## API Endpoints

### GET /api/download

Download a YouTube video.

**Parameters:**
- `url` (required) - YouTube video URL
- `quality` (optional) - Video quality (default: 720p)

**Example:**
```
GET /api/download?url=https://www.youtube.com/watch?v=VIDEO_ID&quality=720p
```

## Deployment

This API is designed to run on Railway.app with automatic Docker deployment.

## Local Development

```bash
npm install
npm start
```

The server will start on port 3000.
