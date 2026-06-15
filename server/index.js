require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const gameRoutes = require('./routes/game');
const { registerHandlers } = require('./socket/handlers');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

app.use(cors());
app.use(express.json());
app.use('/api/games', gameRoutes);

io.on('connection', (socket) => {
  registerHandlers(io, socket);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
