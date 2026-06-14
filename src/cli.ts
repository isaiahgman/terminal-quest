import terminalKit from 'terminal-kit';

const term = terminalKit.terminal;

/**
 * Restore the terminal to a clean state. Must run on EVERY exit path
 * (quit, SIGINT/SIGTERM, uncaught error) — a roguelike that leaves the
 * terminal in raw/alt-screen/hidden-cursor state is a failed run.
 */
let shuttingDown = false;
function shutdown(code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  term.hideCursor(false);
  term.grabInput(false);
  term.fullscreen(false);
  term.styleReset();
  process.exit(code);
}

function main(): void {
  term.fullscreen(true);
  term.hideCursor(true);
  term.grabInput(true);

  term.moveTo(2, 2).bold.cyan('⚔  Terminal Quest');
  term.moveTo(2, 4).gray('a real-time terminal action-roguelike');
  term.moveTo(2, 6).dim('press q to quit');

  term.on('key', (name: string) => {
    if (name === 'q' || name === 'CTRL_C') shutdown(0);
  });

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('uncaughtException', (err: unknown) => {
    shutdown(1);
    console.error(err);
  });
}

main();
