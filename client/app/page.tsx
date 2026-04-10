'use client'
import { useRouter } from "next/navigation";

export default function Home() {
  
  const router=useRouter();

  return (
    <div className="bg-[url(/ChessBG.webp)] bg-contain bg-no-repeat bg-center w-screen h-screen flex flex-col items-center justify-center bg-white gap-3">
      <div className="px-4 py-6 bg-white/10 backdrop-blur-lg  flex flex-col justify-center align-center width-full height-[600px] rounded-2xl text-white" >
      <div className="flex flex-col items-center leading-12">
        <p className="text-[40px] md:text-[70px] tracking-tight">Welcome to Chess World!</p>
        <p>Play live with built-in video calling and enjoy the most authentic online chess experience.</p>
      </div>
      <div className="flex gap-10 align-center justify-center ">
        {/* <div onClick={()=>router.push('/create-game')} className="px-5 py-1.5 border border-white blur-sm opacity-20 rounded-md cursor-pointer bg-white   hover:bg-zinc-200 text-[16px]">
          <button className="glass-btn text-black">
            Create Game
          </button>
        </div> */}
        <button className="px-6 py-3 rounded-xl 
        bg-white/10 backdrop-blur-md
        border border-white/20 
        text-white font-semibold tracking-wide
        shadow-lg
        transition-all duration-300
        hover:bg-white/20 hover:scale-105 hover:shadow-xl">
          Create Game
        </button>
        <button className="px-7 py-3 rounded-xl bg-white/10 backdrop-blur-md 
        border border-white/20 
        text-white font-semibold tracking-wide
        shadow-lg
        transition-all duration-300
        hover:bg-white/20 hover:scale-105 hover:shadow-xl" >
          Join Game
        </button>
        {/* <div onClick={()=>router.push('/join-game')} className="px-7 py-1.5 border border-zinc-800 rounded-md cursor-pointer bg-zinc-800 text-white hover:bg-zinc-700 text-[16px]">
          <div className="blur-sm opacity-25 text-black" > 
            Join Game
          </div>
        </div> */}
      </div>
      </div>
    </div>
  );
}
 