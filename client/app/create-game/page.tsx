'use client'
import { useRouter } from "next/navigation"
import { useRef, useState } from "react";
import axios from "axios";
import { useInfoHook } from "@/store/info";

const BASE_URL = "http://localhost:8080"; //"https://65.1.130.45.sslip.io"; //process.env.NEXT_PUBLIC_BACKEND_URL ||

export default function CreateGame(){

    const router=useRouter();
    const roomRef=useRef<HTMLInputElement>(null);
    const nameRef=useRef<HTMLInputElement>(null);
    const {name,setName}=useInfoHook();
    const [gameMode, setGameMode] = useState<'CHALLENGE' | 'FRIENDLY'>('CHALLENGE');
    const [createdRoom, setCreatedRoom] = useState<{roomId: string, broadcastRoomId: string, gameMode: string} | null>(null);

    async function create(){
        if(!roomRef.current?.value || !nameRef.current?.value){
            alert('Fill all the fields.');
            return;
        }
        setName(nameRef.current.value);

        await axios.post( `${BASE_URL}/create`,
            {
            roomName : roomRef.current.value,
            gameMode: gameMode
        }).then((res)=>{
            const { roomId, broadcastRoomId, gameMode: responseGameMode } = res.data;
            setCreatedRoom({ roomId, broadcastRoomId, gameMode: responseGameMode });
        }).catch((e)=>{
            alert('Error while Creating room.')
            return;
        })

    }

    const copySpectatorLink = () => {
        if (createdRoom) {
            const link = `${window.location.origin}/broadcast/${createdRoom.broadcastRoomId}`;
            navigator.clipboard.writeText(link);
            alert('Spectator link copied to clipboard!');
        }
    };

    const enterGame = () => {
        if (createdRoom && roomRef.current?.value) {
            router.push(`/room/${roomRef.current.value}/${createdRoom.roomId}`)
        }
    };

    if (createdRoom) {
        return (
            <div className="w-screen h-screen flex flex-col items-center justify-center bg-white">
                <div className="flex flex-col bg-white border border-zinc-800 rounded-lg items-center py-5 px-3 gap-5 w-[500px] h-auto">
                    <h1 className="text-[28px] tracking-tight">Game Created!</h1>

                    <div className="flex flex-col gap-3 w-full">
                        <div className="text-center">
                            <p className="text-[16px] text-zinc-600">Game Mode: <strong>{createdRoom.gameMode}</strong></p>
                        </div>

                        <div className="bg-zinc-50 p-3 rounded border">
                            <p className="text-[14px] text-zinc-600 mb-1">Share this code with your opponent:</p>
                            <p className="text-[18px] font-mono bg-white p-2 border rounded text-center">{createdRoom.roomId}</p>
                        </div>

                        <div className="bg-zinc-50 p-3 rounded border">
                            <p className="text-[14px] text-zinc-600 mb-1">Spectator Link (share to let others watch):</p>
                            <p className="text-[14px] font-mono bg-white p-2 border rounded break-all">
                                {window.location.origin}/broadcast/{createdRoom.broadcastRoomId}
                            </p>
                            <button
                                onClick={copySpectatorLink}
                                className="mt-2 w-full bg-zinc-200 hover:bg-zinc-300 px-3 py-1 rounded text-[14px]"
                            >
                                Copy Spectator Link
                            </button>
                        </div>
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={() => setCreatedRoom(null)}
                            className="bg-zinc-200 hover:bg-zinc-300 px-4 py-2 rounded text-[14px]"
                        >
                            Back
                        </button>
                        <button
                            onClick={enterGame}
                            className="bg-zinc-800 hover:bg-zinc-700 text-white px-6 py-2 rounded text-[16px]"
                        >
                            Enter Game Room
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return <div className="w-screen h-screen flex flex-col items-center justify-center bg-white">
        <div className="flex flex-col bg-white border border-zinc-800 rounded-lg items-center py-5 px-3 gap-5 w-[400px] h-auto">
            <div className="flex justify-around w-full items-center">
                <p className="text-[28px] tracking-tight">Create a Game</p>
                <div className="text-[14px] text-black tracking-tight cursor-pointer hover:underline" onClick={()=>router.push('/')}>{'Home ->'}</div>
            </div>
            <div className="flex flex-col gap-3 items-center w-full">
                <input ref={roomRef} type="text" placeholder="Name your Room" className="w-full px-3 py-1 text-[16px] tracking-tight bg-white focus:outline-0 text-zinc-800 border border-zinc-800 placeholder:text-zinc-700 rounded-md"/>
                <input ref={nameRef} type="text" placeholder="Enter Your Name" className="w-full px-3 py-1 text-[16px] tracking-tight bg-white focus:outline-0 text-zinc-800 border border-zinc-800 placeholder:text-zinc-700 rounded-md"/>

                <div className="flex flex-col gap-2 w-full">
                    <label className="text-[14px] text-zinc-600">Game Mode:</label>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setGameMode('CHALLENGE')}
                            className={`flex-1 px-3 py-2 rounded border text-[14px] ${
                                gameMode === 'CHALLENGE'
                                    ? 'bg-zinc-800 text-white border-zinc-800'
                                    : 'bg-white text-zinc-800 border-zinc-400 hover:bg-zinc-50'
                            }`}
                        >
                            Challenge Mode
                            <div className="text-[12px] opacity-75">Spectators can't be heard</div>
                        </button>
                        <button
                            onClick={() => setGameMode('FRIENDLY')}
                            className={`flex-1 px-3 py-2 rounded border text-[14px] ${
                                gameMode === 'FRIENDLY'
                                    ? 'bg-zinc-800 text-white border-zinc-800'
                                    : 'bg-white text-zinc-800 border-zinc-400 hover:bg-zinc-50'
                            }`}
                        >
                            Friendly Mode
                            <div className="text-[12px] opacity-75">Full communication</div>
                        </button>
                    </div>
                </div>
            </div>
            <div className="flex w-full justify-around items-center ">
                <div onClick={()=>router.push('/join-game')} className="hover:underline text-[14px] hover:text-blue-500 text-zinc-800 cursor-pointer tracking-tight">Want to join a room?</div>
                <div onClick={create} className="bg-white px-7 py-1 rounded-md text-zinc-800 cursor-pointer text-[16px] border border-zinc-800 hover:bg-zinc-200">Create</div>
            </div>
        </div>
    </div>
}