const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const { MongoClient } = require('mongodb');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// MongoDB setup
const mongoUrl = "mongodb+srv://manoj:adM6pnssjmK9W2Sh@cluster0.hlcwrbn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0&tls=true";

if (!mongoUrl) {
  throw new Error('MONGO_URL environment variable is not set');
}
const client = new MongoClient(mongoUrl, { connectTimeoutMS: 30000, serverSelectionTimeoutMS: 30000 });

let db, streamsCollection, usersCollection;

async function connectToMongo() {
  try {
    await client.connect();
    console.log('Successfully connected to MongoDB');
    db = client.db('livestream');
    streamsCollection = db.collection('activeStreams');
    usersCollection = db.collection('users');
    console.log(`Database: ${db.databaseName}, Collections: ${streamsCollection.collectionName}, ${usersCollection.collectionName}`);
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    throw error;
  }
}

// Start server only after MongoDB connection
async function startServer() {
  try {
    await connectToMongo();

    // Handle socket connections
    io.on('connection', (socket) => {
      console.log(`User connected: ${socket.id}`);

      // User registers with name
      socket.on('register', async (userData) => {
        if (!usersCollection) {
          console.error('usersCollection is undefined');
          socket.emit('error', { message: 'Database not connected' });
          return;
        }
        try {
          const user = {
            id: socket.id,
            name: userData.name,
            avatar: userData.avatar || null
          };
          await usersCollection.updateOne(
            { id: socket.id },
            { $set: user },
            { upsert: true }
          );
          console.log(`User registered: ${user.name}, ID: ${socket.id}`);
          socket.emit('registered', user);
        } catch (error) {
          console.error('Error in register:', error);
          socket.emit('error', { message: 'Failed to register user' });
        }
      });

      // Create a new live stream
      socket.on('create-stream', async (streamData) => {
        if (!streamsCollection) {
          console.error('streamsCollection is undefined');
          socket.emit('error', { message: 'Database not connected' });
          return;
        }
        try {
          console.log(`Creating stream in DB: ${db.databaseName}, Collection: ${streamsCollection.collectionName}`);
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
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date()
          };

          await streamsCollection.insertOne(stream);
          console.log('Stream saved to MongoDB:', stream);
          const savedStream = await streamsCollection.findOne({ id: streamId });
          console.log('Verified stream in DB:', savedStream);

          socket.join(streamId);
          socket.emit('stream-created', {
            streamId,
            streamInfo: stream
          });

          const host = await usersCollection.findOne({ id: hostId });
          io.emit('new-stream-available', {
            id: streamId,
            title: streamData.title,
            description: streamData.description,
            hostName: host?.name || 'Unknown',
            viewerCount: 0
          });
        } catch (error) {
          console.error('Error in create-stream:', error);
          socket.emit('error', { message: 'Failed to create stream' });
        }
      });

      // Join a stream as audience
      socket.on('join-stream', async (streamId) => {
        if (!streamsCollection || !usersCollection) {
          console.error('Database collections not initialized');
          socket.emit('error', { message: 'Database not connected' });
          return;
        }
        try {
          const stream = await streamsCollection.findOne({ id: streamId, status: 'active' });
          if (stream) {
            socket.join(streamId);
            await streamsCollection.updateOne(
              { id: streamId },
              { $push: { audience: socket.id }, $set: { updatedAt: new Date() } }
            );
            const updatedStream = await streamsCollection.findOne({ id: streamId });
            const hostInfo = await usersCollection.findOne({ id: stream.hostId });
            const coHosts = await usersCollection
              .find({ id: { $in: stream.coHosts } })
              .toArray();
            socket.emit('joined-stream', {
              streamId,
              streamInfo: updatedStream,
              hostInfo,
              coHosts
            });
            const viewer = await usersCollection.findOne({ id: socket.id });
            io.to(stream.hostId).emit('viewer-joined', {
              streamId,
              viewer,
              viewerCount: updatedStream.audience.length
            });
            io.to(streamId).emit('viewer-count-updated', {
              streamId,
              viewerCount: updatedStream.audience.length
            });
          } else {
            socket.emit('error', { message: 'Stream not found or inactive' });
          }
        } catch (error) {
          console.error('Error in join-stream:', error);
          socket.emit('error', { message: 'Failed to join stream' });
        }
      });

      // Request to become co-host
      socket.on('request-cohost', async (streamId) => {
        if (!streamsCollection || !usersCollection) {
          console.error('Database collections not initialized');
          socket.emit('error', { message: 'Database not connected' });
          return;
        }
        try {
          const stream = await streamsCollection.findOne({ id: streamId, status: 'active' });
          if (stream) {
            await streamsCollection.updateOne(
              { id: streamId },
              { $push: { coHostRequests: socket.id }, $set: { updatedAt: new Date() } }
            );
            const requester = await usersCollection.findOne({ id: socket.id });
            io.to(stream.hostId).emit('cohost-request', {
              streamId,
              requesterId: socket.id,
              requesterInfo: requester
            });
            socket.emit('cohost-request-sent', { streamId });
          } else {
            socket.emit('error', { message: 'Stream not found or inactive' });
          }
        } catch (error) {
          console.error('Error in request-cohost:', error);
          socket.emit('error', { message: 'Failed to request co-host' });
        }
      });

      // Host approves co-host request
      socket.on('approve-cohost', async ({ streamId, cohostId }) => {
        if (!streamsCollection || !usersCollection) {
          console.error('Database collections not initialized');
          socket.emit('error', { message: 'Database not connected' });
          return;
        }
        try {
          const stream = await streamsCollection.findOne({ id: streamId, status: 'active' });
          if (stream && socket.id === stream.hostId) {
            if (stream.coHostRequests.includes(cohostId)) {
              await streamsCollection.updateOne(
                { id: streamId },
                {
                  $pull: { coHostRequests: cohostId },
                  $push: { coHosts: cohostId },
                  $set: { updatedAt: new Date() }
                }
              );
              await streamsCollection.updateOne(
                { id: streamId },
                { $pull: { audience: cohostId }, $set: { updatedAt: new Date() } }
              );
              const updatedStream = await streamsCollection.findOne({ id: streamId });
              const hostInfo = await usersCollection.findOne({ id: stream.hostId });
              const cohostInfo = await usersCollection.findOne({ id: cohostId });
              io.to(cohostId).emit('cohost-approved', {
                streamId,
                hostInfo
              });
              io.to(streamId).emit('cohost-added', {
                streamId,
                cohostInfo
              });
              io.to(streamId).emit('viewer-count-updated', {
                streamId,
                viewerCount: updatedStream.audience.length
              });
            }
          }
        } catch (error) {
          console.error('Error in approve-cohost:', error);
          socket.emit('error', { message: 'Failed to approve co-host' });
        }
      });

      // Host declines co-host request
      socket.on('decline-cohost', async ({ streamId, cohostId }) => {
        if (!streamsCollection || !usersCollection) {
          console.error('Database collections not initialized');
          socket.emit('error', { message: 'Database not connected' });
          return;
        }
        try {
          const stream = await streamsCollection.findOne({ id: streamId, status: 'active' });
          if (stream && socket.id === stream.hostId) {
            if (stream.coHostRequests.includes(cohostId)) {
              await streamsCollection.updateOne(
                { id: streamId },
                { $pull: { coHostRequests: cohostId }, $set: { updatedAt: new Date() } }
              );
              io.to(cohostId).emit('cohost-declined', { streamId });
            }
          }
        } catch (error) {
          console.error('Error in decline-cohost:', error);
          socket.emit('error', { message: 'Failed to decline co-host' });
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
        if (!streamsCollection) {
          console.error('streamsCollection is undefined');
          socket.emit('error', { message: 'Database not connected' });
          return;
        }
        try {
          const stream = await streamsCollection.findOne({ id: streamId, status: 'active' });
          if (stream && socket.id === stream.hostId) {
            console.log(`Ending stream: ${streamId}, Host: ${socket.id}, Timestamp: ${new Date().toISOString()}`);
            await streamsCollection.updateOne(
              { id: streamId },
              { $set: { status: 'ended', updatedAt: new Date(), endedAt: new Date() } }
            );
            io.to(streamId).emit('stream-ended', { streamId });
            io.emit('stream-removed', { streamId });
            // Cleanup ended stream after 1 hour
            setTimeout(async () => {
              await streamsCollection.deleteOne({ id: streamId, status: 'ended' });
              console.log(`Cleaned up ended stream: ${streamId}`);
            }, 60 * 60 * 1000); // 1 hour
          } else {
            console.log(`End stream attempt failed for stream: ${streamId}, Host: ${socket.id}, Reason: ${!stream ? 'Stream not found' : 'Not host'}`);
            socket.emit('error', { message: 'Stream not found or unauthorized' });
          }
        } catch (error) {
          console.error('Error in end-stream:', error);
          socket.emit('error', { message: 'Failed to end stream' });
        }
      });

      // Handle disconnect
      socket.on('disconnect', async () => {
        console.log(`User disconnected: ${socket.id}`);
        if (!streamsCollection || !usersCollection) {
          console.error('Database collections not initialized');
          return;
        }
        try {
          const streams = await streamsCollection.find({ status: 'active' }).toArray();
          for (const stream of streams) {
            console.log(`Checking stream: ${stream.id}, hostId: ${stream.hostId}`);
            await handleLeaveStream(socket, stream.id);
            if (stream.hostId === socket.id) {
              console.log(`Host ${socket.id} disconnected, keeping stream ${stream.id} active temporarily`);
              // Mark stream as ended after 1 hour if host doesn't reconnect
              setTimeout(async () => {
                const stillActive = await streamsCollection.findOne({ id: stream.id, status: 'active' });
                if (stillActive && stillActive.hostId === socket.id) {
                  console.log(`Marking stream ${stream.id} as ended due to host disconnect timeout`);
                  await streamsCollection.updateOne(
                    { id: stream.id },
                    { $set: { status: 'ended', updatedAt: new Date(), endedAt: new Date() } }
                  );
                  io.to(stream.id).emit('stream-ended', { streamId: stream.id });
                  io.emit('stream-removed', { streamId: stream.id });
                  // Cleanup after another hour
                  setTimeout(async () => {
                    await streamsCollection.deleteOne({ id: stream.id, status: 'ended' });
                    console.log(`Cleaned up ended stream: ${stream.id}`);
                  }, 60 * 60 * 1000);
                }
              }, 60 * 60 * 1000); // 1 hour
            }
          }
          await usersCollection.deleteOne({ id: socket.id });
          console.log(`User ${socket.id} removed from users collection`);
        } catch (error) {
          console.error('Error in disconnect:', error);
        }
      });
    });

    // Helper function to handle leave stream logic
    async function handleLeaveStream(socket, streamId) {
      if (!streamsCollection) {
        console.error('streamsCollection is undefined');
        return;
      }
      try {
        const stream = await streamsCollection.findOne({ id: streamId, status: 'active' });
        if (stream) {
          if (stream.coHosts.includes(socket.id)) {
            await streamsCollection.updateOne(
              { id: streamId },
              { $pull: { coHosts: socket.id }, $set: { updatedAt: new Date() } }
            );
            io.to(streamId).emit('cohost-left', {
              streamId,
              cohostId: socket.id
            });
          }
          if (stream.audience.includes(socket.id)) {
            await streamsCollection.updateOne(
              { id: streamId },
              { $pull: { audience: socket.id }, $set: { updatedAt: new Date() } }
            );
          }
          if (stream.coHostRequests.includes(socket.id)) {
            await streamsCollection.updateOne(
              { id: streamId },
              { $pull: { coHostRequests: socket.id }, $set: { updatedAt: new Date() } }
            );
          }
          socket.leave(streamId);
          const updatedStream = await streamsCollection.findOne({ id: streamId });
          io.to(streamId).emit('viewer-count-updated', {
            streamId,
            viewerCount: updatedStream ? updatedStream.audience.length : 0
          });
        }
      } catch (error) {
        console.error('Error in handleLeaveStream:', error);
      }
    }

    // API endpoint for discovering streams
    app.get('/api/streams', async (req, res) => {
      if (!streamsCollection || !usersCollection) {
        console.error('Database collections not initialized');
        res.status(500).json({ error: 'Database not connected' });
        return;
      }
      try {
        console.log(`Fetching from DB: ${db.databaseName}, Collection: ${streamsCollection.collectionName}`);
        let streams = await streamsCollection.find({ status: 'active' }).toArray();
        if (streams.length === 0) {
          console.log('No active streams found, retrying after 1s');
          await new Promise(resolve => setTimeout(resolve, 1000));
          streams = await streamsCollection.find({ status: 'active' }).toArray();
        }
        console.log('Raw streams from MongoDB:', streams);
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
      } catch (error) {
        console.error('Error in /api/streams:', error);
        res.status(500).json({ error: 'Failed to fetch streams' });
      }
    });

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();