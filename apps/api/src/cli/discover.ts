import { loadConfigOrExit } from './config.js';

loadConfigOrExit();
process.stdout.write('brak skonfigurowanych źródeł\n');
