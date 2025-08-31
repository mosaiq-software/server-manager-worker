import cors from 'cors';
import express from 'express';
import routes from './routes';

export const initApp = async () => {
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true, limit: '1mb' }));
    app.set('trust proxy', true);
    app.use(routes);

    return app;
};
