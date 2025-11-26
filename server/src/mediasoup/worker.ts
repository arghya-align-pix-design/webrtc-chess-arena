import * as mediasoup from 'mediasoup';

export async function CreateWorker(){
    const worker=await mediasoup.createWorker({
        rtcMinPort : 40000,
        rtcMaxPort : 40499
    })
    console.log('[worker] Worker PId : ',worker.pid);
    worker.on('died',error=>{
        console.log('[worker] mediasoup worker has died')
        setTimeout(()=>process.exit(1),2000);
    })
    return worker;
}