const Room = require('./Room');
const { generateRoomCode } = require('./idGen');

class RoomManager {
  constructor() {
    this.rooms = new Map();         // code → Room
    this.socketToRoom = new Map();  // socketId → roomCode
  }

  createRoom(socketId, nickname) {
    const code = generateRoomCode(new Set(this.rooms.keys()));
    const room = new Room(code);
    room.hostId = socketId;
    room.addPlayer(socketId, nickname);
    this.rooms.set(code, room);
    this.socketToRoom.set(socketId, code);
    return room;
  }

  getRoom(code) {
    return this.rooms.get((code || '').toUpperCase()) || null;
  }

  getRoomBySocket(socketId) {
    const code = this.socketToRoom.get(socketId);
    return code ? this.rooms.get(code) : null;
  }

  registerSocket(socketId, roomCode) {
    this.socketToRoom.set(socketId, roomCode);
  }

  unregisterSocket(socketId) {
    this.socketToRoom.delete(socketId);
  }

  deleteRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    for (const id of room.players.keys()) {
      this.socketToRoom.delete(id);
    }
    this.rooms.delete(code);
  }
}

module.exports = RoomManager;
