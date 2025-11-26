'use client'
import { useRouter } from "next/navigation";

export default function Home() {
  
  const router=useRouter();

  return (
    <div className="w-screen h-screen flex flex-col items-center justify-center bg-white gap-3">
      <div className="flex flex-col items-center leading-12">
        <p className="text-[75px] tracking-tight">Welcome to Chess World!</p>
        <p>Play live with built-in video calling and enjoy the most authentic online chess experience.</p>
      </div>
      <div className="flex gap-10">
        <div onClick={()=>router.push('/create-game')} className="px-5 py-1.5 border border-zinc-800 rounded-md cursor-pointer bg-white text-zinc-800 hover:bg-zinc-200 text-[16px]">Create Game</div>
        <div onClick={()=>router.push('/join-game')} className="px-7 py-1.5 border border-zinc-800 rounded-md cursor-pointer bg-zinc-800 text-white hover:bg-zinc-700 text-[16px]">Join Game</div>
      </div>
    </div>
  );
}
 