'use client'
import { useEffect, memo, useRef, useState, useCallback } from "react"
import { io, Socket } from "socket.io-client"
import { useRouter } from "next/navigation"
import { Device } from "mediasoup-client"
import ChessManager from "../../compos/ChessManager"
import { Chess } from "chess.js";
import { types as mediasoupTypes } from "mediasoup-client"
import React from "react"

const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8080" //"https://65.1.130.45.sslip.io"; // process.env.NEXT_PUBLIC_BACKEND_URL ||

type AppData = mediasoupTypes.AppData;
type Producer = mediasoupTypes.Producer;
type RtpCapabilities = mediasoupTypes.RtpCapabilities;
type RtpParameters = mediasoupTypes.RtpParameters;
type Transport = mediasoupTypes.Transport;

// Bug 3 fix: VideoSection moved OUTSIDE the component function so React treats it 
// as a stable component type, allowing memo() to actually prevent re-renders.
// When defined inside the component, React creates a new type on every render,
// so memo() can never memoize — the video element gets destroyed and recreated,
// losing its srcObject binding.
const VideoSection = memo(({ videoRef, muted = false, label }: any) => {
    return (
        <div className="relative">
            <video
                ref={videoRef}
                autoPlay
                playsInline
                muted={muted}
                className="w-full border rounded-md"
                style={{ aspectRatio: 16 / 11 }}
            />
            {label && (
                <div className="absolute bottom-1 left-1 bg-black bg-opacity-50 text-white text-xs px-2 py-1 rounded">
                    {label}
                </div>
            )}
        </div>
    );
});
VideoSection.displayName = 'VideoSection';

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

    // Track consumed producer IDs to avoid double-consuming
    const consumedPipedProducerIdsRef = useRef<Set<string>>(new Set());

    // Track dynamically created audio elements for cleanup
    const audioElementsRef = useRef<HTMLAudioElement[]>([]);

    useEffect(() => {
        broadcastRoomIdRef.current = broadcastRoomId;
        joinBroadcastRoom();
        return () => {
            // Stop local media tracks
            if (localStreamRef.current) {
                localStreamRef.current.getTracks().forEach(track => track.stop());
                localStreamRef.current = null;
            }
            // Close transports
            if (sendTransportRef.current) {
                sendTransportRef.current.close();
                sendTransportRef.current = null;
            }
            if (recvTransportRef.current) {
                recvTransportRef.current.close();
                recvTransportRef.current = null;
            }
            // Clean up audio elements
            audioElementsRef.current.forEach(el => {
                el.srcObject = null;
                el.remove();
            });
            audioElementsRef.current = [];
            // Disconnect socket
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
            audioElementsRef.current.push(audio);
        }
    }, []);

    // Bug 2 fix: Consume all piped player producers AND resume them
    const consumeAllPlayerMedia = useCallback(async () => {
        if (!recvTransportRef.current || !deviceRef.current || !socketRef.current) return;

        const response: any = await socketRef.current.emitWithAck('consume-game-broadcast', {
            broadcastRoomId: broadcastRoomId,
            rtpCapabilities: deviceRef.current.rtpCapabilities
        });

        if (response.error) {
            console.error('[spectator] consume-game-broadcast error:', response.error);
            return;
        }

        const { consumers } = response;
        console.log(`[spectator] Received ${consumers.length} player media consumers`);

        for (const { consumerId, producerId, playerId, kind, rtpParameters } of consumers) {
            // Skip already-consumed producers
            if (consumedPipedProducerIdsRef.current.has(producerId)) {
                console.log(`[spectator] Already consuming producer ${producerId}, skipping`);
                continue;
            }

            try {
                const consumer = await recvTransportRef.current?.consume({
                    id: consumerId,
                    producerId,
                    kind,
                    rtpParameters
                });

                if (consumer) {
                    attachPlayerMedia(playerId, kind, consumer.track);
                    consumedPipedProducerIdsRef.current.add(producerId);

                    // Bug 2 fix: RESUME the consumer! Without this, the consumer stays paused
                    // and no media flows to the spectator. This was the primary cause of
                    // "player video not visible in broadcast room".
                    socketRef.current?.emit('resume-consumer-broadcast', {
                        broadcastRoomId: broadcastRoomId,
                        consumerId: consumer.id
                    });

                    console.log(`[spectator] Consuming + resumed player ${playerId} ${kind}`);
                }
            } catch (e) {
                console.error(`[spectator] Failed to consume player media:`, e);
            }
        }
    }, [broadcastRoomId, attachPlayerMedia]);

    // Consume a single newly-piped player producer
    const consumeSinglePlayerMedia = useCallback(async (producerId: string, playerId: string, kind: string) => {
        if (!recvTransportRef.current || !deviceRef.current || !socketRef.current) return;

        // Skip if already consumed
        if (consumedPipedProducerIdsRef.current.has(producerId)) {
            console.log(`[spectator] Already consuming producer ${producerId}, skipping`);
            return;
        }

        // Re-use consume-game-broadcast to consume all available (it will skip already-consumed ones)
        await consumeAllPlayerMedia();
    }, [consumeAllPlayerMedia]);

    const joinBroadcastRoom = async () => {
        socketRef.current = io(`${BASE_URL}`, { autoConnect: true });

        socketRef.current.on('connect', async () => {
            console.log('[spectator] Connected to server');

            // Bug 4 fix: Use emitWithAck (Promise-based) for join-broadcast
            const response: any = await socketRef.current!.emitWithAck('join-broadcast', {
                spectatorName: 'Spectator', // TODO: Get from user input
                broadcastRoomId: broadcastRoomId
            });

            if (response.error) {
                alert(response.error);
                router.push(`/broadcast/${broadcastRoomId}`);
                return;
            }

            console.log('[spectator] Joined broadcast room:', response);

            setGameMode(response.gameMode);
            setPlayers(response.players);
            setInitialFen(response.currentFEN);
            setGame(new Chess(response.currentFEN));
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

            // Bug 4 fix: Create transports using emitWithAck (Promise-based)
            // so `await` actually waits for transport to be ready
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

            // Bug 2 fix: consume piped player media AND resume them
            // Small delay to ensure recv transport is fully ready
            setTimeout(() => {
                consumeAllPlayerMedia();
            }, 500);
        });

        // Chess move handler — only updates game state, does NOT touch video refs (Bug 3)
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

    // Bug 4 fix: Convert from callback-based to Promise-based (emitWithAck)
    // so `await createSendTransport()` actually waits for the transport to exist
    // before we try to produce on it.
    const createSendTransport = async () => {
        if (!deviceRef.current || !socketRef.current) return;

        const response: any = await socketRef.current.emitWithAck('create-transport-broadcast', {
            broadcastRoomId: broadcastRoomId,
            direction: 'send'
        });

        if (response.error) {
            console.error('[spectator] Create send transport error:', response.error);
            return;
        }

        sendTransportRef.current = deviceRef.current.createSendTransport({
            id: response.id,
            iceParameters: response.iceParameters,
            iceCandidates: response.iceCandidates,
            dtlsParameters: response.dtlsParameters
        });

        sendTransportRef.current.on('connect', async ({ dtlsParameters }, callback) => {
            try {
                await socketRef.current!.emitWithAck('connect-transport-broadcast', {
                    broadcastRoomId: broadcastRoomId,
                    transportId: sendTransportRef.current?.id,
                    dtlsParameters
                });
                callback();
            } catch (e) {
                console.error('[spectator] connect send transport error:', e);
            }
        });

        sendTransportRef.current.on('produce', async ({ kind, rtpParameters, appData }, callback) => {
            try {
                const response: any = await socketRef.current!.emitWithAck('produce-broadcast', {
                    broadcastRoomId: broadcastRoomId,
                    transportId: sendTransportRef.current?.id,
                    kind,
                    rtpParameters,
                    appData
                });
                if (response.error) {
                    console.error('[spectator] produce-broadcast error:', response.error);
                    return;
                }
                callback({ id: response.id });
            } catch (e) {
                console.error('[spectator] produce error:', e);
            }
        });

        console.log('[spectator] Send transport created');
    };

    // Bug 4 fix: Convert from callback-based to Promise-based (emitWithAck)
    const createRecvTransport = async () => {
        if (!deviceRef.current || !socketRef.current) return;

        const response: any = await socketRef.current.emitWithAck('create-transport-broadcast', {
            broadcastRoomId: broadcastRoomId,
            direction: 'recv'
        });

        if (response.error) {
            console.error('[spectator] Create recv transport error:', response.error);
            return;
        }

        recvTransportRef.current = deviceRef.current.createRecvTransport({
            id: response.id,
            iceParameters: response.iceParameters,
            iceCandidates: response.iceCandidates,
            dtlsParameters: response.dtlsParameters
        });

        recvTransportRef.current.on('connect', async ({ dtlsParameters }, callback) => {
            try {
                await socketRef.current!.emitWithAck('connect-transport-broadcast', {
                    broadcastRoomId: broadcastRoomId,
                    transportId: recvTransportRef.current?.id,
                    dtlsParameters
                });
                callback();
            } catch (e) {
                console.error('[spectator] connect recv transport error:', e);
            }
        });

        console.log('[spectator] Recv transport created');
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
        if (!recvTransportRef.current || !socketRef.current) return;

        const response: any = await socketRef.current.emitWithAck('consume-spectator-media', {
            broadcastRoomId: broadcastRoomId,
            producerId,
            rtpCapabilities: deviceRef.current?.rtpCapabilities
        });

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
                audioElementsRef.current.push(audio);
            }

            // Resume consumer
            socketRef.current?.emit('resume-consumer-broadcast', {
                broadcastRoomId: broadcastRoomId,
                consumerId: consumer.id
            });
        }
    };

    // Bug 2 fix: Spectator room UI now mirrors the game room layout exactly
    // Left: Player 1 video, Center: Chess board, Right: Player 2 video
    // Spectator panel is a floating overlay at bottom-right
    return (
        <>
            {/* OVERLAY FOR PORTRAIT SCREENS */}
            <div className="fixed inset-0 z-[100] hidden portrait:flex flex-col items-center justify-center bg-zinc-950 text-white p-6">
                <div className="text-7xl mb-6 animate-pulse">📱🔄</div>
                <h2 className="text-3xl font-extrabold text-center mb-4 tracking-tight">Rotate Your Device</h2>
                <p className="text-center text-zinc-400 text-lg max-w-sm">
                    This game is best played in <strong>Landscape Mode</strong>! Please turn your phone sideways to continue playing.
                </p>
            </div>

            <div className="flex p-4 md:p-10 w-screen h-screen items-center justify-between bg-zinc-950 relative">
                {/* LEFT VIDEO — Player 1 */}
                <div className="w-1/5 h-full flex flex-col justify-start">
                    <VideoSection
                        videoRef={player1VideoRef}
                        label={players[0]?.name || "Player 1"}
                    />
                </div>

                {/* CENTER — Chess Board */}
                <div className="w-3/5 h-full flex flex-col items-center justify-center">
                    <div className="h-full border rounded-md flex items-center justify-center" style={{ aspectRatio: 1 }}>
                        <ChessManager
                            game={game}
                            setGame={setGame}
                            initialFen={initialFen}
                            playerColor={null}
                            isSpectator={true}
                        />
                    </div>
                </div>

                {/* RIGHT VIDEO — Player 2 */}
                <div className="w-1/5 h-full flex flex-col justify-end">
                    <VideoSection
                        videoRef={player2VideoRef}
                        label={players[1]?.name || "Player 2"}
                    />
                </div>

                {/* Spectator Info Overlay — Bottom Right */}
                <div className="absolute bottom-4 right-4 bg-zinc-900/80 backdrop-blur-sm rounded-lg p-3 text-white text-sm max-w-[240px] border border-zinc-700">
                    <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-zinc-300">
                            👁️ {gameMode === 'CHALLENGE' ? 'Challenge' : 'Friendly'} Mode
                        </span>
                        <span className="text-zinc-400 text-xs">{spectatorCount}/10</span>
                    </div>

                    {/* Self Video (small) */}
                    <div className="mb-2">
                        <video
                            ref={selfVideoRef}
                            autoPlay
                            playsInline
                            muted={true}
                            className="w-full rounded border border-zinc-600"
                            style={{ aspectRatio: 16 / 9 }}
                        />
                        <div className="text-xs text-zinc-400 mt-1">You (muted)</div>
                    </div>

                    {/* Other Spectators (small grid) */}
                    {spectators.length > 0 && (
                        <div className="grid grid-cols-2 gap-1 mb-2">
                            {spectators.map((spectator) => (
                                <div key={spectator.id}>
                                    <video
                                        ref={(el: HTMLVideoElement | null) => {
                                            if (el) spectatorVideoRefs.current[spectator.id] = el;
                                        }}
                                        autoPlay
                                        playsInline
                                        className="w-full rounded border border-zinc-700"
                                        style={{ aspectRatio: 16 / 9 }}
                                    />
                                    <div className="text-[10px] text-zinc-500 truncate">{spectator.name}</div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Controls */}
                    <div className="flex gap-2">
                        <button
                            onClick={() => {
                                if (localStreamRef.current) {
                                    const audioTrack = localStreamRef.current.getAudioTracks()[0];
                                    if (audioTrack) {
                                        audioTrack.enabled = !audioTrack.enabled;
                                    }
                                }
                            }}
                            className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white text-xs py-1.5 rounded"
                        >
                            🎤 Mic
                        </button>
                        <button
                            onClick={() => router.push('/')}
                            className="flex-1 bg-zinc-700 hover:bg-zinc-600 text-white text-xs py-1.5 rounded"
                        >
                            Leave
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}