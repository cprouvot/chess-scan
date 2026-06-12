import React, { useState, useEffect } from 'react';

// URL de base pour les pièces Lichess Cburnett
const PIECE_IMAGES = {
  'P': 'https://lichess1.org/assets/piece/cburnett/wP.svg',
  'N': 'https://lichess1.org/assets/piece/cburnett/wN.svg',
  'B': 'https://lichess1.org/assets/piece/cburnett/wB.svg',
  'R': 'https://lichess1.org/assets/piece/cburnett/wR.svg',
  'Q': 'https://lichess1.org/assets/piece/cburnett/wQ.svg',
  'K': 'https://lichess1.org/assets/piece/cburnett/wK.svg',
  'p': 'https://lichess1.org/assets/piece/cburnett/bP.svg',
  'n': 'https://lichess1.org/assets/piece/cburnett/bN.svg',
  'b': 'https://lichess1.org/assets/piece/cburnett/bB.svg',
  'r': 'https://lichess1.org/assets/piece/cburnett/bR.svg',
  'q': 'https://lichess1.org/assets/piece/cburnett/bQ.svg',
  'k': 'https://lichess1.org/assets/piece/cburnett/bK.svg',
};

const PIECES_LIST = [
  { code: 'P', name: 'wP' }, { code: 'N', name: 'wN' }, { code: 'B', name: 'wB' },
  { code: 'R', name: 'wR' }, { code: 'Q', name: 'wQ' }, { code: 'K', name: 'wK' },
  { code: 'p', name: 'bP' }, { code: 'n', name: 'bN' }, { code: 'b', name: 'bB' },
  { code: 'r', name: 'bR' }, { code: 'q', name: 'bQ' }, { code: 'k', name: 'bK' }
];

export default function Chessboard({ fen, onFenChange, lastMove, suggestedMove, bestMove, isFlipped = false, boardMode = 'play', onPlayMove }) {
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [selectedPlaySquare, setSelectedPlaySquare] = useState(null);

  // Séparer les parties du FEN
  const fenParts = fen.split(' ');
  const boardPart = fenParts[0];
  const activeColor = fenParts[1] || 'w';
  const castling = fenParts[2] || 'KQkq';
  const enPassant = fenParts[3] || '-';
  const halfmove = fenParts[4] || '0';
  const fullmove = fenParts[5] || '1';

  // Réinitialiser la sélection de jeu quand le mode change
  useEffect(() => {
    setSelectedPlaySquare(null);
  }, [boardMode]);

  // Parser le plateau FEN en grille 8x8
  const parseFen = () => {
    const rows = boardPart.split('/');
    const grid = [];
    for (let r = 0; r < 8; r++) {
      const row = [];
      const rowStr = rows[r] || '8';
      for (let i = 0; i < rowStr.length; i++) {
        const char = rowStr[i];
        if (isNaN(char)) {
          row.push(char);
        } else {
          const emptyCount = parseInt(char, 10);
          for (let e = 0; e < emptyCount; e++) {
            row.push('');
          }
        }
      }
      grid.push(row);
    }
    return grid;
  };

  const grid = parseFen();

  // Reconstruire le FEN complet après édition d'une case
  const updateSquare = (r, c, pieceCode) => {
    const newGrid = grid.map((row, rowIndex) => 
      row.map((col, colIndex) => {
        if (rowIndex === r && colIndex === c) {
          return pieceCode;
        }
        return col;
      })
    );

    // Reconstruire la partie plateau
    const rows = [];
    for (let rIndex = 0; rIndex < 8; rIndex++) {
      let rowStr = '';
      let emptyCount = 0;
      for (let cIndex = 0; cIndex < 8; cIndex++) {
        const piece = newGrid[rIndex][cIndex];
        if (piece === '') {
          emptyCount++;
        } else {
          if (emptyCount > 0) {
            rowStr += emptyCount.toString();
            emptyCount = 0;
          }
          rowStr += piece;
        }
      }
      if (emptyCount > 0) {
        rowStr += emptyCount.toString();
      }
      rows.push(rowStr);
    }

    const newBoardPart = rows.join('/');
    const newFen = [newBoardPart, activeColor, castling, enPassant, halfmove, fullmove].join(' ');
    onFenChange(newFen);
    setSelectedSquare(null);
  };

  // Convertir le nom d'une case (ex: "e2") en coordonnées (ligne, colonne) dans la grille
  const squareToCoords = (square) => {
    if (!square || square.length < 2) return null;
    const filesStr = 'abcdefgh';
    const file = filesStr.indexOf(square[0]);
    const rank = 8 - parseInt(square[1], 10);
    if (file === -1 || isNaN(rank) || rank < 0 || rank > 7) return null;
    return { r: rank, c: file };
  };

  // Décoder le dernier coup joué pour surlignage des cases
  const getMoveHighlight = () => {
    const move = lastMove || bestMove;
    if (!move || move.length < 4) return null;
    const from = move.slice(0, 2);
    const to = move.slice(2, 4);
    const fromCoords = squareToCoords(from);
    const toCoords = squareToCoords(to);
    if (!fromCoords || !toCoords) return null;
    return { from: fromCoords, to: toCoords };
  };

  // Décoder le coup suggéré pour tracer la flèche
  const getSuggestedMoveCoords = () => {
    if (!suggestedMove || suggestedMove.length < 4) return null;
    const from = suggestedMove.slice(0, 2);
    const to = suggestedMove.slice(2, 4);
    const fromCoords = squareToCoords(from);
    const toCoords = squareToCoords(to);
    if (!fromCoords || !toCoords) return null;
    return { from: fromCoords, to: toCoords };
  };

  const highlightedMove = getMoveHighlight();
  const moveArrow = getSuggestedMoveCoords();
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  // Gestion du clic sur une case
  const handleSquareClick = (sq) => {
    const r = sq.actualR;
    const c = sq.actualC;
    const piece = sq.piece;

    if (boardMode === 'edit') {
      setSelectedSquare({ r, c });
    } else {
      // Mode 'play'
      // Déterminer si la pièce cliquée appartient à la couleur active
      const isWhitePiece = piece && piece === piece.toUpperCase();
      const isMyPiece = piece && (
        (isWhitePiece && activeColor === 'w') || 
        (!isWhitePiece && activeColor === 'b')
      );

      if (selectedPlaySquare === null) {
        // Sélectionner notre pièce
        if (isMyPiece) {
          setSelectedPlaySquare({ r, c });
        }
      } else {
        // Une pièce était déjà sélectionnée
        const fromR = selectedPlaySquare.r;
        const fromC = selectedPlaySquare.c;

        if (fromR === r && fromC === c) {
          // Re-cliquer sur la même case : désélectionner
          setSelectedPlaySquare(null);
        } else if (isMyPiece) {
          // Cliquer sur une autre de nos pièces : changer la sélection
          setSelectedPlaySquare({ r, c });
        } else {
          // Essayer de jouer le coup
          const fromSquareName = `${files[fromC]}${8 - fromR}`;
          const toSquareName = `${files[c]}${8 - r}`;
          if (onPlayMove) {
            onPlayMove(fromSquareName, toSquareName);
          }
          setSelectedPlaySquare(null);
        }
      }
    }
  };

  // Construire la grille visuelle par rapport à l'état isFlipped
  const visualGrid = [];
  for (let r = 0; r < 8; r++) {
    const visualRow = [];
    for (let c = 0; c < 8; c++) {
      const actualR = isFlipped ? 7 - r : r;
      const actualC = isFlipped ? 7 - c : c;
      
      const piece = grid[actualR][actualC];
      const isLight = (actualR + actualC) % 2 === 0;
      const squareName = `${files[actualC]}${8 - actualR}`;
      
      let highlightClass = '';
      if (highlightedMove) {
        if (highlightedMove.from.r === actualR && highlightedMove.from.c === actualC) {
          highlightClass = ' highlight-from';
        } else if (highlightedMove.to.r === actualR && highlightedMove.to.c === actualC) {
          highlightClass = ' highlight-to';
        }
      }

      // Case sélectionnée pour déplacement
      let selectedClass = '';
      if (selectedPlaySquare && selectedPlaySquare.r === actualR && selectedPlaySquare.c === actualC) {
        selectedClass = ' selected-piece';
      }

      visualRow.push({
        piece,
        actualR,
        actualC,
        isLight,
        squareName,
        highlightClass,
        selectedClass,
        showRankLabel: c === 0,
        showFileLabel: r === 7,
        rankLabel: 8 - actualR,
        fileLabel: files[actualC]
      });
    }
    visualGrid.push(visualRow);
  }

  // Tracer la flèche de suggestion
  const renderArrow = () => {
    if (!moveArrow) return null;
    const { from, to } = moveArrow;
    
    const displayR1 = isFlipped ? 7 - from.r : from.r;
    const displayC1 = isFlipped ? 7 - from.c : from.c;
    const displayR2 = isFlipped ? 7 - to.r : to.r;
    const displayC2 = isFlipped ? 7 - to.c : to.c;

    const x1 = (displayC1 + 0.5) * 12.5;
    const y1 = (displayR1 + 0.5) * 12.5;
    const x2 = (displayC2 + 0.5) * 12.5;
    const y2 = (displayR2 + 0.5) * 12.5;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const d = Math.sqrt(dx * dx + dy * dy);

    if (d === 0) return null;

    const offsetStart = 4;   // unités de la viewBox 100x100
    const offsetEnd = 6.5;   // unités de la viewBox 100x100

    const arrowX1 = x1 + (dx / d) * offsetStart;
    const arrowY1 = y1 + (dy / d) * offsetStart;
    const arrowX2 = x2 - (dx / d) * offsetEnd;
    const arrowY2 = y2 - (dy / d) * offsetEnd;

    return (
      <svg 
        viewBox="0 0 100 100" 
        style={{ 
          position: 'absolute', 
          top: 0, 
          left: 0, 
          width: '100%', 
          height: '100%', 
          pointerEvents: 'none', 
          zIndex: 10 
        }}
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="4"
            markerHeight="4"
            refX="2"
            refY="2"
            orient="auto"
          >
            <polygon points="0,0 4,2 0,4" fill="var(--color-secondary)" />
          </marker>
        </defs>
        <line
          x1={arrowX1}
          y1={arrowY1}
          x2={arrowX2}
          y2={arrowY2}
          stroke="var(--color-secondary)"
          strokeWidth="1.8"
          strokeLinecap="round"
          opacity="0.8"
          markerEnd="url(#arrowhead)"
        />
      </svg>
    );
  };

  return (
    <div className="board-container">
      <div className="chessboard-wrapper">
        <div className="chessboard">
          {visualGrid.map((row, r) => 
            row.map((sq, c) => {
              return (
                <div
                  key={`${sq.actualR}-${sq.actualC}`}
                  className={`square ${sq.isLight ? 'light' : 'dark'}${sq.highlightClass}${sq.selectedClass || ''}`}
                  onClick={() => handleSquareClick(sq)}
                  title={sq.squareName}
                >
                  {sq.showRankLabel && (
                    <span className="coord-label rank">{sq.rankLabel}</span>
                  )}
                  {sq.showFileLabel && (
                    <span className="coord-label file">{sq.fileLabel}</span>
                  )}

                  {sq.piece && (
                    <img 
                      src={PIECE_IMAGES[sq.piece]} 
                      alt={sq.piece} 
                      className="chess-piece"
                      draggable="false"
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
        {renderArrow()}
      </div>

      {/* Popover de sélection de pièce pour correction manuelle */}
      {selectedSquare !== null && (
        <div className="piece-selector-overlay" onClick={() => setSelectedSquare(null)}>
          <div className="piece-selector-card" onClick={(e) => e.stopPropagation()}>
            <div className="piece-selector-title">
              Éditer la case {files[selectedSquare.c]}{8 - selectedSquare.r}
            </div>
            
            <div className="piece-grid">
              {PIECES_LIST.map((pieceObj) => (
                <button
                  key={pieceObj.code}
                  className="selector-piece-btn"
                  onClick={() => updateSquare(selectedSquare.r, selectedSquare.c, pieceObj.code)}
                >
                  <img src={PIECE_IMAGES[pieceObj.code]} alt={pieceObj.name} />
                </button>
              ))}
            </div>

            <button 
              className="empty-select-btn"
              onClick={() => updateSquare(selectedSquare.r, selectedSquare.c, '')}
            >
              Vider la case
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
