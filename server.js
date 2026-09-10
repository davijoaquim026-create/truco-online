const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  do {
    code = Array.from(
      { length: 6 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  } while (rooms.has(code));

  return code;
}

function roomOf(socket) {
  const code = socket.roomCode;
  const room = code ? rooms.get(code) : null;
  return room ? [code, room] : [null, null];
}

function publicPlayers(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    team: p.team,
    avatar: p.avatar,
    connected: !!p.socketId,
    bot: false
  }));
}

function emitPlayers(room) {
  io.to(room.code).emit("players_update", {
    players: publicPlayers(room)
  });
}

function sendSnapshot(room, snapshot, receiverId) {
  if (!snapshot) return;

  const view = JSON.parse(JSON.stringify(snapshot));
  const receiver = room.players[receiverId];

  if (!receiver) return;

  // Cada jogador vê:
  // - suas próprias cartas
  // - as cartas do parceiro
  // Os adversários ficam ocultos.
  const team = receiver.team;

  view.players = (view.players || []).map(p => {
    const visible =
      Number(p.id) === receiverId ||
      Number(p.team) === team;

    if (visible) {
      return p;
    }

    return {
      ...p,
      cards: (p.cards || []).map(() => null)
    };
  });

  io.to(receiver.socketId).emit("state", view);
}

function broadcastState(room, snapshot) {
  room.lastState = snapshot;

  for (const p of room.players) {
    if (p.socketId) {
      sendSnapshot(room, snapshot, p.id);
    }
  }
}

io.on("connection", socket => {

  // =========================
  // CRIAR SALA
  // =========================
  socket.on("create_room", ({ name, gameMode }) => {

    if (socket.roomCode) return;

    const code = makeCode();

    const room = {
      code,

      gameMode:
        gameMode === "paulista"
          ? "paulista"
          : "mineiro",

      hostId: socket.id,

      started: false,

      lastState: null,

      players: [

        {
          id: 0,
          name: String(name || "Jogador 1").slice(0, 18),
          team: 0,
          avatar: "😎",
          socketId: socket.id
        },

        {
          id: 1,
          name: "Jogador 2",
          team: 0,
          avatar: "🧔",
          socketId: null
        },

        {
          id: 2,
          name: "Jogador 3",
          team: 1,
          avatar: "👨‍🌾",
          socketId: null
        },

        {
          id: 3,
          name: "Jogador 4",
          team: 1,
          avatar: "🧢",
          socketId: null
        }

      ]
    };

    rooms.set(code, room);

    socket.join(code);

    socket.roomCode = code;
    socket.playerId = 0;

    socket.emit("room_created", {
      code,
      playerId: 0
    });

    socket.emit("room_joined", {
      code,
      playerId: 0,
      gameMode: room.gameMode,
      players: publicPlayers(room)
    });

    emitPlayers(room);
  });


  // =========================
  // ENTRAR NA SALA
  // =========================
  socket.on("join_room", ({ name, code }) => {

    code = String(code || "")
      .trim()
      .toUpperCase();

    const room = rooms.get(code);

    if (!room) {
      socket.emit("error", {
        message: "Sala não encontrada."
      });

      return;
    }

    const empty = room.players.find(
      p => !p.socketId
    );

    if (!empty) {

      socket.emit("error", {
        message:
          "Essa sala já está cheia (4 jogadores)."
      });

      return;
    }

    if (room.started) {

      socket.emit("error", {
        message:
          "Essa partida já começou."
      });

      return;
    }

    empty.socketId = socket.id;

    empty.name = String(
      name ||
      `Jogador ${empty.id + 1}`
    ).slice(0, 18);

    socket.join(code);

    socket.roomCode = code;
    socket.playerId = empty.id;

    socket.emit("room_joined", {
      code,
      playerId: empty.id,
      gameMode: room.gameMode,
      players: publicPlayers(room)
    });

    emitPlayers(room);

    const connected =
      room.players.filter(
        p => p.socketId
      ).length;

    // Quando os 4 jogadores entrarem,
    // a sala fica pronta.
    if (connected === 4) {

      room.started = true;

      io.to(room.hostId).emit(
        "all_players_ready",
        {
          players: publicPlayers(room)
        }
      );
    }
  });


  // =========================
  // ESTADO DA PARTIDA
  // =========================
  socket.on("state", snapshot => {

    const [code, room] = roomOf(socket);

    if (!room) return;

    // Apenas o jogador 1
    // mantém a lógica principal da partida.
    if (room.hostId !== socket.id) {
      return;
    }

    broadcastState(room, snapshot);
  });


  // =========================
  // PEDIR ESTADO ATUAL
  // =========================
  socket.on("request_state", ({ code }) => {

    code = String(code || "")
      .trim()
      .toUpperCase();

    const room = rooms.get(code);

    if (
      !room ||
      !room.started ||
      !room.lastState
    ) {
      return;
    }

    const pid = socket.playerId;

    if (
      !room.players[pid] ||
      room.players[pid].socketId !== socket.id
    ) {
      return;
    }

    sendSnapshot(
      room,
      room.lastState,
      pid
    );
  });


  // =========================
  // AÇÕES DOS JOGADORES
  // =========================
  socket.on("action", action => {

    const [code, room] = roomOf(socket);

    if (!room) return;

    const player =
      room.players[socket.playerId];

    if (
      !player ||
      player.socketId !== socket.id
    ) {
      return;
    }

    // O servidor ignora um playerId falso
    // enviado pelo navegador e usa o ID real
    // da conexão.
    const cleanAction = {
      ...(action || {}),
      playerId: player.id
    };

    // Jogador 1 é o anfitrião.
    // Os outros três enviam suas ações
    // para ele executar a lógica da partida.
    if (player.id !== 0) {

      io.to(room.hostId).emit(
        "player_action",
        cleanAction
      );
    }
  });


  // =========================
  // DESCONECTOU
  // =========================
  socket.on("disconnect", () => {

    const [code, room] = roomOf(socket);

    if (!room) return;

    const player =
      room.players[socket.playerId];

    if (
      player &&
      player.socketId === socket.id
    ) {

      const name = player.name;

      player.socketId = null;

      // Se o anfitrião sair,
      // encerra a sala.
      if (player.id === 0) {

        if (
          room.players.some(
            p => p.socketId
          )
        ) {

          io.to(code).emit(
            "room_closed"
          );
        }

        rooms.delete(code);

        return;
      }

      // Se qualquer outro sair,
      // a partida deixa de estar pronta
      // até ele voltar.
      if (room.started) {
        room.started = false;
      }

      io.to(code).emit(
        "player_left",
        {
          id: player.id,
          name
        }
      );

      emitPlayers(room);
    }
  });

});


const PORT =
  process.env.PORT || 3000;

server.listen(PORT, () => {

  console.log(
    `Truco Online 4 jogadores rodando na porta ${PORT}`
  );

});
