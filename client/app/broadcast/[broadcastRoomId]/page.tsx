'use client'
import { useRouter } from "next/navigation"
import { useRef, useState, useEffect } from "react";
import axios from "axios";

const BASE_URL = "http://localhost:8080"//"https://65.1.130.45.sslip.io"; //process.env.NEXT_PUBLIC_BACKEND_URL ||

interface BroadcastInfo {
    broadcastRoomId: string;
    gameRoomId: string;
    gameMode: 'CHALLENGE' | 'FRIENDLY';
    spectatorCount: number;
    players: { name: string }[];
    status: 'waiting' | 'in-game' | 'ended';
}

export default function BroadcastPage({ params }: { params: { broadcastRoomId: string } }) {
    const router = useRouter();
    const nameRef = useRef<HTMLInputElement>(null);
    const [broadcastInfo, setBroadcastInfo] = useState<BroadcastInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchBroadcastInfo();
    }, [params.broadcastRoomId]);

    const fetchBroadcastInfo = async () => {
        try {
            const response = await axios.get(`${BASE_URL}/broadcast/${params.broadcastRoomId}`);
            setBroadcastInfo(response.data);
            setLoading(false);
        } catch (err) {
            setError('Broadcast room not found or has ended');
            setLoading(false);
        }
    };

    const joinAsSpectator = async () => {
        if (!nameRef.current?.value) {
            alert('Please enter your name');
            return;
        }

        try {
            const response = await axios.post(`${BASE_URL}/join-broadcast`, {
                broadcastRoomId: params.broadcastRoomId,
                spectatorName: nameRef.current.value
            });

            // Navigate to spectator room view
            router.push(`/spectator-room/${params.broadcastRoomId}`);
        } catch (err: any) {
            if (err.response?.status === 403) {
                alert('Broadcast room is full (maximum 10 spectators)');
            } else {
                alert('Error joining broadcast room');
            }
        }
    };

    if (loading) {
        return (
            <div className="w-screen h-screen flex items-center justify-center bg-white">
                <div className="text-[18px] text-zinc-600">Loading broadcast info...</div>
            </div>
        );
    }

    if (error || !broadcastInfo) {
        return (
            <div className="w-screen h-screen flex flex-col items-center justify-center bg-white">
                <div className="flex flex-col bg-white border border-red-300 rounded-lg items-center py-5 px-3 gap-5 w-[400px] h-auto">
                    <div className="text-red-600 text-[18px]">Error</div>
                    <div className="text-zinc-600 text-center">{error || 'Broadcast room not found'}</div>
                    <button
                        onClick={() => router.push('/')}
                        className="bg-zinc-800 text-white px-4 py-2 rounded hover:bg-zinc-700"
                    >
                        Go Home
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="w-screen h-screen flex flex-col items-center justify-center bg-white">
            <div className="flex flex-col bg-white border border-zinc-800 rounded-lg items-center py-5 px-3 gap-5 w-[450px] h-auto">
                <div className="flex justify-around w-full items-center">
                    <h1 className="text-[28px] tracking-tight">Watch Chess Game</h1>
                    <div
                        className="text-[14px] text-black tracking-tight cursor-pointer hover:underline"
                        onClick={() => router.push('/')}
                    >
                        Home →
                    </div>
                </div>

                <div className="flex flex-col gap-4 w-full">
                    <div className="bg-zinc-50 p-4 rounded border">
                        <div className="grid grid-cols-2 gap-4 text-[14px]">
                            <div>
                                <span className="text-zinc-600">Game Mode:</span>
                                <div className="font-medium">
                                    {broadcastInfo.gameMode === 'CHALLENGE' ? 'Challenge Mode' : 'Friendly Mode'}
                                </div>
                                <div className="text-[12px] text-zinc-500">
                                    {broadcastInfo.gameMode === 'CHALLENGE'
                                        ? 'Spectators cannot be heard by players'
                                        : 'Full communication enabled'
                                    }
                                </div>
                            </div>
                            <div>
                                <span className="text-zinc-600">Status:</span>
                                <div className={`font-medium ${
                                    broadcastInfo.status === 'in-game' ? 'text-green-600' :
                                    broadcastInfo.status === 'waiting' ? 'text-yellow-600' : 'text-red-600'
                                }`}>
                                    {broadcastInfo.status === 'in-game' ? 'Live Game' :
                                     broadcastInfo.status === 'waiting' ? 'Waiting for Players' : 'Game Ended'}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-zinc-50 p-4 rounded border">
                        <div className="text-[14px] text-zinc-600 mb-2">Players:</div>
                        <div className="flex gap-4">
                            {broadcastInfo.players.map((player, index) => (
                                <div key={index} className="flex-1 text-center">
                                    <div className="text-[16px] font-medium">{player.name}</div>
                                    <div className="text-[12px] text-zinc-500">
                                        Player {index + 1}
                                    </div>
                                </div>
                            ))}
                            {broadcastInfo.players.length === 1 && (
                                <div className="flex-1 text-center text-zinc-400">
                                    <div className="text-[16px]">Waiting...</div>
                                    <div className="text-[12px]">Player 2</div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="bg-zinc-50 p-4 rounded border">
                        <div className="text-[14px] text-zinc-600 mb-2">Spectators:</div>
                        <div className="text-[16px] font-medium">
                            {broadcastInfo.spectatorCount}/10 watching
                        </div>
                        {broadcastInfo.spectatorCount >= 10 && (
                            <div className="text-[12px] text-red-600 mt-1">
                                Broadcast room is full
                            </div>
                        )}
                    </div>

                    <div className="flex flex-col gap-3">
                        <input
                            ref={nameRef}
                            type="text"
                            placeholder="Enter your name to watch"
                            className="w-full px-3 py-2 text-[16px] tracking-tight bg-white focus:outline-0 text-zinc-800 border border-zinc-800 placeholder:text-zinc-700 rounded-md"
                            disabled={broadcastInfo.spectatorCount >= 10}
                        />

                        <button
                            onClick={joinAsSpectator}
                            disabled={broadcastInfo.spectatorCount >= 10}
                            className={`w-full py-2 rounded text-[16px] font-medium ${
                                broadcastInfo.spectatorCount >= 10
                                    ? 'bg-zinc-300 text-zinc-500 cursor-not-allowed'
                                    : 'bg-zinc-800 text-white hover:bg-zinc-700'
                            }`}
                        >
                            {broadcastInfo.spectatorCount >= 10 ? 'Room Full' : 'Join as Spectator'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}