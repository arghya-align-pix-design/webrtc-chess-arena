import {create} from 'zustand';

interface info{
    name : string,
    setName : (name : string)=> void
}

export const useInfoHook=create<info>(set=>({
    name : "",
    setName : (val : string)=>set({name : val})
}))