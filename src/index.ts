import { bootstrap, shutdown } from './bootstrap.js';

let shuttingDown = false;

bootstrap().catch((error) => {
  console.error('❌ Fatal error starting worker:', error);
  process.exit(1);
});

function handleShutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`\n⏹️  Shutting down (${signal})...`);
  void shutdown().finally(() => process.exit(0));
}

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
