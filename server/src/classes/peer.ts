import { Consumer, Producer, Transport } from "mediasoup/types";

export class Peer{
    public name : string;
    public socketId : string;
    public upTransport : Transport | null;
    public downTransport : Transport | null;
    public camProducer : Producer | null;
    public micProducer : Producer | null; 
    public consumers : Consumer[];

    constructor(name : string, socketId : string){
        this.name = name,
        this.socketId = socketId, 
        this.upTransport=null,
        this.downTransport=null,
        this.camProducer=null,
        this.micProducer=null,
        this.consumers=[]
    } 
}