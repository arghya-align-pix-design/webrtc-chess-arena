import { Server } from 'socket.io';
import express from 'express';
import cors from 'cors';
import { Peer, PeerRole } from './classes/peer';
import { Room, GameMode } from './classes/room';
import { BroadcastRoom } from './classes/broadcastRoom';
import { Consumer, Producer, Transport, Worker } from 'mediasoup/types';
import { CreateWorker } from './mediasoup/worker';
import { createWebRtcTransport } from './mediasoup/transport';
import { mediaCodecs } from './mediasoup/config';

const app=express();
app.use(cors({
  origin:  '*',  //'http://localhost:3000',
  methods: ["GET", "POST"],
  //credentials: true
}));
app.use(express.json());

let worker : Worker;
const rooms : Map<string,Room>=new Map();
const broadcastRooms : Map<string,BroadcastRoom>=new Map();

// Custom types
interface Player {
  id: string;
  color: "white" | "black";
}

interface Rooms {
  players: Player[];
  fen: string;
}

const chessRooms: Record<string, Rooms> = {};

async function creatingWorker(){
    worker=await CreateWorker();
}
creatingWorker();

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

app.get('/ping',(req,res)=>{
    res.send({message : 'pong'})
})

app.post('/join',(req,res)=>{
    const {roomId}=req.body;
    const room=rooms.get(roomId);

    if(room){
        if(room.peers.length==2){
            res.status(403).json({error : 'Both peers already joined'});
        }
        res.status(200).json({roomName : room.name, broadcastRoomId: room.broadcastRoomId, gameMode: room.gameMode});
    }
    else{
        res.status(404).json({error : 'Room not found'});
    }
})

app.post('/create',async (req,res)=>{
    console.log('[server] create room request')
    const {roomName, gameMode = GameMode.CHALLENGE}=req.body;
    const id=generateRoomId();
    const broadcastId=generateRoomId();
    try{
        const router=await worker.createRouter({mediaCodecs});
        const room=new Room(roomName,id,router, gameMode);
        room.broadcastRoomId = broadcastId;
        rooms.set(id,room);

        // Create broadcast room
        const broadcastRouter=await worker.createRouter({mediaCodecs});
        const broadcastRoom=new BroadcastRoom(id, broadcastId, broadcastRouter, gameMode);
        broadcastRooms.set(broadcastId, broadcastRoom);

        console.log('[server] room created successfully ', id, 'broadcast:', broadcastId)
        res.status(200).json({roomId : room.id, broadcastRoomId: broadcastId, gameMode});
    }catch(e){
        res.status(401).json({error : 'Error while creating room on BE.'});
    }
})

app.post('/join-broadcast', (req,res)=>{
    const {broadcastRoomId, spectatorName}=req.body;
    const broadcastRoom=broadcastRooms.get(broadcastRoomId);

    if(broadcastRoom){
        if(broadcastRoom.isFull()){
            res.status(403).json({error : 'Broadcast room is full (max 10 spectators)'});
        } else {
            res.status(200).json({
                broadcastRoomId: broadcastRoom.broadcastRoomId,
                gameRoomId: broadcastRoom.gameRoomId,
                gameMode: broadcastRoom.gameMode,
                spectatorCount: broadcastRoom.getSpectatorCount()
            });
        }
    }
    else{
        res.status(404).json({error : 'Broadcast room not found'});
    }
})

app.get('/broadcast/:broadcastRoomId', (req,res)=>{
    const {broadcastRoomId}=req.params;
    const broadcastRoom=broadcastRooms.get(broadcastRoomId);

    if(broadcastRoom){
        const gameRoom = rooms.get(broadcastRoom.gameRoomId);
        const players = gameRoom ? gameRoom.peers.map(p => ({name: p.name})) : [];
        res.status(200).json({
            broadcastRoomId: broadcastRoom.broadcastRoomId,
            gameRoomId: broadcastRoom.gameRoomId,
            gameMode: broadcastRoom.gameMode,
            spectatorCount: broadcastRoom.getSpectatorCount(),
            players: players,
            status: gameRoom && gameRoom.peers.length === 2 ? 'in-game' : 'waiting'
        });
    }
    else{
        res.status(404).json({error : 'Broadcast room not found'});
    }
})

const server=app.listen(8080,()=>{
    console.log('Server is listening on port 8080');
})

/*----------------------------------------------------------------------- */

const io=new Server(server,{
    cors : {
        origin :"*"        //'http://localhost:3000',  // ""
    }
})

io.on('connection',(socket)=>{
    console.log('Client Connected : ',socket.id);

    socket.on('join-room',({name, roomId },callback)=>{
        const peer=new Peer(name,socket.id);
        const room=rooms.get(roomId);
        
        if (!chessRooms[roomId]) {
            chessRooms[roomId] = { 
                players: [],
                fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
            };
        }
        
        console.log('[join-room] 1',roomId);
        if(room){
            socket.join(roomId);
            if(room.peers.length<2){
                console.log('[join-room] 2',roomId);
                room?.peers.push(peer);
                if(!room.router){
                    return callback({error : 'router not exists for this room'})
                }
                const producers=room.getProducers();
                console.log('[join-room-producers] ,producers');
                // Assign chess color: first peer = random, second = opposite
                
                const isFirstPlayer = chessRooms[roomId].players.length === 0;
                const assignedColor: "white" | "black" = isFirstPlayer
                ? (Math.random() < 0.5 ? "white" : "black")
                : (chessRooms[roomId].players[0].color === "white" ? "black" : "white");

                chessRooms[roomId].players.push({ id: socket.id, color: assignedColor });
                
                socket.emit('colorAssigned', assignedColor);
                console.log(`[join-room] color assigned: ${assignedColor} to ${socket.id}`);
                // Notify first peer that opponent has joined
                if(room.peers.length === 2){
                    socket.to(roomId).emit('opponentJoined');
                }
                
                // Sync current game state with the newly joined client
                socket.emit('gameStateSync', { fen: chessRooms[roomId].fen });

                callback({routerRtpCapabilities : room.router.rtpCapabilities, producers : producers});
            }
            else{
                callback({error :'limit hit'});
            }
        }
        else{
            callback({error : 'not found'});
        }
    })

    // Chess: relay a move to the opponent in the same room
    socket.on('moveMade', ({ roomId, from, to, fen }: { roomId: string; from: string; to: string; fen: string }) => {
        console.log(`[moveMade] ${socket.id} moved ${from}->${to} in room ${roomId}`);
        if (chessRooms[roomId]) {
            chessRooms[roomId].fen = fen;
        }
        socket.to(roomId).emit('moveMade', { from, to, fen });

        // Also broadcast to spectators
        const room = rooms.get(roomId);
        if (room && room.broadcastRoomId) {
            io.to(room.broadcastRoomId).emit('moveMade', { from, to, fen });
        }
    })

    // Broadcast room handlers
    socket.on('join-broadcast', ({ spectatorName, broadcastRoomId }, callback) => {
        const broadcastRoom = broadcastRooms.get(broadcastRoomId);
        if (!broadcastRoom) {
            return callback({ error: 'Broadcast room not found' });
        }

        if (broadcastRoom.isFull()) {
            return callback({ error: 'Broadcast room is full (max 10 spectators)' });
        }

        const spectator = new Peer(spectatorName, socket.id, PeerRole.SPECTATOR);
        broadcastRoom.join(spectator);
        socket.join(broadcastRoomId);

        console.log(`[join-broadcast] Spectator ${spectatorName} joined broadcast room ${broadcastRoomId}`);

        // Get game room info for spectators
        const gameRoom = rooms.get(broadcastRoom.gameRoomId);
        const players = gameRoom ? gameRoom.peers.map(p => ({ name: p.name, id: p.socketId })) : [];

        // Get existing spectator producers
        const spectatorProducers = broadcastRoom.getSpectatorProducers();

        callback({
            routerRtpCapabilities: broadcastRoom.router?.rtpCapabilities,
            gameRoomId: broadcastRoom.gameRoomId,
            gameMode: broadcastRoom.gameMode,
            players: players,
            currentFEN: chessRooms[broadcastRoom.gameRoomId]?.fen || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            spectatorProducers: spectatorProducers,
            spectatorCount: broadcastRoom.getSpectatorCount()
        });

        // Notify other spectators
        socket.to(broadcastRoomId).emit('spectator-joined', {
            spectatorId: socket.id,
            spectatorName: spectatorName,
            spectatorCount: broadcastRoom.getSpectatorCount()
        });
    })

    socket.on('create-transport', async ({roomId,direction},callback)=>{
        const room=rooms.get(roomId);
        if(!room){
            console.log('[create-transport] ERROR room not found')
            return callback({error : 'room not found'});
        } 
        const peer=room.peers.find((peer : Peer)=>peer.socketId==socket.id);
        if(!peer){
            console.log('[create-transport] ERROR peer not found')
            return callback({error : 'peer not found'});
        } 
        if(!room.router){
            console.log('[create-transport] ERROR router not found')
            return callback({error : 'router not found'})
        } 
        const transport=await createWebRtcTransport(room.router);
        if(direction=='send'){
            peer.upTransport=transport;
            console.log('[create-transport] uptransport created');
        }
        else{
            peer.downTransport=transport;
            console.log('[create-transport] down transport created');
        }

        callback({
            id : transport.id,
            iceParameters : transport.iceParameters,
            iceCandidates : transport.iceCandidates,
            dtlsParameters : transport.dtlsParameters
        })
    })

    // Broadcast room transport handlers
    socket.on('create-transport-broadcast', async ({broadcastRoomId, direction}, callback) => {
        const broadcastRoom = broadcastRooms.get(broadcastRoomId);
        if (!broadcastRoom) {
            console.log('[create-transport-broadcast] ERROR broadcast room not found')
            return callback({ error: 'broadcast room not found' });
        }
        const spectator = broadcastRoom.spectators.find((s: Peer) => s.socketId === socket.id);
        if (!spectator) {
            console.log('[create-transport-broadcast] ERROR spectator not found')
            return callback({ error: 'spectator not found' });
        }
        if (!broadcastRoom.router) {
            console.log('[create-transport-broadcast] ERROR broadcast router not found')
            return callback({ error: 'broadcast router not found' })
        }
        const transport = await createWebRtcTransport(broadcastRoom.router);
        if (direction === 'send') {
            spectator.upTransport = transport;
            console.log('[create-transport-broadcast] spectator uptransport created');
        } else {
            spectator.downTransport = transport;
            console.log('[create-transport-broadcast] spectator down transport created');
        }

        callback({
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters
        })
    })

    socket.on('connect-transport-broadcast', async ({broadcastRoomId, transportId, dtlsParameters}, callback) => {
        const broadcastRoom = broadcastRooms.get(broadcastRoomId);
        if (!broadcastRoom) return callback({ error: 'broadcast room not found' });
        const spectator = broadcastRoom.spectators.find((s: Peer) => s.socketId === socket.id);
        if (!spectator) return callback({ error: 'spectator not found' });
        if (spectator.downTransport && spectator.downTransport.id === transportId) {
            await spectator.downTransport.connect({ dtlsParameters });
            console.log('[connect-transport-broadcast] spectator downTransport connected');
            callback({ connected: true });
        } else if (spectator.upTransport && spectator.upTransport.id === transportId) {
            await spectator.upTransport.connect({ dtlsParameters });
            console.log('[connect-transport-broadcast] spectator upTransport connected');
            callback({ connected: true });
        } else {
            console.log('[connect-transport-broadcast] ERROR Transport not found');
            callback({ error: 'transport not found' })
        }
    })

    socket.on('connect-transport', async({roomId, transportId, dtlsParameters,},callback)=>{
        const room=rooms.get(roomId);
        if(!room) return callback({error : 'room not found'});
        const peer=room.peers.find((peer : Peer)=>peer.socketId==socket.id);
        if(!peer) return callback({error : 'peer not found'});
        if(peer.downTransport && peer.downTransport.id==transportId){
            await peer.downTransport.connect({dtlsParameters});
            console.log('[connect-transport] downTransport connected');
            callback({connected : true});
        }
        else if(peer.upTransport && peer.upTransport.id==transportId){
            await peer.upTransport.connect({dtlsParameters});
            console.log('[connect-transport] upTransport connected');
            callback({connected : true});
        }
        else{
            console.log('[connect-transport] ERROR Transport not found');
            callback({error : 'transport not found'})
        }
    })

    socket.on('produce', async({ roomId, transportId, kind, rtpParameters, appData},callback)=>{
        console.log('[produce] producer request');
        const room=rooms.get(roomId);
        if(!room){
            console.log('[produce] room not found');
            return callback({error : 'room not found'});
        } 
        const peer=room.peers.find((peer : Peer)=>peer.socketId==socket.id);
        if(!peer){
            callback.log('[produce] peer not found');
            return callback({error : 'peer not found'});
        } 
        if((peer.upTransport && peer.upTransport.id!=transportId) || !peer.upTransport){
            console.log('[connect-transport] ERROR Transport not found');
            return callback({error : 'transport not found'})
        }
        const producer=await peer.upTransport.produce({kind, rtpParameters, appData});
        if(appData.mediaTag=='video'){
            peer.camProducer=producer;  
            console.log('[produce] cam producer set'); 
        }
        else{
            peer.micProducer=producer;
            console.log('[produce] mic producer set');
        }        

        callback({id : producer.id});
        socket.to(roomId).emit('new-producer',{
            producerId : producer.id,
            peerId : socket.id,
            kind,
            appData
        })
        room.producers.push(producer);
        console.log('[new producer] : ',producer.id);
    })

    // Broadcast room produce handler
    socket.on('produce-broadcast', async ({ broadcastRoomId, transportId, kind, rtpParameters, appData }, callback) => {
        console.log('[produce-broadcast] spectator producer request');
        const broadcastRoom = broadcastRooms.get(broadcastRoomId);
        if (!broadcastRoom) {
            console.log('[produce-broadcast] broadcast room not found');
            return callback({ error: 'broadcast room not found' });
        }
        const spectator = broadcastRoom.spectators.find((s: Peer) => s.socketId === socket.id);
        if (!spectator) {
            console.log('[produce-broadcast] spectator not found');
            return callback({ error: 'spectator not found' });
        }
        if ((spectator.upTransport && spectator.upTransport.id !== transportId) || !spectator.upTransport) {
            console.log('[produce-broadcast] ERROR Transport not found');
            return callback({ error: 'transport not found' })
        }
        const producer = await spectator.upTransport.produce({ kind, rtpParameters, appData });
        if (appData.mediaTag === 'video') {
            spectator.camProducer = producer;
            console.log('[produce-broadcast] spectator cam producer set');
        } else {
            spectator.micProducer = producer;
            console.log('[produce-broadcast] spectator mic producer set');
        }

        callback({ id: producer.id });

        // Notify other spectators (but NOT the producer themselves)
        socket.to(broadcastRoomId).emit('spectator-media-added', {
            producerId: producer.id,
            spectatorId: socket.id,
            spectatorName: spectator.name,
            kind,
            appData
        });

        console.log('[spectator new producer] : ', producer.id);
    })

    socket.on('consume',async ({roomId,producerId,rtpCapabilities},callback)=>{
        const room=rooms.get(roomId);
        if(!room) return callback({error : 'room not found'});
        const peer=room.peers.find((peer : Peer)=>peer.socketId==socket.id);
        if(!peer) return callback({error : 'peer not found'});
        const transport=peer.downTransport;
        const producer=room.producers.find((p : Producer)=>p.id==producerId);
        if(!transport){
            console.log('[Consume] transport not found');
            return callback({error : 'transport not found'});
        }
        console.log('[consume] looking for producer : ',producerId);
        if(!producer){
            console.log('[Consume] producer not found');
            return callback({error : 'producer not found'});
        }
        const consumer=await transport.consume({
            producerId,
            rtpCapabilities,
            paused : true
        })
        peer.consumers.push(consumer);
        console.log('[Consume] consumer created successfully');
        callback({
            id : consumer.id,
            producerId,
            kind : consumer.kind,
            rtpParameters : consumer.rtpParameters
        })
    })

    // Broadcast room consume handlers
    socket.on('consume-spectator-media', async ({ broadcastRoomId, producerId, rtpCapabilities }, callback) => {
        const broadcastRoom = broadcastRooms.get(broadcastRoomId);
        if (!broadcastRoom) return callback({ error: 'broadcast room not found' });
        const spectator = broadcastRoom.spectators.find((s: Peer) => s.socketId === socket.id);
        if (!spectator) return callback({ error: 'spectator not found' });
        const transport = spectator.downTransport;

        if (!transport) {
            console.log('[consume-spectator-media] transport not found');
            return callback({ error: 'transport not found' });
        }

        // Find producer from other spectators
        let producer: Producer | null = null;
        for (const otherSpec of broadcastRoom.spectators) {
            if (otherSpec.camProducer?.id === producerId) {
                producer = otherSpec.camProducer;
                break;
            }
            if (otherSpec.micProducer?.id === producerId) {
                producer = otherSpec.micProducer;
                break;
            }
        }

        if (!producer) {
            console.log('[consume-spectator-media] producer not found');
            return callback({ error: 'producer not found' });
        }

        const consumer = await transport.consume({
            producerId,
            rtpCapabilities,
            paused: true
        })
        spectator.consumers.push(consumer);
        console.log('[consume-spectator-media] spectator consumer created successfully');
        callback({
            id: consumer.id,
            producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters
        })
    })

    socket.on('consume-game-broadcast', async ({ broadcastRoomId, producerId, rtpCapabilities }, callback) => {
        const broadcastRoom = broadcastRooms.get(broadcastRoomId);
        if (!broadcastRoom) return callback({ error: 'broadcast room not found' });
        const spectator = broadcastRoom.spectators.find((s: Peer) => s.socketId === socket.id);
        if (!spectator) return callback({ error: 'spectator not found' });
        const transport = spectator.downTransport;

        if (!transport) {
            console.log('[consume-game-broadcast] transport not found');
            return callback({ error: 'transport not found' });
        }

        // Find piped producer from game room
        const gameRoom = rooms.get(broadcastRoom.gameRoomId);
        if (!gameRoom) return callback({ error: 'game room not found' });

        let producer: Producer | null = null;
        for (const player of gameRoom.peers) {
            if (player.camProducer?.id === producerId) {
                producer = player.camProducer;
                break;
            }
            if (player.micProducer?.id === producerId) {
                producer = player.micProducer;
                break;
            }
        }

        if (!producer) {
            console.log('[consume-game-broadcast] piped producer not found');
            return callback({ error: 'producer not found' });
        }

        const consumer = await transport.consume({
            producerId,
            rtpCapabilities,
            paused: true
        })
        spectator.consumers.push(consumer);
        console.log('[consume-game-broadcast] game broadcast consumer created successfully');
        callback({
            id: consumer.id,
            producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters
        })
    })

    socket.on('resume-consumer',async ({roomId,consumerId},callback)=>{
        const room=rooms.get(roomId);
        if(!room) return callback({error : 'room not found'});
        const peer=room.peers.find((peer : Peer)=>peer.socketId==socket.id);
        if(!peer) return callback({error : 'peer not found'});
        const consumer=peer.consumers.find((c : Consumer)=>c.id==consumerId);
        if(consumer){
            await consumer.resume();
            console.log('[resume-consumer] consumer resumed') 
        } 
    })

    // Broadcast room resume consumer
    socket.on('resume-consumer-broadcast', async ({ broadcastRoomId, consumerId }, callback) => {
        const broadcastRoom = broadcastRooms.get(broadcastRoomId);
        if (!broadcastRoom) return callback({ error: 'broadcast room not found' });
        const spectator = broadcastRoom.spectators.find((s: Peer) => s.socketId === socket.id);
        if (!spectator) return callback({ error: 'spectator not found' });
        const consumer = spectator.consumers.find((c: Consumer) => c.id === consumerId);
        if (consumer) {
            await consumer.resume();
            console.log('[resume-consumer-broadcast] spectator consumer resumed')
        }
    })

    socket.on('disconnect', () => {
        console.log('Client Disconnected : ', socket.id);
        
        // Handle game room disconnect
        for (const [roomId, room] of rooms.entries()) {
            const peerIndex = room.peers.findIndex(p => p.socketId === socket.id);
            if (peerIndex !== -1) {
                // Found the peer, remove them
                const peer = room.peers[peerIndex];
                
                // Close transports to free mediasoup resources
                if (peer.upTransport) peer.upTransport.close();
                if (peer.downTransport) peer.downTransport.close();
                peer.consumers.forEach(consumer => consumer.close());
                if (peer.camProducer) peer.camProducer.close();
                if (peer.micProducer) peer.micProducer.close();

                room.peers.splice(peerIndex, 1);
                
                // Cleanup chess room allocation
                if (chessRooms[roomId]) {
                    chessRooms[roomId].players = chessRooms[roomId].players.filter(p => p.id !== socket.id);
                }

                if (room.peers.length === 0) {
                    // Both peers left -> fully clean up room
                    if (room.router) {
                        room.router.close();
                    }
                    rooms.delete(roomId);
                    delete chessRooms[roomId];
                    console.log(`[disconnect] Room ${roomId} completely cleaned up (empty).`);
                    console.log ("trying to look for the room", chessRooms[roomId] );
                    console.log("Remaining rooms:", rooms);
                } else {
                    console.log(`[disconnect] Player left room ${roomId}. Room kept awake.`);
                    socket.to(roomId).emit('playerDisconnected', { socketId: socket.id, name: peer.name });
                }
                break; // Stop iterating rooms once found
            }
        }

        // Handle broadcast room disconnect
        for (const [broadcastRoomId, broadcastRoom] of broadcastRooms.entries()) {
            const spectatorIndex = broadcastRoom.spectators.findIndex(s => s.socketId === socket.id);
            if (spectatorIndex !== -1) {
                // Found the spectator, remove them
                const spectator = broadcastRoom.spectators[spectatorIndex];
                
                // Close transports to free mediasoup resources
                if (spectator.upTransport) spectator.upTransport.close();
                if (spectator.downTransport) spectator.downTransport.close();
                spectator.consumers.forEach(consumer => consumer.close());
                if (spectator.camProducer) spectator.camProducer.close();
                if (spectator.micProducer) spectator.micProducer.close();

                broadcastRoom.spectators.splice(spectatorIndex, 1);
                
                console.log(`[disconnect] Spectator left broadcast room ${broadcastRoomId}. Remaining spectators: ${broadcastRoom.getSpectatorCount()}`);
                
                // Notify remaining spectators
                socket.to(broadcastRoomId).emit('spectator-left', { 
                    spectatorId: socket.id, 
                    spectatorName: spectator.name,
                    spectatorCount: broadcastRoom.getSpectatorCount()
                });

                // If broadcast room is empty, clean it up
                if (broadcastRoom.spectators.length === 0) {
                    if (broadcastRoom.router) {
                        broadcastRoom.router.close();
                    }
                    broadcastRooms.delete(broadcastRoomId);
                    console.log(`[disconnect] Broadcast room ${broadcastRoomId} completely cleaned up (empty).`);
                }
                break; // Stop iterating broadcast rooms once found
            }
        }
    });
})