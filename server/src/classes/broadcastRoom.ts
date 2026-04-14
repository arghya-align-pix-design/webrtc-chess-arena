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
    public pipedPlayer1VideoProducerId: string;
    public pipedPlayer1AudioProducerId: string;
    public pipedPlayer2VideoProducerId: string;
    public pipedPlayer2AudioProducerId: string;

    // For FRIENDLY mode: aggregated spectator audio
    public spectatorAggregatedAudioProducerId: string;

    constructor(gameRoomId: string, broadcastRoomId: string, router: Router, gameMode: GameMode) {
        this.roomId = gameRoomId;
        this.broadcastRoomId = broadcastRoomId;
        this.gameRoomId = gameRoomId;
        this.gameMode = gameMode;
        this.spectators = [];
        this.router = router;
        this.pipedPlayer1VideoProducerId = '';
        this.pipedPlayer1AudioProducerId = '';
        this.pipedPlayer2VideoProducerId = '';
        this.pipedPlayer2AudioProducerId = '';
        this.spectatorAggregatedAudioProducerId = '';
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