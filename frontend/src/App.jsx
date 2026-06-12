import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Chess } from 'chess.js';
import Chessboard from './components/Chessboard';
import './App.css';

// URL de l'API (chemin relatif pour passer par le proxy de développement ou de production)
const API_URL = import.meta.env.VITE_API_URL || '';

// Fonction pour traduire la notation SAN anglaise vers la notation française
const translateSanToFrench = (san) => {
  if (!san) return san;
  let translated = san;
  
  // Remplacement de la pièce au début du coup
  if (/^[KQRBN]/.test(translated)) {
    const firstChar = translated[0];
    const frenchPiece = {
      'K': 'R', // King -> Roi
      'Q': 'D', // Queen -> Dame
      'R': 'T', // Rook -> Tour
      'B': 'F', // Bishop -> Fou
      'N': 'C'  // Knight -> Cavalier
    }[firstChar];
    translated = frenchPiece + translated.slice(1);
  }
  
  // Remplacement de la promotion à la fin du coup, ex : e8=Q -> e8=D
  translated = translated.replace(/=([QRNBP])/g, (match, piece) => {
    const frenchPiece = {
      'Q': 'D',
      'R': 'T',
      'B': 'F',
      'N': 'C'
    }[piece] || piece;
    return '=' + frenchPiece;
  });
  
  return translated;
};

export default function App() {
  const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [imageUrl, setImageUrl] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [boardBox, setBoardBox] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [error, setError] = useState(null);
  const [isFlipped, setIsFlipped] = useState(false);

  // États du moteur d'analyse Stockfish
  const [isAnalyzing, setIsAnalyzing] = useState(true);
  const [engineDepth, setEngineDepth] = useState(15);
  const [currentDepth, setCurrentDepth] = useState(0);
  const [score, setScore] = useState({ type: 'cp', val: 0 });
  const [bestMove, setBestMove] = useState('');
  const [pvLine, setPvLine] = useState([]);
  const [gameMoves, setGameMoves] = useState([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [boardMode, setBoardMode] = useState('play'); // 'play' ou 'edit'
  
  const workerRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastUpdateRef = useRef(0);
  const engineDepthRef = useRef(engineDepth);
  const latestScoreRef = useRef({ type: 'cp', val: 0 });

  useEffect(() => {
    engineDepthRef.current = engineDepth;
  }, [engineDepth]);


  // 1. Fonctions d'aide et variables d'état dérivées
  const getActiveColor = () => {
    return fen.split(' ')[1] || 'w';
  };

  // Générer l'historique complet des coups joués par l'utilisateur
  const gameHistory = useMemo(() => {
    const history = [{ fen: fen, move: null, san: null }];
    try {
      const chess = new Chess(fen);
      for (const m of gameMoves) {
        const moveObj = chess.move(m);
        if (moveObj) {
          history.push({
            fen: chess.fen(),
            move: m.from + m.to + (m.promotion || ''),
            san: moveObj.san,
            from: m.from,
            to: m.to
          });
        } else {
          break;
        }
      }
    } catch (err) {
      console.error("Erreur lors de la génération de l'historique des coups joués:", err);
    }
    return history;
  }, [fen, gameMoves]);

  // Index sécurisé dans l'historique de jeu
  const activeStepIndex = Math.min(currentStepIndex, gameHistory.length - 1);
  const displayFen = gameHistory[activeStepIndex]?.fen || fen;
  const lastMove = gameHistory[activeStepIndex]?.move || null;

  // Générer la suggestion du moteur (PV) à partir de la position actuellement affichée (displayFen)
  const pvHistory = useMemo(() => {
    const history = [{ fen: displayFen, move: null, san: null }];
    if (pvLine.length === 0) return history;
    
    try {
      const chess = new Chess(displayFen);
      for (const moveStr of pvLine) {
        const from = moveStr.slice(0, 2);
        const to = moveStr.slice(2, 4);
        const promotion = moveStr.length > 4 ? moveStr[4] : undefined;
        
        const moveObj = chess.move({ from, to, promotion });
        if (moveObj) {
          history.push({
            fen: chess.fen(),
            move: moveStr,
            san: moveObj.san,
            from,
            to
          });
        } else {
          break;
        }
      }
    } catch (err) {
      console.error("Erreur lors de la génération de l'historique PV:", err);
    }
    return history;
  }, [displayFen, pvLine]);

  const suggestedMove = pvHistory[1]?.move || bestMove;

  // Calculer l'évaluation relative aux Blancs pour la barre d'évaluation
  const getWhiteRelativeScore = () => {
    const currentActiveColor = displayFen.split(' ')[1] || 'w';
    if (score.type === 'mate') {
      return {
        text: `M${Math.abs(score.val)}`,
        value: currentActiveColor === 'w' ? score.val : -score.val,
        isMate: true
      };
    }
    const valInPawns = score.val / 100;
    const scoreForWhite = currentActiveColor === 'w' ? valInPawns : -valInPawns;
    return {
      text: (scoreForWhite >= 0 ? '+' : '') + scoreForWhite.toFixed(2),
      value: scoreForWhite,
      isMate: false
    };
  };

  const whiteEval = getWhiteRelativeScore();

  // Mapper le score à un pourcentage pour la hauteur de la barre blanche (sigmoid)
  const getEvalBarPercentage = () => {
    if (whiteEval.isMate) {
      return whiteEval.value > 0 ? 100 : 0;
    }
    // Formule sigmoïde douce : 0 de cp -> 50%, +2 cp -> 88%, -2 cp -> 12%
    const scoreVal = whiteEval.value;
    const percentage = 50 + (Math.tanh(scoreVal / 2) * 50);
    return Math.max(5, Math.min(95, percentage));
  };

  const barHeight = getEvalBarPercentage();

  // 2. Gestionnaires d'événements et actions utilisateurs
  const toggleActiveColor = () => {
    const parts = fen.split(' ');
    const newColor = parts[1] === 'w' ? 'b' : 'w';
    parts[1] = newColor;
    parts[4] = '0'; 
    parts[5] = '1';
    const newFen = parts.join(' ');
    setFen(newFen);
    setGameMoves([]);
    setCurrentStepIndex(0);
  };

  const handlePlayMove = (from, to) => {
    try {
      const chess = new Chess(displayFen);
      const moveObj = chess.move({ from, to, promotion: 'q' });
      if (moveObj) {
        const newMoves = gameMoves.slice(0, activeStepIndex);
        newMoves.push({ from, to, promotion: 'q' });
        setGameMoves(newMoves);
        setCurrentStepIndex(activeStepIndex + 1);
      }
    } catch (err) {
      console.warn("Coup illégal joué:", err);
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    setError(null);
    setIsScanning(true);
    setImageFile(file);

    const localUrl = URL.createObjectURL(file);
    setImageUrl(localUrl);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${API_URL}/api/scan`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || "Erreur lors de l'analyse du plateau.");
      }

      const data = await response.json();
      if (data.success) {
        setFen(data.fen);
        setGameMoves([]);
        setCurrentStepIndex(0);
        setBoardBox(data.board_box);
        if (data.is_flipped !== undefined) {
          setIsFlipped(data.is_flipped);
        }
      } else {
        throw new Error(data.message || "Impossible d'extraire la position.");
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Connexion au serveur de vision impossible.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleCopyFen = () => {
    navigator.clipboard.writeText(displayFen);
    alert('FEN copié dans le presse-papier !');
  };

  // 3. Effets de bord (React useEffect Hooks)
  
  // Initialisation et gestion du Web Worker Stockfish local
  useEffect(() => {
    const worker = new Worker('/stockfish.js');
    workerRef.current = worker;

    worker.postMessage('uci');
    worker.postMessage('isready');
    worker.postMessage('setoption name Hash value 32');

    worker.onmessage = (e) => {
      const line = e.data;
      if (typeof line !== 'string') return;
      
      if (line.startsWith('info')) {
        const depthMatch = line.match(/depth\s+(\d+)/);
        let depth = 0;
        if (depthMatch) {
          depth = parseInt(depthMatch[1], 10);
          setCurrentDepth(depth);
        }

        const scoreCpMatch = line.match(/score cp\s+(-?\d+)/);
        const scoreMateMatch = line.match(/score mate\s+(-?\d+)/);
        
        let newScore = null;
        if (scoreCpMatch) {
          newScore = { type: 'cp', val: parseInt(scoreCpMatch[1], 10) };
        } else if (scoreMateMatch) {
          newScore = { type: 'mate', val: parseInt(scoreMateMatch[1], 10) };
        }

        if (newScore) {
          latestScoreRef.current = newScore;
          const now = Date.now();
          if (now - lastUpdateRef.current > 100) {
            setScore(newScore);
            lastUpdateRef.current = now;
          }
        }

        const pvMatch = line.match(/\bpv\s+(.*)/);
        if (pvMatch) {
          const pvArray = pvMatch[1].trim().split(/\s+/).filter(m => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m));
          setPvLine(pvArray);
          if (pvArray.length > 0) {
            setBestMove(pvArray[0]);
          }
        }
      } else if (line.startsWith('bestmove')) {
        const bestmoveMatch = line.match(/bestmove\s+(\S+)/);
        if (bestmoveMatch && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(bestmoveMatch[1])) {
          setBestMove(bestmoveMatch[1]);
        }
        // La recherche est terminée : forcer la mise à jour immédiate avec la dernière évaluation trouvée
        if (latestScoreRef.current) {
          setScore(latestScoreRef.current);
        }
      }
    };

    return () => {
      worker.terminate();
    };
  }, []);

  // Déclencher l'analyse Stockfish chaque fois que le FEN affiché ou les réglages changent
  useEffect(() => {
    if (!workerRef.current || !isAnalyzing) return;

    setCurrentDepth(0);
    latestScoreRef.current = score;
    setBestMove('');
    setPvLine([]);
    lastUpdateRef.current = 0;

    workerRef.current.postMessage('stop');
    workerRef.current.postMessage(`position fen ${displayFen}`);
    workerRef.current.postMessage(`go depth ${engineDepth}`);
  }, [displayFen, engineDepth, isAnalyzing]);

  // Référence pour éviter de ré-enregistrer l'écouteur keydown à chaque changement d'état
  const keyboardStateRef = useRef();
  keyboardStateRef.current = { currentStepIndex, gameHistory, bestMove, handlePlayMove };

  // Écouteur pour la navigation clavier (flèches gauche/droite)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT') {
        return;
      }
      const { currentStepIndex: idx, gameHistory: hist, bestMove: bm, handlePlayMove: pm } = keyboardStateRef.current;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCurrentStepIndex(prev => Math.max(0, prev - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (idx < hist.length - 1) {
          setCurrentStepIndex(prev => prev + 1);
        } else if (bm) {
          const from = bm.slice(0, 2);
          const to = bm.slice(2, 4);
          pm(from, to);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // S'assurer que currentStepIndex reste cohérent avec l'historique en cas de réinitialisation/changement FEN
  useEffect(() => {
    if (currentStepIndex > gameHistory.length - 1) {
      setCurrentStepIndex(gameHistory.length - 1);
    }
  }, [gameHistory.length, currentStepIndex]);

  const activeColor = getActiveColor();

  return (
    <div className="app-container">
      {/* En-tête */}
      <header className="header">
        <div className="logo-container">
          <span className="logo-icon">♞</span>
          <span className="logo-text">Chess Scan</span>
          <span className="logo-badge">WASM Engine</span>
        </div>
        {imageUrl && (
          <div className="desktop-only-lichess-link">
            <a 
              href={`https://lichess.org/analysis/${displayFen}`} 
              target="_blank" 
              rel="noreferrer"
              className="upload-btn"
              style={{ textDecoration: 'none', background: 'var(--bg-surface-solid)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
            >
              Ouvrir sur Lichess
            </a>
          </div>
        )}
      </header>

      {/* Contenu principal */}
      {!imageUrl ? (
        <div className="upload-container-centered">
          <div className="glass-card upload-card-centered">
            {/* Logo & description */}
            <div className="centered-hero">
              <span className="logo-icon-large">♞</span>
              <h2>Chess Scan</h2>
              <p>Analysez instantanément vos positions d'échecs à partir d'une capture d'écran</p>
            </div>
            
            {/* Zone d'Upload */}
            {isScanning ? (
              <div className="upload-loading-overlay">
                <div className="spinner-large"></div>
                <p style={{ color: 'var(--text-secondary)', fontWeight: 500, marginTop: '1rem' }}>Analyse de l'image en cours...</p>
              </div>
            ) : (
              <div 
                className={`upload-zone ${isDragActive ? 'drag-active' : ''}`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current.click()}
              >
                <div className="upload-icon">📤</div>
                <div className="upload-title">Déposez votre capture d'écran</div>
                <div className="upload-desc">Formats supportés : PNG, JPG, JPEG</div>
                <button className="upload-btn" onClick={(e) => { e.stopPropagation(); fileInputRef.current.click(); }}>Sélectionner un fichier</button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  style={{ display: 'none' }} 
                  accept="image/*"
                  onChange={(e) => handleFile(e.target.files[0])}
                />
              </div>
            )}

            {error && (
              <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#f87171', borderRadius: '8px', fontSize: '0.9rem', textAlign: 'left' }}>
                ⚠️ {error}
              </div>
            )}
          </div>
        </div>
      ) : (
        <main className="main-content">
          
          {/* Colonne de gauche : Analyse & Échiquier */}
          <section className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button 
                  className="back-btn" 
                  onClick={() => {
                    setImageUrl(null);
                    setImageFile(null);
                    setBoardBox(null);
                    setError(null);
                    setFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
                    setGameMoves([]);
                    setCurrentStepIndex(0);
                  }}
                  title="Retour à l'accueil"
                >
                  ⬅ Retour
                </button>
                <h2 className="board-title">Échiquier Reconstitué</h2>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div className="mode-toggle-container">
                  <button 
                    className={`mode-toggle-btn ${boardMode === 'play' ? 'active' : ''}`}
                    onClick={() => setBoardMode('play')}
                  >
                    🎮 Jouer
                  </button>
                  <button 
                    className={`mode-toggle-btn ${boardMode === 'edit' ? 'active' : ''}`}
                    onClick={() => setBoardMode('edit')}
                  >
                    🔧 Éditer
                  </button>
                </div>
                {isScanning && <div className="spinner" title="Analyse de l'image en cours..."></div>}
              </div>
            </div>

            {error && (
              <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#f87171', borderRadius: '8px', fontSize: '0.9rem' }}>
                ⚠️ {error}
              </div>
            )}

            <div className="workspace-grid">
              {/* Conteneur Échiquier + Barre d'évaluation côte à côte */}
              <div className="board-and-eval-container">
                {/* Barre d'évaluation */}
                <div className="eval-bar-container">
                  <div className="eval-bar-wrapper">
                    <div 
                      className="eval-bar-value" 
                      style={{ 
                        height: `${barHeight}%`,
                        bottom: isFlipped ? 'auto' : 0,
                        top: isFlipped ? 0 : 'auto'
                      }}
                    />
                  </div>
                </div>

                {/* Échiquier */}
                <div className="board-wrapper">
                  <Chessboard 
                    fen={displayFen} 
                    onFenChange={(newFen) => {
                      setFen(newFen);
                      setGameMoves([]);
                      setCurrentStepIndex(0);
                    }} 
                    lastMove={lastMove}
                    suggestedMove={suggestedMove}
                    isFlipped={isFlipped}
                    boardMode={boardMode}
                    onPlayMove={handlePlayMove}
                  />
                </div>
              </div>

              {/* Légende et contrôles de navigation en dessous de l'ensemble */}
              <div className="board-controls-container">
                <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                  {boardMode === 'play' ? (
                    <span>💡 <em>Cliquez sur une pièce puis sur une case pour jouer un coup.</em></span>
                  ) : (
                    <span>💡 <em>Cliquez sur une case pour corriger manuellement une pièce.</em></span>
                  )}
                </div>

                {/* Contrôles de navigation dans la PV */}
                {gameHistory.length > 0 && (
                  <div className="navigation-controls">
                    <button 
                      onClick={() => setCurrentStepIndex(0)} 
                      disabled={activeStepIndex === 0}
                      className="nav-btn"
                      title="Début"
                    >
                      ⏮
                    </button>
                    <button 
                      onClick={() => setCurrentStepIndex(prev => Math.max(0, prev - 1))} 
                      disabled={activeStepIndex === 0}
                      className="nav-btn"
                      title="Précédent (Flèche Gauche)"
                    >
                      ◀
                    </button>
                    <span className="nav-status">
                      Coup {activeStepIndex} / {gameHistory.length - 1}
                    </span>
                    <button 
                      onClick={() => {
                        if (currentStepIndex < gameHistory.length - 1) {
                          setCurrentStepIndex(prev => prev + 1);
                        } else if (bestMove) {
                          const from = bestMove.slice(0, 2);
                          const to = bestMove.slice(2, 4);
                          handlePlayMove(from, to);
                        }
                      }} 
                      disabled={currentStepIndex === gameHistory.length - 1 && !bestMove}
                      className="nav-btn"
                      title="Suivant (Flèche Droite)"
                    >
                      ▶
                    </button>
                    <button 
                      onClick={() => setCurrentStepIndex(gameHistory.length - 1)} 
                      disabled={activeStepIndex === gameHistory.length - 1}
                      className="nav-btn"
                      title="Fin"
                    >
                      ⏭
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Paramètres de la position */}
            <div className="panel-section" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '1.25rem', marginBottom: '1.25rem' }}>
              <span className="section-title">Paramètres de la position</span>
              <div style={{ marginTop: '0.75rem' }}>
                <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.5rem' }}>
                  Trait de jeu (Qui doit jouer) :
                </label>
                <div className="toggle-container">
                  <button 
                    className={`toggle-btn white ${activeColor === 'w' ? 'active' : ''}`}
                    onClick={toggleActiveColor}
                  >
                    ⚪ Blancs
                  </button>
                  <button 
                    className={`toggle-btn black ${activeColor === 'b' ? 'active' : ''}`}
                    onClick={toggleActiveColor}
                  >
                    ⚫ Noirs
                  </button>
                </div>
              </div>

              <div style={{ marginTop: '1.25rem' }}>
                <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.5rem' }}>
                  Orientation de l'échiquier :
                </label>
                <button 
                  className="action-btn secondary"
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', background: 'var(--bg-surface-solid)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                  onClick={() => setIsFlipped(!isFlipped)}
                >
                  🔄 Retourner ({isFlipped ? 'Noirs en bas' : 'Blancs en bas'})
                </button>
              </div>
            </div>

            {/* Formulaire FEN */}
            <div className="panel-section">
              <span className="section-title">Code FEN</span>
              <div className="fen-box">
                <input 
                  type="text" 
                  className="fen-input" 
                  value={displayFen} 
                  onChange={(e) => {
                    setFen(e.target.value);
                    setGameMoves([]);
                    setCurrentStepIndex(0);
                  }} 
                />
                <button className="copy-btn" onClick={handleCopyFen} title="Copier le FEN">
                  📋
                </button>
              </div>
            </div>

            {/* Lien Lichess Mobile */}
            {imageUrl && (
              <div className="mobile-only-lichess-link" style={{ marginTop: '0.5rem' }}>
                <a 
                  href={`https://lichess.org/analysis/${displayFen}`} 
                  target="_blank" 
                  rel="noreferrer"
                  className="upload-btn"
                  style={{ textDecoration: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'var(--bg-surface-solid)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', width: '100%', padding: '0.75rem', borderRadius: '8px', fontWeight: 600 }}
                >
                  Ouvrir sur Lichess
                </a>
              </div>
            )}
          </section>

          {/* Colonne de droite : Upload & Moteur */}
          <section style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            
            {/* Module d'Upload (Aperçu) */}
            <div className="glass-card">
              <h3 style={{ marginBottom: '1rem' }}>Capture d'Écran</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="preview-card">
                  <img src={imageUrl} alt="Échiquier scanné" className="preview-img" />
                  <div className="preview-overlay-info">
                    {boardBox ? 'Zone de jeu détectée par IA' : 'Traitement de la capture...'}
                  </div>
                </div>
                <button 
                  className="upload-btn" 
                  style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
                  onClick={() => {
                    setImageUrl(null);
                    setImageFile(null);
                    setBoardBox(null);
                    setError(null);
                    setFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
                    setGameMoves([]);
                    setCurrentStepIndex(0);
                  }}
                >
                  Remplacer l'image
                </button>
              </div>
            </div>

            {/* Module Stockfish */}
            <div className="glass-card control-panel">
              <div className="panel-section">
                <span className="section-title">Analyse Stockfish</span>
                
                <div className="eval-stats" style={{ margin: '1rem 0' }}>
                  <div className="eval-stat-row">
                    <span className="eval-stat-label">Évaluation :</span>
                    <span className="eval-score-text">{whiteEval.text}</span>
                  </div>
                  <div className="eval-stat-row">
                    <span className="eval-stat-label">Profondeur moteur :</span>
                    <span className="eval-stat-val">{currentDepth} / {engineDepth}</span>
                  </div>
                  <div className="eval-stat-row">
                    <span className="eval-stat-label">Meilleur coup suggéré :</span>
                    <span className="eval-stat-val" style={{ color: 'var(--color-secondary)', fontSize: '1.1rem' }}>
                      {bestMove ? bestMove : 'Recherche...'}
                    </span>
                  </div>
                </div>

                {/* Affichage des coups joués (gameHistory) */}
                {gameHistory.length > 1 && (
                  <div style={{ marginTop: '1rem' }}>
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.5rem' }}>
                      Historique des coups :
                    </label>
                    <div className="pv-moves-container played-moves">
                      {gameHistory.slice(1).map((step, i) => {
                        const moveIndex = i + 1;
                        const startColor = fen.split(' ')[1] || 'w';
                        const isWhite = startColor === 'w' ? (moveIndex % 2 !== 0) : (moveIndex % 2 === 0);
                        const moveNum = Math.floor((i + (startColor === 'b' ? 1 : 0)) / 2) + 1;
                        
                        let label = step.san ? translateSanToFrench(step.san) : step.move;
                        if (isWhite) {
                          label = `${moveNum}. ${label}`;
                        } else if (i === 0) {
                          label = `${moveNum}... ${label}`;
                        }
                        
                        return (
                          <button
                            key={i}
                            className={`pv-move-btn played ${activeStepIndex === moveIndex ? 'active' : ''}`}
                            onClick={() => setCurrentStepIndex(moveIndex)}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Affichage de la ligne de suggestion du moteur (pvHistory) */}
                {pvLine.length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.5rem' }}>
                      Suggestions du moteur (cliquez pour jouer la variante) :
                    </label>
                    <div className="pv-moves-container suggested-moves">
                      {pvHistory.slice(1).map((step, i) => {
                        const pvIndex = i + 1;
                        const currentColor = displayFen.split(' ')[1] || 'w';
                        const isWhite = currentColor === 'w' ? (pvIndex % 2 !== 0) : (pvIndex % 2 === 0);
                        const moveNum = Math.floor((i + (currentColor === 'b' ? 1 : 0)) / 2) + 1;
                        
                        let label = step.san ? translateSanToFrench(step.san) : step.move;
                        if (isWhite) {
                          label = `${moveNum}. ${label}`;
                        } else if (i === 0) {
                          label = `${moveNum}... ${label}`;
                        }
                        
                        return (
                          <button
                            key={i}
                            className="pv-move-btn suggested"
                            onClick={() => {
                              const newMoves = gameMoves.slice(0, currentStepIndex);
                              for (let k = 1; k <= pvIndex; k++) {
                                const pvStep = pvHistory[k];
                                if (pvStep && pvStep.from && pvStep.to) {
                                  newMoves.push({
                                    from: pvStep.from,
                                    to: pvStep.to,
                                    promotion: pvStep.move.length > 4 ? pvStep.move[4] : undefined
                                  });
                                }
                              }
                              setGameMoves(newMoves);
                              setCurrentStepIndex(currentStepIndex + pvIndex);
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem' }}>
                      Profondeur max
                    </label>
                    <select 
                      value={engineDepth} 
                      onChange={(e) => setEngineDepth(parseInt(e.target.value, 10))}
                      className="fen-input"
                      style={{ width: '100%', padding: '0.5rem' }}
                    >
                      <option value={10}>10 (Rapide)</option>
                      <option value={15}>15 (Standard)</option>
                      <option value={18}>18 (Précis)</option>
                      <option value={20}>20 (Profond)</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-end', flex: 1 }}>
                    <button 
                      className={`action-btn ${isAnalyzing ? 'secondary' : 'primary'}`}
                      onClick={() => setIsAnalyzing(!isAnalyzing)}
                    >
                      {isAnalyzing ? '⏸ Arrêter' : '▶ Analyser'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
