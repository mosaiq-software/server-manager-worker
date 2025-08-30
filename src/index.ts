import 'dotenv/config';
import { initApp } from './app';
import { applyGithubFingerprints } from './utils/authGit';
import { exit } from 'process';

const start = async () => {
    const app = await initApp();
    const server = app.listen(process.env.API_PORT, () => {
        console.log(`Server started at ${process.env.API_URL}:${process.env.API_PORT}`);
    });

    applyGithubFingerprints();

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
