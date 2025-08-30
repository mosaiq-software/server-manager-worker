import { Sequelize } from 'sequelize';
export const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: `${process.env.DATABASE_DIR}/${
        process.env.DATABASE_NAME ?? 'database.sqlite'
    }`,
    logging: process.env.DATABASE_LOGGING === 'true',
});

sequelize.sync();
