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
  chooseBotColumn,
  getOpponentDisc,
  getPlayerDisc,
  getPlayerLabel,
  isRoomFull,
  makeRoomCode,
  normalizeRoomCode,
  parseBoard
} from './game';

const STORAGE_NAME_KEY = 'four-row-player-name';
const STORAGE_THEME_KEY = 'four-row-theme';
const HUMAN_UID = 'local-human';
const BOT_UID = 'local-bot';

const GAME_MODES = [
  { value: 'online', label: 'Онлайн' },
  { value: 'bot', label: 'Бот' }
];

const THEME_OPTIONS = [
  { value: 'system', label: 'Система' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Темная' }
];

const BOT_DIFFICULTIES = [
  { value: 'easy', label: 'Легкий' },
  { value: 'normal', label: 'Средний' },
  { value: 'hard', label: 'Сложный' }
];

function getInitialCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return normalizeRoomCode(params.get('room'));
}

function getInitialThemePreference() {
  const saved = localStorage.getItem(STORAGE_THEME_KEY);
  return THEME_OPTIONS.some((option) => option.value === saved) ? saved : 'system';
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

function createBotRoom(displayName) {
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
        uid: HUMAN_UID,
        name: displayName,
        connected: true
      },
      yellow: {
        uid: BOT_UID,
        name: 'Бот',
        connected: true
      }
    },
    status: 'playing',
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
  const [botRoom, setBotRoom] = useState(() => createBotRoom(getSafeName(localStorage.getItem(STORAGE_NAME_KEY))));
  const [notice, setNotice] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [autoJoinAttempted, setAutoJoinAttempted] = useState(false);
  const [themePreference, setThemePreference] = useState(getInitialThemePreference);
  const [gameMode, setGameMode] = useState('online');
  const [botDifficulty, setBotDifficulty] = useState('normal');
  const [isBoardExpanded, setIsBoardExpanded] = useState(false);
  const [resultDismissedKey, setResultDismissedKey] = useState('');

  const safeName = useMemo(() => getSafeName(displayName), [displayName]);
  const onlineMyDisc = useMemo(() => getPlayerDisc(room, user?.uid), [room, user]);
  const currentRoom = gameMode === 'bot' ? botRoom : room;
  const myDisc = gameMode === 'bot' ? RED : onlineMyDisc;
  const opponentDisc = onlineMyDisc ? getOpponentDisc(onlineMyDisc) : null;
  const canPlay =
    gameMode === 'bot'
      ? Boolean(botRoom && botRoom.status === 'playing' && botRoom.turn === RED && !botRoom.winner)
      : Boolean(room && user && onlineMyDisc && room.status === 'playing' && room.turn === onlineMyDisc && !room.winner);
  const heroStatus = getHeroStatus(currentRoom, myDisc, gameMode);
  const resultKey = getResultKey(currentRoom, gameMode, activeRoomCode);
  const resultState = getResultState(currentRoom, myDisc);
  const showResult = Boolean(resultState && resultKey && resultDismissedKey !== resultKey);
  const panelNotice = notice || (gameMode === 'online' ? authError : '');

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const resolvedTheme = themePreference === 'system' ? (media.matches ? 'dark' : 'light') : themePreference;
      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.dataset.themePreference = themePreference;
      document.documentElement.style.colorScheme = resolvedTheme;
    };

    applyTheme();
    localStorage.setItem(STORAGE_THEME_KEY, themePreference);

    if (themePreference !== 'system') {
      return undefined;
    }

    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [themePreference]);

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
    setBotRoom((current) => {
      if (current.players.red.name === safeName) {
        return current;
      }

      return {
        ...current,
        players: {
          ...current.players,
          red: {
            ...current.players.red,
            name: safeName
          }
        }
      };
    });
  }, [safeName]);

  useEffect(() => {
    if (gameMode !== 'online' || !user || autoJoinAttempted || activeRoomCode || !joinCode) {
      return;
    }

    setAutoJoinAttempted(true);
    joinRoom(joinCode);
  }, [activeRoomCode, autoJoinAttempted, gameMode, joinCode, user]);

  useEffect(() => {
    if (gameMode !== 'online' || !db || !user || !room || !activeRoomCode || !onlineMyDisc) {
      return;
    }

    const seat = onlineMyDisc === RED ? 'red' : 'yellow';

    if (room.players?.[seat]?.name === safeName) {
      return;
    }

    update(ref(db, `rooms/${activeRoomCode}/players/${seat}`), { name: safeName }).catch(() => {});
  }, [activeRoomCode, gameMode, onlineMyDisc, room, safeName, user]);

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
    if (gameMode !== 'online' || !db || !user || !room || !activeRoomCode) {
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
  }, [activeRoomCode, gameMode, room, user]);

  useEffect(() => {
    if (gameMode !== 'bot' || botRoom.status !== 'playing' || botRoom.turn !== YELLOW || botRoom.winner) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setBotRoom((current) => {
        if (!current || current.status !== 'playing' || current.turn !== YELLOW || current.winner) {
          return current;
        }

        const col = chooseBotColumn(current.board, botDifficulty, YELLOW, RED);

        if (typeof col !== 'number') {
          return current;
        }

        return applyMoveToRoom(current, BOT_UID, col);
      });
    }, 520);

    return () => window.clearTimeout(timer);
  }, [botDifficulty, botRoom, gameMode]);

  useEffect(() => {
    if (!resultKey) {
      setResultDismissedKey('');
    }
  }, [resultKey]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key !== 'Escape') {
        return;
      }

      if (showResult) {
        setResultDismissedKey(resultKey);
        return;
      }

      if (isBoardExpanded) {
        setIsBoardExpanded(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBoardExpanded, resultKey, showResult]);

  useEffect(() => {
    const shouldLock = isBoardExpanded || showResult;
    const previousOverflow = document.body.style.overflow;

    if (shouldLock) {
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isBoardExpanded, showResult]);

  function selectGameMode(nextMode) {
    setGameMode(nextMode);
    setNotice('');
    setCopied(false);
    setResultDismissedKey('');

    if (nextMode === 'bot') {
      setActiveRoomCode('');
      setRoom(undefined);
      setBotRoom(createBotRoom(safeName));
      updateRoomUrl('');
    }
  }

  async function createRoom() {
    if (!db || !user) {
      setNotice('Firebase еще не готов. Проверь конфиг и включи Anonymous Auth.');
      return;
    }

    setGameMode('online');
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

    setGameMode('online');
    setIsBusy(true);
    setNotice('');

    try {
      const roomReference = ref(db, `rooms/${code}`);
      const result = await runTransaction(
        roomReference,
        (currentRoomSnapshot) => claimSeat(currentRoomSnapshot, user, safeName),
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
    if (gameMode === 'bot') {
      if (!canPlay) {
        return;
      }

      setBotRoom((current) => applyMoveToRoom(current, HUMAN_UID, col));
      return;
    }

    if (!db || !user || !activeRoomCode || !canPlay) {
      return;
    }

    const roomReference = ref(db, `rooms/${activeRoomCode}`);

    try {
      await runTransaction(roomReference, (currentRoomSnapshot) => applyMoveToRoom(currentRoomSnapshot, user.uid, col));
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function restartGame() {
    setResultDismissedKey('');

    if (gameMode === 'bot') {
      setBotRoom(createBotRoom(safeName));
      return;
    }

    if (!db || !user || !activeRoomCode) {
      return;
    }

    const roomReference = ref(db, `rooms/${activeRoomCode}`);

    try {
      await runTransaction(roomReference, (currentRoomSnapshot) => {
        if (!currentRoomSnapshot || !getPlayerDisc(currentRoomSnapshot, user.uid)) {
          return currentRoomSnapshot;
        }

        const hasBothPlayers = Boolean(currentRoomSnapshot.players?.red?.uid && currentRoomSnapshot.players?.yellow?.uid);

        return {
          ...currentRoomSnapshot,
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
    if (!db || !activeRoomCode || !room || !onlineMyDisc) {
      leaveRoom();
      return;
    }

    const seat = onlineMyDisc === RED ? 'red' : 'yellow';
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

  return (
    <main className="app-shell">
      <div className="ambient-orb ambient-orb-a" />
      <div className="ambient-orb ambient-orb-b" />
      <div className="grain" />

      <header className="fluid-nav reveal-on-load">
        <button className="nav-field-button" type="button" onClick={() => setIsBoardExpanded(true)}>
          <span className="brand-mark">
            <ExpandIcon />
          </span>
          <span className="brand-copy">
            <span className="brand-title">Открыть поле на полный экран</span>
            <span className="brand-caption">{gameMode === 'bot' ? 'Партия с ботом' : 'Поле 4 в ряд'}</span>
          </span>
        </button>
        {activeRoomCode ? <button className="nav-chip" onClick={clearRoom}>Выйти</button> : null}
      </header>

      <section className="hero-grid">
        <div className="hero-copy reveal-on-load delayed-a">
          <span className="eyebrow">4 в ряд</span>
          <h1>4 в ряд.</h1>
          <p>
            Создай комнату, отправь ссылку другу или сыграй локальную партию с ботом на спокойном игровом поле.
          </p>

          <div className="status-stack">
            <StatusPill label="Режим" value={gameMode === 'bot' ? 'Игра с ботом' : 'Онлайн-дуэль'} />
            <StatusPill label="Комната" value={gameMode === 'bot' ? 'локальная' : activeRoomCode || 'не выбрана'} />
            <StatusPill label="Ты" value={myDisc ? getPlayerLabel(myDisc) : 'пока зритель'} />
          </div>
        </div>

        <div className="game-column reveal-on-load delayed-b">
          <Shell className="control-shell">
            <div className="panel-head">
              <div>
                <span className="eyebrow compact">Лобби</span>
                <h2>{gameMode === 'bot' ? 'Игра с ботом' : 'Комната'}</h2>
              </div>
              <span className="room-token">{gameMode === 'bot' ? 'BOT' : activeRoomCode || '-----'}</span>
            </div>

            <div className="settings-grid">
              <SegmentedControl label="Режим" value={gameMode} options={GAME_MODES} onChange={selectGameMode} />
              <SegmentedControl label="Тема" value={themePreference} options={THEME_OPTIONS} onChange={setThemePreference} />
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

            {gameMode === 'bot' ? (
              <div className="bot-settings">
                <SegmentedControl
                  label="Сложность бота"
                  value={botDifficulty}
                  options={BOT_DIFFICULTIES}
                  onChange={setBotDifficulty}
                  wide
                />
                <button className="magnetic-button primary" onClick={restartGame}>
                  Новая партия
                  <span className="button-orb"><span className="orb-symbol">↻</span></span>
                </button>
              </div>
            ) : (
              <>
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
                    <span className="button-orb"><span className="orb-symbol">↗</span></span>
                  </button>
                </div>

                <div className="button-grid">
                  <button className="magnetic-button primary" onClick={createRoom} disabled={isBusy || !user}>
                    Создать
                    <span className="button-orb"><span className="orb-symbol">+</span></span>
                  </button>
                  <button className="magnetic-button ghost" onClick={copyInviteLink} disabled={!activeRoomCode}>
                    {copied ? 'Скопировано' : 'Ссылка'}
                    <span className="button-orb"><span className="orb-symbol">⤴</span></span>
                  </button>
                </div>
              </>
            )}

            {panelNotice ? <div className="notice">{panelNotice}</div> : null}
          </Shell>

          <Shell className="board-shell">
            <div className="board-head">
              <div>
                <span className="eyebrow compact">Поле</span>
                <h2>{heroStatus.title}</h2>
                <p>{heroStatus.description}</p>
              </div>
              <div className="board-actions">
                <button className="mini-action icon-action" onClick={() => setIsBoardExpanded(true)} aria-label="Открыть поле на полный экран">
                  <ExpandIcon />
                </button>
                {currentRoom && myDisc ? (
                  <button className="mini-action" onClick={restartGame}>Новая</button>
                ) : null}
              </div>
            </div>

            <ScoreRail room={currentRoom} myDisc={myDisc} />
            <Board room={currentRoom} canPlay={canPlay} onMove={makeMove} />
          </Shell>
        </div>
      </section>

      {isBoardExpanded ? (
        <BoardFullscreen
          room={currentRoom}
          myDisc={myDisc}
          status={heroStatus}
          canPlay={canPlay}
          onMove={makeMove}
          onClose={() => setIsBoardExpanded(false)}
          onRestart={currentRoom && myDisc ? restartGame : null}
        />
      ) : null}

      {showResult ? (
        <ResultOverlay
          result={resultState}
          onClose={() => setResultDismissedKey(resultKey)}
          onRestart={myDisc ? restartGame : null}
        />
      ) : null}
    </main>
  );
}

function getHeroStatus(room, myDisc, gameMode) {
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
      title: didWin ? 'Победа' : myDisc ? 'Поражение' : 'Партия завершена',
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

  if (gameMode === 'bot' && room.turn === YELLOW) {
    return {
      title: 'Ход бота',
      description: 'Бот выбирает колонку для ответного хода.'
    };
  }

  const isMyTurn = room.turn === myDisc;
  return {
    title: isMyTurn ? 'Твой ход' : 'Ход соперника',
    description: isMyTurn ? 'Выбери колонку, куда упадет фишка.' : 'Ждем ответный ход второго игрока.'
  };
}

function getResultKey(room, gameMode, activeRoomCode) {
  if (!room?.winner) {
    return '';
  }

  return `${gameMode}:${activeRoomCode || 'local'}:${room.createdAt || 0}:${room.lastMove?.at || 0}:${room.winner}`;
}

function getResultState(room, myDisc) {
  if (!room?.winner) {
    return null;
  }

  if (room.winner === 'draw') {
    return {
      kind: 'draw',
      title: 'Ничья',
      description: 'Поле заполнено. Можно сразу начать новую партию.'
    };
  }

  if (!myDisc) {
    return {
      kind: 'spectator',
      title: 'Партия завершена',
      description: `${getPlayerLabel(room.winner)} собрал 4 в ряд.`
    };
  }

  const didWin = room.winner === myDisc;

  return {
    kind: didWin ? 'win' : 'loss',
    title: didWin ? 'Вы победили!' : 'Вы проиграли!',
    description: didWin ? 'Четыре фишки собрались в линию.' : `${getPlayerLabel(room.winner)} собрал 4 в ряд.`
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

function SegmentedControl({ label, value, options, onChange, wide = false }) {
  return (
    <div className={`control-group ${wide ? 'wide' : ''}`}>
      <span className="control-label">{label}</span>
      <div className="segmented-control">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`segment-button ${value === option.value ? 'active' : ''}`}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
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
        <span>{getPlayerLabel(disc)} {player?.connected ? 'онлайн' : 'оффлайн'}</span>
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

function BoardFullscreen({ room, myDisc, canPlay, onMove, onClose, onRestart }) {
  return (
    <div className="board-overlay" role="dialog" aria-modal="true" aria-label="Поле на полный экран">
      <div className="board-overlay-shell">
        <div className="board-overlay-core">
          <div className="board-overlay-topline">
            <ScoreRail room={room} myDisc={myDisc} />
            <div className="board-overlay-actions">
              {onRestart ? <button className="mini-action" onClick={onRestart}>Новая</button> : null}
              <button className="mini-action icon-action close-action" onClick={onClose} aria-label="Закрыть поле">
                <span className="close-glyph" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="expanded-board-stage">
            <Board room={room} canPlay={canPlay} onMove={onMove} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultOverlay({ result, onClose, onRestart }) {
  return (
    <div className={`result-backdrop result-${result.kind}`} role="dialog" aria-modal="true" aria-label={result.title}>
      {result.kind === 'win' ? <Fireworks /> : null}
      <div className="result-card">
        <span className="eyebrow compact">Финал</span>
        <h2>{result.title}</h2>
        <p>{result.description}</p>
        <div className="result-actions">
          {onRestart ? (
            <button className="magnetic-button primary" onClick={onRestart}>
              Новая партия
              <span className="button-orb"><span className="orb-symbol">↻</span></span>
            </button>
          ) : null}
          <button className="magnetic-button secondary" onClick={onClose}>
            Закрыть
            <span className="button-orb"><span className="close-glyph small" aria-hidden="true" /></span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Fireworks() {
  return (
    <div className="fireworks" aria-hidden="true">
      <span className="firework firework-a" />
      <span className="firework firework-b" />
      <span className="firework firework-c" />
    </div>
  );
}

function ExpandIcon() {
  return <span className="expand-glyph" aria-hidden="true">⛶</span>;
}

export default App;
