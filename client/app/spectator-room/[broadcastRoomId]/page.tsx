'use client'
import { useEffect, memo, useRef, useState, useCallback } from "react"
import { io, Socket } from "socket.io-client"
import { useRouter } from "next/navigation"
import { Device } from "mediasoup-client"
import ChessManager from "../../compos/ChessManager"
import { Chess } from "chess.js";
import { types as mediasoupTypes } from "mediasoup-client"
import React from "react"

const BASE_URL = "http://localhost:8080" //"https://65.1.130.45.sslip.io"; // process.env.NEXT_PUBLIC_BACKEND_URL ||

type AppData = mediasoupTypes.AppData;
type Producer = mediasoupTypes.Producer;
type RtpCapabilities = mediasoupTypes.RtpCapabilities;
type RtpParameters = mediasoupTypes.RtpParameters;
type Transport = mediasoupTypes.Transport;

export default function SpectatorRoom({ params }: { params: Promise<{ broadcastRoomId: string }> }) {
    const unwrappedParams = React.use(params);
    const broadcastRoomId = unwrappedParams.broadcastRoomId;

    const socketRef = useRef<Socket | null>(null);
    const broadcastRoomIdRef = useRef<string>(null);
    const router = useRouter();

    const deviceRef = useRef<Device>(null);
    const sendTransportRef = useRef<Transport>(null);
    const recvTransportRef = useRef<Transport>(null);

    // Chess state
    const [game, setGame] = useState(new Chess());
    const [initialFen, setInitialFen] = useState<string>("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");

    // Broadcast state
    const [gameMode, setGameMode] = useState<'CHALLENGE' | 'FRIENDLY'>('CHALLENGE');
    const [players, setPlayers] = useState<{ name: string; id: string }[]>([]);
    const [spectatorCount, setSpectatorCount] = useState(0);
    const [spectators, setSpectators] = useState<{ id: string; name: string }[]>([]);

    // Video elements
    const player1VideoRef = useRef<HTMLVideoElement>(null);
    const player2VideoRef = useRef<HTMLVideoElement>(null);
    const selfVideoRef = useRef<HTMLVideoElement>(null);
    const localStreamRef = useRef<MediaStream>(null);

    // Track which player socketId maps to which video ref (player1 or player2)
    const playerIdMapRef = useRef<{ player1Id: string | null; player2Id: string | null }>({
        player1Id: null,
        player2Id: null
    });

    // Spectator video grid refs
    const spectatorVideoRefs = useRef<{ [spectatorId: string]: HTMLVideoElement }>({});

    useEffect(() => {
        broadcastRoomIdRef.current = broadcastRoomId;
        joinBroadcastRoom();
        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
        };
    }, [broadcastRoomId]);

    // Attach a single piped consumer's track to the correct player video element
    const attachPlayerMedia = useCallback((playerId: string, kind: string, track: MediaStreamTrack) => {
        // Assign player IDs to slots on first encounter
        const map = playerIdMapRef.current;
        if (!map.player1Id && !map.player2Id) {
            map.player1Id = playerId;
        } else if (map.player1Id && map.player1Id !== playerId && !map.player2Id) {
            map.player2Id = playerId;
        }

        const isPlayer1 = map.player1Id === playerId;
        const videoRef = isPlayer1 ? player1VideoRef : player2VideoRef;

        if (kind === 'video') {
            const stream = new MediaStream([track]);
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.play().catch(() => console.debug('[spectator] video play blocked'));
            }
        } else {
            // Audio: create a hidden <audio> element so player audio plays
            const audio = document.createElement('audio');
            audio.autoplay = true;
            audio.srcObject = new MediaStream([track]);
            audio.play().catch(() => console.debug('[spectator] audio play blocked'));
            document.body.appendChild(audio);
        }
    }, []);

    // Consume all piped player producers from the Broadcast Router in one call
    const consumeAllPlayerMedia = useCallback(async () => {
        if (!recvTransportRef.current || !deviceRef.current || !socketRef.current) return;

        socketRef.current.emit('consume-game-broadcast', {
            broadcastRoomId: broadcastRoomId,
            rtpCapabilities: deviceRef.current.rtpCapabilities
        }, async (response: any) => {
            if (response.error) {
                console.error('[spectator] consume-game-broadcast error:', response.error);
                return;
            }

            const { consumers } = response;
            console.log(`[spectator] Received ${consumers.length} player media consumers`);

            for (const { consumerId, producerId, playerId, kind, rtpParameters } of consumers) {
                try {
                    const consumer = await recvTransportRef.current?.consume({
                        id: consumerId,
                        producerId,
                        kind,
                        rtpParameters
                    });

                    if (consumer) {
                        attachPlayerMedia(playerId, kind, consumer.track);
                        console.log(`[spectator] Consuming player ${playerId} ${kind}`);
                    }
                } catch (e) {
                    console.error(`[spectator] Failed to consume player media:`, e);
                }
            }
        });
    }, [broadcastRoomId, attachPlayerMedia]);

    // Consume a single newly-piped player producer (when a player starts producing after spectator already joined)
    const consumeSinglePlayerMedia = useCallback(async (producerId: string, playerId: string, kind: string) => {
        if (!recvTransportRef.current || !deviceRef.current || !socketRef.current) return;

        // Re-use consume-game-broadcast which now handles everything via piped producers
        // But for a single new producer, we still call consume-game-broadcast which returns ALL
        // However, we may already have consumers for the other producers.
        // More efficient: request a single consume. Let's reuse the existing flow.
        socketRef.current.emit('consume-game-broadcast', {
            broadcastRoomId: broadcastRoomId,
            rtpCapabilities: deviceRef.current.rtpCapabilities
        }, async (response: any) => {
            if (response.error) {
                console.error('[spectator] consume-game-broadcast (single) error:', response.error);
                return;
            }

            const { consumers } = response;
            for (const { consumerId, producerId: pId, playerId: plId, kind: k, rtpParameters } of consumers) {
                try {
                    const consumer = await recvTransportRef.current?.consume({
                        id: consumerId,
                        producerId: pId,
                        kind: k,
                        rtpParameters
                    });

                    if (consumer) {
                        attachPlayerMedia(plId, k, consumer.track);
                        console.log(`[spectator] Consuming newly piped player ${plId} ${k}`);
                    }
                } catch (e) {
                    console.error(`[spectator] Failed to consume newly piped media:`, e);
                }
            }
        });
    }, [broadcastRoomId, attachPlayerMedia]);

    const joinBroadcastRoom = async () => {
        socketRef.current = io(`${BASE_URL}`, { autoConnect: true });

        socketRef.current.on('connect', () => {
            console.log('[spectator] Connected to server');

            socketRef.current?.emit('join-broadcast', {
                spectatorName: 'Spectator', // TODO: Get from user input
                broadcastRoomId: broadcastRoomId
            }, async (response: any) => {
                if (response.error) {
                    alert(response.error);
                    router.push(`/broadcast/${broadcastRoomId}`);
                    return;
                }

                console.log('[spectator] Joined broadcast room:', response);

                setGameMode(response.gameMode);
                setPlayers(response.players);
                setInitialFen(response.currentFEN);
                setSpectatorCount(response.spectatorCount);

                const currentSpectatorId = socketRef.current?.id;
                if (response.spectatorList) {
                    setSpectators(
                        response.spectatorList
                            .filter((spectator: any) => spectator.id !== currentSpectatorId)
                            .map((spectator: any) => ({ id: spectator.id, name: spectator.name }))
                    );
                }

                // Set player ID mapping from response
                if (response.players.length > 0) {
                    playerIdMapRef.current.player1Id = response.players[0]?.id || null;
                }
                if (response.players.length > 1) {
                    playerIdMapRef.current.player2Id = response.players[1]?.id || null;
                }

                // Load device
                await loadDevice(response.routerRtpCapabilities);

                // Create transports
                await createSendTransport();
                await createRecvTransport();

                // Start producing spectator media (viewer ↔ viewer)
                await startSpectatorMedia();

                // Consume existing spectator media (viewer ↔ viewer)
                if (response.spectatorProducers) {
                    for (const producer of response.spectatorProducers) {
                        await consumeSpectatorMedia(producer.id, producer.appData);
                    }
                }

                // TASK 4: Auto-consume piped player media (players' video+audio)
                // Small delay to ensure recv transport is fully ready
                setTimeout(() => {
                    consumeAllPlayerMedia();
                }, 500);
            });
        });

        // Chess move handler
        socketRef.current.on('moveMade', ({ from, to, fen }: { from: string; to: string; fen: string }) => {
            console.log('[spectator] Move received:', from, to, fen);
            setGame(new Chess(fen));
        });

        // Spectator events
        socketRef.current.on('spectator-joined', (data: { spectatorId: string; spectatorName: string; spectatorCount: number }) => {
            console.log('[spectator] New spectator joined:', data);
            setSpectatorCount(data.spectatorCount);
            setSpectators(prev => [...prev.filter(s => s.id !== data.spectatorId), {
                id: data.spectatorId,
                name: data.spectatorName
            }]);
        });

        socketRef.current.on('spectator-left', (data: { spectatorId: string; spectatorName: string; spectatorCount: number }) => {
            console.log('[spectator] Spectator left:', data);
            setSpectatorCount(data.spectatorCount);
            setSpectators(prev => prev.filter(s => s.id !== data.spectatorId));
        });

        socketRef.current.on('spectator-media-added', async (data: { producerId: string; spectatorId: string; spectatorName: string; kind: string; appData: AppData }) => {
            console.log('[spectator] New spectator media:', data);
            await consumeSpectatorMedia(data.producerId, data.appData);
        });

        // Listen for late-arriving player piped media (player starts cam/mic after spectator joined)
        socketRef.current.on('player-media-piped', async (data: { producerId: string; playerId: string; kind: string }) => {
            console.log('[spectator] New player media piped:', data);
            await consumeSinglePlayerMedia(data.producerId, data.playerId, data.kind);
        });
    };

    const loadDevice = async (routerRtpCapabilities: RtpCapabilities) => {
        try {
            deviceRef.current = new Device();
            await deviceRef.current.load({ routerRtpCapabilities });
            console.log('[spectator] Device loaded');
        } catch (error) {
            console.error('[spectator] Failed to load device:', error);
        }
    };

    const createSendTransport = async () => {
        if (!deviceRef.current) return;

        socketRef.current?.emit('create-transport-broadcast', {
            broadcastRoomId: broadcastRoomId,
            direction: 'send'
        }, async (response: any) => {
            if (response.error) {
                console.error('[spectator] Create send transport error:', response.error);
                return;
            }

            sendTransportRef.current = deviceRef.current?.createSendTransport({
                id: response.id,
                iceParameters: response.iceParameters,
                iceCandidates: response.iceCandidates,
                dtlsParameters: response.dtlsParameters
            }) ?? null;

            sendTransportRef.current?.on('connect', async ({ dtlsParameters }, callback) => {
                socketRef.current?.emit('connect-transport-broadcast', {
                    broadcastRoomId: broadcastRoomId,
                    transportId: sendTransportRef.current?.id,
                    dtlsParameters
                }, ({ connected }: any) => {
                    if (connected) {
                        callback();
                    }
                });
            });

            sendTransportRef.current?.on('produce', async ({ kind, rtpParameters, appData }, callback) => {
                socketRef.current?.emit('produce-broadcast', {
                    broadcastRoomId: broadcastRoomId,
                    transportId: sendTransportRef.current?.id,
                    kind,
                    rtpParameters,
                    appData
                }, (response: any) => {
                    if (response.error) {
                        console.error('[spectator] produce-broadcast error:', response.error);
                        return;
                    }
                    callback({ id: response.id });
                });
            });

            console.log('[spectator] Send transport created');
        });
    };

    const createRecvTransport = async () => {
        if (!deviceRef.current) return;

        socketRef.current?.emit('create-transport-broadcast', {
            broadcastRoomId: broadcastRoomId,
            direction: 'recv'
        }, async (response: any) => {
            if (response.error) {
                console.error('[spectator] Create recv transport error:', response.error);
                return;
            }

            recvTransportRef.current = deviceRef.current?.createRecvTransport({
                id: response.id,
                iceParameters: response.iceParameters,
                iceCandidates: response.iceCandidates,
                dtlsParameters: response.dtlsParameters
            }) ?? null;

            recvTransportRef.current?.on('connect', async ({ dtlsParameters }, callback) => {
                socketRef.current?.emit('connect-transport-broadcast', {
                    broadcastRoomId: broadcastRoomId,
                    transportId: recvTransportRef.current?.id,
                    dtlsParameters
                }, ({ connected }: any) => {
                    if (connected) {
                        callback();
                    }
                });
            });

            console.log('[spectator] Recv transport created');
        });
    };

    const startSpectatorMedia = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 },
                audio: { echoCancellation: true, noiseSuppression: true }
            });

            localStreamRef.current = stream;

            // Display self video (local only, no echo)
            if (selfVideoRef.current) {
                selfVideoRef.current.srcObject = stream;
                selfVideoRef.current.muted = true;
            }

            // Produce video via the send transport's 'produce' event handler
            if (sendTransportRef.current) {
                const videoTrack = stream.getVideoTracks()[0];
                await sendTransportRef.current.produce({
                    track: videoTrack,
                    appData: { mediaTag: 'video' }
                });
            }

            // Produce audio via the send transport's 'produce' event handler
            if (sendTransportRef.current) {
                const audioTrack = stream.getAudioTracks()[0];
                await sendTransportRef.current.produce({
                    track: audioTrack,
                    appData: { mediaTag: 'audio' }
                });
            }

            console.log('[spectator] Started producing media');
        } catch (error) {
            console.error('[spectator] Failed to start media:', error);
        }
    };

    const consumeSpectatorMedia = async (producerId: string, appData: AppData) => {
        if (!recvTransportRef.current) return;

        socketRef.current?.emit('consume-spectator-media', {
            broadcastRoomId: broadcastRoomId,
            producerId,
            rtpCapabilities: deviceRef.current?.rtpCapabilities
        }, async (response: any) => {
            if (response.error) {
                console.error('[spectator] Consume error:', response.error);
                return;
            }

            const consumer = await recvTransportRef.current?.consume({
                id: response.id,
                producerId: response.producerId,
                kind: response.kind,
                rtpParameters: response.rtpParameters
            });

            if (consumer) {
                const stream = new MediaStream([consumer.track]);

                // Find the spectator video element
                const spectatorId = appData.peerId as string;
                const videoElement = spectatorVideoRefs.current[spectatorId];

                if (videoElement && consumer.kind === 'video') {
                    videoElement.srcObject = stream;
                }

                if (consumer.kind === 'audio') {
                    const audio = document.createElement('audio');
                    audio.autoplay = true;
                    audio.srcObject = stream;
                    audio.play().catch(() => console.debug('[spectator] spectator audio play blocked'));
                    document.body.appendChild(audio);
                }

                // Resume consumer
                socketRef.current?.emit('resume-consumer-broadcast', {
                    broadcastRoomId: broadcastRoomId,
                    consumerId: consumer.id
                });
            }
        });
    };

    // Memoized Video Component
    const VideoSection = memo(({ videoRef, muted = false, label }: any) => {
        return (
            <div className="relative">
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted={muted}
                    className="w-full border rounded-md"
                    style={{ aspectRatio: 16 / 9 }}
                />
                {label && (
                    <div className="absolute bottom-1 left-1 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
                        {label}
                    </div>
                )}
            </div>
        );
    });

    return (
        <div className="w-screen h-screen bg-white flex">
            {/* Game View (Left - 75%) */}
            <div className="flex-1 flex flex-col p-4">
                {/* Header */}
                <div className="flex justify-between items-center mb-4">
                    <h1 className="text-2xl font-bold">Spectating Chess Game</h1>
                    <div className="text-sm text-gray-600">
                        Mode: {gameMode} | Spectators: {spectatorCount}/10
                    </div>
                </div>

                {/* Game Area */}
                <div className="flex-1 flex gap-4">
                    {/* Player Videos + Chess Board */}
                    <div className="flex-1 flex flex-col gap-4">
                        {/* Player 1 Video */}
                        <div className="flex-1">
                            <VideoSection
                                videoRef={player1VideoRef}
                                label={players[0]?.name || "Player 1"}
                            />
                        </div>

                        {/* Chess Board */}
                        <div className="flex-1 flex items-center justify-center">
                            <ChessManager
                                game={game}
                                setGame={setGame}
                                initialFen={initialFen}
                                playerColor={null} // Spectator - no color
                                isSpectator={true}
                            />
                        </div>

                        {/* Player 2 Video */}
                        <div className="flex-1">
                            <VideoSection
                                videoRef={player2VideoRef}
                                label={players[1]?.name || "Player 2"}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Spectator Panel (Right - 25%) */}
            <div className="w-80 bg-gray-50 border-l p-4 flex flex-col">
                <h2 className="text-lg font-semibold mb-4">Spectators</h2>

                {/* Self Video */}
                <div className="mb-4">
                    <div className="text-sm text-gray-600 mb-2">You</div>
                    <VideoSection
                        videoRef={selfVideoRef}
                        muted={true}
                        label="You (muted)"
                    />
                </div>

                {/* Other Spectators */}
                <div className="flex-1 overflow-y-auto">
                    <div className="grid grid-cols-1 gap-3">
                        {spectators.map((spectator) => (
                            <div key={spectator.id}>
                                <div className="text-sm text-gray-600 mb-1">{spectator.name}</div>
                                <VideoSection
                                    videoRef={(el: HTMLVideoElement | null) => {
                                        if (el) spectatorVideoRefs.current[spectator.id] = el;
                                    }}
                                    label={spectator.name}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Controls */}
                <div className="mt-4 space-y-2">
                    <button
                        onClick={() => {
                            if (localStreamRef.current) {
                                const audioTrack = localStreamRef.current.getAudioTracks()[0];
                                if (audioTrack) {
                                    audioTrack.enabled = !audioTrack.enabled;
                                }
                            }
                        }}
                        className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600"
                    >
                        Toggle Microphone
                    </button>

                    <button
                        onClick={() => router.push('/')}
                        className="w-full bg-gray-500 text-white py-2 rounded hover:bg-gray-600"
                    >
                        Leave Spectating
                    </button>
                </div>
            </div>
        </div>
    );
}