const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({length: 6}, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function roomOf(socket) {
  for (const [code, room] of rooms) {
    if (room.host === socket.id || room.guest === socket.id) return [code, room];
  }
  return [null, null];
}

function sendSnapshot(room, snapshot) {
  if (room.guest) {
    const guestView = JSON.parse(JSON.stringify(snapshot));
    // O convidado recebe somente a própria mão e a mão do parceiro (Zé).
    // As cartas do anfitrião e do outro adversário ficam ocultas.
    guestView.players = guestView.players.map(p => {
      if (p.id === 1 || p.id === 3) return p;
      return {...p, cards: (p.cards || []).map(() => null)};
    });
    if (guestView.trick) {
      guestView.trick = guestView.trick.map(x => {
        if (x.hidden) return x;
        return x;
      });
    }
    io.to(room.guest).emit("state", guestView);
  }
}

io.on("connection", socket => {
  socket.on("create_room", ({name, gameMode}) => {
    const code = makeCode();
    rooms.set(code, {
      host: socket.id,
      guest: null,
      hostName: String(name || "Jogador").slice(0,18),
      guestName: null,
      gameMode: gameMode === "paulista" ? "paulista" : "mineiro",
      lastState: null
    });
    socket.join(code);
    socket.emit("room_created", {code});
  });

  socket.on("join_room", ({name, code}) => {
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      socket.emit("error", {message: "Sala não encontrada."});
      return;
    }
    if (room.guest && room.guest !== socket.id) {
      socket.emit("error", {message: "Essa sala já está cheia."});
      return;
    }
    room.guest = socket.id;
    room.guestName = String(name || "Convidado").slice(0,18);
    socket.join(code);

    socket.emit("room_joined", {
      code,
      gameMode: room.gameMode,
      hostName: room.hostName
    });

    io.to(room.host).emit("guest_joined", {
      name: room.guestName
    });
  });

  socket.on("state", snapshot => {
    const [code, room] = roomOf(socket);
    if (!room || room.host !== socket.id) return;
    room.lastState = snapshot;
    sendSnapshot(room, snapshot);
  });

  socket.on("action", action => {
    const [code, room] = roomOf(socket);
    if (!room || room.host !== socket.id && room.guest !== socket.id) return;

    // Só o convidado pode enviar comandos para o anfitrião.
    if (socket.id === room.guest) {
      io.to(room.host).emit("guest_action", action);
    }
  });

  socket.on("disconnect", () => {
    const [code, room] = roomOf(socket);
    if (!room) return;
    if (room.host === socket.id) {
      if (room.guest) io.to(room.guest).emit("room_closed");
      rooms.delete(code);
    } else if (room.guest === socket.id) {
      room.guest = null;
      room.guestName = null;
      io.to(room.host).emit("host_message", {text: "O outro jogador saiu da sala."});
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Truco Online rodando na porta ${PORT}`);
});
