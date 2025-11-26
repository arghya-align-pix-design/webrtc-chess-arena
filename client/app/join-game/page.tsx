'use client'
import { useRouter } from "next/navigation"
import { useRef } from "react";
import axios from 'axios';
import { useInfoHook } from "@/store/info";

export default function JoinGame(){
    
    const router=useRouter();
    const roomIdRef=useRef<HTMLInputElement>(null);
    const nameRef=useRef<HTMLInputElement>(null);
    const {name,setName}=useInfoHook();

    async function join(){
        if(!roomIdRef.current?.value || !nameRef.current?.value){
            alert('Fill all the filds.');
            return;
        }   
        setName(nameRef.current.value);

        await axios.post('http://localhost:8080/join',{
            roomId : roomIdRef.current.value, 
        }).then((res)=>{
            const roomName=res.data.roomName;
            const roomId=roomIdRef.current?.value;
            router.push(`/room/${roomName}/${roomId}`);
        }).catch((e)=>{
            alert('Error while Joining room.')
            return;
        })
    }

    return <div className="w-screen h-screen flex flex-col items-center justify-center bg-white">
        <div className="flex flex-col bg-white border border-zinc-800 rounded-lg items-center py-5 px-3 gap-5 w-[400px] h-auto">
            <div className="flex justify-around w-full items-center">
                <p className="text-[28px] tracking-tight">Join a Game</p>
                <div className="text-[14px] text-black tracking-tight cursor-pointer hover:underline" onClick={()=>router.push('/')}>{'Home ->'}</div>    
            </div>
            <div className="flex flex-col gap-3 items-center">
                <input ref={roomIdRef} type="text" placeholder="Enter roomID" className="w-full px-3 py-1 text-[16px] tracking-tight bg-white focus:outline-0 text-zinc-800 border border-zinc-800 placeholder:text-zinc-700 rounded-md"/>
                <input ref={nameRef} type="text" placeholder="Enter Your Name" className="w-full px-3 py-1 text-[16px] tracking-tight bg-white focus:outline-0 text-zinc-800 border border-zinc-800 placeholder:text-zinc-700 rounded-md"/>
            </div>
            <div className="flex w-full justify-around items-center ">
                <div onClick={()=>router.push('/create-game')} className="hover:underline text-[14px] hover:text-blue-500 text-zinc-800 cursor-pointer tracking-tight">Want to create a room?</div>
                <div onClick={join} className="bg-white px-7 py-1 rounded-md text-zinc-800 cursor-pointer text-[16px] border border-zinc-800 hover:bg-zinc-200">Join</div>
            </div>
        </div>
    </div>
}