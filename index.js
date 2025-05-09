
// // server.js - Main server file
// const express = require('express');
// const http = require('http');
// const socketIO = require('socket.io');
// const { v4: uuidv4 } = require('uuid');

// const app = express();
// const server = http.createServer(app);
// const io = socketIO(server, {
//   cors: {
//     origin: '*',
//     methods: ['GET', 'POST']
//   }
// });

// // Store active streams and their participants
// const activeStreams = {};
// // Store user info
// const users = {};

// // Handle socket connections
// io.on('connection', (socket) => {
//   console.log(`User connected: ${socket.id}`);
  
//   // User registers with name
//   socket.on('register', (userData) => {
//     users[socket.id] = {
//       id: socket.id,
//       name: userData.name,
//       avatar: userData.avatar || null
//     };
//     socket.emit('registered', users[socket.id]);
//   });

//   // Create a new live stream
//   socket.on('create-stream', (streamData) => {
//     const streamId = uuidv4();
//     const hostId = socket.id;
    
//     activeStreams[streamId] = {
//       id: streamId,
//       title: streamData.title,
//       description: streamData.description,
//       hostId: hostId,
//       coHosts: [],
//       audience: [],
//       coHostRequests: [],
//       createdAt: new Date()
//     };
    
//     // Join the stream room
//     socket.join(streamId);
    
//     // Notify the host
//     socket.emit('stream-created', {
//       streamId,
//       streamInfo: activeStreams[streamId]
//     });
    
//     // Broadcast new stream to all connected users
//     io.emit('new-stream-available', {
//       id: streamId,
//       title: streamData.title,
//       description: streamData.description,
//       hostName: users[hostId].name,
//       viewerCount: 0
//     });
//   });
  
//   // Join a stream as audience
//   socket.on('join-stream', (streamId) => {
//     if (activeStreams[streamId]) {
//       // Join the stream room
//       socket.join(streamId);
      
//       // Add to audience list
//       activeStreams[streamId].audience.push(socket.id);
      
//       // Send stream info to the new viewer
//       socket.emit('joined-stream', {
//         streamId,
//         streamInfo: activeStreams[streamId],
//         hostInfo: users[activeStreams[streamId].hostId],
//         coHosts: activeStreams[streamId].coHosts.map(id => users[id])
//       });
      
//       // Notify host and co-hosts about new viewer
//       io.to(activeStreams[streamId].hostId).emit('viewer-joined', {
//         streamId,
//         viewer: users[socket.id],
//         viewerCount: activeStreams[streamId].audience.length
//       });
      
//       // Update view count for all users
//       io.to(streamId).emit('viewer-count-updated', {
//         streamId,
//         viewerCount: activeStreams[streamId].audience.length
//       });
//     } else {
//       socket.emit('error', { message: 'Stream not found' });
//     }
//   });
  
//   // Request to become co-host
//   socket.on('request-cohost', (streamId) => {
//     if (activeStreams[streamId]) {
//       // Add to co-host requests
//       activeStreams[streamId].coHostRequests.push(socket.id);
      
//       // Notify host about co-host request
//       io.to(activeStreams[streamId].hostId).emit('cohost-request', {
//         streamId,
//         requesterId: socket.id,
//         requesterInfo: users[socket.id]
//       });
      
//       // Notify requester that request was sent
//       socket.emit('cohost-request-sent', { streamId });
//     } else {
//       socket.emit('error', { message: 'Stream not found' });
//     }
//   });
  
//   // Host approves co-host request
//   socket.on('approve-cohost', ({ streamId, cohostId }) => {
//     if (activeStreams[streamId] && socket.id === activeStreams[streamId].hostId) {
//       // Check if request exists
//       const requestIndex = activeStreams[streamId].coHostRequests.indexOf(cohostId);
//       if (requestIndex !== -1) {
//         // Remove from requests
//         activeStreams[streamId].coHostRequests.splice(requestIndex, 1);
        
//         // Move user from audience to co-hosts if they're in audience
//         const audienceIndex = activeStreams[streamId].audience.indexOf(cohostId);
//         if (audienceIndex !== -1) {
//           activeStreams[streamId].audience.splice(audienceIndex, 1);
//         }
        
//         // Add to co-hosts
//         activeStreams[streamId].coHosts.push(cohostId);
        
//         // Notify the approved co-host
//         io.to(cohostId).emit('cohost-approved', {
//           streamId,
//           hostInfo: users[activeStreams[streamId].hostId]
//         });
        
//         // Notify all viewers about new co-host
//         io.to(streamId).emit('cohost-added', {
//           streamId,
//           cohostInfo: users[cohostId]
//         });
        
//         // Update view count
//         io.to(streamId).emit('viewer-count-updated', {
//           streamId,
//           viewerCount: activeStreams[streamId].audience.length
//         });
//       }
//     }
//   });
  
//   // Host declines co-host request
//   socket.on('decline-cohost', ({ streamId, cohostId }) => {
//     if (activeStreams[streamId] && socket.id === activeStreams[streamId].hostId) {
//       // Check if request exists
//       const requestIndex = activeStreams[streamId].coHostRequests.indexOf(cohostId);
//       if (requestIndex !== -1) {
//         // Remove from requests
//         activeStreams[streamId].coHostRequests.splice(requestIndex, 1);
        
//         // Notify the declined user
//         io.to(cohostId).emit('cohost-declined', { streamId });
//       }
//     }
//   });
  
//   // WebRTC signaling for host and co-hosts
//   socket.on('signal', ({ to, signal, streamId }) => {
//     io.to(to).emit('signal', {
//       from: socket.id,
//       signal,
//       streamId
//     });
//   });
  
//   // Leave stream
//   socket.on('leave-stream', (streamId) => {
//     handleLeaveStream(socket, streamId);
//   });
  
//   // End stream (host only)
//   socket.on('end-stream', (streamId) => {
//     if (activeStreams[streamId] && socket.id === activeStreams[streamId].hostId) {
//       // Notify all participants
//       io.to(streamId).emit('stream-ended', { streamId });
      
//       // Remove stream
//       delete activeStreams[streamId];
      
//       // Notify all connected users that stream is no longer available
//       io.emit('stream-removed', { streamId });
//     }
//   });
  
//   // Handle disconnect
//   socket.on('disconnect', () => {
//     console.log(`User disconnected: ${socket.id}`);
    
//     // Handle leaving all streams
//     for (const streamId in activeStreams) {
//       handleLeaveStream(socket, streamId);
      
//       // If disconnected user is host, end the stream
//       if (activeStreams[streamId] && activeStreams[streamId].hostId === socket.id) {
//         io.to(streamId).emit('stream-ended', { streamId });
//         delete activeStreams[streamId];
//         io.emit('stream-removed', { streamId });
//       }
//     }
    
//     // Remove user
//     delete users[socket.id];
//   });
// });

// // Helper function to handle leave stream logic
// function handleLeaveStream(socket, streamId) {
//   if (activeStreams[streamId]) {
//     // Check if user is a co-host
//     const coHostIndex = activeStreams[streamId].coHosts.indexOf(socket.id);
//     if (coHostIndex !== -1) {
//       // Remove from co-hosts
//       activeStreams[streamId].coHosts.splice(coHostIndex, 1);
      
//       // Notify all participants
//       io.to(streamId).emit('cohost-left', {
//         streamId,
//         cohostId: socket.id
//       });
//     }
    
//     // Check if user is in audience
//     const audienceIndex = activeStreams[streamId].audience.indexOf(socket.id);
//     if (audienceIndex !== -1) {
//       // Remove from audience
//       activeStreams[streamId].audience.splice(audienceIndex, 1);
//     }
    
//     // Check if user has pending co-host request
//     const requestIndex = activeStreams[streamId].coHostRequests.indexOf(socket.id);
//     if (requestIndex !== -1) {
//       // Remove request
//       activeStreams[streamId].coHostRequests.splice(requestIndex, 1);
//     }
    
//     // Leave the socket room
//     socket.leave(streamId);
    
//     // Update view count for all users
//     io.to(streamId).emit('viewer-count-updated', {
//       streamId,
//       viewerCount: activeStreams[streamId].audience.length
//     });
//   }
// }

// // API endpoints for discovering streams
// app.get('/api/streams', (req, res) => {
//   const streamsList = Object.keys(activeStreams).map(id => {
//     const stream = activeStreams[id];
//     return {
//       id: stream.id,
//       title: stream.title,
//       description: stream.description,
//       hostName: users[stream.hostId]?.name || 'Unknown',
//       viewerCount: stream.audience.length,
//       createdAt: stream.createdAt
//     };
//   });
  
//   res.json(streamsList);
// });

// const PORT = process.env.PORT || 3000;
// server.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
// });
// server.js - Main server file
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const { MongoClient } = require('mongodb'); // Import MongoDB driver

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// MongoDB setup
const mongoUrl = process.env.MONGO_URL || 'mongodb+srv://manoj:adM6pnssjmK9W2Sh@cluster0.hlcwrbn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0'; // Replace with your MongoDB URL
const client = new MongoClient(mongoUrl);

let db, streamsCollection, usersCollection;

async function connectToMongo() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    db = client.db('livestream'); // Database name
    streamsCollection = db.collection('activeStreams'); // Collection for streams
    usersCollection = db.collection('users'); // Collection for users
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  }
}

// Connect to MongoDB when the server starts
connectToMongo();

// Handle socket connections
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // User registers with name
  socket.on('register', async (userData) => {
    const user = {
      id: socket.id,
      name: userData.name,
      avatar: userData.avatar || null
    };
    // Save user to MongoDB
    await usersCollection.updateOne(
      { id: socket.id },
      { $set: user },
      { upsert: true }
    );
    socket.emit('registered', user);
  });

  // Create a new live stream
  socket.on('create-stream', async (streamData) => {
    const streamId = uuidv4();
    const hostId = socket.id;

    const stream = {
      id: streamId,
      title: streamData.title,
      description: streamData.description,
      hostId: hostId,
      coHosts: [],
      audience: [],
      coHostRequests: [],
      createdAt: new Date()
    };

    // Save stream to MongoDB
    await streamsCollection.insertOne(stream);

    // Join the stream room
    socket.join(streamId);

    // Notify the host
    socket.emit('stream-created', {
      streamId,
      streamInfo: stream
    });

    // Fetch host user info
    const host = await usersCollection.findOne({ id: hostId });

    // Broadcast new stream to all connected users
    io.emit('new-stream-available', {
      id: streamId,
      title: streamData.title,
      description: streamData.description,
      hostName: host?.name || 'Unknown',
      viewerCount: 0
    });
  });

  // Join a stream as audience
  socket.on('join-stream', async (streamId) => {
    const stream = await streamsCollection.findOne({ id: streamId });
    if (stream) {
      // Join the stream room
      socket.join(streamId);

      // Add to audience list
      await streamsCollection.updateOne(
        { id: streamId },
        { $push: { audience: socket.id } }
      );

      // Fetch updated stream and user info
      const updatedStream = await streamsCollection.findOne({ id: streamId });
      const hostInfo = await usersCollection.findOne({ id: stream.hostId });
      const coHosts = await usersCollection
        .find({ id: { $in: stream.coHosts } })
        .toArray();

      // Send stream info to the new viewer
      socket.emit('joined-stream', {
        streamId,
        streamInfo: updatedStream,
        hostInfo,
        coHosts
      });

      // Fetch viewer info
      const viewer = await usersCollection.findOne({ id: socket.id });

      // Notify host about new viewer
      io.to(stream.hostId).emit('viewer-joined', {
        streamId,
        viewer,
        viewerCount: updatedStream.audience.length
      });

      // Update view count for all users
      io.to(streamId).emit('viewer-count-updated', {
        streamId,
        viewerCount: updatedStream.audience.length
      });
    } else {
      socket.emit('error', { message: 'Stream not found' });
    }
  });

  // Request to become co-host
  socket.on('request-cohost', async (streamId) => {
    const stream = await streamsCollection.findOne({ id: streamId });
    if (stream) {
      // Add to co-host requests
      await streamsCollection.updateOne(
        { id: streamId },
        { $push: { coHostRequests: socket.id } }
      );

      // Fetch requester info
      const requester = await usersCollection.findOne({ id: socket.id });

      // Notify host about co-host request
      io.to(stream.hostId).emit('cohost-request', {
        streamId,
        requesterId: socket.id,
        requesterInfo: requester
      });

      // Notify requester that request was sent
      socket.emit('cohost-request-sent', { streamId });
    } else {
      socket.emit('error', { message: 'Stream not found' });
    }
  });

  // Host approves co-host request
  socket.on('approve-cohost', async ({ streamId, cohostId }) => {
    const stream = await streamsCollection.findOne({ id: streamId });
    if (stream && socket.id === stream.hostId) {
      // Check if request exists
      if (stream.coHostRequests.includes(cohostId)) {
        // Remove from requests and add to co-hosts
        await streamsCollection.updateOne(
          { id: streamId },
          {
            $pull: { coHostRequests: cohostId },
            $push: { coHosts: cohostId }
          }
        );

        // Remove from audience if present
        await streamsCollection.updateOne(
          { id: streamId },
          { $pull: { audience: cohostId } }
        );

        // Fetch updated stream and user info
        const updatedStream = await streamsCollection.findOne({ id: streamId });
        const hostInfo = await usersCollection.findOne({ id: stream.hostId });
        const cohostInfo = await usersCollection.findOne({ id: cohostId });

        // Notify the approved co-host
        io.to(cohostId).emit('cohost-approved', {
          streamId,
          hostInfo
        });

        // Notify all viewers about new co-host
        io.to(streamId).emit('cohost-added', {
          streamId,
          cohostInfo
        });

        // Update view count
        io.to(streamId).emit('viewer-count-updated', {
          streamId,
          viewerCount: updatedStream.audience.length
        });
      }
    }
  });

  // Host declines co-host request
  socket.on('decline-cohost', async ({ streamId, cohostId }) => {
    const stream = await streamsCollection.findOne({ id: streamId });
    if (stream && socket.id === stream.hostId) {
      // Check if request exists
      if (stream.coHostRequests.includes(cohostId)) {
        // Remove from requests
        await streamsCollection.updateOne(
          { id: streamId },
          { $pull: { coHostRequests: cohostId } }
        );

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
  socket.on('end-stream', async (streamId) => {
    const stream = await streamsCollection.findOne({ id: streamId });
    if (stream && socket.id === stream.hostId) {
      // Notify all participants
      io.to(streamId).emit('stream-ended', { streamId });

      // Remove stream from MongoDB
      await streamsCollection.deleteOne({ id: streamId });

      // Notify all connected users that stream is no longer available
      io.emit('stream-removed', { streamId });
    }
  });

  // Handle disconnect
  socket.on('disconnect', async () => {
    console.log(`User disconnected: ${socket.id}`);

    // Handle leaving all streams
    const streams = await streamsCollection.find().toArray();
    for (const stream of streams) {
      await handleLeaveStream(socket, stream.id);

      // If disconnected user is host, end the stream
      if (stream.hostId === socket.id) {
        io.to(stream.id).emit('stream-ended', { id: stream.id });
        await streamsCollection.deleteOne({ id: stream.id });
        io.emit('stream-removed', { id: stream.id });
      }
    }

    // Remove user from MongoDB
    await usersCollection.deleteOne({ id: socket.id });
  });
});

// Helper function to handle leave stream logic
async function handleLeaveStream(socket, streamId) {
  const stream = await streamsCollection.findOne({ id: streamId });
  if (stream) {
    // Check if user is a co-host
    if (stream.coHosts.includes(socket.id)) {
      // Remove from co-hosts
      await streamsCollection.updateOne(
        { id: streamId },
        { $pull: { coHosts: socket.id } }
      );

      // Notify all participants
      io.to(streamId).emit('cohost-left', {
        streamId,
        cohostId: socket.id
      });
    }

    // Check if user is in audience
    if (stream.audience.includes(socket.id)) {
      // Remove from audience
      await streamsCollection.updateOne(
        { id: streamId },
        { $pull: { audience: socket.id } }
      );
    }

    // Check if user has pending co-host request
    if (stream.coHostRequests.includes(socket.id)) {
      // Remove request
      await streamsCollection.updateOne(
        { id: streamId },
        { $pull: { coHostRequests: socket.id } }
      );
    }

    // Leave the socket room
    socket.leave(streamId);

    // Fetch updated stream
    const updatedStream = await streamsCollection.findOne({ id: streamId });

    // Update view count for all users
    io.to(streamId).emit('viewer-count-updated', {
      streamId,
      viewerCount: updatedStream.audience.length
    });
  }
}

// API endpoint for discovering streams
app.get('/api/streams', async (req, res) => {
  const streams = await streamsCollection.find().toArray();
  const streamsList = await Promise.all(
    streams.map(async (stream) => {
      const host = await usersCollection.findOne({ id: stream.hostId });
      return {
        id: stream.id,
        title: stream.title,
        description: stream.description,
        hostName: host?.name || 'Unknown',
        viewerCount: stream.audience.length,
        createdAt: stream.createdAt
      };
    })
  );

  res.json(streamsList);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});