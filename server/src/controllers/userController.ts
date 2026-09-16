import { getUsers, createUser, updateUser, deleteUser, changeOwnPassword, resetUserPassword } from '../services/userService';
import { AuthRequest } from '../middleware/auth';
import { Response as ExpressResponse } from 'express';

export const getUsersController = (req: AuthRequest, res: ExpressResponse) => getUsers(req, res);
export const createUserController = (req: AuthRequest, res: ExpressResponse) => createUser(req, res);
export const updateUserController = (req: AuthRequest, res: ExpressResponse) => updateUser(req, res);
export const deleteUserController = (req: AuthRequest, res: ExpressResponse) => deleteUser(req, res);
export const changeOwnPasswordController = (req: AuthRequest, res: ExpressResponse) => changeOwnPassword(req, res);
export const resetUserPasswordController = (req: AuthRequest, res: ExpressResponse) => resetUserPassword(req, res);
