import prisma from '../config/database';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { generateToken, hashPassword, comparePassword } from '../utils/response';
import { AuthRequest } from '../middleware/auth';

export const login = async (email: string, password: string) => {
  const user = await prisma.user.findFirst({
    where: { email },
    include: {
      role: true,
      restaurant: true,
      branch: true,
      userStations: { include: { station: { include: { branch: { select: { name: true } } } } } },
    },
  });

  if (!user || user.status !== 'ACTIVE') {
    throw new Error('Invalid credentials or inactive account');
  }

  const isValid = await comparePassword(password, user.passwordHash);
  if (!isValid) {
    throw new Error('Invalid credentials');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const token = generateToken(user.id, user.restaurantId, user.tokenVersion);

  return {
    token,
    user: {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      roleId: user.roleId,
      roleName: user.role.name,
      restaurantId: user.restaurantId,
      restaurantName: user.restaurant.name,
      branchId: user.branchId,
      branchName: user.branch?.name,
      status: user.status,
      employeeCode: user.employeeCode,
      jobTitle: user.jobTitle,
      hireDate: user.hireDate,
      notes: user.notes,
      permissions: (() => {
        try {
          return JSON.parse(user.role?.permissions || '[]');
        } catch {
          return [];
        }
      })(),
      stations: (user.userStations || []).map((us) => ({
        id: us.station?.id,
        name: us.station?.name,
        branchId: us.station?.branchId,
        branchName: us.station?.branch?.name || '',
      })),
    },
  };
};

export const createInitialAdmin = async (data: {
  restaurantName: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerPhone?: string;
}) => {
  const existingRestaurant = await prisma.restaurant.findFirst();
  if (existingRestaurant) {
    throw new Error('Restaurant already exists');
  }

  const ownerRole = await prisma.role.findUnique({
    where: { name: 'OWNER' },
  });

  if (!ownerRole) {
    throw new Error('OWNER role not found. Please run seed script first.');
  }

  const restaurant = await prisma.restaurant.create({
    data: {
      name: data.restaurantName,
      legalName: data.restaurantName,
      status: 'ACTIVE',
    },
  });

  const passwordHash = await hashPassword(data.ownerPassword);

  const owner = await prisma.user.create({
    data: {
      restaurantId: restaurant.id,
      firstName: data.ownerFirstName,
      lastName: data.ownerLastName,
      email: data.ownerEmail,
      phone: data.ownerPhone,
      passwordHash,
      passwordChangedAt: new Date(),
      tokenVersion: 0,
      roleId: ownerRole.id,
      status: 'ACTIVE',
    },
    include: {
      role: true,
      restaurant: true,
    },
  });

  return {
    restaurant,
    user: {
      id: owner.id,
      firstName: owner.firstName,
      lastName: owner.lastName,
      email: owner.email,
      roleName: owner.role.name,
    },
  };
};

export const getMe = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: true,
      restaurant: true,
      branch: true,
      userStations: { include: { station: { include: { branch: { select: { name: true } } } } } },
    },
  });

  if (!user) {
    throw new Error('User not found');
  }

  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    roleId: user.roleId,
    roleName: user.role.name,
    restaurantId: user.restaurantId,
    restaurantName: user.restaurant.name,
    branchId: user.branchId,
    branchName: user.branch?.name,
    status: user.status,
    employeeCode: user.employeeCode,
    jobTitle: user.jobTitle,
    hireDate: user.hireDate,
    notes: user.notes,
    permissions: (() => {
      try {
        return JSON.parse(user.role?.permissions || '[]');
      } catch {
        return [];
      }
    })(),
    stations: (user.userStations || []).map((us) => ({
      id: us.station?.id,
      name: us.station?.name,
      branchId: us.station?.branchId,
      branchName: us.station?.branch?.name || '',
    })),
  };
};
