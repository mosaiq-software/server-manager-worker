import 'dotenv/config';
import { initApp } from './app';
import { applyGithubFingerprints, initializeBindings } from './initUtils';
import { exit } from 'process';

const start = async () => {
    const app = await initApp();
    const server = app.listen(process.env.WORKER_PORT, () => {
        console.log(`Server started on port ${process.env.WORKER_PORT}`);
    });

    applyGithubFingerprints();
    await initializeBindings();

    process.on('SIGTERM', async () => {
        console.warn('Received SIGTERM, Ignoring...');
    });

    process.on('SIGINT', async () => {
        console.warn('Received SIGINT');
        server.close(() => {
            console.log('Server closed');
            exit(0);
        });
    });
};

start();
