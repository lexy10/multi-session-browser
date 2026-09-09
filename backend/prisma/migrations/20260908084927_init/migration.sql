-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'USER');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "decodoUsername" TEXT NOT NULL DEFAULT '',
    "decodoPasswordEnc" TEXT NOT NULL DEFAULT '',
    "endpoint" TEXT NOT NULL DEFAULT 'gate.decodo.com:7000',
    "sessionDuration" INTEGER NOT NULL DEFAULT 30,
    "dataSaver" TEXT NOT NULL DEFAULT 'balanced',
    "autoCountry" TEXT NOT NULL DEFAULT '',
    "autoCity" TEXT NOT NULL DEFAULT '',
    "globalLock" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
