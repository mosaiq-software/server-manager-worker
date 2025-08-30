import { sequelize } from '@/utils/dbHelper';
import { Secret } from '@mosaiq/nsm-common/types';
import { DataTypes, Model } from 'sequelize';

class SecretModel extends Model {}
SecretModel.init(
    {
        projectId: {
            type: DataTypes.STRING,
            primaryKey: true,
        },
        env: {
            type: DataTypes.STRING,
            primaryKey: true,
        },
        secretName: {
            type: DataTypes.STRING,
            primaryKey: true,
        },
        secretValue: {
            type: DataTypes.STRING,
        },
        secretPlaceholder: {
            type: DataTypes.STRING,
        },
    },
    { sequelize }
);

export const getAllSecretsForProjectModel = async (projectId: string): Promise<Secret[]> => {
    return (await SecretModel.findAll({ where: { projectId } }))?.map((sec) => sec.toJSON()) as Secret[];
};

export const createSecretModel = async (sec: Secret) => {
    return await SecretModel.create({ ...sec });
};

export const updateSecretModel = async (projectId: string, env: string, secretName: string, newValue: string) => {
    return await SecretModel.update(
        {
            secretValue: newValue,
        },
        { where: { projectId, env, secretName } }
    );
};

export const deleteAllSecretsForProjectEnvModel = async (projectId: string, env: string) => {
    return await SecretModel.destroy({ where: { projectId, env } });
};
