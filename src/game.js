export const ROWS = 6;
export const COLS = 7;
export const EMPTY = '.';
export const RED = 'R';
export const YELLOW = 'Y';
export const INITIAL_BOARD = EMPTY.repeat(ROWS * COLS);

export function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';

  for (let index = 0; index < 5; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return code;
}

export function normalizeRoomCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

export function parseBoard(board) {
  const source = typeof board === 'string' && board.length === ROWS * COLS ? board : INITIAL_BOARD;
  return source.split('');
}

export function serializeBoard(cells) {
  return cells.join('').slice(0, ROWS * COLS).padEnd(ROWS * COLS, EMPTY);
}

export function indexOfCell(row, col) {
  return row * COLS + col;
}

export function dropDisc(boardString, col, disc) {
  const cells = parseBoard(boardString);

  for (let row = ROWS - 1; row >= 0; row -= 1) {
    const index = indexOfCell(row, col);

    if (cells[index] === EMPTY) {
      cells[index] = disc;
      return {
        board: serializeBoard(cells),
        row,
        col
      };
    }
  }

  return null;
}

export function getCell(boardString, row, col) {
  const cells = parseBoard(boardString);
  return cells[indexOfCell(row, col)];
}

export function detectWinner(boardString) {
  const cells = parseBoard(boardString);
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1]
  ];

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const disc = cells[indexOfCell(row, col)];

      if (disc === EMPTY) {
        continue;
      }

      for (const [deltaRow, deltaCol] of directions) {
        const line = [[row, col]];

        for (let step = 1; step < 4; step += 1) {
          const nextRow = row + deltaRow * step;
          const nextCol = col + deltaCol * step;

          if (nextRow < 0 || nextRow >= ROWS || nextCol < 0 || nextCol >= COLS) {
            break;
          }

          if (cells[indexOfCell(nextRow, nextCol)] !== disc) {
            break;
          }

          line.push([nextRow, nextCol]);
        }

        if (line.length === 4) {
          return {
            winner: disc,
            line
          };
        }
      }
    }
  }

  return null;
}

export function isDraw(boardString) {
  return parseBoard(boardString).every((cell) => cell !== EMPTY) && !detectWinner(boardString);
}

export function getLegalColumns(boardString) {
  const cells = parseBoard(boardString);

  return Array.from({ length: COLS }, (_, col) => col).filter((col) => cells[indexOfCell(0, col)] === EMPTY);
}

export function simulateMove(boardString, col, disc) {
  const move = dropDisc(boardString, col, disc);

  if (!move) {
    return null;
  }

  const victory = detectWinner(move.board);
  const draw = isDraw(move.board);

  return {
    ...move,
    status: victory || draw ? 'finished' : 'playing',
    winner: victory?.winner || (draw ? 'draw' : ''),
    winningLine: victory?.line || []
  };
}

export function getPlayerDisc(room, uid) {
  if (!room || !uid) {
    return null;
  }

  if (room.players?.red?.uid === uid) {
    return RED;
  }

  if (room.players?.yellow?.uid === uid) {
    return YELLOW;
  }

  return null;
}

export function getPlayerLabel(disc) {
  if (disc === RED) {
    return 'Красный';
  }

  if (disc === YELLOW) {
    return 'Зеленый';
  }

  return 'Зритель';
}

export function getOpponentDisc(disc) {
  return disc === RED ? YELLOW : RED;
}

export function isRoomFull(room) {
  return Boolean(room?.players?.red?.uid && room?.players?.yellow?.uid);
}

const CENTER_FIRST_COLUMNS = [3, 2, 4, 1, 5, 0, 6];

function findTacticalMove(boardString, disc) {
  return CENTER_FIRST_COLUMNS.find((col) => simulateMove(boardString, col, disc)?.winner === disc);
}

function scoreWindow(window, botDisc, humanDisc) {
  const botCount = window.filter((cell) => cell === botDisc).length;
  const humanCount = window.filter((cell) => cell === humanDisc).length;
  const emptyCount = window.filter((cell) => cell === EMPTY).length;

  if (botCount === 4) {
    return 100000;
  }

  if (humanCount === 4) {
    return -100000;
  }

  if (botCount === 3 && emptyCount === 1) {
    return 120;
  }

  if (botCount === 2 && emptyCount === 2) {
    return 18;
  }

  if (humanCount === 3 && emptyCount === 1) {
    return -150;
  }

  if (humanCount === 2 && emptyCount === 2) {
    return -20;
  }

  return 0;
}

function scoreBoard(boardString, botDisc, humanDisc) {
  const cells = parseBoard(boardString);
  let score = 0;

  for (let row = 0; row < ROWS; row += 1) {
    if (cells[indexOfCell(row, 3)] === botDisc) {
      score += 7;
    }
  }

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col <= COLS - 4; col += 1) {
      score += scoreWindow(
        [0, 1, 2, 3].map((step) => cells[indexOfCell(row, col + step)]),
        botDisc,
        humanDisc
      );
    }
  }

  for (let col = 0; col < COLS; col += 1) {
    for (let row = 0; row <= ROWS - 4; row += 1) {
      score += scoreWindow(
        [0, 1, 2, 3].map((step) => cells[indexOfCell(row + step, col)]),
        botDisc,
        humanDisc
      );
    }
  }

  for (let row = 0; row <= ROWS - 4; row += 1) {
    for (let col = 0; col <= COLS - 4; col += 1) {
      score += scoreWindow(
        [0, 1, 2, 3].map((step) => cells[indexOfCell(row + step, col + step)]),
        botDisc,
        humanDisc
      );
    }
  }

  for (let row = 0; row <= ROWS - 4; row += 1) {
    for (let col = 3; col < COLS; col += 1) {
      score += scoreWindow(
        [0, 1, 2, 3].map((step) => cells[indexOfCell(row + step, col - step)]),
        botDisc,
        humanDisc
      );
    }
  }

  return score;
}

function minimax(boardString, depth, alpha, beta, maximizing, botDisc, humanDisc) {
  const victory = detectWinner(boardString);
  const legalColumns = getLegalColumns(boardString);

  if (victory?.winner === botDisc) {
    return { score: 1000000 + depth, col: null };
  }

  if (victory?.winner === humanDisc) {
    return { score: -1000000 - depth, col: null };
  }

  if (depth === 0 || legalColumns.length === 0) {
    return { score: scoreBoard(boardString, botDisc, humanDisc), col: null };
  }

  const orderedColumns = CENTER_FIRST_COLUMNS.filter((col) => legalColumns.includes(col));
  let bestCol = orderedColumns[0] ?? null;

  if (maximizing) {
    let value = -Infinity;

    for (const col of orderedColumns) {
      const move = simulateMove(boardString, col, botDisc);
      const next = minimax(move.board, depth - 1, alpha, beta, false, botDisc, humanDisc);

      if (next.score > value) {
        value = next.score;
        bestCol = col;
      }

      alpha = Math.max(alpha, value);

      if (alpha >= beta) {
        break;
      }
    }

    return { score: value, col: bestCol };
  }

  let value = Infinity;

  for (const col of orderedColumns) {
    const move = simulateMove(boardString, col, humanDisc);
    const next = minimax(move.board, depth - 1, alpha, beta, true, botDisc, humanDisc);

    if (next.score < value) {
      value = next.score;
      bestCol = col;
    }

    beta = Math.min(beta, value);

    if (alpha >= beta) {
      break;
    }
  }

  return { score: value, col: bestCol };
}

export function chooseBotColumn(boardString, difficulty = 'normal', botDisc = YELLOW, humanDisc = RED) {
  const legalColumns = getLegalColumns(boardString);

  if (!legalColumns.length) {
    return null;
  }

  if (difficulty === 'easy') {
    return legalColumns[Math.floor(Math.random() * legalColumns.length)];
  }

  const winningMove = findTacticalMove(boardString, botDisc);

  if (typeof winningMove === 'number') {
    return winningMove;
  }

  const blockingMove = findTacticalMove(boardString, humanDisc);

  if (typeof blockingMove === 'number') {
    return blockingMove;
  }

  if (difficulty === 'hard') {
    return minimax(boardString, 5, -Infinity, Infinity, true, botDisc, humanDisc).col ?? legalColumns[0];
  }

  return CENTER_FIRST_COLUMNS.find((col) => legalColumns.includes(col)) ?? legalColumns[0];
}

export function applyMoveToRoom(room, uid, col) {
  if (!room || typeof col !== 'number') {
    return room;
  }

  const disc = getPlayerDisc(room, uid);

  if (!disc || room.status !== 'playing' || room.turn !== disc || room.winner) {
    return room;
  }

  if (col < 0 || col >= COLS) {
    return room;
  }

  const move = dropDisc(room.board, col, disc);

  if (!move) {
    return room;
  }

  const victory = detectWinner(move.board);
  const draw = isDraw(move.board);

  return {
    ...room,
    board: move.board,
    turn: victory || draw ? room.turn : getOpponentDisc(disc),
    status: victory || draw ? 'finished' : 'playing',
    winner: victory?.winner || (draw ? 'draw' : ''),
    winningLine: victory?.line || [],
    lastMove: {
      by: disc,
      row: move.row,
      col: move.col,
      at: Date.now()
    }
  };
}
