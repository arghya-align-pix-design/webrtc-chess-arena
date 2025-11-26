import { Producer, Router, AppData } from "mediasoup/types";
import { Peer } from "./peer";

export class Room{
    public name : string;
    public id : string;
    public peers : Peer[];
    public router : Router | null;
    public producers : Producer[];

    constructor(roomName : string, roomId : string, router : Router){
        this.name = roomName,
        this.id = roomId,
        this.peers=[],
        this.router=router,
        this.producers=[]
    }
    
    join(peer : Peer){
        this.peers.push(peer);
    }

    leave(peer : Peer){
        this.peers=this.peers.filter((p : Peer)=>p.socketId!=peer.socketId);
    }

    getProducers(){
        const producersInfo : {id : string, kind : 'video' | 'audio', appData : AppData }[]= [];
        this.peers.forEach(peer => {
            let producer = peer.camProducer;
            if (producer) {
                producersInfo.push({
                    id: producer.id,
                    kind: producer.kind,
                    appData: producer.appData
                });
            }
            producer=peer.micProducer;
            if (producer) {
                producersInfo.push({
                    id: producer.id,
                    kind: producer.kind,
                    appData: producer.appData
                });
            }
        });
        console.log('[Room Class]-----Producers Info-----', producersInfo);
        return producersInfo;
    }

}