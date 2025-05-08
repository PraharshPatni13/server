const { io } = require('../server');



io.on('connection', (socket) => {
  // console.log('A user connected:', socket.id);
  socket.on('user_connected', (data) => {
    console.log('A user connected:', data);
  });
  socket.on('message', (msg) => {
    console.log('Message received:', msg);
    io.emit('message', msg);
  });

  socket.on('disconnect', () => {

  });

});

