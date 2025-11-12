FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    ffmpeg \
    wget \
    curl

# Install yt-dlp (fix for Alpine Linux pip restrictions)
RUN pip3 install --break-system-packages yt-dlp

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy app source
COPY . .

# Create temp directory
RUN mkdir -p /tmp

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
