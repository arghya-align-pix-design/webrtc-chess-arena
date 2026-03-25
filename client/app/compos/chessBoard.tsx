'use client';
import { Chessboard } from "react-chessboard";
import { Chess,Square } from "chess.js";

type ChessBoardProps = {
    position: string; // FEN string to represent the board state
    onMove: (move: { from: Square; to: Square }) => boolean; // Function handling piece movement
    playerColor: "white" | "black"; // Player's color
};

const ChessBoard = ({ position, onMove, playerColor }:ChessBoardProps) => {
    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            {/* <h2>You are playing as {playerColor}</h2> */}
            <Chessboard 
                options={{
                    position:position,
                    onPieceDrop: ({sourceSquare , targetSquare}) =>{
                        if (!targetSquare) return false;
                        return  onMove({
                            from: sourceSquare as Square,
                            to: targetSquare as Square
                        });
                    },
                    boardOrientation:playerColor, // Ensures correct perspective
                    //boardWidth:500,
                    canDragPiece:({
                        //piece
                        square
                    }) => {
                         const chess = new Chess(position);
                        const piece = chess.get(square as Square);
                        if(!piece)return false;
                        const pieceColor = piece.color === "w" ? "white" : "black";
                        return pieceColor === playerColor;
                    }
                }}
                
                // Disallow piece dragging unless it's your color's turn
                // // 👈 Adjust this to your desired size (e.g., 600 for large screens)
                
                />
        </div>
    );
};

export default ChessBoard;
