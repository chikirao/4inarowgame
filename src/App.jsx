import { useEffect, useMemo, useState } from 'react';
import { get, onDisconnect, onValue, ref, remove, runTransaction, set, update } from 'firebase/database';
import { db, ensureAnonymousSession, isFirebaseConfigured } from './firebase';
import {
  COLS,
  EMPTY,
  INITIAL_BOARD,
  RED,
  ROWS,
  YELLOW,
  applyMoveToRoom,
  getOpponentDisc,
  getPlayerDisc,
  getPlayerLabel,
  isRoomFull,
  makeRoomCode,
  normalizeRoomCode,
  parseBoard
} from './game';

const STORAGE_NAME_KEY = 'four-row-player-name';

function getInitialCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return normalizeRoomCode(params.get('room'));
}

function getSafeName(value) {
  const trimmed = String(value || '').trim().replace(/\s+/g, ' ');
  return trimmed.slice(0, 18) || 'Игрок';
}

function updateRoomUrl(code) {
  const nextUrl = code ? `${window.location.pathname}?room=${code}` : window.location.pathname;
  window.history.replaceState({}, '', nextUrl);
}

function createEmptyRoom(user, displayName) {
  return {
    board: INITIAL_BOARD,
    createdAt: Date.now(),
    lastMove: {
      by: '',
      row: -1,
      col: -1,
      at: Date.now()
    },
    players: {
      red: {
        uid: user.uid,
        name: displayName,
        connected: true
      },
      yellow: {
        uid: '',
        name: '',
        connected: false
      }
    },
    status: 'waiting',
    turn: RED,
    winner: '',
    winningLine: []
  };
}

function claimSeat(currentRoom, user, displayName) {
  if (!currentRoom) {
    return undefined;
  }

  const room = {
    ...currentRoom,
    players: {
      red: currentRoom.players?.red || { uid: '', name: '', connected: false },
      yellow: currentRoom.players?.yellow || { uid: '', name: '', connected: false }
    }
  };

  if (room.players.red.uid === user.uid) {
    room.players.red = { ...room.players.red, name: displayName, connected: true };
    return room;
  }

  if (room.players.yellow.uid === user.uid) {
    room.players.yellow = { ...room.players.yellow, name: displayName, connected: true };
    return room;
  }

  if (!room.players.red.uid) {
    room.players.red = { uid: user.uid, name: displayName, connected: true };
  } else if (!room.players.yellow.uid) {
    room.players.yellow = { uid: user.uid, name: displayName, connected: true };
  } else {
    return room;
  }

  if (room.players.red.uid && room.players.yellow.uid && room.status === 'waiting') {
    room.status = 'playing';
  }

  return room;
}

function App() {
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState('');
  const [displayName, setDisplayName] = useState(() => localStorage.getItem(STORAGE_NAME_KEY) || '');
  const [joinCode, setJoinCode] = useState(getInitialCodeFromUrl());
  const [activeRoomCode, setActiveRoomCode] = useState('');
  const [room, setRoom] = useState(undefined);
  const [notice, setNotice] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [autoJoinAttempted, setAutoJoinAttempted] = useState(false);

  const safeName = useMemo(() => getSafeName(displayName), [displayName]);

  const myDisc = useMemo(() => getPlayerDisc(room, user?.uid), [room, user]);
  const opponentDisc = myDisc ? getOpponentDisc(myDisc) : null;
  const canPlay = Boolean(room && user && myDisc && room.status === 'playing' && room.turn === myDisc && !room.winner);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setAuthError('Добавь Firebase-переменные в .env.local или в Environment variables на Cloudflare Pages.');
      return;
    }

    ensureAnonymousSession()
      .then(setUser)
      .catch((error) => setAuthError(error.message));
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_NAME_KEY, safeName);
  }, [safeName]);


  useEffect(() => {
    if (!user || autoJoinAttempted || activeRoomCode || !joinCode) {
      return;
    }

    setAutoJoinAttempted(true);
    joinRoom(joinCode);
  }, [activeRoomCode, autoJoinAttempted, joinCode, user]);

  useEffect(() => {
    if (!db || !user || !room || !activeRoomCode || !myDisc) {
      return;
    }

    const seat = myDisc === RED ? 'red' : 'yellow';

    if (room.players?.[seat]?.name === safeName) {
      return;
    }

    update(ref(db, `rooms/${activeRoomCode}/players/${seat}`), { name: safeName }).catch(() => {});
  }, [activeRoomCode, myDisc, room, safeName, user]);

  useEffect(() => {
    if (!activeRoomCode || !db) {
      setRoom(undefined);
      return undefined;
    }

    const roomReference = ref(db, `rooms/${activeRoomCode}`);
    return onValue(roomReference, (snapshot) => {
      setRoom(snapshot.exists() ? snapshot.val() : null);
    });
  }, [activeRoomCode]);

  useEffect(() => {
    if (!db || !user || !room || !activeRoomCode) {
      return undefined;
    }

    const disc = getPlayerDisc(room, user.uid);

    if (!disc) {
      return undefined;
    }

    const seat = disc === RED ? 'red' : 'yellow';
    const connectedReference = ref(db, `rooms/${activeRoomCode}/players/${seat}/connected`);
    const disconnect = onDisconnect(connectedReference);

    set(connectedReference, true);
    disconnect.set(false);

    return () => {
      disconnect.cancel();
      set(connectedReference, false);
    };
  }, [activeRoomCode, room, user]);

  async function createRoom() {
    if (!db || !user) {
      setNotice('Firebase еще не готов. Проверь конфиг и включи Anonymous Auth.');
      return;
    }

    setIsBusy(true);
    setNotice('');

    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = makeRoomCode();
        const roomReference = ref(db, `rooms/${code}`);
        const snapshot = await get(roomReference);

        if (snapshot.exists()) {
          continue;
        }

        await set(roomReference, createEmptyRoom(user, safeName));
        setActiveRoomCode(code);
        setJoinCode(code);
        updateRoomUrl(code);
        setNotice('Комната создана. Скопируй ссылку и отправь второму игроку.');
        return;
      }

      setNotice('Не получилось подобрать код комнаты. Попробуй еще раз.');
    } catch (error) {
      setNotice(error.message);
    } finally {
      setIsBusy(false);
    }
  }

  async function joinRoom(codeToJoin = joinCode) {
    const code = normalizeRoomCode(codeToJoin);

    if (!db || !user) {
      setNotice('Firebase еще не готов. Проверь конфиг и включи Anonymous Auth.');
      return;
    }

    if (!code) {
      setNotice('Введи код комнаты.');
      return;
    }

    setIsBusy(true);
    setNotice('');

    try {
      const roomReference = ref(db, `rooms/${code}`);
      const result = await runTransaction(
        roomReference,
        (currentRoom) => claimSeat(currentRoom, user, safeName),
        { applyLocally: false }
      );

      if (!result.committed || !result.snapshot.exists()) {
        setNotice('Комната не найдена. Проверь код или создай новую.');
        return;
      }

      const nextRoom = result.snapshot.val();

      if (!getPlayerDisc(nextRoom, user.uid)) {
        setNotice('В комнате уже два игрока. Можно открыть ее только как зритель.');
      }

      setActiveRoomCode(code);
      setJoinCode(code);
      updateRoomUrl(code);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setIsBusy(false);
    }
  }

  async function makeMove(col) {
    if (!db || !user || !activeRoomCode || !canPlay) {
      return;
    }

    const roomReference = ref(db, `rooms/${activeRoomCode}`);

    try {
      await runTransaction(roomReference, (currentRoom) => applyMoveToRoom(currentRoom, user.uid, col));
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function restartGame() {
    if (!db || !user || !activeRoomCode) {
      return;
    }

    const roomReference = ref(db, `rooms/${activeRoomCode}`);

    try {
      await runTransaction(roomReference, (currentRoom) => {
        if (!currentRoom || !getPlayerDisc(currentRoom, user.uid)) {
          return currentRoom;
        }

        const hasBothPlayers = Boolean(currentRoom.players?.red?.uid && currentRoom.players?.yellow?.uid);

        return {
          ...currentRoom,
          board: INITIAL_BOARD,
          lastMove: {
            by: '',
            row: -1,
            col: -1,
            at: Date.now()
          },
          status: hasBothPlayers ? 'playing' : 'waiting',
          turn: RED,
          winner: '',
          winningLine: []
        };
      });
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function clearRoom() {
    if (!db || !activeRoomCode || !room || !myDisc) {
      leaveRoom();
      return;
    }

    const seat = myDisc === RED ? 'red' : 'yellow';
    const roomReference = ref(db, `rooms/${activeRoomCode}`);

    try {
      const otherSeat = opponentDisc === RED ? 'red' : 'yellow';
      const hasOpponent = Boolean(room.players?.[otherSeat]?.uid);

      if (!hasOpponent) {
        await remove(roomReference);
      } else {
        await update(ref(db, `rooms/${activeRoomCode}/players/${seat}`), {
          uid: '',
          name: '',
          connected: false
        });
        await update(roomReference, {
          board: INITIAL_BOARD,
          lastMove: {
            by: '',
            row: -1,
            col: -1,
            at: Date.now()
          },
          status: 'waiting',
          turn: RED,
          winner: '',
          winningLine: []
        });
      }
    } catch (error) {
      setNotice(error.message);
    }

    leaveRoom();
  }

  function leaveRoom() {
    setActiveRoomCode('');
    setRoom(undefined);
    updateRoomUrl('');
  }

  async function copyInviteLink() {
    if (!activeRoomCode) {
      return;
    }

    const link = `${window.location.origin}${window.location.pathname}?room=${activeRoomCode}`;

    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice(link);
    }
  }

  const heroStatus = getHeroStatus(room, myDisc);

  return (
    <main className="app-shell">
      <div className="ambient-orb ambient-orb-a" />
      <div className="ambient-orb ambient-orb-b" />
      <div className="grain" />

      <header className="fluid-nav reveal-on-load">
        <div className="brand-mark">4</div>
        <div>
          <span className="brand-title">Four in Row</span>
          <span className="brand-caption">Firebase multiplayer</span>
        </div>
        {activeRoomCode ? <button className="nav-chip" onClick={clearRoom}>Выйти</button> : null}
      </header>

      <section className="hero-grid">
        <div className="hero-copy reveal-on-load delayed-a">
          <span className="eyebrow">Realtime duel</span>
          <h1>4 в ряд.</h1>
          <p>
            Создай комнату, отправь ссылку другу и соревнуйтесь в классической дуэли на одном общем поле.
          </p>

          <div className="status-stack">
            <StatusPill label="Сессия" value={user ? 'Anonymous Auth готов' : 'Подключение'} />
            <StatusPill label="Комната" value={activeRoomCode || 'не выбрана'} />
            <StatusPill label="Ты" value={myDisc ? getPlayerLabel(myDisc) : 'пока зритель'} />
          </div>
        </div>

        <div className="game-column reveal-on-load delayed-b">
          <Shell className="control-shell">
            <div className="panel-head">
              <div>
                <span className="eyebrow compact">Lobby</span>
                <h2>Комната</h2>
              </div>
              <span className="room-token">{activeRoomCode || '-----'}</span>
            </div>

            <label className="field-label" htmlFor="player-name">Имя игрока</label>
            <input
              id="player-name"
              className="text-field"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Например, Viktor"
              maxLength={18}
            />

            <div className="join-row">
              <div className="join-field-wrap">
                <label className="field-label" htmlFor="room-code">Код комнаты</label>
                <input
                  id="room-code"
                  className="text-field code-field"
                  value={joinCode}
                  onChange={(event) => setJoinCode(normalizeRoomCode(event.target.value))}
                  placeholder="A7K2Q"
                  maxLength={8}
                />
              </div>
              <button className="magnetic-button secondary" onClick={() => joinRoom()} disabled={isBusy || !user}>
                Войти
                <span className="button-orb">↗</span>
              </button>
            </div>

            <div className="button-grid">
              <button className="magnetic-button primary" onClick={createRoom} disabled={isBusy || !user}>
                Создать
                <span className="button-orb">+</span>
              </button>
              <button className="magnetic-button ghost" onClick={copyInviteLink} disabled={!activeRoomCode}>
                {copied ? 'Скопировано' : 'Ссылка'}
                <span className="button-orb">⤴</span>
              </button>
            </div>

            {notice || authError ? <div className="notice">{notice || authError}</div> : null}
          </Shell>

          <Shell className="board-shell">
            <div className="board-head">
              <div>
                <span className="eyebrow compact">Board</span>
                <h2>{heroStatus.title}</h2>
                <p>{heroStatus.description}</p>
              </div>
              {room && myDisc ? (
                <button className="mini-action" onClick={restartGame}>Новая</button>
              ) : null}
            </div>

            <ScoreRail room={room} myDisc={myDisc} />
            <Board room={room} canPlay={canPlay} onMove={makeMove} />
          </Shell>
        </div>
      </section>
    </main>
  );
}

function getHeroStatus(room, myDisc) {
  if (room === null) {
    return {
      title: 'Комната не найдена',
      description: 'Создай новую комнату или проверь код приглашения.'
    };
  }

  if (!room) {
    return {
      title: 'Готов к дуэли',
      description: 'Создай комнату или вставь код комнаты друга.'
    };
  }

  if (room.winner === 'draw') {
    return {
      title: 'Ничья',
      description: 'Поле заполнено. Запусти новую партию.'
    };
  }

  if (room.winner) {
    const didWin = myDisc === room.winner;
    return {
      title: didWin ? 'Победа' : 'Партия завершена',
      description: `${getPlayerLabel(room.winner)} собрал 4 в ряд.`
    };
  }

  if (!isRoomFull(room)) {
    return {
      title: 'Ожидаем второго игрока',
      description: 'Скопируй ссылку и отправь другу.'
    };
  }

  if (!myDisc) {
    return {
      title: 'Режим зрителя',
      description: `${getPlayerLabel(room.turn)} сейчас делает ход.`
    };
  }

  const isMyTurn = room.turn === myDisc;
  return {
    title: isMyTurn ? 'Твой ход' : 'Ход соперника',
    description: isMyTurn ? 'Выбери колонку, куда упадет фишка.' : 'Ждем ответный ход второго игрока.'
  };
}

function StatusPill({ label, value }) {
  return (
    <div className="status-pill">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Shell({ children, className = '' }) {
  return (
    <div className={`outer-shell ${className}`}>
      <div className="inner-core">{children}</div>
    </div>
  );
}

function ScoreRail({ room, myDisc }) {
  const red = room?.players?.red;
  const yellow = room?.players?.yellow;

  return (
    <div className="score-rail">
      <PlayerCard disc={RED} player={red} active={room?.turn === RED && !room?.winner} own={myDisc === RED} />
      <div className="versus-dot">vs</div>
      <PlayerCard disc={YELLOW} player={yellow} active={room?.turn === YELLOW && !room?.winner} own={myDisc === YELLOW} />
    </div>
  );
}

function PlayerCard({ disc, player, active, own }) {
  const isRed = disc === RED;
  const name = player?.uid ? player.name || 'Игрок' : 'Свободно';

  return (
    <div className={`player-card ${active ? 'active' : ''} ${own ? 'own' : ''}`}>
      <span className={`disc-preview ${isRed ? 'red' : 'yellow'}`} />
      <div>
        <strong>{name}</strong>
        <span>{getPlayerLabel(disc)} {player?.connected ? 'online' : 'offline'}</span>
      </div>
    </div>
  );
}

function Board({ room, canPlay, onMove }) {
  const board = room?.board || INITIAL_BOARD;
  const cells = parseBoard(board);
  const winningCells = new Set((room?.winningLine || []).map(([row, col]) => `${row}:${col}`));
  const lastMoveKey = room?.lastMove ? `${room.lastMove.row}:${room.lastMove.col}` : '';

  return (
    <div className={`board-wrap ${canPlay ? 'playable' : ''}`} aria-label="Игровое поле 4 в ряд">
      {Array.from({ length: ROWS }).map((_, row) =>
        Array.from({ length: COLS }).map((__, col) => {
          const cell = cells[row * COLS + col] || EMPTY;
          const key = `${row}:${col}`;
          const isWinning = winningCells.has(key);
          const isLast = lastMoveKey === key;

          return (
            <button
              key={key}
              type="button"
              className={`board-cell ${cell === RED ? 'has-red' : ''} ${cell === YELLOW ? 'has-yellow' : ''} ${isWinning ? 'winning' : ''} ${isLast ? 'last' : ''}`}
              onClick={() => onMove(col)}
              disabled={!canPlay}
              aria-label={`Колонка ${col + 1}, строка ${row + 1}`}
            >
              <span className="cell-cavity">
                {cell !== EMPTY ? <span className="disc" /> : null}
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

export default App;
