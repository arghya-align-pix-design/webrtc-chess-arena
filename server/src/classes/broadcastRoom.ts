import { Router, Producer } from "mediasoup/types";
import { Peer, PeerRole } from "./peer";
import { GameMode } from "./room";

export class BroadcastRoom {
    public roomId: string;
    public broadcastRoomId: string;
    public gameRoomId: string;
    public gameMode: GameMode;
    public maxSpectators: number = 10;
    public spectators: Peer[];
    public router: Router | null;

    // Piped producers from game room
    // key = player socketId, value = array of their piped producers (audio + video)
    public pipedProducers: Map<string, Producer[]> = new Map();

    constructor(gameRoomId: string, broadcastRoomId: string, router: Router, gameMode: GameMode) {
        this.roomId = gameRoomId;
        this.broadcastRoomId = broadcastRoomId;
        this.gameRoomId = gameRoomId;
        this.gameMode = gameMode;
        this.spectators = [];
        this.router = router;
    }

    public join(spectator: Peer): boolean {
        if (this.spectators.length >= this.maxSpectators) return false;
        if (spectator.role !== PeerRole.SPECTATOR) return false;
        this.spectators.push(spectator);
        return true;
    }

    public leave(spectator: Peer): void {
        this.spectators = this.spectators.filter(
            s => s.socketId !== spectator.socketId
        );
    }

    public getSpectatorCount(): number {
        return this.spectators.length;
    }

    public isFull(): boolean {
        return this.spectators.length >= this.maxSpectators;
    }

    // --- Piped producer helpers (cross-router from Game → Broadcast) ---

    public addPipedProducer(producer: Producer, playerSocketId: string): void {
        const existing = this.pipedProducers.get(playerSocketId) || [];
        existing.push(producer);
        this.pipedProducers.set(playerSocketId, existing);
    }

    public removePipedProducers(playerSocketId: string): void {
        const producers = this.pipedProducers.get(playerSocketId) || [];
        producers.forEach(p => p.close());
        this.pipedProducers.delete(playerSocketId);
    }

    public getAllPipedProducers(): { producerId: string; playerId: string; kind: 'video' | 'audio' }[] {
        const result: { producerId: string; playerId: string; kind: 'video' | 'audio' }[] = [];
        for (const [playerId, producers] of this.pipedProducers) {
            for (const p of producers) {
                result.push({ producerId: p.id, playerId, kind: p.kind as 'video' | 'audio' });
            }
        }
        return result;
    }

    public clearAllPipedProducers(): void {
        for (const [, producers] of this.pipedProducers) {
            producers.forEach(p => p.close());
        }
        this.pipedProducers.clear();
    }

    // --- Spectator producer helpers (viewer ↔ viewer media within Broadcast Router) ---

    public getSpectatorProducers(): {id: string, kind: 'video' | 'audio', appData: any}[] {
        const producersInfo: {id: string, kind: 'video' | 'audio', appData: any}[] = [];
        this.spectators.forEach(spectator => {
            let producer = spectator.camProducer;
            if (producer) {
                producersInfo.push({
                    id: producer.id,
                    kind: producer.kind,
                    appData: { ...producer.appData, peerId: spectator.socketId, peerName: spectator.name }
                });
            }
            producer = spectator.micProducer;
            if (producer) {
                producersInfo.push({
                    id: producer.id,
                    kind: producer.kind,
                    appData: { ...producer.appData, peerId: spectator.socketId, peerName: spectator.name }
                });
            }
        });
        return producersInfo;
    }
}