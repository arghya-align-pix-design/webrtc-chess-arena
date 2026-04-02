'use client'
import { useEffect,useState, useCallback,useRef } from "react";
import { Chess, Move, Square } from "chess.js";
import ChessBoard from "./chessBoard";
import { Socket } from "socket.io-client";

type MoveData = {
    from: Square;
    to: Square;
    fen: string;
};

type ChessManagerProps = {
    // game: Chess;
    // setGame: (game: Chess) => void;
    playerColor: "white" | "black";
    socket: Socket;
    roomId: string | null;
    initialFen?: string;
};

const ChessManager = ({ 
    //game, setGame, 
    playerColor, socket, roomId, initialFen }: ChessManagerProps) => {
    const [warning, setWarning] = useState("");
    //const gameRef = useRef(new Chess()); // ✅ stable instance
    const [game,setGame]=useState(new Chess(initialFen));
    //const [fen, setFen] = useState(gameRef.current.fen());

    useEffect(() => {
        if (initialFen) {
            setGame(new Chess(initialFen));
        }
    }, [initialFen]);

    const handleOpponentMove = useCallback(({ from, to, fen }: MoveData) => {
        console.log(`Move received: ${from} -> ${to}`);
        const gameCopy = new Chess(fen);
        setGame(gameCopy);
        //setFen(fen);

        if (gameCopy.isCheckmate()) {
            const winner = playerColor === "white" ? "Black" : "White";
            alert(`♟️ Checkmate! ${winner} wins!`);
        } else if (gameCopy.isDraw()) {
            alert("🤝 It's a draw!");
        } else if (gameCopy.isStalemate()) {
            alert("😐 Stalemate!");
        }
    },[playerColor, setGame]) //
    
    useEffect(()=>{
        
        // Listen for opponent's move
        socket.on("moveMade", handleOpponentMove);
        return () => {
            socket.off("moveMade", handleOpponentMove); // clean up
        };
    
    },[socket, handleOpponentMove]) //setGame,


    const handleMove = (move: { from: Square; to: Square }): boolean => {
        //const game = gameRef.current;// jst added
        
        const turn = game.turn(); // 'w' or 'b'
        const isPlayerTurn =
            (playerColor === "white" && turn === "w") ||
            (playerColor === "black" && turn === "b");

        if (!isPlayerTurn) {
            console.log("Not your turn");
            setWarning("⛔ Not your turn!");
            setTimeout(() => setWarning(""), 2000);
            return false;
            //return false;
        }

        const gameCopy = new Chess(game.fen());
        try{
            const result: Move | null = gameCopy.move({
            //const result: Move | null = game.move({
                from: move.from,
                to: move.to,
                promotion: "q", // always promote to queen to avoid invalid move exceptions
            });

        if (result) {
            setGame(new Chess(gameCopy.fen())); // Update board optimally with new reference

            //const newFen = game.fen();
            //setFen(newFen);

            // Emit move to the opponent (include roomId so backend can relay correctly)
            socket.emit("moveMade", { 
                roomId, 
                from: move.from, 
                to: move.to,
               // fen: newFen,
                fen: gameCopy.fen()
            });

             // Check for game over conditions
            if (
                //newFen.isCheckmate()
                gameCopy.isCheckmate()
            ) {
                const winner = playerColor === "white" ? "White" : "Black";
                alert(`♟️ Checkmate! ${winner} wins!`);
            } else if (gameCopy.isDraw()) {
                alert("🤝 It's a draw!");
            } else if (gameCopy.isStalemate()) {
                alert("😐 Stalemate!");
            }
            return true; // Move is valid
        }
        else {
            setWarning("🚫 Invalid move!");
            setTimeout(() => setWarning(""), 2000);
            return false;
        }
        }catch(err){
            console.warn("Caught invalid move:", err);
            setWarning("🚫 Illegal move!");
            setTimeout(() => setWarning(""), 2000);
            return false;
        }
       
        //return false; // Invalid move
    };
    return(
        <div>
            {warning && <p style={{ color: "red", fontWeight: "bold" }}>{warning}</p>}
            <ChessBoard position={
                game.fen()
                //fen
                } onMove={handleMove} playerColor={playerColor} />;
        </div>
    )
};

export default ChessManager;
