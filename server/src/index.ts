import { Server } from 'socket.io';
import express from 'express';
import cors from 'cors';
import { Peer } from './classes/peer';
import { Room } from './classes/room';
import { Consumer, Producer, Transport, Worker } from 'mediasoup/types';
import { CreateWorker } from './mediasoup/worker';
import { createWebRtcTransport } from './mediasoup/transport';
import { mediaCodecs } from './mediasoup/config';

const app=express();
app.use(cors({
  origin: "http://localhost:3000",  
  credentials: true
}));
app.use(express.json());

let worker : Worker;
const rooms : Map<string,Room>=new Map();

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
        res.status(200).json({roomName : room.name});
    }
    else{
        res.status(404).json({error : 'Room not found'});
    }
})

app.post('/create',async (req,res)=>{
    console.log('[server] create room request')
    const {roomName}=req.body;
    const id=generateRoomId();
    try{
        const router=await worker.createRouter({mediaCodecs});
        const room=new Room(roomName,id,router);
        rooms.set(id,room);
        console.log('[server] room created successfully ', id)
        res.status(200).json({roomId : room.id});
    }catch(e){
        res.status(401).json({error : 'Error while creating room.'});
    }
})

const server=app.listen(8080,()=>{
    console.log('Server is listening on port 8080');
})

/*----------------------------------------------------------------------- */

const io=new Server(server,{
    cors : {
        origin : 'http://localhost:3000'
    }
})

io.on('connection',(socket)=>{
    console.log('Client Connected : ',socket.id);

    socket.on('join-room',({name, roomId },callback)=>{
        const peer=new Peer(name,socket.id);
        const room=rooms.get(roomId);
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
})