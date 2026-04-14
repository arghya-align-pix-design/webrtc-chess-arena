import { Consumer, Producer, Transport } from "mediasoup/types";

export enum PeerRole {
    PLAYER = 'PLAYER',
    SPECTATOR = 'SPECTATOR'
}

export class Peer{
    public name : string;
    public socketId : string;
    public role: PeerRole;
    public upTransport : Transport | null;
    public downTransport : Transport | null;
    public camProducer : Producer | null;
    public micProducer : Producer | null; 
    public consumers : Consumer[];

    constructor(name : string, socketId : string, role: PeerRole = PeerRole.PLAYER){
        this.name = name,
        this.socketId = socketId,
        this.role = role,
        this.upTransport=null,
        this.downTransport=null,
        this.camProducer=null,
        this.micProducer=null,
        this.consumers=[]
    } 
}