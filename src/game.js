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
    return 'Гранатовый';
  }

  if (disc === YELLOW) {
    return 'Золотой';
  }

  return 'Зритель';
}

export function getOpponentDisc(disc) {
  return disc === RED ? YELLOW : RED;
}

export function isRoomFull(room) {
  return Boolean(room?.players?.red?.uid && room?.players?.yellow?.uid);
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
