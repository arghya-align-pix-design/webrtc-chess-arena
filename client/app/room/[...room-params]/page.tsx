'use client'
import { useEffect, memo, useRef, useState } from "react"
import { io, Socket } from "socket.io-client"
import { useInfoHook } from "@/store/info"
import { useRouter } from "next/navigation"
import { Device } from "mediasoup-client"
import ChessManager from "../../compos/ChessManager"
import { Chess } from "chess.js";
import { types as mediasoupTypes } from "mediasoup-client"
import React from "react"

type AppData = mediasoupTypes.AppData;
type Producer = mediasoupTypes.Producer;
type RtpCapabilities = mediasoupTypes.RtpCapabilities;
type RtpParameters = mediasoupTypes.RtpParameters;
type Transport = mediasoupTypes.Transport;
const BACK_END='http://localhost:8080';

// ✅ Memoized Video Component
    // const VideoSection = memo(({ videoRef, muted = false }: any) => {
    //     return (
    //         <video
    //             ref={videoRef}
    //             autoPlay
    //             playsInline
    //             muted={muted}
    //             className="w-full border rounded-md"
    //             style={{ aspectRatio: 16 / 11 }}
    //         />
    //     );
    // },[]);

export default function Room(){
    const socketRef=useRef<Socket | null>(null);
    const {name,setName}=useInfoHook();
    const roomIdRef=useRef<string>(null);
    const [roomName,setRoomName]=useState<string>('');
    const router=useRouter();

    const deviceRef=useRef<Device>(null);
    const sendTransportRef=useRef<Transport>(null);
    const recvTransportRef=useRef<Transport>(null);
    const selfProducerIds : string[]=[];
    let consumedProducerIds : string[]=[];
    const remoteStreamRef=useRef<MediaStream>(null);
    const remoteVideoRef=useRef<HTMLVideoElement>(null);
    const localVideoRef=useRef<HTMLVideoElement>(null);
    const localStreamRef=useRef<MediaStream>(null);
    const micProducersRef=useRef<Producer>(null);
    const camProducersRef=useRef<Producer>(null);
    //Player data
    const [game, setGame] = useState(new Chess());
    const [playerColor, setPlayerColor] = useState<"white" | "black" | null>(null);

    

    useEffect(()=>{
        const url=window.location.pathname;
        const segments=url.split('/');
        const roomName=segments[2];
        const roomId=segments[3];
        if(roomName) setRoomName(roomName);
        if(roomId){
            roomIdRef.current=roomId;
            console.log(roomIdRef.current);
        }
        
        
        
    },[]);

    useEffect(()=>{
        if(roomName=='') return;
        socketRef.current=io(BACK_END, { autoConnect: true });
        console.log(roomIdRef.current);

        // Chess: listen for color assignment
        // Registered here so it fires as soon as we join, before any mediasoup traffic
        socketRef.current.on('colorAssigned', (color: 'white' | 'black') => {
            console.log('[colorAssigned]', color);
            setPlayerColor(color);
        });

        joinRoom();
        const newProducerHandler = async ({ producerId, peerId, kind, appData } : {producerId : string, peerId : string, kind : 'video' | 'audio', appData : AppData}) => {
            await createConsumer(producerId,appData);
        };
        socketRef.current.on('new-producer',newProducerHandler);

        return () => {
            socketRef.current?.off('colorAssigned');
            socketRef.current?.off('new-producer', newProducerHandler);
        };
    },[roomName])

    async function createTransport(){
        const socket=socketRef.current;
        const roomId=roomIdRef.current;
        if(!socket){
            alert('No socket Connection found')
            router.push('/join-game')
            return;
        }
        if(!deviceRef.current){
            alert('No Device found');
            router.push('/join-game');
            return;
        }
        
        const upTransport=await socket.emitWithAck('create-transport',{roomId,direction : 'send'});
        const sendTransport=deviceRef.current.createSendTransport({
            id : upTransport.id,
            iceParameters : upTransport.iceParameters,
            iceCandidates : upTransport.iceCandidates,
            dtlsParameters : upTransport.dtlsParameters
        })

        const downTransport=await socket.emitWithAck('create-transport',{roomId, direction : 'recv'});
        const recvTransport=deviceRef.current.createRecvTransport({
            id : downTransport.id,
            iceParameters : downTransport.iceParameters,
            iceCandidates : downTransport.iceCandidates,
            dtlsParameters : downTransport.dtlsParameters
        })

        sendTransport.on('connect',async({dtlsParameters},callback)=>{
            try{
                await socket.emitWithAck('connect-transport',{
                    roomId,
                    transportId : sendTransport.id,
                    dtlsParameters
                });
                callback();
            }catch(e){
                console.log('[connect-send-transport] ',e);
            }
        })

        sendTransport.on('produce',async({kind,rtpParameters,appData},callback)=>{
            try{
                const {id : producerId}=await socket.emitWithAck('produce',{
                    roomId,
                    transportId : sendTransport.id,
                    kind,
                    rtpParameters,
                    appData
                })
                selfProducerIds.push(producerId);
                callback({id : producerId});
            }catch(e){
                console.log('[produce-transport] ',e);
            }
        })

        recvTransport.on('connect',async ({ dtlsParameters },callback)=>{
            try{
                await socket.emitWithAck('connect-transport',{
                    roomId,
                    transportId : recvTransport.id,
                    dtlsParameters
                })
                callback();
            }catch(e){
                console.log('[connect-recv-transport] ',e);
            }
        })
        
        sendTransportRef.current=sendTransport;
        recvTransportRef.current=recvTransport;

    }

    async function createConsumer(producerId : string, appData :AppData){
        if(!deviceRef.current){
            alert('device not found');
            router.push('/join-game');
        }
        const producer=selfProducerIds.find((id : string)=>id==producerId);
        if(producer) return;
        
        consumedProducerIds.push(producerId);
        socketRef.current?.emit('consume',{
            roomId : roomIdRef.current,
            producerId,
            rtpCapabilities : deviceRef.current?.rtpCapabilities
        }, async (res : {error?:string, id : string, producerId : string, kind : 'video' | 'audio', rtpParameters : RtpParameters})=>{
            if(res.error){
                console.log(res.error);
                return;
            }
            const consumer=await recvTransportRef.current?.consume({
                id : res.id,
                producerId : res.producerId,
                kind : res.kind,
                rtpParameters : res.rtpParameters
            })

            if(!consumer){
                console.log('error in creating consumer');
                return;
            }

            if(res.kind=='video'){
                const stream=new MediaStream();
                stream.addTrack(consumer.track);
                remoteStreamRef.current=stream;
                if(remoteVideoRef.current){
                    remoteVideoRef.current.srcObject=stream;
                    if(stream) remoteVideoRef.current.play().catch(()=>console.debug('play blocked'));
                } 
                socketRef.current?.emit('resume-consumer',{roomId : roomIdRef.current,consumerId : consumer.id});
            }
            else{
                const audio=document.createElement('audio');
                audio.autoplay=true;
                audio.srcObject=new MediaStream([consumer.track]);
                audio.play().catch(()=>console.debug('audio play blocked'));
                document.body.appendChild(audio);
                socketRef.current?.emit('resume-consumer',{roomId : roomIdRef.current,consumerId : consumer.id});
            }

            consumer?.on('transportclose',()=>{
                remoteStreamRef.current=null;
                consumedProducerIds=consumedProducerIds.filter((id : string)=>id!=producerId);
            })
        })

    }

    async function joinRoom(){
        if(!socketRef.current){
            alert('No socket connection found');
            router.push('/join-game')
            return;
        }
        socketRef.current.emit('join-room',({name, roomId : roomIdRef.current}),async (res : {error? : string, routerRtpCapabilities : RtpCapabilities, producers : Producer[]})=>{
            if(res.error){
                alert(res.error);
                router.push('/join-game');
            }
            const { routerRtpCapabilities,producers}=res;
            const device=new Device();
            await device.load({routerRtpCapabilities});
            deviceRef.current=device;
            await createTransport();
            for(const producerInfo of producers){
                const producerId=producerInfo.id;
                const appData : AppData=producerInfo.appData;
                await createConsumer(producerId,appData);
            }
            const localStream=await navigator.mediaDevices.getUserMedia({
                video : {width : {ideal : 1920}, height : {ideal : 1080}, frameRate : {ideal :60}, facingMode : 'user'},
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true}
            })
            const localVideoTrack=localStream.getVideoTracks()[0];
            if(localVideoTrack){
                await localVideoTrack.applyConstraints({
                    width : 1920,
                    height : 1080,
                    frameRate : {ideal : 60}
                }).catch(err=>console.warn('applyConstraints failed : ',err));
            }

            if(localStream && localVideoRef.current && sendTransportRef.current){
                localVideoRef.current.srcObject=localStream;
                localStreamRef.current=localStream;
                
                micProducersRef.current=await sendTransportRef.current.produce({
                    track : localStream.getAudioTracks()[0],
                    appData : {mediaTag : 'audio'},
                    codecOptions : {
                        opusMaxPlaybackRate : 48000,
                        opusStereo : true
                    },
                    encodings : [{maxBitrate : 128000}]
                })

                camProducersRef.current=await sendTransportRef.current.produce({
                    track : localStream.getVideoTracks()[0],
                    encodings : [
                        { 
                            rid: 'low',
                            maxBitrate: 200000,      
                            scaleResolutionDownBy: 4,
                            maxFramerate: 15
                        },
                        { 
                            rid: 'medium',
                            maxBitrate: 800000,      
                            scaleResolutionDownBy: 2,
                            maxFramerate: 30
                        },
                        { 
                            rid: 'high',
                            maxBitrate: 3500000,     
                            maxFramerate: 60
                        }
                    ],
                    codecOptions : {videoGoogleStartBitrate : 2000},
                    appData : {mediaTag : 'video'}
                })
            }
        })
    }
    
    return <div className="flex p-10 w-screen h-screen items-center justify-between">
        {/* LEFT VIDEO-OPPONENT'S VIDEO */}
        <div className="w-1/5 h-full flex flex-col justify-start">
            <video ref={localVideoRef} autoPlay playsInline muted={true} className="w-full border rounded-md" style={{aspectRatio : 16/11}}/>
        </div>
        <div className="w-3/5 h-full flex flex-col items-center justify-center">
            <div className="h-full border rounded-md flex items-center justify-center" style={{aspectRatio : 1}}>
                {playerColor && socketRef.current &&  (
                    <ChessManager
                        // game={game}
                        // setGame={setGame}
                        playerColor={playerColor}
                        socket={socketRef.current}
                        roomId={roomIdRef.current}
                    />
                )}
            </div>
        </div>
        {/* RIGHT VIDEO- USER'S VIDEO */}
        <div className="w-1/5 h-full flex flex-col justify-end">
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full border rounded-md" style={{aspectRatio : 16/11}}/>
        </div>
    </div>
}