import cors from 'cors';
import express from 'express';
import routes from './routes/routes';

export const initApp = async () => {
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '100mb' }));
    app.use(express.urlencoded({ extended: true, limit: '100mb' }));
    app.set('trust proxy', true);
    app.use(routes);

    return app;
};
