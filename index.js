
// server.js - Main server file
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Store active streams and their participants
const activeStreams = {};
// Store user info
const users = {};

// Handle socket connections
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // User registers with name
  socket.on('register', (userData) => {
    users[socket.id] = {
      id: socket.id,
      name: userData.name,
      avatar: userData.avatar || null
    };
    socket.emit('registered', users[socket.id]);
  });

  // Create a new live stream
  socket.on('create-stream', (streamData) => {
    const streamId = uuidv4();
    const hostId = socket.id;
    
    activeStreams[streamId] = {
      id: streamId,
      title: streamData.title,
      description: streamData.description,
      hostId: hostId,
      coHosts: [],
      audience: [],
      coHostRequests: [],
      createdAt: new Date()
    };
    
    // Join the stream room
    socket.join(streamId);
    
    // Notify the host
    socket.emit('stream-created', {
      streamId,
      streamInfo: activeStreams[streamId]
    });
    
    // Broadcast new stream to all connected users
    io.emit('new-stream-available', {
      id: streamId,
      title: streamData.title,
      description: streamData.description,
      hostName: users[hostId].name,
      viewerCount: 0
    });
  });
  
  // Join a stream as audience
  socket.on('join-stream', (streamId) => {
    if (activeStreams[streamId]) {
      // Join the stream room
      socket.join(streamId);
      
      // Add to audience list
      activeStreams[streamId].audience.push(socket.id);
      
      // Send stream info to the new viewer
      socket.emit('joined-stream', {
        streamId,
        streamInfo: activeStreams[streamId],
        hostInfo: users[activeStreams[streamId].hostId],
        coHosts: activeStreams[streamId].coHosts.map(id => users[id])
      });
      
      // Notify host and co-hosts about new viewer
      io.to(activeStreams[streamId].hostId).emit('viewer-joined', {
        streamId,
        viewer: users[socket.id],
        viewerCount: activeStreams[streamId].audience.length
      });
      
      // Update view count for all users
      io.to(streamId).emit('viewer-count-updated', {
        streamId,
        viewerCount: activeStreams[streamId].audience.length
      });
    } else {
      socket.emit('error', { message: 'Stream not found' });
    }
  });
  
  // Request to become co-host
  socket.on('request-cohost', (streamId) => {
    if (activeStreams[streamId]) {
      // Add to co-host requests
      activeStreams[streamId].coHostRequests.push(socket.id);
      
      // Notify host about co-host request
      io.to(activeStreams[streamId].hostId).emit('cohost-request', {
        streamId,
        requesterId: socket.id,
        requesterInfo: users[socket.id]
      });
      
      // Notify requester that request was sent
      socket.emit('cohost-request-sent', { streamId });
    } else {
      socket.emit('error', { message: 'Stream not found' });
    }
  });
  
  // Host approves co-host request
  socket.on('approve-cohost', ({ streamId, cohostId }) => {
    if (activeStreams[streamId] && socket.id === activeStreams[streamId].hostId) {
      // Check if request exists
      const requestIndex = activeStreams[streamId].coHostRequests.indexOf(cohostId);
      if (requestIndex !== -1) {
        // Remove from requests
        activeStreams[streamId].coHostRequests.splice(requestIndex, 1);
        
        // Move user from audience to co-hosts if they're in audience
        const audienceIndex = activeStreams[streamId].audience.indexOf(cohostId);
        if (audienceIndex !== -1) {
          activeStreams[streamId].audience.splice(audienceIndex, 1);
        }
        
        // Add to co-hosts
        activeStreams[streamId].coHosts.push(cohostId);
        
        // Notify the approved co-host
        io.to(cohostId).emit('cohost-approved', {
          streamId,
          hostInfo: users[activeStreams[streamId].hostId]
        });
        
        // Notify all viewers about new co-host
        io.to(streamId).emit('cohost-added', {
          streamId,
          cohostInfo: users[cohostId]
        });
        
        // Update view count
        io.to(streamId).emit('viewer-count-updated', {
          streamId,
          viewerCount: activeStreams[streamId].audience.length
        });
      }
    }
  });
  
  // Host declines co-host request
  socket.on('decline-cohost', ({ streamId, cohostId }) => {
    if (activeStreams[streamId] && socket.id === activeStreams[streamId].hostId) {
      // Check if request exists
      const requestIndex = activeStreams[streamId].coHostRequests.indexOf(cohostId);
      if (requestIndex !== -1) {
        // Remove from requests
        activeStreams[streamId].coHostRequests.splice(requestIndex, 1);
        
        // Notify the declined user
        io.to(cohostId).emit('cohost-declined', { streamId });
      }
    }
  });
  
  // WebRTC signaling for host and co-hosts
  socket.on('signal', ({ to, signal, streamId }) => {
    io.to(to).emit('signal', {
      from: socket.id,
      signal,
      streamId
    });
  });
  
  // Leave stream
  socket.on('leave-stream', (streamId) => {
    handleLeaveStream(socket, streamId);
  });
  
  // End stream (host only)
  socket.on('end-stream', (streamId) => {
    if (activeStreams[streamId] && socket.id === activeStreams[streamId].hostId) {
      // Notify all participants
      io.to(streamId).emit('stream-ended', { streamId });
      
      // Remove stream
      delete activeStreams[streamId];
      
      // Notify all connected users that stream is no longer available
      io.emit('stream-removed', { streamId });
    }
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    // Handle leaving all streams
    for (const streamId in activeStreams) {
      handleLeaveStream(socket, streamId);
      
      // If disconnected user is host, end the stream
      if (activeStreams[streamId] && activeStreams[streamId].hostId === socket.id) {
        io.to(streamId).emit('stream-ended', { streamId });
        delete activeStreams[streamId];
        io.emit('stream-removed', { streamId });
      }
    }
    
    // Remove user
    delete users[socket.id];
  });
});

// Helper function to handle leave stream logic
function handleLeaveStream(socket, streamId) {
  if (activeStreams[streamId]) {
    // Check if user is a co-host
    const coHostIndex = activeStreams[streamId].coHosts.indexOf(socket.id);
    if (coHostIndex !== -1) {
      // Remove from co-hosts
      activeStreams[streamId].coHosts.splice(coHostIndex, 1);
      
      // Notify all participants
      io.to(streamId).emit('cohost-left', {
        streamId,
        cohostId: socket.id
      });
    }
    
    // Check if user is in audience
    const audienceIndex = activeStreams[streamId].audience.indexOf(socket.id);
    if (audienceIndex !== -1) {
      // Remove from audience
      activeStreams[streamId].audience.splice(audienceIndex, 1);
    }
    
    // Check if user has pending co-host request
    const requestIndex = activeStreams[streamId].coHostRequests.indexOf(socket.id);
    if (requestIndex !== -1) {
      // Remove request
      activeStreams[streamId].coHostRequests.splice(requestIndex, 1);
    }
    
    // Leave the socket room
    socket.leave(streamId);
    
    // Update view count for all users
    io.to(streamId).emit('viewer-count-updated', {
      streamId,
      viewerCount: activeStreams[streamId].audience.length
    });
  }
}

// API endpoints for discovering streams
app.get('/api/streams', (req, res) => {
  const streamsList = Object.keys(activeStreams).map(id => {
    const stream = activeStreams[id];
    return {
      id: stream.id,
      title: stream.title,
      description: stream.description,
      hostName: users[stream.hostId]?.name || 'Unknown',
      viewerCount: stream.audience.length,
      createdAt: stream.createdAt
    };
  });
  
  res.json(streamsList);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
